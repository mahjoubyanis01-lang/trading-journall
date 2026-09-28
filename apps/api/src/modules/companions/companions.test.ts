import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestApp, registerUser, type TestContext } from "../../test/helpers.js";
import { conversations, relationshipEvents, relationships } from "../../db/schema/index.js";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => ctx.close());

describe("companions", () => {
  it("expose le catalogue (présets + voix) sans authentification", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/companions/catalog" });
    expect(res.statusCode).toBe(200);
    expect(res.json().presets.map((p: { id: string }) => p.id)).toContain("playful");
    expect(res.json().voices.length).toBeGreaterThan(3);
  });

  it("crée un compagnon avec personnalité (préset + surcharges), relation initiale et conversation", async () => {
    const { auth, userId } = await registerUser(ctx.app);
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/companions",
      headers: auth,
      payload: {
        name: "Emma",
        userNickname: "Yan",
        voice: { gender: "feminine", voiceId: "lea" },
        avatar: { color: "#FF6B6B" },
        personality: { preset: "playful", traits: { affection: 0.9 }, style: { initiativeFrequency: "often" } },
        permissions: { spontaneousCalls: true },
      },
    });
    expect(res.statusCode).toBe(201);
    const c = res.json().companion;
    expect(c.name).toBe("Emma");
    expect(c.userNickname).toBe("Yan");
    expect(c.voice.voiceId).toBe("lea");
    expect(c.avatar.color).toBe("#FF6B6B");
    expect(c.avatar.kind).toBe("stylized");
    expect(c.personality.preset).toBe("playful");
    expect(c.personality.traits.humor).toBe(0.9); // du préset
    expect(c.personality.traits.affection).toBe(0.9); // surcharge
    expect(c.personality.style.initiativeFrequency).toBe("often");
    expect(c.personality.style.messageLength).toBe("short");
    expect(c.permissions.spontaneousCalls).toBe(true);
    expect(c.permissions.stories).toBe(true);

    const rel = await ctx.db.query.relationships.findFirst({ where: eq(relationships.companionId, c.id) });
    expect(rel?.stage).toBe("new");
    expect(rel?.userId).toBe(userId);
    const conv = await ctx.db.query.conversations.findFirst({ where: eq(conversations.companionId, c.id) });
    expect(conv?.kind).toBe("direct");
    const events = await ctx.db.query.relationshipEvents.findMany({ where: eq(relationshipEvents.companionId, c.id) });
    expect(events.map((e) => e.type)).toContain("companion_created");
  });

  it("applique les valeurs par défaut quand seul le nom est fourni", async () => {
    const { auth } = await registerUser(ctx.app);
    const res = await ctx.app.inject({ method: "POST", url: "/api/companions", headers: auth, payload: { name: "Alex" } });
    expect(res.statusCode).toBe(201);
    const c = res.json().companion;
    expect(c.personality.preset).toBeNull();
    expect(c.personality.traits.humor).toBe(0.6);
    expect(c.voice.voiceId).toBe("aria");
  });

  it("liste, met à jour (personnalité versionnée) et supprime", async () => {
    const { auth } = await registerUser(ctx.app);
    const created = (await ctx.app.inject({ method: "POST", url: "/api/companions", headers: auth, payload: { name: "Sarah" } })).json().companion;
    const list = await ctx.app.inject({ method: "GET", url: "/api/companions", headers: auth });
    expect(list.json().companions.map((c: { id: string }) => c.id)).toEqual([created.id]);

    const upd = await ctx.app.inject({ method: "PATCH", url: `/api/companions/${created.id}`, headers: auth, payload: { bio: "aime les films", personality: { traits: { humor: 0.1 } }, permissions: { stories: false } } });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().companion.bio).toBe("aime les films");
    expect(upd.json().companion.personality.traits.humor).toBe(0.1);
    expect(upd.json().companion.personality.traits.curiosity).toBe(0.7);
    expect(upd.json().companion.permissions.stories).toBe(false);
    expect(upd.json().companion.permissions.notifications).toBe(true);
    const p = await ctx.db.query.personalities.findFirst({ where: (t, { eq }) => eq(t.companionId, created.id) });
    expect(p?.version).toBe(2);

    const del = await ctx.app.inject({ method: "DELETE", url: `/api/companions/${created.id}`, headers: auth });
    expect(del.statusCode).toBe(200);
    const after = await ctx.app.inject({ method: "GET", url: `/api/companions/${created.id}`, headers: auth });
    expect(after.statusCode).toBe(404);
  });

  it("PRIVACY : un utilisateur ne peut jamais lire, modifier ou supprimer le compagnon d'un autre", async () => {
    const a = await registerUser(ctx.app);
    const b = await registerUser(ctx.app);
    const emma = (await ctx.app.inject({ method: "POST", url: "/api/companions", headers: a.auth, payload: { name: "Emma" } })).json().companion;

    const listB = await ctx.app.inject({ method: "GET", url: "/api/companions", headers: b.auth });
    expect(listB.json().companions).toHaveLength(0);
    expect((await ctx.app.inject({ method: "GET", url: `/api/companions/${emma.id}`, headers: b.auth })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: "PATCH", url: `/api/companions/${emma.id}`, headers: b.auth, payload: { name: "X" } })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: "DELETE", url: `/api/companions/${emma.id}`, headers: b.auth })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: "GET", url: `/api/companions/${emma.id}` })).statusCode).toBe(401);

    // Le compagnon de A est intact.
    const still = await ctx.app.inject({ method: "GET", url: `/api/companions/${emma.id}`, headers: a.auth });
    expect(still.statusCode).toBe(200);
    expect(still.json().companion.name).toBe("Emma");
  });

  it("valide les entrées (nom vide, couleur invalide, trait hors bornes)", async () => {
    const { auth } = await registerUser(ctx.app);
    for (const payload of [{ name: "" }, { name: "Emma", avatar: { color: "rouge" } }, { name: "Emma", personality: { traits: { humor: 1.5 } } }]) {
      const res = await ctx.app.inject({ method: "POST", url: "/api/companions", headers: auth, payload });
      expect(res.statusCode).toBe(400);
    }
  });
});
