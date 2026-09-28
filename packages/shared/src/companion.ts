import { z } from "zod";
import { personalitySchema, personalityUpdateSchema } from "./personality.js";
import { patchOf, withDefaults } from "./schema-utils.js";

export const voiceGenderSchema = z.enum(["feminine", "masculine", "neutral"]);

/** Identité vocale du compagnon. voiceId est un id du catalogue TASK, résolu côté serveur (VoiceProvider). */
const voiceShape = {
  gender: voiceGenderSchema,
  voiceId: z.string().max(60),
  speed: z.number().min(0.7).max(1.3),
};
export const companionVoiceSchema = withDefaults(voiceShape, { gender: "feminine", voiceId: "aria", speed: 1 });
export const companionVoicePatchSchema = patchOf(voiceShape);
export type CompanionVoice = z.infer<typeof companionVoiceSchema>;

/**
 * Apparence. Le MVP utilise un avatar stylisé (couleur + initiale + style) ;
 * l'image de référence (identité visuelle persistante) arrive avec ImageProvider.
 */
const avatarShape = {
  kind: z.enum(["stylized", "image"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  style: z.enum(["soft", "bold", "minimal"]),
  referenceMediaId: z.string().uuid().nullable(),
};
export const companionAvatarSchema = withDefaults(avatarShape, { kind: "stylized", color: "#7C5CFF", style: "soft", referenceMediaId: null });
export const companionAvatarPatchSchema = patchOf(avatarShape);
export type CompanionAvatar = z.infer<typeof companionAvatarSchema>;

/** Ce que l'utilisateur autorise pour ce compagnon (section 24). */
const permissionsShape = {
  spontaneousMessages: z.boolean(),
  spontaneousCalls: z.boolean(),
  stories: z.boolean(),
  notifications: z.boolean(),
  preferredChannel: z.enum(["text", "voice", "call"]),
};
export const companionPermissionsSchema = withDefaults(permissionsShape, {
  spontaneousMessages: true,
  spontaneousCalls: false,
  stories: true,
  notifications: true,
  preferredChannel: "text",
});
export const companionPermissionsPatchSchema = patchOf(permissionsShape);
export type CompanionPermissions = z.infer<typeof companionPermissionsSchema>;

export const companionStatusSchema = z.enum(["onboarding", "active", "archived"]);

export const createCompanionSchema = z.object({
  name: z.string().trim().min(1).max(40),
  bio: z.string().trim().max(300).optional(),
  voice: companionVoicePatchSchema.optional(),
  avatar: companionAvatarPatchSchema.optional(),
  personality: personalityUpdateSchema.optional(),
  permissions: companionPermissionsPatchSchema.optional(),
  /** Comment le compagnon doit appeler l'utilisateur. */
  userNickname: z.string().trim().min(1).max(40).optional(),
});
export type CreateCompanionInput = z.infer<typeof createCompanionSchema>;

export const updateCompanionSchema = createCompanionSchema.partial().extend({
  status: companionStatusSchema.optional(),
});
export type UpdateCompanionInput = z.infer<typeof updateCompanionSchema>;

export const companionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  bio: z.string().nullable(),
  userNickname: z.string().nullable(),
  status: companionStatusSchema,
  voice: companionVoiceSchema,
  avatar: companionAvatarSchema,
  permissions: companionPermissionsSchema,
  personality: personalitySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Companion = z.infer<typeof companionSchema>;
