import type { AITask, ModelChoice, RoutingSignals } from "./types.js";

/**
 * Model Router (section 27). Choix par tâche + signaux. Un modèle coûteux n'est utilisé
 * que pour les conversations qui le méritent (relation avancée, émotion forte, événement).
 */
export const MODELS = {
  fast: "claude-haiku-4-5",
  balanced: "claude-sonnet-5",
  deep: "claude-opus-5",
} as const;

export function chooseModel(task: AITask, signals: RoutingSignals = {}): ModelChoice {
  const degrade = signals.degrade === true;
  switch (task) {
    case "chat.simple":
      return { model: degrade ? MODELS.fast : MODELS.balanced, effort: "low", maxTokens: 600, thinking: false };
    case "chat.deep":
      return degrade
        ? { model: MODELS.balanced, effort: "low", maxTokens: 800, thinking: false }
        : { model: MODELS.deep, effort: "medium", maxTokens: 1000, thinking: true };
    case "emotion.classify":
      return { model: MODELS.fast, maxTokens: 300, thinking: false };
    case "memory.extract":
      return { model: MODELS.fast, maxTokens: 1500, thinking: false };
    case "memory.consolidate":
      return { model: MODELS.balanced, effort: "low", maxTokens: 3000, thinking: false };
    case "initiative.reason":
    case "story.generate":
      return { model: MODELS.balanced, effort: "low", maxTokens: 400, thinking: false };
    case "call.summary":
      return { model: MODELS.fast, maxTokens: 800, thinking: false };
  }
}

/** Décide si une conversation mérite le modèle profond. */
export function pickChatTask(signals: RoutingSignals): "chat.simple" | "chat.deep" {
  if (signals.degrade) return "chat.simple";
  if ((signals.emotionalIntensity ?? 0) >= 0.6) return "chat.deep";
  if (signals.hasUpcomingEvent) return "chat.deep";
  if ((signals.userMessageLength ?? 0) > 400) return "chat.deep";
  if (signals.relationshipStage === "close") return "chat.deep";
  return "chat.simple";
}
