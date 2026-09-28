import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseOrThrow } from "../../validate.js";
import { notFound } from "../../errors.js";
import { calibrate } from "../../engines/emotion/calibration.js";

const idParam = z.object({ id: z.string().uuid() });
const memoryPatch = z.object({ content: z.string().trim().min(1).max(300).optional(), pinned: z.boolean().optional(), importance: z.number().min(0).max(1).optional() });
const forgetBody = z.object({ text: z.string().trim().min(2).max(300) });

/** Le cerveau (cerveau.md) : lecture, édition, oubli. Contrôle utilisateur complet (section 24/29). */
export async function brainRoutes(app: FastifyInstance) {
  app.get("/companions/:id/brain", { preHandler: [app.authenticate] }, async (req) => {
    const { id } = parseOrThrow(idParam, req.params);
    const user = req.user!;
    const { c, p } = await app.services.companions.getRaw(user.id, id);
    const memory = app.services.memory;
    const rows = await memory.active(id);
    const upcoming = await memory.upcomingEvents(id, new Date(), 90);
    const markdown = memory.renderMemories(rows, upcoming, { forPrompt: false, timeZone: user.timezone, companionName: c.name, userName: c.userNickname ?? user.displayName ?? "toi" });
    const cal = await app.services.mood.getCalibration(id);
    const calibration = calibrate(cal, { traits: p.traits, style: p.style, preset: p.preset });
    return {
      markdown,
      memories: rows.map((m) => ({ id: m.id, type: m.type, key: m.key, content: m.content, importance: m.importance, confidence: m.confidence, source: m.source, sensitive: m.sensitive, pinned: m.pinned, occurredAt: m.occurredAt?.toISOString() ?? null, createdAt: m.createdAt.toISOString(), updatedAt: m.updatedAt.toISOString() })),
      events: upcoming.map((e) => ({ id: e.id, type: e.type, title: e.title, startsAt: e.startsAt.toISOString(), importance: e.importance, followUp: e.followUp })),
      calibration: { baseline: cal.baseline, current: cal.current, userStyle: cal.userStyle, readings: cal.readings, adjustments: calibration.adjustments, unusual: calibration.unusual, lines: calibration.lines },
      promptBudgetChars: 3200,
    };
  });

  app.patch("/memories/:id", { preHandler: [app.authenticate] }, async (req) => {
    const { id } = parseOrThrow(idParam, req.params);
    const patch = parseOrThrow(memoryPatch, req.body);
    const row = await app.services.memory.update(req.user!.id, id, patch);
    if (!row) throw notFound("Souvenir");
    return { memory: { id: row.id, content: row.content, pinned: row.pinned, importance: row.importance } };
  });

  app.delete("/memories/:id", { preHandler: [app.authenticate] }, async (req) => {
    const { id } = parseOrThrow(idParam, req.params);
    const row = await app.services.memory.forget(req.user!.id, id);
    if (!row) throw notFound("Souvenir");
    return { ok: true };
  });

  app.delete("/events/:id", { preHandler: [app.authenticate] }, async (req) => {
    const { id } = parseOrThrow(idParam, req.params);
    const row = await app.services.memory.forgetEvent(req.user!.id, id);
    if (!row) throw notFound("Événement");
    return { ok: true };
  });

  app.post("/companions/:id/brain/forget", { preHandler: [app.authenticate] }, async (req) => {
    const { id } = parseOrThrow(idParam, req.params);
    const { text } = parseOrThrow(forgetBody, req.body);
    await app.services.companions.getRaw(req.user!.id, id);
    const forgotten = await app.services.memory.forgetByText(req.user!.id, id, text);
    return { forgotten: forgotten.map((m) => ({ id: m.id, content: m.content })) };
  });
}
