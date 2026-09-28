import type { FastifyInstance } from "fastify";
import { updateUserSchema } from "@task/shared";
import { parseOrThrow } from "../../validate.js";
import { SESSION_COOKIE } from "../auth/plugin.js";
import { toUserPublic } from "../auth/service.js";

export async function userRoutes(app: FastifyInstance) {
  app.patch("/users/me", { preHandler: [app.authenticate] }, async (req) => {
    const input = parseOrThrow(updateUserSchema, req.body);
    const row = await app.services.users.update(req.user!, input);
    return { user: toUserPublic(row) };
  });

  app.delete("/users/me", { preHandler: [app.authenticate] }, async (req, reply) => {
    await app.services.users.deleteAccount(req.user!.id);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });
}
