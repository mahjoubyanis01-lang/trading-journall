/** Prix publics ($ par million de tokens), utilisés pour le suivi interne des coûts. */
export const PRICE_PER_MTOK: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  fake: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

export function costMicroUsd(model: string, usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }) {
  const p = PRICE_PER_MTOK[model] ?? PRICE_PER_MTOK["claude-sonnet-5"]!;
  const usd =
    (usage.inputTokens * p.input + usage.outputTokens * p.output + usage.cacheReadTokens * p.cacheRead + usage.cacheWriteTokens * p.cacheWrite) /
    1_000_000;
  return Math.round(usd * 1_000_000);
}
