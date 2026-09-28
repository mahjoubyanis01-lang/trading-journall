import { and, asc, desc, eq, isNull, lt, sql } from "drizzle-orm";
import type { Conversation, Message, SendMessageInput } from "@task/shared";
import type { Db } from "../../db/client.js";
import { conversations, messages, relationshipEvents, relationships, type ConversationRow, type MessageRow } from "../../db/schema/index.js";
import { ConversationEngine } from "../../engines/conversation/index.js";
import { bubbleDelayMs } from "../../engines/conversation/splitter.js";
import { notFound } from "../../errors.js";
import type { CostMeter } from "../../costs/meter.js";
import type { Logger } from "../../observability/logger.js";
import { CompanionService } from "../companions/service.js";
import { ConversationBus } from "./bus.js";
import type { MemoryEngine } from "../../engines/memory/index.js";
import type { MoodService } from "../mood/service.js";
import { calibrate } from "../../engines/emotion/calibration.js";
import { estimateEmotion } from "../../engines/emotion/index.js";

export function toMessageDto(m: MessageRow): Message {
  return {
    id: m.id,
    conversationId: m.conversationId,
    sender: m.sender,
    kind: m.kind,
    content: m.content,
    mediaId: m.mediaId,
    burstIndex: m.burstIndex,
    createdAt: m.createdAt.toISOString(),
    readAt: m.readAt?.toISOString() ?? null,
  };
}

