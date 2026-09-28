import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { createAIProvider } from "./providers/ai/index.js";
import { buildApp } from "./app.js";

const config = loadConfig();
await runMigrations(config.DATABASE_URL);
const { db, sql } = createDb(config.DATABASE_URL);
const ai = createAIProvider(config);
const app = await buildApp({ config, db, ai });

if (ai.name === "fake") {
  app.log.warn("Aucune clé ANTHROPIC_API_KEY : le fournisseur IA factice est actif (réponses scriptées, pas de vraie conversation).");
}

const shutdown = async () => {
  await app.close();
  await sql.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
