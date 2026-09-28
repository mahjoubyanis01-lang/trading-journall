import { describe, expect, it } from "vitest";
import { describeEmotion, estimateEmotion } from "./index.js";

describe("emotion estimator (heuristique, probabiliste)", () => {
  it("renvoie une distribution qui somme à ~1 et reste neutre sur un message banal", () => {
    const e = estimateEmotion("tu fais quoi ce soir ?");
    const sum = Object.values(e.states).reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(0.98);
    expect(e.states.neutral).toBeGreaterThan(0.9);
    expect(e.intensity).toBeLessThan(0.2);
    expect(describeEmotion(e)).toBeNull();
  });
  it("détecte fatigue, stress, tristesse, joie sans certitude", () => {
    expect(estimateEmotion("crevé, j'ai pas dormi...").states.tired).toBeGreaterThan(0.4);
    expect(estimateEmotion("trop de pression, deadline demain, j'y arrive pas").states.stressed).toBeGreaterThan(0.5);
    const sad = estimateEmotion("je me sens seul et triste");
    expect(sad.states.sad).toBeGreaterThan(0.5);
    expect(sad.intensity).toBeGreaterThanOrEqual(0.6);
    expect(estimateEmotion("mdrrr trop bien 😂").states.positive).toBeGreaterThan(0.5);
    const d = describeEmotion(sad)!;
    expect(d).toContain("peut-être");
    expect(d).toContain("N'affirme rien");
  });
});
