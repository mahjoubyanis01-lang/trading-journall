import { z } from "zod";
import { patchOf, withDefaults } from "./schema-utils.js";

/** Trait continu 0..1. */
export const trait = z.number().min(0).max(1);

const traitShape = {
  humor: trait,
  curiosity: trait,
  sociability: trait,
  affection: trait,
  energy: trait,
  calm: trait,
  teasing: trait,
  spontaneity: trait,
};
export const DEFAULT_TRAITS = { humor: 0.6, curiosity: 0.7, sociability: 0.7, affection: 0.5, energy: 0.6, calm: 0.5, teasing: 0.4, spontaneity: 0.6 };
export const personalityTraitsSchema = withDefaults(traitShape, DEFAULT_TRAITS);
export const personalityTraitsPatchSchema = patchOf(traitShape);
export type PersonalityTraits = z.infer<typeof personalityTraitsSchema>;

export const messageLengthSchema = z.enum(["short", "medium", "long"]);
export const frequencySchema = z.enum(["never", "rare", "sometimes", "often"]);

const styleShape = {
  messageLength: messageLengthSchema,
  voiceFrequency: frequencySchema,
  storyFrequency: frequencySchema,
  initiativeFrequency: frequencySchema,
  emojiUsage: z.enum(["none", "light", "normal", "heavy"]),
  language: z.string().min(2).max(10),
};
export const DEFAULT_STYLE = {
  messageLength: "short",
  voiceFrequency: "sometimes",
  storyFrequency: "sometimes",
  initiativeFrequency: "sometimes",
  emojiUsage: "light",
  language: "fr",
} as const;
export const personalityStyleSchema = withDefaults(styleShape, DEFAULT_STYLE);
export const personalityStylePatchSchema = patchOf(styleShape);
export type PersonalityStyle = z.infer<typeof personalityStyleSchema>;

export const personalitySchema = z.object({
  traits: personalityTraitsSchema.prefault({}),
  style: personalityStyleSchema.prefault({}),
  /** Préset d'origine (pour l'onboarding). */
  preset: z.string().max(40).nullable().default(null),
});
export type Personality = z.infer<typeof personalitySchema>;

export const personalityUpdateSchema = z.object({
  traits: personalityTraitsPatchSchema.optional(),
  style: personalityStylePatchSchema.optional(),
  preset: z.string().max(40).nullable().optional(),
});
export type PersonalityUpdate = z.infer<typeof personalityUpdateSchema>;

/** Présets proposés à l'onboarding : point de départ, jamais une contrainte. */
export const PERSONALITY_PRESETS: Record<
  string,
  { label: string; description: string; traits: Partial<PersonalityTraits>; style?: Partial<PersonalityStyle> }
> = {
  warm: {
    label: "Chaleureux·se",
    description: "Présent·e, attentionné·e, doux·ce. Aime prendre des nouvelles.",
    traits: { affection: 0.8, calm: 0.7, humor: 0.5, teasing: 0.2, energy: 0.5 },
    style: { emojiUsage: "normal" },
  },
  playful: {
    label: "Taquin·e",
    description: "Drôle, vif·ve, un peu provocateur·rice. Ne se prend pas au sérieux.",
    traits: { humor: 0.9, teasing: 0.8, energy: 0.8, spontaneity: 0.8, calm: 0.3 },
    style: { emojiUsage: "normal", messageLength: "short" },
  },
  chill: {
    label: "Posé·e",
    description: "Calme, à l'écoute, réfléchi·e. Parle peu mais bien.",
    traits: { calm: 0.9, energy: 0.3, humor: 0.4, teasing: 0.2, curiosity: 0.6 },
    style: { emojiUsage: "light", messageLength: "medium", initiativeFrequency: "rare" },
  },
  curious: {
    label: "Curieux·se",
    description: "Pose des questions, s'intéresse à tout, relance.",
    traits: { curiosity: 0.95, sociability: 0.8, energy: 0.7, humor: 0.6 },
    style: { emojiUsage: "light" },
  },
};
