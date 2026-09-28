import type { FastifyInstance } from "fastify";
import { loginSchema, registerSchema } from "@task/shared";
import { parseOrThrow } from "../../validate.js";
import { SESSION_COOKIE } from "./plugin.js";
import { toUserPublic } from "./service.js";

export async function authRoutes(app: FastifyInstance) {
  const cookieOpts = (expires: Date) => ({
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: app.config.COOKIE_SECURE || app.config.NODE_ENV === "production",
    signed: true,
    expires,
  });
  const strict = app.config.NODE_ENV === "test" ? {} : { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  app.post("/auth/register", strict, async (req, reply) => {
    const input = parseOrThrow(registerSchema, req.body);
    const { user, token, expiresAt } = await app.services.auth.register(input, req.headers["user-agent"]);
    reply.setCookie(SESSION_COOKIE, token, cookieOpts(expiresAt));
    return reply.code(201).send({ user, token });
  });

  app.post("/auth/login", strict, async (req, reply) => {
    const input = parseOrThrow(loginSchema, req.body);
    const { user, token, expiresAt } = await app.services.auth.login(input, req.headers["user-agent"]);
    reply.setCookie(SESSION_COOKIE, token, cookieOpts(expiresAt));
    return { user, token };
  });

  app.post("/auth/logout", async (req, reply) => {
    if (req.sessionToken) await app.services.auth.revoke(req.sessionToken);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/auth/me", { preHandler: [app.authenticate] }, async (req) => {
    return { user: toUserPublic(req.user!) };
  });
}
