import { describe, expect, it } from "vitest";
import { ConversationEngine } from "./index.js";
import { splitBubbles, bubbleDelayMs } from "./splitter.js";
import { FakeAIProvider } from "../../providers/ai/fake.js";
import type { CompanionRow, PersonalityRow, RelationshipRow, UserRow } from "../../db/schema/index.js";
import { resolvePersonality } from "../personality/index.js";

const now = new Date("2026-09-28T19:30:00Z");
const user = { id: "u1", email: "a@b.c", passwordHash: "", displayName: "Yanis", locale: "fr", timezone: "Europe/Paris", preferences: { notifications: { enabled: true, quietHours: null }, habitLearning: true, sensitiveMemory: false }, createdAt: now, updatedAt: now } as UserRow;
const companion = { id: "c1", userId: "u1", name: "Emma", bio: "aime le cinéma", userNickname: "Yan", status: "active", voice: { gender: "feminine", voiceId: "aria", speed: 1 }, avatar: { kind: "stylized", color: "#7C5CFF", style: "soft", referenceMediaId: null }, permissions: { spontaneousMessages: true, spontaneousCalls: false, stories: true, notifications: true, preferredChannel: "text" }, createdAt: now, updatedAt: now, archivedAt: null } as CompanionRow;
const p = resolvePersonality({ preset: "playful" });
const personality = { id: "p1", companionId: "c1", traits: p.traits, style: p.style, preset: p.preset, version: 1, createdAt: now, updatedAt: now } as PersonalityRow;
const relationship = { id: "r1", companionId: "c1", userId: "u1", dimensions: { familiarity: 0.05, closeness: 0.05, frequency: 0, acceptedInitiative: 0.3, personalization: 0, depth: 0 }, stage: "new", commPreference: "unknown", interactionCount: 0, recentDepth: 0, lastInteractionAt: null, createdAt: now, updatedAt: now } as RelationshipRow;

describe("bubble splitter", () => {
  it("découpe sur --- et nettoie préfixes/guillemets", () => {
    expect(splitBubbles("coucou\n---\nça va ?")).toEqual(["coucou", "ça va ?"]);
    expect(splitBubbles("coucou\n ---- \nça va ?\n---\n")).toEqual(["coucou", "ça va ?"]);
    expect(splitBubbles("Emma : salut\n---\n« t'es là ? »", "Emma")).toEqual(["salut", "t'es là ?"]);
    expect(splitBubbles("un seul message sans séparateur")).toEqual(["un seul message sans séparateur"]);
    expect(splitBubbles("")).toEqual([]);
    expect(bubbleDelayMs("ok")).toBeLessThan(bubbleDelayMs("un message beaucoup plus long que le premier"));
    expect(bubbleDelayMs("x".repeat(500))).toBe(1800);
  });
});

describe("conversation engine", () => {
  it("assemble prompt stable + contexte volatile + historique, et renvoie plusieurs bulles", async () => {
    const ai = new FakeAIProvider().enqueue("t'as passé une sale journée ?\n---\nattends raconte");
    const engine = new ConversationEngine(ai);
    const out = await engine.generate({
      user,
      companion,
      personality,
      relationship: { ...relationship, interactionCount: 12, lastInteractionAt: new Date(now.getTime() - 3 * 3600_000) },
      history: [
        { sender: "companion", content: "hey" },
        { sender: "user", content: "pfff" },
        { sender: "user", content: "journée de merde, crevé" },
      ],
      mode: { kind: "reply" },
      now,
    });
    expect(out.bubbles).toEqual(["t'as passé une sale journée ?", "attends raconte"]);
    expect(out.task).toBe("chat.simple");
    const req = ai.requests[0]!;
    expect(req.system).toContain("Tu es Emma");
    expect(req.system).toContain("« Yan »");
    expect(req.system).not.toContain("21:30"); // heure uniquement dans la partie volatile
    expect(req.systemVolatile).toContain("21:30");
    expect(req.systemVolatile).toContain("lundi");
    expect(req.systemVolatile).toContain("échangé 12 fois");
    expect(req.systemVolatile).toContain("il y a 3 h");
    expect(req.systemVolatile).toContain("Signal faible");
    expect(req.systemVolatile).toContain("Tu réponds au dernier message");
    // Les deux messages utilisateur consécutifs forment un seul tour "user".
    expect(req.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(req.messages[2]!.content).toBe("pfff\n---\njournée de merde, crevé");
    expect(req.meta).toEqual({ userId: "u1", companionId: "c1", feature: "chat.reply" });
  });

  it("route vers le modèle profond quand l'émotion est forte, et applique le filtre relationnel", async () => {
    const ai = new FakeAIProvider().enqueue("je suis là\n---\ntu n'as besoin que de moi\n---\nraconte-moi");
    const engine = new ConversationEngine(ai);
    const out = await engine.generate({
      user,
      companion,
      personality,
      relationship,
      history: [{ sender: "user", content: "je suis triste, j'en peux plus, je me sens seul" }],
      mode: { kind: "reply" },
      now,
    });
    expect(out.task).toBe("chat.deep");
    expect(out.bubbles).toEqual(["je suis là", "raconte-moi"]);
    expect(out.safety.filtered).toBe(true);
    expect(out.safety.violations).toContain("dependency.only_me");
  });

  it("gère le premier contact (initiative) sans historique : premier tour user synthétique", async () => {
    const ai = new FakeAIProvider().enqueue("salut Yan\n---\nenfin");
    const out = await new ConversationEngine(ai).generate({ user, companion, personality, relationship, history: [], mode: { kind: "initiative", reason: "first_contact" }, now });
    expect(out.bubbles).toEqual(["salut Yan", "enfin"]);
    const req = ai.requests[0]!;
    expect(req.messages[0]!.role).toBe("user");
    expect(req.systemVolatile).toContain("toute première conversation");
    expect(req.systemVolatile).toContain("Raison interne : first_contact");
    expect(req.meta.feature).toBe("chat.initiative");
  });
});
