import { pgTable, uuid, text, timestamp, jsonb, real, integer, boolean, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { companions } from "./companions.js";

export type MemoryType = "identity" | "preference" | "episodic" | "semantic" | "relationship" | "event" | "shared";
export type MemorySource = "user_said" | "inferred" | "shared_moment" | "system" | "user_edited";

/**
 * Le "cerveau" (section 6) : souvenirs catégorisés, avec importance, date, source, expiration.
 * `key` permet les emplacements uniques (ex. "prenom", "travail", "ville") mis à jour plutôt que dupliqués.
 * Rendu en markdown (cerveau.md) par le Memory Engine pour le prompt et pour l'utilisateur.
 */
export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companionId: uuid("companion_id")
      .notNull()
      .references(() => companions.id, { onDelete: "cascade" }),
    type: text("type").$type<MemoryType>().notNull(),
    key: text("key"),
    content: text("content").notNull(),
    importance: real("importance").notNull().default(0.5),
    confidence: real("confidence").notNull().default(0.8),
    source: text("source").$type<MemorySource>().notNull().default("user_said"),
    sensitive: boolean("sensitive").notNull().default(false),
    pinned: boolean("pinned").notNull().default(false),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastRecalledAt: timestamp("last_recalled_at", { withTimezone: true }),
    recallCount: integer("recall_count").notNull().default(0),
    /** Id du message d'origine (traçabilité). */
    sourceMessageId: uuid("source_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("memories_companion_idx").on(t.companionId, t.type), index("memories_companion_key_idx").on(t.companionId, t.key)],
);

export type EventFollowUp = "none" | "before_sent" | "day_sent" | "after_sent" | "done";

/** Événements futurs (section 17) : entretien, examen, voyage… avec état de relance. */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companionId: uuid("companion_id")
      .notNull()
      .references(() => companions.id, { onDelete: "cascade" }),
    memoryId: uuid("memory_id").references(() => memories.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    allDay: boolean("all_day").notNull().default(true),
    importance: real("importance").notNull().default(0.6),
    followUp: text("follow_up").$type<EventFollowUp>().notNull().default("none"),
    outcome: text("outcome"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("events_companion_time_idx").on(t.companionId, t.startsAt)],
);

export type MoodStates = { neutral: number; positive: number; tired: number; stressed: number; sad: number; angry: number };

/** Lectures d'humeur (section 8) : probabilistes, datées, sourcées. Jamais un diagnostic. */
export const moodReadings = pgTable(
  "mood_readings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companionId: uuid("companion_id")
      .notNull()
      .references(() => companions.id, { onDelete: "cascade" }),
    messageId: uuid("message_id"),
    states: jsonb("states").$type<MoodStates>().notNull(),
    intensity: real("intensity").notNull(),
    dominant: text("dominant").notNull(),
    source: text("source").$type<"heuristic" | "llm">().notNull(),
    /** Indices textuels courts (jamais le message complet). */
    cues: jsonb("cues").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mood_companion_time_idx").on(t.companionId, t.createdAt)],
);

export type UserStyle = {
  avgMessageLength: number;
  emojiRate: number; // emojis par message
  exclamationRate: number;
  questionRate: number;
  lowercaseRate: number; // part des messages commençant en minuscule
  samples: number;
};

/**
 * Auto-calibration : humeur de référence (lente), humeur récente (rapide), style d'écriture de
 * l'utilisateur (miroir). Le Personality Engine reste la source de la personnalité ; la calibration
 * module seulement le ton et le format du moment.
 */
export const calibrations = pgTable("calibrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companionId: uuid("companion_id")
    .notNull()
    .unique()
    .references(() => companions.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  baseline: jsonb("baseline").$type<MoodStates>().notNull(),
  current: jsonb("current").$type<MoodStates>().notNull(),
  userStyle: jsonb("user_style").$type<UserStyle>().notNull(),
  readings: integer("readings").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MemoryRow = typeof memories.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type MoodReadingRow = typeof moodReadings.$inferSelect;
export type CalibrationRow = typeof calibrations.$inferSelect;
