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

  /**
   * Fournisseur IA par défaut : "local" (Ollama/llama.cpp, OpenAI-compatible), "hermes" (Hermes Agent API server),
   * "anthropic" (clé serveur requise) ou "fake" (tests). Les slots chat/fast/deep peuvent le surcharger.
   */
  AI_PROVIDER: z.enum(["local", "hermes", "anthropic", "fake"]).optional(),
  AI_CHAT_PROVIDER: z.enum(["local", "hermes", "anthropic", "fake"]).optional(),
  AI_FAST_PROVIDER: z.enum(["local", "hermes", "anthropic", "fake"]).optional(),
  AI_DEEP_PROVIDER: z.enum(["local", "hermes", "anthropic", "fake"]).optional(),
  /** Charge les modèles locaux au démarrage pour des premières réponses rapides. */
  AI_WARMUP: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  ANTHROPIC_API_KEY: z.string().optional(),

  /** LLM local, texte uniquement (Ollama par défaut). */
  LOCAL_LLM_BASE_URL: z.string().default("http://127.0.0.1:11434/v1"),
  LOCAL_LLM_API_KEY: z.string().optional(),
  LOCAL_CHAT_MODEL: z.string().default("hermes3:8b"),
  LOCAL_FAST_MODEL: z.string().default("hermes3:3b"),
  LOCAL_DEEP_MODEL: z.string().optional(),

  /** Hermes Agent (Nous Research) : `hermes gateway` avec API_SERVER_ENABLED=true. */
  HERMES_AGENT_BASE_URL: z.string().default("http://127.0.0.1:8642/v1"),
  HERMES_AGENT_API_KEY: z.string().optional(),
  HERMES_AGENT_MODEL: z.string().default("hermes-agent"),
});

export type ProviderKind = "local" | "hermes" | "anthropic" | "fake";
export type AppConfig = z.infer<typeof envSchema> & { aiProvider: ProviderKind; aiSlots: { chat: ProviderKind; fast: ProviderKind; deep: ProviderKind } };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuration invalide: ${issues}`);
  }
  const c = parsed.data;
  // Défaut : local (Ollama) sauf en test. Si une clé Anthropic existe et que rien n'est précisé, on la
  // réserve au slot "deep" (conversations importantes) et le reste tourne en local.
  const aiProvider: ProviderKind = c.AI_PROVIDER ?? (c.NODE_ENV === "test" ? "fake" : "local");
  const aiSlots = {
    chat: c.AI_CHAT_PROVIDER ?? aiProvider,
    fast: c.AI_FAST_PROVIDER ?? (aiProvider === "hermes" ? "local" : aiProvider),
    deep: c.AI_DEEP_PROVIDER ?? (!c.AI_PROVIDER && c.ANTHROPIC_API_KEY && aiProvider === "local" ? "anthropic" : aiProvider),
  } as const;
  for (const slot of Object.values(aiSlots)) {
    if (slot === "anthropic" && !c.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY manquante alors qu'un slot IA utilise anthropic.");
  }
  return { ...c, aiProvider, aiSlots };
}
