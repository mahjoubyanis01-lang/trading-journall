import { z } from "zod";

/** Préférences globales de l'utilisateur (contrôle utilisateur, section 24/29). */
export const userPreferencesSchema = z.object({
  notifications: z
    .object({
      enabled: z.boolean().default(true),
      quietHours: z
        .object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) })
        .nullable()
        .default({ start: "23:00", end: "08:00" }),
    })
    .prefault({}),
  /** L'IA peut inférer des habitudes (heures de réveil, travail...). Désactivable. */
  habitLearning: z.boolean().default(true),
  /** Autorise le stockage de souvenirs que l'utilisateur mentionne sur des sujets sensibles. */
  sensitiveMemory: z.boolean().default(false),
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export const userPublicSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string().nullable(),
  locale: z.string(),
  timezone: z.string(),
  preferences: userPreferencesSchema,
  createdAt: z.string(),
});
export type UserPublic = z.infer<typeof userPublicSchema>;

export const updateUserSchema = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  locale: z.string().min(2).max(10).optional(),
  timezone: z.string().min(1).max(64).optional(),
  preferences: z
    .object({
      notifications: z.object({ enabled: z.boolean().optional(), quietHours: z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }).nullable().optional() }).optional(),
      habitLearning: z.boolean().optional(),
      sensitiveMemory: z.boolean().optional(),
    })
    .optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
