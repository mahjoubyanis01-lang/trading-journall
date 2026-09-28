import type { Db } from "../db/client.js";
import { usageRecords } from "../db/schema/index.js";
import { costMicroUsd } from "../providers/ai/pricing.js";
import type { Usage } from "../providers/ai/types.js";

/** CostMeter (section 28) : chaque appel fournisseur écrit des lignes d'usage par utilisateur. */
export class CostMeter {
  constructor(private db: Db) {}

  async recordTokens(input: { userId: string; companionId?: string; model: string; feature: string; usage: Usage }) {
    const { usage, model } = input;
    const total = costMicroUsd(model, usage);
    const rows = [
      { kind: "tokens_in" as const, quantity: usage.inputTokens },
      { kind: "tokens_out" as const, quantity: usage.outputTokens },
      { kind: "tokens_cache_read" as const, quantity: usage.cacheReadTokens },
      { kind: "tokens_cache_write" as const, quantity: usage.cacheWriteTokens },
    ].filter((r) => r.quantity > 0);
    if (rows.length === 0) return;
    await this.db.insert(usageRecords).values(
      rows.map((r, i) => ({
        userId: input.userId,
        companionId: input.companionId ?? null,
        kind: r.kind,
        quantity: r.quantity,
        // Le coût total est porté par la première ligne pour éviter les doubles comptes.
        costMicroUsd: i === 0 ? total : 0,
        model,
        feature: input.feature,
      })),
    );
  }
}
