import { z } from "zod";

export const memoryTypeSchema = z.enum(["identity", "preference", "episodic", "semantic", "relationship", "event", "shared"]);

/** Sortie structurée de l'extraction (petit modèle local : schéma plat, valeurs simples). */
export const extractionSchema = z.object({
  items: z
    .array(
      z.object({
        op: z.enum(["add", "update", "forget"]).default("add"),
        type: memoryTypeSchema.default("semantic"),
        /** Emplacement unique pour identity/preference (ex: "prenom", "travail", "ville", "plat_prefere"). */
        key: z.string().max(40).nullable().default(null),
        content: z.string().min(1).max(300),
        importance: z.number().min(0).max(1).default(0.5),
        confidence: z.number().min(0).max(1).default(0.8),
        /** Date de l'événement raconté (ISO ou expression relative), sinon null. */
        occurred_at: z.string().max(40).nullable().default(null),
      }),
    )
    .default([]),
  events: z
    .array(
      z.object({
        type: z.string().max(40).default("other"),
        title: z.string().min(1).max(120),
        /** "YYYY-MM-DD" de préférence, sinon une expression relative en français ("vendredi", "demain"). */
        date: z.string().max(40),
        time: z.string().max(5).nullable().default(null),
        importance: z.number().min(0).max(1).default(0.6),
      }),
    )
    .default([]),
});
export type Extraction = z.infer<typeof extractionSchema>;

/** Classification d'humeur par le modèle rapide. Simple pour rester fiable sur un petit modèle. */
export const moodSchema = z.object({
  dominant: z.enum(["neutral", "positive", "tired", "stressed", "sad", "angry"]).default("neutral"),
  confidence: z.number().min(0).max(1).default(0.5),
  cues: z.array(z.string().max(40)).max(5).default([]),
});
export type MoodClassification = z.infer<typeof moodSchema>;
