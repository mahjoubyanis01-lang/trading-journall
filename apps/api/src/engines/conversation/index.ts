import type { Personality } from "@task/shared";
import type { CompanionRow, PersonalityRow, RelationshipRow, UserRow } from "../../db/schema/index.js";
import type { AIProvider, ChatMessage, CompletionResult } from "../../providers/ai/types.js";
import { pickChatTask } from "../../providers/ai/router.js";
import { buildPersonalityPrompt } from "../personality/index.js";
import { buildVolatileContext } from "../context/index.js";
import { estimateEmotion, type EmotionEstimate } from "../emotion/index.js";
import { filterOutboundBubbles } from "../safety/index.js";
import { splitBubbles } from "./splitter.js";

export interface HistoryItem {
  sender: "user" | "companion" | "system";
  content: string;
}

export interface GenerateInput {
  user: UserRow;
  companion: CompanionRow;
  personality: PersonalityRow;
  relationship: RelationshipRow;
  history: HistoryItem[];
  mode: { kind: "reply" } | { kind: "initiative"; reason: string };
  memories?: string[];
  now?: Date;
  degrade?: boolean;
}

export interface GenerateOutput {
  bubbles: string[];
  raw: string;
  result: CompletionResult;
  task: "chat.simple" | "chat.deep";
  emotion: EmotionEstimate | null;
  safety: { filtered: boolean; violations: string[] };
}

const HISTORY_LIMIT = 40;

/**
 * Conversation Engine (section 18). Assemble personnalité (stable) + contexte (volatile)
 * + historique, choisit la tâche de routage, appelle le fournisseur, découpe en bulles,
 * applique le filtre relationnel. Aucune écriture en base : le module conversations s'en charge.
 */
export class ConversationEngine {
  constructor(private ai: AIProvider) {}

  buildMessages(history: HistoryItem[], mode: GenerateInput["mode"]): ChatMessage[] {
    const recent = history.filter((h) => h.sender !== "system").slice(-HISTORY_LIMIT);
    const msgs: ChatMessage[] = [];
    for (const h of recent) {
      const role = h.sender === "user" ? "user" : "assistant";
      const last = msgs[msgs.length - 1];
      // Fusionne les bulles consécutives d'un même émetteur en un tour.
      if (last && last.role === role) last.content += `\n---\n${h.content}`;
      else msgs.push({ role, content: h.content });
    }
    if (msgs.length === 0 || msgs[0]!.role !== "user") {
      // L'API exige un premier tour "user" : on l'explicite comme ouverture de conversation.
      msgs.unshift({ role: "user", content: mode.kind === "initiative" ? "(la conversation s'ouvre, tu écris en premier)" : "(début de la conversation)" });
    }
    if (mode.kind === "initiative" && msgs[msgs.length - 1]!.role === "assistant") {
      msgs.push({ role: "user", content: "(aucune réponse pour l'instant ; tu peux écrire de toi-même)" });
    }
    return msgs;
  }

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const personality: Personality = { traits: input.personality.traits, style: input.personality.style, preset: input.personality.preset };
    const system = buildPersonalityPrompt({
      companionName: input.companion.name,
      bio: input.companion.bio,
      userNickname: input.companion.userNickname,
      userDisplayName: input.user.displayName,
      personality,
      stage: input.relationship.stage,
    });

    const lastUser = [...input.history].reverse().find((h) => h.sender === "user");
    const emotion = input.mode.kind === "reply" && lastUser ? estimateEmotion(lastUser.content) : null;
    const systemVolatile = buildVolatileContext({
      user: input.user,
      relationship: input.relationship,
      now: input.now,
      emotion,
      mode: input.mode,
      companionName: input.companion.name,
      memories: input.memories,
    });

    const task = pickChatTask({
      relationshipStage: input.relationship.stage,
      emotionalIntensity: emotion?.intensity ?? 0,
      userMessageLength: lastUser?.content.length ?? 0,
      degrade: input.degrade,
    });

    let text = "";
    let result: CompletionResult | null = null;
    for await (const ev of this.ai.stream({
      task,
      system,
      systemVolatile,
      messages: this.buildMessages(input.history, input.mode),
      signals: { relationshipStage: input.relationship.stage, emotionalIntensity: emotion?.intensity ?? 0, degrade: input.degrade },
      meta: { userId: input.user.id, companionId: input.companion.id, feature: input.mode.kind === "reply" ? "chat.reply" : "chat.initiative" },
    })) {
      if (ev.type === "delta") text += ev.text;
      else result = ev.result;
    }
    if (!result) throw new Error("Le fournisseur IA n'a pas terminé la génération");

    const raw = result.text || text;
    const split = splitBubbles(raw, input.companion.name);
    const safety = filterOutboundBubbles(split);
    return { bubbles: safety.bubbles, raw, result, task, emotion, safety: { filtered: safety.filtered, violations: safety.violations } };
  }
}
