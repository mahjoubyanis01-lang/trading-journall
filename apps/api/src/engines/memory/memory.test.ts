import { describe, expect, it } from "vitest";
import { resolveRelativeDate, localParts, findRelativeDateInText } from "./dates.js";
import { tokenize, jaccard, overlapScore } from "./text.js";
import { detectSensitive } from "./sensitive.js";
import { extractionSchema } from "./schema.js";

const now = new Date("2026-09-28T19:30:00Z"); // lundi 28 septembre 2026, 21:30 à Paris
const tz = "Europe/Paris";
const ymd = (d: Date | null) => d?.toISOString().slice(0, 10);

describe("dates relatives (FR)", () => {
  it("résout jours de semaine, demain, dans N jours, week-end, ISO, jj/mm", () => {
    expect(localParts(now, tz).weekday).toBe(1);
    expect(ymd(resolveRelativeDate("vendredi", now, tz))).toBe("2026-10-02");
    expect(ymd(resolveRelativeDate("Vendredi prochain", now, tz))).toBe("2026-10-02");
    expect(ymd(resolveRelativeDate("lundi", now, tz))).toBe("2026-09-28");
    expect(ymd(resolveRelativeDate("lundi prochain", now, tz))).toBe("2026-10-05");
    expect(ymd(resolveRelativeDate("demain", now, tz))).toBe("2026-09-29");
    expect(ymd(resolveRelativeDate("après-demain", now, tz))).toBe("2026-09-30");
    expect(ymd(resolveRelativeDate("dans 3 jours", now, tz))).toBe("2026-10-01");
    expect(ymd(resolveRelativeDate("ce week-end", now, tz))).toBe("2026-10-03");
    expect(ymd(resolveRelativeDate("2026-10-15", now, tz))).toBe("2026-10-15");
    expect(ymd(resolveRelativeDate("15/10", now, tz))).toBe("2026-10-15");
    expect(ymd(resolveRelativeDate("le 12 janvier", now, tz))).toBe("2027-01-12");
    expect(ymd(resolveRelativeDate("le 30", now, tz))).toBe("2026-09-30");
    expect(ymd(resolveRelativeDate("vendredi 2 octobre 2026", now, tz))).toBe("2026-10-02");
    expect(ymd(resolveRelativeDate("vendredi 2 octobre à 14h", now, tz))).toBe("2026-10-02");
    expect(ymd(resolveRelativeDate("28 septembre 2026", now, tz))).toBe("2026-09-28");
    expect(resolveRelativeDate("un jour", now, tz)).toBeNull();
    expect(findRelativeDateInText("vendredi j'ai un entretien, je stresse")).toBe("vendredi");
    expect(findRelativeDateInText("on se voit demain ?")).toBe("demain");
    expect(findRelativeDateInText("j'adore les lasagnes")).toBeNull();
  });
});

describe("texte", () => {
  it("tokenise sans accents ni mots vides, mesure la similarité", () => {
    expect(tokenize("J'ai un entretien vendredi à Lyon !")).toEqual(["entretien", "vendredi", "lyon"]);
    expect(jaccard(tokenize("Yan travaille dans un café"), tokenize("Yan travaille dans un café à Lyon"))).toBeGreaterThan(0.7);
    expect(overlapScore(tokenize("entretien"), "Yan a un entretien d'embauche vendredi")).toBe(1);
    expect(overlapScore(tokenize("pizza"), "Yan a un entretien vendredi")).toBe(0);
  });
});

describe("sensible", () => {
  it("détecte santé, religion, finances et laisse passer le reste", () => {
    expect(detectSensitive("Yan suit une thérapie pour sa dépression")).toContain("health");
    expect(detectSensitive("Yan fait le ramadan")).toContain("religion");
    expect(detectSensitive("Yan a des dettes")).toContain("finance");
    expect(detectSensitive("Yan adore les pâtes")).toEqual([]);
  });
});

describe("schéma d'extraction", () => {
  it("accepte une sortie minimale de petit modèle et remplit les défauts", () => {
    const r = extractionSchema.parse({ items: [{ content: "Yan aime les pâtes" }], events: [{ title: "Entretien", date: "vendredi" }] });
    expect(r.items[0]).toMatchObject({ op: "add", type: "semantic", importance: 0.5, key: null });
    expect(r.events[0]).toMatchObject({ type: "other", importance: 0.6, time: null });
    expect(extractionSchema.parse({})).toEqual({ items: [], events: [] });
  });
});
