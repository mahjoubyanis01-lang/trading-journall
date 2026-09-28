import type { FastifyInstance } from "fastify";
import { createCompanionSchema, updateCompanionSchema, PERSONALITY_PRESETS } from "@task/shared";
import { z } from "zod";
import { parseOrThrow } from "../../validate.js";
import { VOICE_CATALOG } from "./catalog.js";

const idParam = z.object({ id: z.string().uuid() });

export async function companionRoutes(app: FastifyInstance) {
  app.get("/companions/catalog", async () => ({
    presets: Object.entries(PERSONALITY_PRESETS).map(([id, p]) => ({ id, label: p.label, description: p.description })),
    voices: VOICE_CATALOG,
  }));

  app.get("/companions", { preHandler: [app.authenticate] }, async (req) => ({
    companions: await app.services.companions.list(req.user!.id),
  }));

  app.post("/companions", { preHandler: [app.authenticate] }, async (req, reply) => {
    const input = parseOrThrow(createCompanionSchema, req.body);
    const companion = await app.services.companions.create(req.user!.id, input);
    return reply.code(201).send({ companion });
  });

  app.get("/companions/:id", { preHandler: [app.authenticate] }, async (req) => {
    const { id } = parseOrThrow(idParam, req.params);
    return { companion: await app.services.companions.get(req.user!.id, id) };
  });

  app.patch("/companions/:id", { preHandler: [app.authenticate] }, async (req) => {
    const { id } = parseOrThrow(idParam, req.params);
    const input = parseOrThrow(updateCompanionSchema, req.body);
    return { companion: await app.services.companions.update(req.user!.id, id, input) };
  });

  app.delete("/companions/:id", { preHandler: [app.authenticate] }, async (req) => {
    const { id } = parseOrThrow(idParam, req.params);
    await app.services.companions.delete(req.user!.id, id);
    return { ok: true };
  });
}
