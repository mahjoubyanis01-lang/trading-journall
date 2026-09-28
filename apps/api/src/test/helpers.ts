import type { FastifyInstance } from "fastify";
import { loadConfig } from "../config.js";
import { createDb, type Db } from "../db/client.js";
import { FakeAIProvider } from "../providers/ai/fake.js";
import { buildApp } from "../app.js";

export interface TestContext {
  app: FastifyInstance;
  db: Db;
  ai: FakeAIProvider;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestContext> {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://task:task@127.0.0.1:5432/task_test";
  const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: url, AI_PROVIDER: "fake", COOKIE_SECRET: "test-cookie-secret-0123456789" });
  const { db, sql } = createDb(url, { max: 4 });
  const ai = new FakeAIProvider();
  const app = await buildApp({ config, db, ai });
  await app.ready();
  return {
    app,
    db,
    ai,
    close: async () => {
      await app.close();
      await sql.end();
    },
  };
}

let counter = 0;
export function uniqueEmail(prefix = "u") {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

/** Crée un compte et renvoie le token de session (Bearer). */
export async function registerUser(app: FastifyInstance, overrides: Record<string, unknown> = {}) {
  const email = (overrides.email as string) ?? uniqueEmail();
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { email, password: "motdepasse123", displayName: "Yanis", ...overrides } });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  const body = res.json() as { user: { id: string }; token: string };
  return { userId: body.user.id, token: body.token, email, auth: { authorization: `Bearer ${body.token}` } };
}
