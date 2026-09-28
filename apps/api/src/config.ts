import { z } from "zod";

/**
 * Configuration serveur. Tous les secrets vivent ici, jamais côté client.
 * L'utilisateur final ne configure aucune clé : le produit fournit les fournisseurs.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),

  /** Origine du client web autorisée (CORS + cookies same-site). */
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  COOKIE_SECRET: z.string().min(16).default("dev-only-cookie-secret-change-me"),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),

  /** Fournisseur IA : "anthropic" (clé serveur requise) ou "fake" (tests / dev sans clé). */
  AI_PROVIDER: z.enum(["anthropic", "fake"]).optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema> & { aiProvider: "anthropic" | "fake" };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuration invalide: ${issues}`);
  }
  const c = parsed.data;
  // Sans clé Anthropic, on bascule explicitement sur le provider factice et on le dit.
  const aiProvider: "anthropic" | "fake" = c.AI_PROVIDER ?? (c.ANTHROPIC_API_KEY ? "anthropic" : "fake");
  if (aiProvider === "anthropic" && !c.ANTHROPIC_API_KEY && c.NODE_ENV === "production") {
    throw new Error("ANTHROPIC_API_KEY manquante en production.");
  }
  return { ...c, aiProvider };
}
