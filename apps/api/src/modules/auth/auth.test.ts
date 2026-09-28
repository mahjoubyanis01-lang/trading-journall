import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, registerUser, uniqueEmail, type TestContext } from "../../test/helpers.js";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => ctx.close());

describe("auth", () => {
  it("inscrit un utilisateur, pose un cookie de session et renvoie le profil", async () => {
    const email = uniqueEmail();
    const res = await ctx.app.inject({ method: "POST", url: "/api/auth/register", payload: { email, password: "motdepasse123", displayName: "Yanis" } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.email).toBe(email);
    expect(body.user.displayName).toBe("Yanis");
    expect(body.user.preferences.notifications.enabled).toBe(true);
    expect(body.user).not.toHaveProperty("passwordHash");
    const cookie = res.cookies.find((c) => c.name === "task_session");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe("lax");
  });

  it("refuse un email déjà utilisé et un mot de passe trop court", async () => {
    const { email } = await registerUser(ctx.app);
    const dup = await ctx.app.inject({ method: "POST", url: "/api/auth/register", payload: { email, password: "motdepasse123" } });
    expect(dup.statusCode).toBe(409);
    const short = await ctx.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: uniqueEmail(), password: "court" } });
    expect(short.statusCode).toBe(400);
    expect(short.json().error.code).toBe("validation_error");
  });

  it("connecte avec le bon mot de passe et refuse le mauvais sans révéler l'existence du compte", async () => {
    const { email } = await registerUser(ctx.app);
    const ok = await ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "motdepasse123" } });
    expect(ok.statusCode).toBe(200);
    const bad = await ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "mauvais-mdp" } });
    const unknown = await ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: uniqueEmail(), password: "mauvais-mdp" } });
    expect(bad.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(bad.json().error.message).toBe(unknown.json().error.message);
  });

  it("authentifie via cookie signé et via Bearer, et révoque à la déconnexion", async () => {
    const reg = await ctx.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: uniqueEmail(), password: "motdepasse123" } });
    const cookie = reg.cookies.find((c) => c.name === "task_session")!;
    const token = reg.json().token as string;

    const viaCookie = await ctx.app.inject({ method: "GET", url: "/api/auth/me", cookies: { task_session: cookie.value } });
    expect(viaCookie.statusCode).toBe(200);
    const viaBearer = await ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: { authorization: `Bearer ${token}` } });
    expect(viaBearer.statusCode).toBe(200);
    const anon = await ctx.app.inject({ method: "GET", url: "/api/auth/me" });
    expect(anon.statusCode).toBe(401);

    await ctx.app.inject({ method: "POST", url: "/api/auth/logout", headers: { authorization: `Bearer ${token}` } });
    const after = await ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: { authorization: `Bearer ${token}` } });
    expect(after.statusCode).toBe(401);
  });

  it("met à jour le profil et les préférences sans écraser le reste", async () => {
    const { auth } = await registerUser(ctx.app);
    const res = await ctx.app.inject({ method: "PATCH", url: "/api/users/me", headers: auth, payload: { displayName: "Y", preferences: { habitLearning: false } } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.displayName).toBe("Y");
    expect(res.json().user.preferences.habitLearning).toBe(false);
    expect(res.json().user.preferences.notifications.enabled).toBe(true);
  });

  it("supprime le compte et tout ce qui en dépend", async () => {
    const { auth, userId } = await registerUser(ctx.app);
    const c = await ctx.app.inject({ method: "POST", url: "/api/companions", headers: auth, payload: { name: "Emma" } });
    expect(c.statusCode).toBe(201);
    const del = await ctx.app.inject({ method: "DELETE", url: "/api/users/me", headers: auth });
    expect(del.statusCode).toBe(200);
    const me = await ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: auth });
    expect(me.statusCode).toBe(401);
    const rows = await ctx.db.query.companions.findMany({ where: (t, { eq }) => eq(t.userId, userId) });
    expect(rows).toHaveLength(0);
  });
});
