import { describe, expect, it } from "vitest";
import { applyReading, calibrate, distance, initialCalibration, mergeStyle, statesFromClassification, styleSample } from "./calibration.js";
import { resolvePersonality } from "../personality/index.js";
import { estimateEmotion } from "./index.js";

const P = resolvePersonality({ preset: "playful" });
const SAD = statesFromClassification({ dominant: "sad", confidence: 0.8, cues: [] });
const OK = statesFromClassification({ dominant: "neutral", confidence: 0.8, cues: [] });
const HAPPY = statesFromClassification({ dominant: "positive", confidence: 0.8, cues: [] });

describe("auto-calibration", () => {
  it("part neutre : aucune consigne sans lecture ni style", () => {
    const out = calibrate(initialCalibration(), P);
    expect(out.lines).toEqual([]);
    expect(out.unusual).toBe(false);
  });

  it("l'humeur courante suit vite, la référence lentement", () => {
    let cal = initialCalibration();
    for (let i = 0; i < 8; i++) cal = applyReading(cal, OK, "ça va et toi ?");
    const before = cal.baseline.neutral;
    cal = applyReading(cal, SAD, "je suis triste");
    expect(cal.current.sad).toBeGreaterThan(0.35);
    expect(cal.baseline.neutral).toBeGreaterThan(before - 0.06);
    expect(cal.readings).toBe(9);
  });

  it("adapte le ton à la tristesse et détecte un changement inhabituel après historique", () => {
    let cal = initialCalibration();
    for (let i = 0; i < 8; i++) cal = applyReading(cal, HAPPY, "trop bien mdr 😂");
    cal = applyReading(cal, SAD, "je me sens seul");
    cal = applyReading(cal, SAD, "j'en peux plus");
    const out = calibrate(cal, P, { heuristicNow: estimateEmotion("je suis triste") });
    expect(out.adjustments.teasing).toBe("off");
    expect(out.lines.join(" ")).toContain("pas de vannes");
    expect(out.unusual).toBe(true);
    expect(out.lines.join(" ")).toContain("pas son état habituel");
    expect(distance(cal.current, cal.baseline)).toBeGreaterThan(0.6);
  });

  it("imite le style d'écriture : court, sans emoji, minuscules", () => {
    let cal = initialCalibration();
    for (const m of ["ok", "ça va", "tranquille", "oui"]) cal = applyReading(cal, OK, m);
    const out = calibrate(cal, resolvePersonality({ preset: "warm", style: { messageLength: "medium" } }));
    expect(out.adjustments.messageLength).toBe("shorter");
    expect(out.adjustments.emojis).toBe("fewer");
    expect(out.adjustments.lowercase).toBe(true);
    expect(styleSample("Salut 😂😂 !").emojiRate).toBe(2);
    const merged = mergeStyle(styleSample("aaaa"), styleSample("bbbbbbbb"));
    expect(merged.avgMessageLength).toBe(6);
    expect(merged.samples).toBe(2);
  });

  it("la fatigue raccourcit, la bonne humeur relance", () => {
    const tired = applyReading(initialCalibration(), statesFromClassification({ dominant: "tired", confidence: 0.9, cues: [] }), "crevé");
    expect(calibrate(tired, P).adjustments.messageLength).toBe("shorter");
    const happy = applyReading(initialCalibration(), HAPPY, "trop bien !");
    expect(calibrate(happy, P).adjustments.energy).toBe("higher");
  });
});
