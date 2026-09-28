import { and, asc, desc, eq, gte, isNull, lte } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { events, memories, type EventRow, type MemoryRow, type MemoryType, type UserRow } from "../../db/schema/index.js";
import type { AIProvider, ChatMessage } from "../../providers/ai/types.js";
import { extractionSchema, type Extraction } from "./schema.js";
import { resolveRelativeDate, formatLocalDate, localParts, findRelativeDateInText } from "./dates.js";
import { detectSensitive } from "./sensitive.js";
import { fold, jaccard, overlapScore, tokenize } from "./text.js";

/**
 * Memory Engine (section 6) — le "cerveau" du compagnon.
 * - ingest() : extraction structurée (modèle rapide) → opérations add/update/forget + événements ;
 * - recall() : rappel lexical (importance × pertinence × récence), sans dépendance externe ;
 * - renderBrain() : cerveau.md, tableau lisible par l'utilisateur ET injecté dans le prompt (borné).
 * Inspiré de la mémoire curée et bornée de Hermes Agent (MEMORY.md / USER.md), mais par compagnon,
 * isolée par utilisateur et contrôlable depuis l'app.
 */

export interface IngestInput {
  user: UserRow;
  companionId: string;
  companionName: string;
  /** Comment le compagnon appelle la personne (sinon son prénom). */
  userNickname?: string | null;
  /** Tours récents (du plus ancien au plus récent). */
  turns: { sender: "user" | "companion"; content: string; id?: string }[];
  now?: Date;
}

export interface IngestResult {
  added: MemoryRow[];
  updated: MemoryRow[];
  forgotten: MemoryRow[];
  events: EventRow[];
  droppedSensitive: number;
  skippedDuplicates: number;
}

const TYPE_LABEL: Record<MemoryType, string> = {
  identity: "Identité",
  preference: "Goûts et habitudes",
  semantic: "Ce que je sais",
  episodic: "Ce qu'on s'est raconté",
  relationship: "Nous",
  shared: "Nos moments",
  event: "Événements",
};

export const BRAIN_PROMPT_BUDGET_CHARS = 3200;

export class MemoryEngine {
  constructor(
    private db: Db,
    private ai: AIProvider,
  ) {}

  /* ───────────── extraction ───────────── */

  buildExtractionPrompt(input: IngestInput, existingBrain: string): { system: string; messages: ChatMessage[] } {
    const now = input.now ?? new Date();
    const today = formatLocalDate(now, input.user.timezone);
    const lp = localParts(now, input.user.timezone);
    const isoToday = `${lp.year}-${String(lp.month).padStart(2, "0")}-${String(lp.day).padStart(2, "0")}`;
    const nick = input.userNickname ?? input.user.displayName ?? "la personne";
    const system = [
      `Tu es la mémoire de ${input.companionName}, un compagnon qui discute avec ${nick}. Tu extrais ce qui mérite d'être retenu de l'échange ci-dessous, pour s'en souvenir dans des semaines.`,
      `Aujourd'hui : ${today} (${isoToday}).`,
      "",
      "Règles :",
      "- Ne retiens QUE ce que la personne a dit sur elle, sa vie, ses goûts, ses projets, ses proches, ou un moment marquant entre vous. Ignore le bavardage et ce que dit le compagnon.",
      "- N'invente rien, ne déduis pas d'informations sensibles (santé, religion, orientation, argent, politique). Si la personne en parle explicitement, retiens-le tel quel.",
      "- Une entrée = une phrase courte à la troisième personne (« Yan travaille dans un café »).",
      "- type : identity (qui elle est : prénom, âge, ville, travail, famille), preference (goûts, habitudes), episodic (un événement raconté, daté si possible), semantic (fait général sur elle), relationship (ce qu'elle attend de vous deux), shared (moment marquant entre vous : blague interne, première fois).",
      "- key : pour identity/preference uniquement, un identifiant stable en minuscules sans accent (prenom, age, ville, travail, etudes, famille, animal, plat_prefere, musique, sport, sommeil...). Réutilise la même key pour mettre à jour (op=update).",
      "- op=forget si la personne demande explicitement d'oublier quelque chose.",
      "- importance : 0.9 identité et grands événements, 0.6 goûts et projets, 0.3 détails.",
      "- events : uniquement des choses FUTURES avec une date (entretien, examen, rendez-vous, voyage, anniversaire, compétition, soirée). date en YYYY-MM-DD si tu peux la calculer à partir d'aujourd'hui, sinon l'expression exacte (« vendredi », « demain »).",
      "- Si rien ne mérite d'être retenu, renvoie des listes vides.",
      existingBrain ? `\nCe qui est déjà en mémoire (ne le répète pas, mets à jour si ça change) :\n${existingBrain}` : "",
    ].join("\n");
    const transcript = input.turns.map((t) => `${t.sender === "user" ? nick : input.companionName} : ${t.content}`).join("\n");
    return { system, messages: [{ role: "user", content: `Échange :\n${transcript}\n\nExtrais la mémoire en JSON.` }] };
  }

