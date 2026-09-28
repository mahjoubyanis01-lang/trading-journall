import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { createAIStack, OpenAICompatibleProvider } from "./providers/ai/index.js";
import { buildApp } from "./app.js";

const config = loadConfig();
await runMigrations(config.DATABASE_URL);
const { db, sql } = createDb(config.DATABASE_URL);
const { provider: ai, instances } = createAIStack(config);
const app = await buildApp({ config, db, ai });

app.log.info({ ai: ai.name, slots: config.aiSlots }, "fournisseurs IA");
if (config.aiSlots.chat === "fake") {
  app.log.warn("Le fournisseur IA factice sert le chat : réponses scriptées, pas de vraie conversation. Configure AI_PROVIDER=local (Ollama) ou hermes.");
}
for (const [kind, inst] of Object.entries(instances)) {
  if (inst instanceof OpenAICompatibleProvider) {
    const reachable = await inst.ping();
    if (!reachable) app.log.warn({ provider: kind }, "endpoint IA injoignable pour l'instant (le serveur démarre quand même)");
    else if (config.AI_WARMUP) {
      const r = await inst.warmup();
      app.log.info({ provider: kind, warmup: r }, "modèles chargés");
    }
  }
}

const shutdown = async () => {
  await app.close();
  await sql.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
