import { and, desc, eq, isNull } from "drizzle-orm";
import {
  companionAvatarSchema,
  companionPermissionsSchema,
  companionVoiceSchema,
  type Companion,
  type CreateCompanionInput,
  type UpdateCompanionInput,
} from "@task/shared";
import type { Db } from "../../db/client.js";
import {
  companions,
  conversations,
  personalities,
  relationshipEvents,
  relationships,
  type CompanionRow,
  type PersonalityRow,
  type RelationshipDimensions,
} from "../../db/schema/index.js";
import { resolvePersonality } from "../../engines/personality/index.js";
import { notFound } from "../../errors.js";

export const INITIAL_DIMENSIONS: RelationshipDimensions = {
  familiarity: 0.05,
  closeness: 0.05,
  frequency: 0,
  acceptedInitiative: 0.3,
  personalization: 0,
  depth: 0,
};

export function toCompanionDto(c: CompanionRow, p: PersonalityRow): Companion {
  return {
    id: c.id,
    name: c.name,
    bio: c.bio,
    userNickname: c.userNickname,
    status: c.status,
    voice: companionVoiceSchema.parse(c.voice),
    avatar: companionAvatarSchema.parse(c.avatar),
    permissions: companionPermissionsSchema.parse(c.permissions),
    personality: { traits: p.traits, style: p.style, preset: p.preset },
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/**
 * Service compagnon. Toute lecture/écriture est filtrée par userId : un utilisateur ne peut
 * jamais atteindre le compagnon d'un autre (testé dans companions.test.ts).
 */
export class CompanionService {
  constructor(private db: Db) {}

  async create(userId: string, input: CreateCompanionInput) {
    const personality = resolvePersonality({ preset: input.personality?.preset ?? null, traits: input.personality?.traits, style: input.personality?.style });
    return this.db.transaction(async (tx) => {
      const [c] = await tx
        .insert(companions)
        .values({
          userId,
          name: input.name,
          bio: input.bio ?? null,
          userNickname: input.userNickname ?? null,
          status: "active",
          voice: companionVoiceSchema.parse(input.voice ?? {}),
          avatar: companionAvatarSchema.parse(input.avatar ?? {}),
          permissions: companionPermissionsSchema.parse(input.permissions ?? {}),
        })
        .returning();
      const [p] = await tx
        .insert(personalities)
        .values({ companionId: c!.id, traits: personality.traits, style: personality.style, preset: personality.preset })
        .returning();
      await tx.insert(relationships).values({ companionId: c!.id, userId, dimensions: INITIAL_DIMENSIONS, stage: "new" });
      await tx.insert(conversations).values({ userId, companionId: c!.id, kind: "direct" });
      await tx.insert(relationshipEvents).values({ companionId: c!.id, type: "companion_created", payload: { preset: personality.preset } });
      return toCompanionDto(c!, p!);
    });
  }

  async list(userId: string): Promise<Companion[]> {
    const rows = await this.db
      .select({ c: companions, p: personalities })
      .from(companions)
      .innerJoin(personalities, eq(personalities.companionId, companions.id))
      .where(and(eq(companions.userId, userId), isNull(companions.archivedAt)))
      .orderBy(desc(companions.createdAt));
    return rows.map((r) => toCompanionDto(r.c, r.p));
  }

  async getRaw(userId: string, companionId: string) {
    const row = await this.db
      .select({ c: companions, p: personalities, r: relationships })
      .from(companions)
      .innerJoin(personalities, eq(personalities.companionId, companions.id))
      .innerJoin(relationships, eq(relationships.companionId, companions.id))
      .where(and(eq(companions.id, companionId), eq(companions.userId, userId)))
      .limit(1);
    const hit = row[0];
    if (!hit) throw notFound("Compagnon");
    return hit;
  }

  async get(userId: string, companionId: string): Promise<Companion> {
    const { c, p } = await this.getRaw(userId, companionId);
    return toCompanionDto(c, p);
  }

  async update(userId: string, companionId: string, input: UpdateCompanionInput): Promise<Companion> {
    const { c, p } = await this.getRaw(userId, companionId);
    return this.db.transaction(async (tx) => {
      const [nc] = await tx
        .update(companions)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.bio !== undefined ? { bio: input.bio } : {}),
          ...(input.userNickname !== undefined ? { userNickname: input.userNickname } : {}),
          ...(input.status !== undefined ? { status: input.status, archivedAt: input.status === "archived" ? new Date() : null } : {}),
          ...(input.voice ? { voice: companionVoiceSchema.parse({ ...c.voice, ...input.voice }) } : {}),
          ...(input.avatar ? { avatar: companionAvatarSchema.parse({ ...c.avatar, ...input.avatar }) } : {}),
          ...(input.permissions ? { permissions: companionPermissionsSchema.parse({ ...c.permissions, ...input.permissions }) } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(companions.id, companionId), eq(companions.userId, userId)))
        .returning();
      let np = p;
      if (input.personality) {
        const merged = resolvePersonality({
          preset: input.personality.preset !== undefined ? input.personality.preset : p.preset,
          traits: { ...p.traits, ...(input.personality.traits ?? {}) },
          style: { ...p.style, ...(input.personality.style ?? {}) },
        });
        const [row] = await tx
          .update(personalities)
          .set({ traits: merged.traits, style: merged.style, preset: merged.preset, version: p.version + 1, updatedAt: new Date() })
          .where(eq(personalities.companionId, companionId))
          .returning();
        np = row!;
      }
      return toCompanionDto(nc!, np);
    });
  }

  /** Suppression définitive du compagnon et de toute sa relation (mémoire, messages). */
  async delete(userId: string, companionId: string) {
    const res = await this.db
      .delete(companions)
      .where(and(eq(companions.id, companionId), eq(companions.userId, userId)))
      .returning({ id: companions.id });
    if (res.length === 0) throw notFound("Compagnon");
  }
}