  async ingest(input: IngestInput): Promise<IngestResult> {
    const now = input.now ?? new Date();
    const result: IngestResult = { added: [], updated: [], forgotten: [], events: [], droppedSensitive: 0, skippedDuplicates: 0 };
    if (!input.turns.some((t) => t.sender === "user" && t.content.trim().length > 0)) return result;

    const existing = await this.active(input.companionId);
    const brain = this.renderMemories(existing, [], { forPrompt: true, budgetChars: 1800, timeZone: input.user.timezone });
    const { system, messages } = this.buildExtractionPrompt(input, brain);
    const { data } = await this.ai.structured(
      { task: "memory.extract", system, messages, meta: { userId: input.user.id, companionId: input.companionId, feature: "memory.extract" } },
      extractionSchema,
      "memory_extraction",
    );
    return this.apply(input, data, existing, now, result);
  }

  /** Applique une extraction (séparé pour les tests et la ré-ingestion). */
  async apply(input: IngestInput, data: Extraction, existing: MemoryRow[], now: Date, result: IngestResult): Promise<IngestResult> {
    const allowSensitive = input.user.preferences.sensitiveMemory === true;
    const lastUserMsg = [...input.turns].reverse().find((t) => t.sender === "user");
    const userSaid = input.turns.filter((t) => t.sender === "user").map((t) => t.content).join("\n");
    // Le nom de la personne apparaît dans chaque entrée : il ne compte pas comme preuve.
    const nameTokens = new Set(tokenize(`${input.user.displayName ?? ""} ${input.userNickname ?? ""} ${input.companionName}`));
    const evidence = (content: string) => overlapScore(tokenize(content).filter((t) => !nameTokens.has(t)), userSaid);
    // Un "forget" n'est honoré que si la personne a explicitement demandé d'oublier : un petit modèle
    // peut émettre l'opération à tort, et un oubli est destructif.
    const forgetRequested = /(oubli|efface|supprim|retiens pas|retiens plus|ne (?:le |la )?garde pas)/iu.test(fold(userSaid));

    for (const item of data.items) {
      const content = item.content.trim();
      if (!content) continue;
      const sensitiveCats = detectSensitive(content);
      const sensitive = sensitiveCats.length > 0;
      if (sensitive && !allowSensitive) {
        result.droppedSensitive++;
        continue;
      }
      // Sécurité anti-hallucination légère : un souvenir "identity/preference" doit partager du vocabulaire avec ce que l'utilisateur a dit.
      if ((item.type === "identity" || item.type === "preference") && item.confidence < 0.9 && evidence(content) < 0.34) continue;

      if (item.op === "forget") {
        if (!forgetRequested) continue;
        const targets = existing.filter((m) => (item.key && m.key === item.key) || jaccard(tokenize(m.content), tokenize(content)) >= 0.4);
        for (const t of targets) {
          const [row] = await this.db.update(memories).set({ deletedAt: now, updatedAt: now }).where(eq(memories.id, t.id)).returning();
          if (row) result.forgotten.push(row);
        }
        continue;
      }

      const keyMatch = item.key ? existing.find((m) => m.key === item.key && m.type === item.type) : undefined;
      const dup = existing.find((m) => jaccard(tokenize(m.content), tokenize(content)) >= 0.75);
      if (keyMatch && (item.op === "update" || keyMatch.content !== content)) {
        const [row] = await this.db
          .update(memories)
          .set({ content, importance: Math.max(keyMatch.importance, item.importance), confidence: item.confidence, sensitive, updatedAt: now, sourceMessageId: lastUserMsg?.id ?? null })
          .where(eq(memories.id, keyMatch.id))
          .returning();
        if (row) {
          result.updated.push(row);
          existing = existing.map((m) => (m.id === row.id ? row : m));
        }
        continue;
      }
      if (keyMatch || dup) {
        result.skippedDuplicates++;
        continue;
      }
      if (item.importance < 0.2) continue;
      const occurredAt = item.occurred_at ? resolveRelativeDate(item.occurred_at, now, input.user.timezone) : null;
      const [row] = await this.db
        .insert(memories)
        .values({
          userId: input.user.id,
          companionId: input.companionId,
          type: item.type,
          key: item.key ?? null,
          content,
          importance: item.importance,
          confidence: item.confidence,
          source: "user_said",
          sensitive,
          occurredAt: occurredAt ?? (item.type === "episodic" ? now : null),
          sourceMessageId: lastUserMsg?.id ?? null,
        })
        .returning();
      if (row) {
        result.added.push(row);
        existing = [...existing, row];
      }
    }

    const upcoming = await this.upcomingEvents(input.companionId, now, 365);
    const todayKey = formatLocalDate(now, input.user.timezone);
    const textDate = findRelativeDateInText(userSaid);
    for (const ev of data.events) {
      let when = resolveRelativeDate(ev.date, now, input.user.timezone);
      // Le modèle a souvent du mal avec les dates relatives : si sa date est absente ou tombe
      // "aujourd'hui" alors que la personne a écrit une expression de date, on fait confiance au texte.
      if (textDate && (!when || formatLocalDate(when, input.user.timezone) === todayKey)) {
        const fromText = resolveRelativeDate(textDate, now, input.user.timezone);
        if (fromText) when = fromText;
      }
      if (!when) continue;
      if (ev.time && /^\d{2}:\d{2}$/.test(ev.time)) {
        const [h, m] = ev.time.split(":").map(Number);
        when.setUTCHours(h!, m!, 0, 0); // approximation : heure locale ≈ UTC à midi ; affiné en phase 5 avec le fuseau
      }
      const same = upcoming.find((u) => Math.abs(u.startsAt.getTime() - when.getTime()) < 36 * 3600_000 && jaccard(tokenize(u.title), tokenize(ev.title)) >= 0.3);
      if (same) continue;
      const [memRow] = await this.db
        .insert(memories)
        .values({
          userId: input.user.id,
          companionId: input.companionId,
          type: "event",
          content: `${ev.title} (${formatLocalDate(when, input.user.timezone)})`,
          importance: Math.max(0.6, ev.importance),
          confidence: 0.9,
          source: "user_said",
          occurredAt: when,
          expiresAt: new Date(when.getTime() + 14 * 86_400_000),
          sourceMessageId: lastUserMsg?.id ?? null,
        })
        .returning();
      const [row] = await this.db
        .insert(events)
        .values({ userId: input.user.id, companionId: input.companionId, memoryId: memRow?.id ?? null, type: ev.type, title: ev.title, startsAt: when, allDay: !ev.time, importance: ev.importance })
        .returning();
      if (row) result.events.push(row);
    }
    return result;
  }

