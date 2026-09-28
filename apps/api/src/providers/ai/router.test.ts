import { describe, expect, it } from "vitest";
import { chooseModel, MODELS, pickChatTask } from "./router.js";
import { costMicroUsd } from "./pricing.js";

describe("model router", () => {
  it("n'utilise le modèle profond que quand la conversation le mérite", () => {
    expect(pickChatTask({})).toBe("chat.simple");
    expect(pickChatTask({ relationshipStage: "warming", userMessageLength: 40 })).toBe("chat.simple");
    expect(pickChatTask({ emotionalIntensity: 0.8 })).toBe("chat.deep");
    expect(pickChatTask({ hasUpcomingEvent: true })).toBe("chat.deep");
    expect(pickChatTask({ relationshipStage: "close" })).toBe("chat.deep");
    expect(pickChatTask({ relationshipStage: "close", emotionalIntensity: 0.9, degrade: true })).toBe("chat.simple");
  });

  it("assigne un modèle économique aux tâches de classification/extraction", () => {
    expect(chooseModel("emotion.classify").model).toBe(MODELS.fast);
    expect(chooseModel("memory.extract").model).toBe(MODELS.fast);
    expect(chooseModel("chat.simple").model).toBe(MODELS.balanced);
    expect(chooseModel("chat.deep").model).toBe(MODELS.deep);
    expect(chooseModel("chat.deep", { degrade: true }).model).toBe(MODELS.balanced);
    expect(chooseModel("chat.simple", { degrade: true }).model).toBe(MODELS.fast);
  });

  it("calcule un coût cohérent avec la grille de prix", () => {
    expect(costMicroUsd("claude-sonnet-5", { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(2_000_000);
    expect(costMicroUsd("claude-haiku-4-5", { inputTokens: 0, outputTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(5_000);
    expect(costMicroUsd("fake", { inputTokens: 100, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(0);
  });
});
