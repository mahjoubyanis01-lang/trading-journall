import type { FastifyInstance } from "fastify";
import { sendMessageSchema, type ConversationStreamEvent } from "@task/shared";
import { z } from "zod";
import { parseOrThrow } from "../../validate.js";

const idParam = z.object({ id: z.string().uuid() });
const beforeQuery = z.object({ before: z.string().datetime({ offset: true }).optional() });

export async function conversationRoutes(app: FastifyInstance) {
  const svc = () => app.services.conversations;

  app.get("/conversations", { preHandler: [app.authenticate] }, async (req) => ({ conversations: await svc().list(req.user!.id) }));

  app.get("/companions/:id/conversation", { preHandler: [app.authenticate] }, async (req) => {
    const { id } = parseOrThrow(idParam, req.params);
    return { conversation: await svc().forCompanion(req.user!.id, id) };
  });

  app.get("/conversations/:id/messages", { preHandler: [app.authenticate] }, async (req) => {
    const { id } = parseOrThrow(idParam, req.params);
    const { before } = parseOrThrow(beforeQuery, req.query);
    return { messages: await svc().messages(req.user!.id, id, before) };
  });

  app.post("/conversations/:id/messages", { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    const input = parseOrThrow(sendMessageSchema, req.body);
    const { message } = await svc().sendUserMessage(req.user!.id, id, input);
    return reply.code(201).send({ message });
  });

  app.post("/conversations/:id/read", { preHandler: [app.authenticate] }, async (req) => {
    const { id } = parseOrThrow(idParam, req.params);
    await svc().markRead(req.user!.id, id);
    return { ok: true };
  });

  /** Flux SSE des événements de la conversation (typing, message, error). */
  app.get("/conversations/:id/stream", { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    await svc().getOwned(req.user!.id, id);
    reply.hijack(); // on gère la réponse brute (flux long)
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    reply.raw.write(": connected\n\n");
    const send = (e: ConversationStreamEvent) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
    const off = svc().bus.subscribe(id, send);
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), 15_000);
    req.raw.on("close", () => {
      clearInterval(ping);
      off();
    });
    return reply;
  });
}
