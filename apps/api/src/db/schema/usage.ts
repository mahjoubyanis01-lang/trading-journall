import { pgTable, uuid, text, timestamp, bigint, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export type UsageKind = "tokens_in" | "tokens_out" | "tokens_cache_read" | "tokens_cache_write" | "voice_seconds" | "video_seconds" | "storage_bytes";

/** Suivi des coûts par utilisateur (section 28). Alimenté par chaque appel fournisseur. */
export const usageRecords = pgTable(
  "usage_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companionId: uuid("companion_id"),
    kind: text("kind").$type<UsageKind>().notNull(),
    quantity: bigint("quantity", { mode: "number" }).notNull(),
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull().default(0),
    model: text("model"),
    feature: text("feature"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usage_user_time_idx").on(t.userId, t.createdAt)],
);