function toConversationDto(c: ConversationRow, unreadCount: number): Conversation {
  return {
    id: c.id,
    companionId: c.companionId!,
    kind: c.kind,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    lastMessagePreview: c.lastMessagePreview,
    unreadCount,
    createdAt: c.createdAt.toISOString(),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ConversationServiceOptions {
  /** Facteur de temporalité entre bulles (0 en test). */
  pacing: number;
  /** Délai d'attente avant de répondre, pour laisser l'utilisateur finir une rafale de messages. */
  settleMs: number;
}

/**
 * Service conversations. Toute lecture est filtrée par userId. La génération des réponses
 * est sérialisée par conversation : deux messages rapprochés produisent une seule réponse
 * qui voit les deux.
 */
export class ConversationService {
  private chains = new Map<string, Promise<void>>();
  private pendingFirstContact = new Set<string>();
  /** Par conversation : date du dernier message utilisateur déjà couvert par une génération. */
  private coveredUpTo = new Map<string, number>();

  /** Jobs d'arrière-plan (humeur, mémoire) : suivis pour pouvoir attendre leur fin (tests, arrêt propre). */
  private background = new Set<Promise<unknown>>();

  constructor(
    private db: Db,
    private engine: ConversationEngine,
    private companions: CompanionService,
    private costs: CostMeter,
    public bus: ConversationBus,
    private log: Logger,
    private opts: ConversationServiceOptions,
    private memory: MemoryEngine,
    private mood: MoodService,
  ) {}

  private track<T>(label: string, p: Promise<T>): void {
    const wrapped = p.catch((err) => this.log.warn({ err, job: label }, "job d'arrière-plan échoué")).finally(() => this.background.delete(wrapped));
    this.background.add(wrapped);
  }

  /** Attend la fin des générations et des jobs d'arrière-plan en cours. */
  async idle(): Promise<void> {
    for (let i = 0; i < 20 && (this.background.size > 0 || this.chains.size > 0); i++) {
      await Promise.allSettled([...this.background, ...this.chains.values()]);
    }
  }

  async list(userId: string): Promise<Conversation[]> {
    const rows = await this.db
      .select({
        c: conversations,
        // Drizzle rend `${conversations.id}` non qualifié dans une sélection mono-table : on qualifie explicitement.
        unread: sql<number>`(select count(*) from ${messages} m where m.conversation_id = "conversations"."id" and m.sender = 'companion' and m.read_at is null)`.mapWith(Number),
      })
      .from(conversations)
      .where(and(eq(conversations.userId, userId), eq(conversations.kind, "direct")))
      .orderBy(desc(conversations.lastMessageAt));
    return rows.filter((r) => r.c.companionId).map((r) => toConversationDto(r.c, r.unread));
  }

  /** Conversation directe d'un compagnon (créée si absente). Déclenche le premier contact si elle est vide. */
  async forCompanion(userId: string, companionId: string): Promise<Conversation> {
    await this.companions.getRaw(userId, companionId); // 404 si pas à l'utilisateur
    let row = await this.db.query.conversations.findFirst({ where: and(eq(conversations.userId, userId), eq(conversations.companionId, companionId), eq(conversations.kind, "direct")) });
    if (!row) {
      [row] = await this.db.insert(conversations).values({ userId, companionId, kind: "direct" }).returning();
    }
    const [count] = await this.db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(messages).where(eq(messages.conversationId, row!.id));
    if ((count?.n ?? 0) === 0 && !this.pendingFirstContact.has(row!.id)) {
      this.pendingFirstContact.add(row!.id);
      this.enqueue(row!.id, () => this.generate(userId, row!.id, { kind: "initiative", reason: "first_contact" }).finally(() => this.pendingFirstContact.delete(row!.id)));
    }
    return toConversationDto(row!, 0);
  }

  async getOwned(userId: string, conversationId: string): Promise<ConversationRow> {
    const row = await this.db.query.conversations.findFirst({ where: and(eq(conversations.id, conversationId), eq(conversations.userId, userId)) });
    if (!row) throw notFound("Conversation");
    return row;
  }

  async messages(userId: string, conversationId: string, before?: string, limit = 50): Promise<Message[]> {
    await this.getOwned(userId, conversationId);
    const where = before
      ? and(eq(messages.conversationId, conversationId), lt(messages.createdAt, new Date(before)))
      : eq(messages.conversationId, conversationId);
    const rows = await this.db.select().from(messages).where(where).orderBy(desc(messages.createdAt)).limit(limit);
    return rows.reverse().map(toMessageDto);
  }

  async markRead(userId: string, conversationId: string) {
    await this.getOwned(userId, conversationId);
    await this.db
      .update(messages)
      .set({ readAt: new Date() })
      .where(and(eq(messages.conversationId, conversationId), eq(messages.sender, "companion"), isNull(messages.readAt)));
  }

  /** Persiste le message utilisateur, le publie, et planifie la réponse. */
  async sendUserMessage(userId: string, conversationId: string, input: SendMessageInput): Promise<{ message: Message; reply: Promise<void> }> {
    const conv = await this.getOwned(userId, conversationId);
    const [row] = await this.db
      .insert(messages)
      .values({ conversationId, userId, companionId: conv.companionId, sender: "user", kind: "text", content: input.content, deliveredAt: new Date() })
      .returning();
    await this.db
      .update(conversations)
      .set({ lastMessageAt: row!.createdAt, lastMessagePreview: preview(input.content, true) })
      .where(eq(conversations.id, conversationId));
    const message = toMessageDto(row!);
    this.bus.publish(conversationId, { type: "message", message });
    // Humeur : en parallèle de la réponse, jamais bloquant.
    if (conv.companionId) {
      this.track(
        "mood.observe",
        (async () => {
          const { c } = await this.companions.getRaw(userId, conv.companionId!);
          const user = (await this.db.query.users.findFirst({ where: (t, { eq }) => eq(t.id, userId) }))!;
          await this.mood.observe(user, c, { id: row!.id, content: input.content });
        })(),
      );
    }
    const reply = this.enqueue(conversationId, () => this.generate(userId, conversationId, { kind: "reply" }));
    return { message, reply };
  }

  /** Sérialise les générations par conversation. */
  private enqueue(conversationId: string, job: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(conversationId) ?? Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(job)
      .catch((err) => {
        this.log.error({ err, conversationId }, "génération de réponse échouée");
        this.bus.publish(conversationId, { type: "error", code: "generation_failed", message: "Réponse indisponible pour le moment" });
      });
    this.chains.set(conversationId, next);
    void next.finally(() => {
      if (this.chains.get(conversationId) === next) this.chains.delete(conversationId);
    });
    return next;
  }

  private async generate(userId: string, conversationId: string, mode: { kind: "reply" } | { kind: "initiative"; reason: string }) {
    if (mode.kind === "reply" && this.opts.settleMs > 0) await sleep(this.opts.settleMs);
    const conv = await this.getOwned(userId, conversationId);
    if (!conv.companionId) return;
    const { c, p, r } = await this.companions.getRaw(userId, conv.companionId);
    const user = (await this.db.query.users.findFirst({ where: (t, { eq }) => eq(t.id, userId) }))!;
    const history = await this.db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt)).limit(200);

    // Coalescence : une rafale de messages utilisateur reçoit une seule réponse. Si tous les
    // messages utilisateur ont déjà été couverts par une génération précédente, on ne répond pas deux fois.
    const lastUser = [...history].reverse().find((h) => h.sender === "user");
    if (mode.kind === "reply") {
      if (!lastUser) return;
      if (lastUser.createdAt.getTime() <= (this.coveredUpTo.get(conversationId) ?? 0)) return;
      this.coveredUpTo.set(conversationId, lastUser.createdAt.getTime());
    }
    if (mode.kind === "initiative" && mode.reason === "first_contact" && history.length > 0) return;

    this.bus.publish(conversationId, { type: "typing", companionId: c.id });
    const started = Date.now();

    // Cerveau (rappel ciblé sur les derniers messages utilisateur) + calibration du moment.
    const recentUserText = history.filter((h) => h.sender === "user").slice(-3).map((h) => h.content).join(" ");
    const [brain, cal] = await Promise.all([this.memory.brainForPrompt(c.id, recentUserText, user.timezone), this.mood.getCalibration(c.id)]);
    const calibration = calibrate(cal, { traits: p.traits, style: p.style, preset: p.preset }, { heuristicNow: lastUser ? estimateEmotion(lastUser.content) : null });

    const out = await this.engine.generate({
      user,
      companion: c,
      personality: p,
      relationship: r,
      history: history.map((h) => ({ sender: h.sender, content: h.content })),
      mode,
      brain: brain.text,
      calibrationLines: calibration.lines,
    });
    if (brain.recalledIds.length) this.track("memory.touch", this.memory.touchRecalled(brain.recalledIds));

    // Relation et coûts sont persistés AVANT la publication des bulles : quand le client voit
    // le message, l'état serveur est cohérent.
    await this.db.transaction(async (tx) => {
      const first = r.interactionCount === 0;
      await tx
        .update(relationships)
        .set({ interactionCount: r.interactionCount + 1, lastInteractionAt: new Date(), updatedAt: new Date() })
        .where(eq(relationships.id, r.id));
      if (first) await tx.insert(relationshipEvents).values({ companionId: c.id, type: "first_conversation", payload: { mode: mode.kind } });
    });
    await this.costs.recordTokens({ userId, companionId: c.id, model: out.result.model, provider: out.result.provider, feature: mode.kind === "reply" ? "chat.reply" : "chat.initiative", usage: out.result.usage });

    const created: MessageRow[] = [];
    for (let i = 0; i < out.bubbles.length; i++) {
      const content = out.bubbles[i]!;
      if (i > 0 && this.opts.pacing > 0) {
        this.bus.publish(conversationId, { type: "typing", companionId: c.id });
        await sleep(bubbleDelayMs(content, this.opts.pacing));
      }
      const [row] = await this.db
        .insert(messages)
        .values({
          conversationId,
          userId,
          companionId: c.id,
          sender: "companion",
          kind: "text",
          content,
          burstIndex: out.bubbles.length > 1 ? i : null,
          deliveredAt: new Date(),
          generationMeta:
            i === 0
              ? {
                  model: out.result.model,
                  task: out.task,
                  inputTokens: out.result.usage.inputTokens,
                  outputTokens: out.result.usage.outputTokens,
                  latencyMs: Date.now() - started,
                  ...(mode.kind === "initiative" ? { initiativeReason: mode.reason } : {}),
                  safety: out.safety,
                }
              : undefined,
        })
        .returning();
      created.push(row!);
      await this.db.update(conversations).set({ lastMessageAt: row!.createdAt, lastMessagePreview: preview(content, false) }).where(eq(conversations.id, conversationId));
      this.bus.publish(conversationId, { type: "message", message: toMessageDto(row!) });
    }

    this.log.info(
      { conversationId, companionId: c.id, task: out.task, model: out.result.model, provider: out.result.provider, bubbles: out.bubbles.length, latencyMs: Date.now() - started, filtered: out.safety.filtered, mode: mode.kind, calibration: calibration.adjustments, unusual: calibration.unusual },
      "réponse générée",
    );

    // Mémoire : extraction sur le tour qui vient de se terminer (messages utilisateur depuis la dernière réponse + cette réponse).
    if (mode.kind === "reply") {
      let start = history.length;
      while (start > 0 && history[start - 1]!.sender !== "companion") start--;
      const turns = [...history.slice(start).map((h) => ({ sender: h.sender as "user" | "companion", content: h.content, id: h.id })), ...created.map((m) => ({ sender: "companion" as const, content: m.content, id: m.id }))];
      this.track(
        "memory.ingest",
        this.memory.ingest({ user, companionId: c.id, companionName: c.name, userNickname: c.userNickname, turns }).then((r) => {
          if (r.added.length || r.updated.length || r.events.length || r.forgotten.length) {
            this.log.info({ companionId: c.id, added: r.added.length, updated: r.updated.length, events: r.events.length, forgotten: r.forgotten.length, droppedSensitive: r.droppedSensitive }, "mémoire mise à jour");
          }
        }),
      );
    }
  }
}

function preview(text: string, fromUser: boolean) {
  const t = text.replace(/\s+/g, " ").trim().slice(0, 80);
  return fromUser ? `Toi : ${t}` : t;
}
