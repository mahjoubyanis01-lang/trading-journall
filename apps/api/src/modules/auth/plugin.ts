import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { UserRow } from "../../db/schema/index.js";
import { unauthorized } from "../../errors.js";

export const SESSION_COOKIE = "task_session";

declare module "fastify" {
  interface FastifyRequest {
    user: UserRow | null;
    sessionToken: string | null;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

function extractToken(req: FastifyRequest): string | null {
  const cookie = req.cookies[SESSION_COOKIE];
  if (cookie) {
    const unsigned = req.unsignCookie(cookie);
    if (unsigned.valid && unsigned.value) return unsigned.value;
  }
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return null;
}

/** Décore chaque requête avec `user` (si session valide) et fournit le preHandler `authenticate`. */
export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest("user", null);
  app.decorateRequest("sessionToken", null);

  app.addHook("onRequest", async (req) => {
    const token = extractToken(req);
    req.sessionToken = token;
    req.user = token ? await app.services.auth.resolve(token) : null;
  });

  app.decorate("authenticate", async (req: FastifyRequest) => {
    if (!req.user) throw unauthorized();
  });
});
