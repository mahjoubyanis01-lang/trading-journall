import { and, eq, gt } from "drizzle-orm";
import { userPreferencesSchema, type RegisterInput, type LoginInput, type UserPublic } from "@task/shared";
import type { Db } from "../../db/client.js";
import { sessions, users, type UserRow } from "../../db/schema/index.js";
import { conflict, unauthorized } from "../../errors.js";
import { generateSessionToken, hashPassword, hashSessionToken, verifyPassword } from "./password.js";

export function toUserPublic(u: UserRow): UserPublic {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    locale: u.locale,
    timezone: u.timezone,
    preferences: userPreferencesSchema.parse(u.preferences ?? {}),
    createdAt: u.createdAt.toISOString(),
  };
}

export class AuthService {
  constructor(
    private db: Db,
    private sessionTtlDays: number,
  ) {}

  async register(input: RegisterInput, userAgent?: string) {
    const existing = await this.db.query.users.findFirst({ where: eq(users.email, input.email) });
    if (existing) throw conflict("email_taken", "Un compte existe déjà avec cet email");
    const passwordHash = await hashPassword(input.password);
    const [user] = await this.db
      .insert(users)
      .values({
        email: input.email,
        passwordHash,
        displayName: input.displayName ?? null,
        locale: input.locale,
        timezone: input.timezone,
        preferences: userPreferencesSchema.parse({}),
      })
      .returning();
    const session = await this.createSession(user!.id, userAgent);
    return { user: toUserPublic(user!), ...session };
  }

  async login(input: LoginInput, userAgent?: string) {
    const user = await this.db.query.users.findFirst({ where: eq(users.email, input.email) });
    // Même message dans les deux cas : ne pas révéler l'existence d'un compte.
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw unauthorized("Email ou mot de passe incorrect");
    }
    const session = await this.createSession(user.id, userAgent);
    return { user: toUserPublic(user), ...session };
  }

  async createSession(userId: string, userAgent?: string) {
    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + this.sessionTtlDays * 86_400_000);
    await this.db.insert(sessions).values({ userId, tokenHash: hashSessionToken(token), userAgent: userAgent?.slice(0, 200) ?? null, expiresAt });
    return { token, expiresAt };
  }

  /** Résout un token en utilisateur. Retourne null si absent/expiré. */
  async resolve(token: string): Promise<UserRow | null> {
    const tokenHash = hashSessionToken(token);
    const row = await this.db
      .select({ user: users, sessionId: sessions.id })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
      .limit(1);
    const hit = row[0];
    if (!hit) return null;
    // Mise à jour paresseuse de last_seen (au plus une fois par minute serait mieux ; suffisant ici).
    void this.db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, hit.sessionId)).catch(() => {});
    return hit.user;
  }

  async revoke(token: string) {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
  }

  async revokeAll(userId: string) {
    await this.db.delete(sessions).where(eq(sessions.userId, userId));
  }
}
