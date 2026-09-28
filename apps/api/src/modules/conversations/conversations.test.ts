import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestApp, registerUser, type TestContext } from "../../test/helpers.js";
import { relationships, usageRecords } from "../../db/schema/index.js";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => ctx.close());
beforeEach(() => ctx.ai.reset());

async function setup(name = "Emma") {
  const u = await registerUser(ctx.app);
  const companion = (await ctx.app.inject({ method: "POST", url: "/api/companions", headers: u.auth, payload: { name, userNickname: "Yan", personality: { preset: "warm" } } })).json().companion;
  return { ...u, companion };
}

describe("conversations", () => {
  it("premier contact : ouvrir la conversation vide fait écrire le compagnon en premier", async () => {
    const { auth, companion } = await setup();
    ctx.ai.enqueue("salut Yan !\n---\nenfin on se parle");
    const res = await ctx.app.inject({ method: "GET", url: `/api/companions/${companion.id}/conversation`, headers: auth });
    expect(res.statusCode).toBe(200);
    const conv = res.json().conversation;
    await ctx.app.services.conversations.bus.waitFor(conv.id, (e) => e.type === "message" && e.message.content === "enfin on se parle");
    const msgs = (await ctx.app.inject({ method: "GET", url: `/api/conversations/${conv.id}/messages`, headers: auth })).json().messages;
    expect(msgs.map((m: { sender: string; content: string }) => [m.sender, m.content])).toEqual([
      ["companion", "salut Yan !"],
      ["companion", "enfin on se parle"],
    ]);
    expect(msgs[0].burstIndex).toBe(0);
    // Réouvrir ne redéclenche rien.
    await ctx.app.inject({ method: "GET", url: `/api/companions/${companion.id}/conversation`, headers: auth });
    await new Promise((r) => setTimeout(r, 50));
    const again = (await ctx.app.inject({ method: "GET", url: `/api/conversations/${conv.id}/messages`, headers: auth })).json().messages;
    expect(again).toHaveLength(2);
    const rel = await ctx.db.query.relationships.findFirst({ where: eq(relationships.companionId, companion.id) });
    expect(rel?.interactionCount).toBe(1);
    expect(rel?.lastInteractionAt).not.toBeNull();
  });

  it("envoi d'un message : réponse générée, non lus, aperçu, coûts enregistrés", async () => {
    const { auth, companion, userId } = await setup();
    ctx.ai.enqueue("hey"); // premier contact
    const conv = (await ctx.app.inject({ method: "GET", url: `/api/companions/${companion.id}/conversation`, headers: auth })).json().conversation;
    await ctx.app.services.conversations.bus.waitFor(conv.id, (e) => e.type === "message");

    ctx.ai.enqueue("ah ouais ?\n---\nraconte");
    const send = await ctx.app.inject({ method: "POST", url: `/api/conversations/${conv.id}/messages`, headers: auth, payload: { content: "journée bizarre" } });
    expect(send.statusCode).toBe(201);
    expect(send.json().message.sender).toBe("user");
    await ctx.app.services.conversations.bus.waitFor(conv.id, (e) => e.type === "message" && e.message.content === "raconte");

    const list = (await ctx.app.inject({ method: "GET", url: "/api/conversations", headers: auth })).json().conversations;
    expect(list).toHaveLength(1);
    expect(list[0].unreadCount).toBe(3);
    expect(list[0].lastMessagePreview).toBe("raconte");

    const last = ctx.ai.requests.filter((r) => r.task.startsWith("chat")).at(-1)!;
    expect(last.task).toBe("chat.simple");
    expect(last.messages[last.messages.length - 1]).toEqual({ role: "user", content: "journée bizarre" });

    await ctx.app.inject({ method: "POST", url: `/api/conversations/${conv.id}/read`, headers: auth });
    const after = (await ctx.app.inject({ method: "GET", url: "/api/conversations", headers: auth })).json().conversations;
    expect(after[0].unreadCount).toBe(0);
    expect(after[0].lastMessagePreview).toBe("raconte");

    const usage = await ctx.db.query.usageRecords.findMany({ where: eq(usageRecords.userId, userId) });
    expect(usage.length).toBeGreaterThan(0);
    expect(usage.every((u) => u.model === "fake")).toBe(true);
  });

  it("coalesce deux messages rapprochés en une seule réponse", async () => {
    const { auth, companion } = await setup();
    ctx.ai.enqueue("hey");
    const conv = (await ctx.app.inject({ method: "GET", url: `/api/companions/${companion.id}/conversation`, headers: auth })).json().conversation;
    await ctx.app.services.conversations.bus.waitFor(conv.id, (e) => e.type === "message");
    const chatCount = () => ctx.ai.requests.filter((r) => r.task.startsWith("chat")).length;
    const before = chatCount();
    ctx.ai.enqueue("les deux d'un coup");
    const [a, b] = await Promise.all([
      ctx.app.services.conversations.sendUserMessage((await ctx.app.services.auth.resolve(auth.authorization.slice(7)))!.id, conv.id, { content: "un", kind: "text" }),
      ctx.app.services.conversations.sendUserMessage((await ctx.app.services.auth.resolve(auth.authorization.slice(7)))!.id, conv.id, { content: "deux", kind: "text" }),
    ]);
    await Promise.all([a.reply, b.reply]);
    expect(chatCount() - before).toBe(1);
    const msgs = (await ctx.app.inject({ method: "GET", url: `/api/conversations/${conv.id}/messages`, headers: auth })).json().messages;
    expect(msgs.map((m: { content: string }) => m.content)).toEqual(["hey", "un", "deux", "les deux d'un coup"]);
  });

  it("le flux SSE délivre typing puis message", async () => {
    const { auth, companion } = await setup();
    ctx.ai.enqueue("hey");
    const conv = (await ctx.app.inject({ method: "GET", url: `/api/companions/${companion.id}/conversation`, headers: auth })).json().conversation;
    await ctx.app.services.conversations.bus.waitFor(conv.id, (e) => e.type === "message");

    await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    const addr = ctx.app.server.address() as { port: number };
    const ac = new AbortController();
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/conversations/${conv.id}/stream`, { headers: auth, signal: ac.signal });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const events: ({ type: "message"; message: { content: string } } | { type: "typing" } | { type: "error"; message: string })[] = [];
    ctx.ai.enqueue("oui oui");
    await ctx.app.inject({ method: "POST", url: `/api/conversations/${conv.id}/messages`, headers: auth, payload: { content: "t'es là ?" } });
    while (!events.some((e) => e.type === "message" && e.message.content === "oui oui")) {
      const err = events.find((e) => e.type === "error");
      if (err) throw new Error(`SSE error event: ${JSON.stringify(err)}`);
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (line) events.push(JSON.parse(line.slice(6)));
      }
    }
    ac.abort();
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("message"); // écho du message utilisateur
    expect(types).toContain("typing");
    expect(types[types.length - 1]).toBe("message");
  });

  it("PRIVACY : impossible de lire, écrire ou écouter la conversation d'un autre utilisateur", async () => {
    const a = await setup();
    const b = await registerUser(ctx.app);
    ctx.ai.enqueue("hey");
    const conv = (await ctx.app.inject({ method: "GET", url: `/api/companions/${a.companion.id}/conversation`, headers: a.auth })).json().conversation;
    await ctx.app.services.conversations.bus.waitFor(conv.id, (e) => e.type === "message");
    expect((await ctx.app.inject({ method: "GET", url: `/api/companions/${a.companion.id}/conversation`, headers: b.auth })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: "GET", url: `/api/conversations/${conv.id}/messages`, headers: b.auth })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: "POST", url: `/api/conversations/${conv.id}/messages`, headers: b.auth, payload: { content: "hack" } })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: "GET", url: `/api/conversations/${conv.id}/stream`, headers: b.auth })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: "GET", url: `/api/conversations`, headers: b.auth })).json().conversations).toHaveLength(0);
  });

  it("valide le contenu (vide ou trop long)", async () => {
    const { auth, companion } = await setup();
    ctx.ai.enqueue("hey");
    const conv = (await ctx.app.inject({ method: "GET", url: `/api/companions/${companion.id}/conversation`, headers: auth })).json().conversation;
    expect((await ctx.app.inject({ method: "POST", url: `/api/conversations/${conv.id}/messages`, headers: auth, payload: { content: "   " } })).statusCode).toBe(400);
    expect((await ctx.app.inject({ method: "POST", url: `/api/conversations/${conv.id}/messages`, headers: auth, payload: { content: "x".repeat(4001) } })).statusCode).toBe(400);
  });
});

describe("conversations × cerveau × humeur", () => {
  it("après une réponse, la mémoire est extraite, l'humeur lue et la calibration mise à jour ; le tour suivant voit le cerveau", async () => {
    const { auth, companion, userId } = await setup();
    ctx.ai.enqueue("hey");
    const conv = (await ctx.app.inject({ method: "GET", url: `/api/companions/${companion.id}/conversation`, headers: auth })).json().conversation;
    await ctx.app.services.conversations.bus.waitFor(conv.id, (e) => e.type === "message");

    // Tour 1 : humeur (LLM) puis extraction mémoire, dans l'ordre d'appel des tâches structurées.
    ctx.ai.enqueueStructured({ dominant: "stressed", confidence: 0.8, cues: ["entretien"] });
    ctx.ai.enqueueStructured({ items: [{ type: "identity", key: "travail", content: "Yan cherche un poste de dev", importance: 0.8, confidence: 0.95 }], events: [{ type: "interview", title: "Entretien dev", date: "vendredi", importance: 0.9 }] });
    ctx.ai.enqueue("ah un entretien, stressé ?");
    await ctx.app.inject({ method: "POST", url: `/api/conversations/${conv.id}/messages`, headers: auth, payload: { content: "vendredi j'ai un entretien pour un poste de dev, je stresse un peu" } });
    await ctx.app.services.conversations.bus.waitFor(conv.id, (e) => e.type === "message" && e.message.sender === "companion");
    await ctx.app.services.conversations.idle();

    const brain = (await ctx.app.inject({ method: "GET", url: `/api/companions/${companion.id}/brain`, headers: auth })).json();
    expect(brain.memories.map((m: { key: string }) => m.key)).toContain("travail");
    expect(brain.events).toHaveLength(1);
    expect(brain.events[0].title).toBe("Entretien dev");
    expect(brain.calibration.readings).toBe(1);
    expect(brain.calibration.current.stressed).toBeGreaterThan(0.3);
    const readings = await ctx.app.services.mood.recentReadings(companion.id);
    expect(readings[0]?.source).toBe("llm");
    expect(readings[0]?.dominant).toBe("stressed");
    expect(readings[0]?.userId).toBe(userId);

    // Tour 2 : le prompt contient le cerveau (partie stable) et la calibration (partie volatile).
    ctx.ai.enqueue("tu vas gérer");
    await ctx.app.inject({ method: "POST", url: `/api/conversations/${conv.id}/messages`, headers: auth, payload: { content: "tu crois que ça va aller ?" } });
    await ctx.app.services.conversations.bus.waitFor(conv.id, (e) => e.type === "message" && e.message.content === "tu vas gérer");
    await ctx.app.services.conversations.idle();
    const chatReq = ctx.ai.requests.filter((r) => r.task.startsWith("chat")).at(-1)!;
    expect(chatReq.system).toContain("## Ta mémoire de Yan");
    expect(chatReq.system).toContain("Entretien dev");
    expect(chatReq.system).toContain("cherche un poste de dev");
    expect(chatReq.task).toBe("chat.deep"); // événement à venir → modèle profond
    expect(chatReq.systemVolatile).toContain("Calibration du moment");
    expect(chatReq.systemVolatile).toContain("stressée");
  });
});
