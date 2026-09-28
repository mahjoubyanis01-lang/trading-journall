import { pgTable, uuid, text, timestamp, jsonb, integer, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { companions } from "./companions.js";

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Null pour un groupe (V3). */
    companionId: uuid("companion_id").references(() => companions.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"direct" | "group">().notNull().default("direct"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastMessagePreview: text("last_message_preview"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversations_user_idx").on(t.userId), index("conversations_companion_idx").on(t.companionId)],
);

export type GenerationMeta = {
  model?: string;
  task?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  /** Raison interne quand le message vient d'une initiative. */
  initiativeReason?: string;
  safety?: { filtered: boolean; violations: string[] };
};

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** Dénormalisé pour l'isolation par utilisateur sans jointure. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companionId: uuid("companion_id").references(() => companions.id, { onDelete: "cascade" }),
    sender: text("sender").$type<"user" | "companion" | "system">().notNull(),
    kind: text("kind").$type<"text" | "voice" | "image" | "video" | "gif" | "story_reply" | "system">().notNull().default("text"),
    content: text("content").notNull(),
    mediaId: uuid("media_id"),
    burstIndex: integer("burst_index"),
    generationMeta: jsonb("generation_meta").$type<GenerationMeta>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
