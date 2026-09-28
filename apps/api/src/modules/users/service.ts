import { eq } from "drizzle-orm";
import { userPreferencesSchema, type UpdateUserInput } from "@task/shared";
import type { Db } from "../../db/client.js";
import { users, type UserRow } from "../../db/schema/index.js";
import { notFound } from "../../errors.js";

export class UserService {
  constructor(private db: Db) {}

  async update(user: UserRow, input: UpdateUserInput): Promise<UserRow> {
    const prefs = input.preferences
      ? userPreferencesSchema.parse({ ...user.preferences, ...input.preferences, notifications: { ...user.preferences.notifications, ...(input.preferences.notifications ?? {}) } })
      : undefined;
    const [row] = await this.db
      .update(users)
      .set({
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.locale !== undefined ? { locale: input.locale } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(prefs ? { preferences: prefs } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();
    if (!row) throw notFound("Utilisateur");
    return row;
  }

  /** Suppression complète : cascade sur compagnons, personnalités, relations, conversations, messages, usage, sessions. */
  async deleteAccount(userId: string) {
    await this.db.delete(users).where(eq(users.id, userId));
  }
}
