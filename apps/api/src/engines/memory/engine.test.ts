import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, registerUser, type TestContext } from "../../test/helpers.js";
import { MemoryEngine } from "./index.js";
import type { UserRow } from "../../db/schema/index.js";

let ctx: TestContext;
let engine: MemoryEngine;
const now = new Date("2026-09-28T19:30:00Z");
beforeAll(async () => {
  ctx = await createTestApp();
  engine = ctx.app.services.memory;
});
afterAll(async () => ctx.close());

async function setup(sensitiveMemory = false) {
  const u = await registerUser(ctx.app);
  if (sensitiveMemory) await ctx.app.inject({ method: "PATCH", url: "/api/users/me", headers: u.auth, payload: { preferences: { sensitiveMemory: true } } });
  const companion = (await ctx.app.inject({ method: "POST", url: "/api/companions", headers: u.auth, payload: { name: "Emma", userNickname: "Yan" } })).json().companion;
  const user = (await ctx.db.query.users.findFirst({ where: (t, { eq }) => eq(t.id, u.userId) })) as UserRow;
  return { ...u, companion, user };
}

describe("memory engine", () => {
  it("ingère une extraction : ajout, clés uniques, doublons, événement daté, sensible filtré", async () => {
    const { user, companion } = await setup();
    const turns = [
      { sender: "user" as const, content: "je m'appelle Yan, je bosse dans un café à Lyon et vendredi j'ai un entretien pour un poste de dev", id: undefined },
      { sender: "companion" as const, content: "oh un entretien !" },
    ];
    ctx.ai.enqueueStructured({
      items: [
        { op: "add", type: "identity", key: "prenom", content: "Yan s'appelle Yan", importance: 0.9 },
        { op: "add", type: "identity", key: "travail", content: "Yan travaille dans un café à Lyon", importance: 0.8 },
        { op: "add", type: "semantic", content: "Yan travaille dans un café à Lyon", importance: 0.5 },
        { op: "add", type: "semantic", content: "Yan suit une thérapie pour sa dépression", importance: 0.7 },
        { op: "add", type: "preference", key: "sport", content: "Yan fait du judo tous les mardis", importance: 0.6, confidence: 0.5 },
      ],
      // Le modèle renvoie "aujourd'hui" à tort : le texte dit "vendredi", on lui fait confiance.
      events: [{ type: "interview", title: "Entretien pour un poste de dev", date: "2026-09-28", importance: 0.9 }],
    });
    const r = await engine.ingest({ user, companionId: companion.id, companionName: "Emma", userNickname: "Yan", turns, now });
    expect(r.added.map((m) => m.key)).toEqual(["prenom", "travail"]);
    expect(r.skippedDuplicates).toBe(1);
    expect(r.droppedSensitive).toBe(1);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]!.startsAt.toISOString().slice(0, 10)).toBe("2026-10-02");
    const req = ctx.ai.requests.at(-1)!;
    expect(req.task).toBe("memory.extract");
    expect(req.system).toContain("2026-09-28");
    expect(req.messages[0]!.content).toContain("Yan : je m'appelle Yan");

    // Mise à jour d'un emplacement existant : pas de doublon.
    ctx.ai.enqueueStructured({ items: [{ op: "update", type: "identity", key: "travail", content: "Yan travaille dans une boulangerie à Lyon", importance: 0.8 }], events: [{ title: "Entretien dev", date: "2026-10-02" }] });
    const r2 = await engine.ingest({ user, companionId: companion.id, companionName: "Emma", turns: [{ sender: "user", content: "en fait je bosse dans une boulangerie à Lyon maintenant" }], now });
    expect(r2.updated).toHaveLength(1);
    expect(r2.added).toHaveLength(0);
    expect(r2.events).toHaveLength(0); // même événement à ±36 h avec titre proche
    const active = await engine.active(companion.id);
    expect(active.find((m) => m.key === "travail")?.content).toContain("boulangerie");

    // Un "forget" émis sans demande explicite est ignoré.
    ctx.ai.enqueueStructured({ items: [{ op: "forget", type: "identity", key: "travail", content: "le travail de Yan" }], events: [] });
    const r2b = await engine.ingest({ user, companionId: companion.id, companionName: "Emma", turns: [{ sender: "user", content: "je bosse toujours à la boulangerie" }], now });
    expect(r2b.forgotten).toHaveLength(0);

    // Oubli explicite.
    ctx.ai.enqueueStructured({ items: [{ op: "forget", type: "identity", key: "travail", content: "le travail de Yan" }], events: [] });
    const r3 = await engine.ingest({ user, companionId: companion.id, companionName: "Emma", turns: [{ sender: "user", content: "oublie où je travaille" }], now });
    expect(r3.forgotten).toHaveLength(1);
    expect((await engine.active(companion.id)).some((m) => m.key === "travail")).toBe(false);
  });

  it("conserve un souvenir sensible seulement si l'utilisateur l'autorise", async () => {
    const { user, companion } = await setup(true);
    ctx.ai.enqueueStructured({ items: [{ type: "semantic", content: "Yan fait le ramadan", importance: 0.6, confidence: 0.9 }], events: [] });
    const r = await engine.ingest({ user, companionId: companion.id, companionName: "Emma", turns: [{ sender: "user", content: "je fais le ramadan cette année" }], now });
    expect(r.added).toHaveLength(1);
    expect(r.added[0]!.sensitive).toBe(true);
  });

  it("rappelle par pertinence et rend cerveau.md (prompt borné, version utilisateur en tableaux)", async () => {
    const { user, companion } = await setup();
    ctx.ai.enqueueStructured({
      items: [
        { type: "identity", key: "prenom", content: "Yan s'appelle Yan", importance: 0.9, confidence: 0.95 },
        { type: "preference", key: "plat_prefere", content: "Yan adore les lasagnes", importance: 0.6, confidence: 0.95 },
        { type: "episodic", content: "Yan a raté son bus et est arrivé en retard au travail", importance: 0.3, occurred_at: "hier" },
        { type: "shared", content: "Première conversation : Yan a taquiné Emma sur sa bio", importance: 0.7 },
      ],
      events: [{ type: "trip", title: "Week-end à Marseille", date: "samedi" }],
    });
    await engine.ingest({ user, companionId: companion.id, companionName: "Emma", turns: [{ sender: "user", content: "moi c'est Yan, j'adore les lasagnes, hier j'ai raté mon bus, et samedi je pars à Marseille" }], now });
    const rows = await engine.active(companion.id);
    const picked = engine.recall(rows, "on mange quoi ce soir ? des lasagnes ?", 2, now);
    expect(picked.map((m) => m.type)).toEqual(["identity", "preference"]); // identité toujours, puis pertinence

    const { text } = await engine.brainForPrompt(companion.id, "lasagnes", user.timezone, now);
    expect(text).toContain("### À venir");
    expect(text).toContain("Marseille");
    expect(text).toContain("### Identité");
    expect(text).toContain("lasagnes");
    expect(text.length).toBeLessThanOrEqual(3200);

    const md = engine.renderMemories(rows, await engine.upcomingEvents(companion.id, now, 30), { forPrompt: false, timeZone: user.timezone, now, companionName: "Emma", userName: "Yan" });
    expect(md).toContain("# Cerveau de Emma");
    expect(md).toContain("| Souvenir | Importance | Depuis |");
    expect(md).toContain("## Nos moments");

    const budgeted = engine.renderMemories(rows, [], { forPrompt: true, budgetChars: 120, timeZone: user.timezone, now });
    expect(budgeted.length).toBeLessThanOrEqual(125);
    expect(budgeted.endsWith("…")).toBe(true);
  });

  it("contrôle utilisateur : édition, épinglage, oubli par texte, isolation", async () => {
    const a = await setup();
    const b = await registerUser(ctx.app);
    ctx.ai.enqueueStructured({ items: [{ type: "preference", key: "musique", content: "Yan écoute du rap français", importance: 0.5, confidence: 0.95 }], events: [] });
    await engine.ingest({ user: a.user, companionId: a.companion.id, companionName: "Emma", turns: [{ sender: "user", content: "j'écoute surtout du rap français" }], now });
    const brain = await ctx.app.inject({ method: "GET", url: `/api/companions/${a.companion.id}/brain`, headers: a.auth });
    expect(brain.statusCode).toBe(200);
    const mem = brain.json().memories[0];
    expect(mem.content).toContain("rap");
    expect(brain.json().markdown).toContain("Goûts et habitudes");
    expect(brain.json().calibration.readings).toBe(0);

    expect((await ctx.app.inject({ method: "GET", url: `/api/companions/${a.companion.id}/brain`, headers: b.auth })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: "PATCH", url: `/api/memories/${mem.id}`, headers: b.auth, payload: { pinned: true } })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: "DELETE", url: `/api/memories/${mem.id}`, headers: b.auth })).statusCode).toBe(404);

    const upd = await ctx.app.inject({ method: "PATCH", url: `/api/memories/${mem.id}`, headers: a.auth, payload: { content: "Yan écoute du rap et du jazz", pinned: true } });
    expect(upd.json().memory.pinned).toBe(true);
    const forget = await ctx.app.inject({ method: "POST", url: `/api/companions/${a.companion.id}/brain/forget`, headers: a.auth, payload: { text: "le rap" } });
    expect(forget.json().forgotten).toHaveLength(1);
    expect((await ctx.app.inject({ method: "GET", url: `/api/companions/${a.companion.id}/brain`, headers: a.auth })).json().memories).toHaveLength(0);
  });
});