  /* ───────────── lecture ───────────── */

  async active(companionId: string): Promise<MemoryRow[]> {
    const now = new Date();
    const rows = await this.db
      .select()
      .from(memories)
      .where(and(eq(memories.companionId, companionId), isNull(memories.deletedAt)))
      .orderBy(desc(memories.importance), desc(memories.updatedAt));
    return rows.filter((m) => !m.expiresAt || m.expiresAt > now);
  }

  async upcomingEvents(companionId: string, now = new Date(), horizonDays = 14): Promise<EventRow[]> {
    return this.db
      .select()
      .from(events)
      .where(and(eq(events.companionId, companionId), isNull(events.deletedAt), gte(events.startsAt, new Date(now.getTime() - 86_400_000)), lte(events.startsAt, new Date(now.getTime() + horizonDays * 86_400_000))))
      .orderBy(asc(events.startsAt));
  }

  /** Rappel : pinned + identité toujours ; le reste trié par pertinence lexicale × importance × récence. */
  recall(rows: MemoryRow[], query: string, limit = 12, now = new Date()): MemoryRow[] {
    const q = tokenize(query);
    const scored = rows.map((m) => {
      const rel = overlapScore(q, m.content);
      const ageDays = (now.getTime() - m.updatedAt.getTime()) / 86_400_000;
      const recency = Math.exp(-ageDays / 45);
      const always = m.pinned || m.type === "identity" ? 1 : 0;
      return { m, score: always * 10 + rel * 3 + m.importance * 1.5 + recency * 0.5 };
    });
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.m);
  }

  async touchRecalled(ids: string[], now = new Date()) {
    for (const id of ids) {
      const [m] = await this.db.select({ n: memories.recallCount }).from(memories).where(eq(memories.id, id));
      await this.db.update(memories).set({ lastRecalledAt: now, recallCount: (m?.n ?? 0) + 1 }).where(eq(memories.id, id));
    }
  }

  /* ───────────── rendu cerveau.md ───────────── */

  renderMemories(rows: MemoryRow[], upcoming: EventRow[], opts: { forPrompt: boolean; budgetChars?: number; timeZone: string; now?: Date; companionName?: string; userName?: string }): string {
    const now = opts.now ?? new Date();
    const budget = opts.budgetChars ?? (opts.forPrompt ? BRAIN_PROMPT_BUDGET_CHARS : Infinity);
    const order: MemoryType[] = ["identity", "preference", "relationship", "shared", "semantic", "episodic"];
    const lines: string[] = [];
    if (!opts.forPrompt) lines.push(`# Cerveau de ${opts.companionName ?? "ton compagnon"}`, "", `Ce que ${opts.companionName ?? "il"} sait de ${opts.userName ?? "toi"}. Tu peux tout modifier ou supprimer.`, "");

    if (upcoming.length) {
      lines.push(opts.forPrompt ? "### À venir" : "## À venir", "", "| Quand | Quoi | Importance |", "|---|---|---|");
      for (const e of upcoming) {
        const days = Math.round((e.startsAt.getTime() - now.getTime()) / 86_400_000);
        const rel = days <= 0 ? "aujourd'hui" : days === 1 ? "demain" : `dans ${days} j`;
        lines.push(`| ${formatLocalDate(e.startsAt, opts.timeZone)} (${rel}) | ${e.title} | ${stars(e.importance)} |`);
      }
      lines.push("");
    }
    for (const type of order) {
      const items = rows.filter((m) => m.type === type);
      if (!items.length) continue;
      lines.push(opts.forPrompt ? `### ${TYPE_LABEL[type]}` : `## ${TYPE_LABEL[type]}`, "");
      if (opts.forPrompt) {
        for (const m of items) lines.push(`- ${m.content}${m.occurredAt && type === "episodic" ? ` (${formatLocalDate(m.occurredAt, opts.timeZone)})` : ""}`);
      } else {
        lines.push("| Souvenir | Importance | Depuis |", "|---|---|---|");
        for (const m of items) lines.push(`| ${m.content.replace(/\|/g, "/")} | ${stars(m.importance)} | ${formatLocalDate(m.createdAt, opts.timeZone)} |`);
      }
      lines.push("");
    }
    let out = lines.join("\n").trim();
    if (out.length > budget) {
      // Coupe proprement à la dernière ligne complète sous le budget.
      out = out.slice(0, budget);
      out = out.slice(0, out.lastIndexOf("\n")) + "\n…";
    }
    return out;
  }

  /** Cerveau compact pour le prompt : rappel ciblé + événements proches. */
  async brainForPrompt(companionId: string, query: string, timeZone: string, now = new Date()): Promise<{ text: string; recalledIds: string[] }> {
    const rows = await this.active(companionId);
    const upcoming = await this.upcomingEvents(companionId, now, 10);
    const picked = this.recall(rows, query, 14, now);
    const text = this.renderMemories(picked, upcoming, { forPrompt: true, timeZone, now });
    return { text, recalledIds: picked.map((m) => m.id) };
  }

  /* ───────────── contrôle utilisateur ───────────── */

  async update(userId: string, id: string, patch: { content?: string; pinned?: boolean; importance?: number }) {
    const [row] = await this.db
      .update(memories)
      .set({ ...patch, source: patch.content !== undefined ? "user_edited" : undefined, updatedAt: new Date() })
      .where(and(eq(memories.id, id), eq(memories.userId, userId), isNull(memories.deletedAt)))
      .returning();
    return row ?? null;
  }

  async forget(userId: string, id: string) {
    const [row] = await this.db
      .update(memories)
      .set({ deletedAt: new Date() })
      .where(and(eq(memories.id, id), eq(memories.userId, userId)))
      .returning();
    return row ?? null;
  }

  async forgetEvent(userId: string, id: string) {
    const [row] = await this.db
      .update(events)
      .set({ deletedAt: new Date() })
      .where(and(eq(events.id, id), eq(events.userId, userId)))
      .returning();
    if (row?.memoryId) await this.db.update(memories).set({ deletedAt: new Date() }).where(eq(memories.id, row.memoryId));
    return row ?? null;
  }

  /** "Oublie ça" : supprime les souvenirs lexicalement proches du texte donné. */
  async forgetByText(userId: string, companionId: string, text: string): Promise<MemoryRow[]> {
    const rows = (await this.active(companionId)).filter((m) => m.userId === userId);
    const q = tokenize(text);
    const targets = rows.filter((m) => overlapScore(q, m.content) >= 0.5 || jaccard(q, tokenize(m.content)) >= 0.3);
    const out: MemoryRow[] = [];
    for (const t of targets) {
      const r = await this.forget(userId, t.id);
      if (r) out.push(r);
    }
    return out;
  }

  /** Purge définitive des souvenirs supprimés depuis plus de N jours (RGPD). */
  async purgeDeleted(olderThanDays = 30) {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
    await this.db.delete(memories).where(and(lte(memories.deletedAt, cutoff)));
  }
}

function stars(v: number) {
  return "★".repeat(Math.max(1, Math.round(v * 3))) + "☆".repeat(3 - Math.max(1, Math.round(v * 3)));
}
