import { pgTable, uuid, text, timestamp, jsonb, integer, index, real } from "drizzle-orm/pg-core";
import type { CompanionAvatar, CompanionPermissions, CompanionVoice, PersonalityStyle, PersonalityTraits } from "@task/shared";
import { users } from "./users.js";

export const companions = pgTable(
  "companions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    bio: text("bio"),
    userNickname: text("user_nickname"),
    status: text("status").$type<"onboarding" | "active" | "archived">().notNull().default("active"),
    voice: jsonb("voice").$type<CompanionVoice>().notNull(),
    avatar: jsonb("avatar").$type<CompanionAvatar>().notNull(),
    permissions: jsonb("permissions").$type<CompanionPermissions>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index("companions_user_idx").on(t.userId)],
);

export const personalities = pgTable("personalities", {
  id: uuid("id").primaryKey().defaultRandom(),
  companionId: uuid("companion_id")
    .notNull()
    .unique()
    .references(() => companions.id, { onDelete: "cascade" }),
  traits: jsonb("traits").$type<PersonalityTraits>().notNull(),
  style: jsonb("style").$type<PersonalityStyle>().notNull(),
  preset: text("preset"),
  /** Incrémenté à chaque modification : permet de tracer l'évolution (légère) de la personnalité. */
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Dimensions internes de la relation (0..1). Jamais affichées comme score. */
export type RelationshipDimensions = {
  familiarity: number;
  closeness: number;
  frequency: number;
  acceptedInitiative: number;
  personalization: number;
  depth: number;
};
export type RelationshipStage = "new" | "warming" | "established" | "close";

export const relationships = pgTable("relationships", {
  id: uuid("id").primaryKey().defaultRandom(),
  companionId: uuid("companion_id")
    .notNull()
    .unique()
    .references(() => companions.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  dimensions: jsonb("dimensions").$type<RelationshipDimensions>().notNull(),
  stage: text("stage").$type<RelationshipStage>().notNull().default("new"),
  commPreference: text("comm_preference").$type<"text" | "voice" | "call" | "unknown">().notNull().default("unknown"),
  interactionCount: integer("interaction_count").notNull().default(0),
  /** Score glissant de profondeur des derniers échanges, utilisé par le routeur de modèles. */
  recentDepth: real("recent_depth").notNull().default(0),
  lastInteractionAt: timestamp("last_interaction_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const relationshipEvents = pgTable(
  "relationship_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companionId: uuid("companion_id")
      .notNull()
      .references(() => companions.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("relationship_events_companion_idx").on(t.companionId, t.createdAt)],
);

export type CompanionRow = typeof companions.$inferSelect;
export type PersonalityRow = typeof personalities.$inferSelect;
export type RelationshipRow = typeof relationships.$inferSelect;
