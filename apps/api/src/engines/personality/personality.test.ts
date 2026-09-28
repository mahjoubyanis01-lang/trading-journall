import { describe, expect, it } from "vitest";
import { buildPersonalityPrompt, evolveTrait, level, resolvePersonality } from "./index.js";

const base = { companionName: "Emma", userNickname: "Yan", stage: "new" as const };

describe("personality engine", () => {
  it("résout un préset avec surcharges et valeurs par défaut", () => {
    const p = resolvePersonality({ preset: "chill", traits: { humor: 0.9 } });
    expect(p.preset).toBe("chill");
    expect(p.traits.calm).toBe(0.9);
    expect(p.traits.humor).toBe(0.9);
    expect(p.style.initiativeFrequency).toBe("rare");
    expect(p.style.language).toBe("fr");
    expect(resolvePersonality({ preset: "inconnu" }).preset).toBeNull();
  });

  it("est déterministe : même entrée, même prompt (cache prompt possible)", () => {
    const p = resolvePersonality({ preset: "playful" });
    const a = buildPersonalityPrompt({ ...base, personality: p });
    const b = buildPersonalityPrompt({ ...base, personality: p });
    expect(a).toBe(b);
    expect(a).not.toMatch(/\d{2}:\d{2}/); // aucune heure : partie stable uniquement
  });

  it("traduit les traits en consignes cohérentes et ne montre jamais de chiffres", () => {
    const funny = buildPersonalityPrompt({ ...base, personality: resolvePersonality({ traits: { humor: 0.95, teasing: 0.1 } }) });
    const serious = buildPersonalityPrompt({ ...base, personality: resolvePersonality({ traits: { humor: 0.05, teasing: 0.1 } }) });
    expect(funny).toContain("très drôle");
    expect(serious).toContain("plutôt sérieux");
    expect(funny).toContain("ne taquines jamais");
    expect(funny).not.toMatch(/0\.\d/);
  });

  it("intègre l'identité, le surnom, le stade relationnel et les règles absolues", () => {
    const p = buildPersonalityPrompt({ ...base, bio: "étudiante en design", stage: "close", personality: resolvePersonality({}) });
    expect(p).toContain("Tu es Emma");
    expect(p).toContain("« Yan »");
    expect(p).toContain("étudiante en design");
    expect(p).toContain("Vous êtes proches");
    expect(p).toContain("jamais entrer dans un vrai conflit");
    expect(p).toContain("dépendance");
    expect(p).toContain("---");
    expect(p).toContain("je suis désolé que tu ressentes cela");
  });

  it("borne l'évolution des traits autour de l'origine", () => {
    expect(evolveTrait(0.5, 0.5, 0.5)).toBeCloseTo(0.52);
    expect(evolveTrait(0.5, 0.64, 0.5)).toBeCloseTo(0.65);
    expect(evolveTrait(0.5, 0.36, -0.5)).toBeCloseTo(0.35);
    expect(evolveTrait(0.95, 0.95, 0.5)).toBeLessThanOrEqual(1);
    expect(level(0)).toBe("very_low");
    expect(level(0.99)).toBe("very_high");
  });
});
