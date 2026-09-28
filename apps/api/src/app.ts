import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type { AppConfig } from "./config.js";
import type { Db } from "./db/client.js";
import { AppError } from "./errors.js";
import { createLogger } from "./observability/logger.js";
import type { AIProvider } from "./providers/ai/types.js";
import { CostMeter } from "./costs/meter.js";
import { AuthService } from "./modules/auth/service.js";
import { authPlugin } from "./modules/auth/plugin.js";
import { authRoutes } from "./modules/auth/routes.js";
import { UserService } from "./modules/users/service.js";
import { userRoutes } from "./modules/users/routes.js";
import { CompanionService } from "./modules/companions/service.js";
import { companionRoutes } from "./modules/companions/routes.js";
import { ConversationService } from "./modules/conversations/service.js";
import { conversationRoutes } from "./modules/conversations/routes.js";
import { ConversationBus } from "./modules/conversations/bus.js";
import { ConversationEngine } from "./engines/conversation/index.js";
import { MemoryEngine } from "./engines/memory/index.js";
import { MoodService } from "./modules/mood/service.js";
import { brainRoutes } from "./modules/brain/routes.js";
import type { Logger } from "./observability/logger.js";

export interface Services {
  auth: AuthService;
  users: UserService;
  companions: CompanionService;
  conversations: ConversationService;
  memory: MemoryEngine;
  mood: MoodService;
  costs: CostMeter;
}

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
    db: Db;
    ai: AIProvider;
    services: Services;
  }
}

export interface BuildAppOptions {
  config: AppConfig;
  db: Db;
  ai: AIProvider;
}

export async function buildApp({ config, db, ai }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: createLogger(config.NODE_ENV === "test" ? "silent" : config.LOG_LEVEL, config.NODE_ENV === "development") as unknown as FastifyBaseLogger,
    trustProxy: true,
    bodyLimit: 1024 * 1024,
    forceCloseConnections: true, // ferme les flux SSE ouverts à l'arrêt
  });

  app.decorate("config", config);
  app.decorate("db", db);
  app.decorate("ai", ai);
  const companions = new CompanionService(db);
  const costs = new CostMeter(db);
  const log = app.log as unknown as Logger;
  const memory = new MemoryEngine(db, ai);
  const mood = new MoodService(db, ai, log);
  app.decorate("services", {
    auth: new AuthService(db, config.SESSION_TTL_DAYS),
    users: new UserService(db),
    companions,
    conversations: new ConversationService(
      db,
      new ConversationEngine(ai),
      companions,
      costs,
      new ConversationBus(),
      log,
      { pacing: config.NODE_ENV === "test" ? 0 : 1, settleMs: config.NODE_ENV === "test" ? 100 : 700 },
      memory,
      mood,
    ),
    memory,
    mood,
    costs,
  } satisfies Services);

  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
  await app.register(cookie, { secret: config.COOKIE_SECRET });
  await app.register(rateLimit, { global: true, max: config.NODE_ENV === "test" ? 10_000 : 300, timeWindow: "1 minute" });
  await app.register(authPlugin);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err, reqId: req.id }, "unhandled error");
    return reply.code(status).send({
      error: { code: status >= 500 ? "internal_error" : "request_error", message: status >= 500 ? "Erreur interne" : (err as Error).message },
    });
  });

  app.get("/health", async () => ({ ok: true, ai: ai.name, slots: config.aiSlots }));

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(userRoutes);
      await api.register(companionRoutes);
      await api.register(conversationRoutes);
      await api.register(brainRoutes);
    },
    { prefix: "/api" },
  );

  return app;
}
