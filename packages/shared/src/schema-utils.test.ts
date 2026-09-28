import { describe, expect, it } from "vitest";
import { companionVoicePatchSchema, companionVoiceSchema, createCompanionSchema, personalityTraitsPatchSchema, personalityTraitsSchema, updateUserSchema } from "./index.js";

describe("schémas partagés", () => {
  it("les schémas complets appliquent les défauts, les schémas patch n'en injectent aucun", () => {
    expect(personalityTraitsSchema.parse({}).humor).toBe(0.6);
    expect(personalityTraitsPatchSchema.parse({ affection: 0.9 })).toEqual({ affection: 0.9 });
    expect(companionVoiceSchema.parse({})).toEqual({ gender: "feminine", voiceId: "aria", speed: 1 });
    expect(companionVoicePatchSchema.parse({ speed: 1.2 })).toEqual({ speed: 1.2 });
    const c = createCompanionSchema.parse({ name: "Emma", personality: { traits: { humor: 0.1 } }, permissions: { stories: false } });
    expect(c.personality?.traits).toEqual({ humor: 0.1 });
    expect(c.permissions).toEqual({ stories: false });
  });
  it("PATCH utilisateur partiel", () => {
    expect(updateUserSchema.parse({ preferences: { habitLearning: false } })).toEqual({ preferences: { habitLearning: false } });
  });
});
