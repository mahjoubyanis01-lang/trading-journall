import type { ZodType } from "zod";

/**
 * Tâches IA connues du routeur. Chaque moteur déclare sa tâche ; le routeur choisit
 * le modèle, l'effort et le budget de tokens. Ne jamais appeler un modèle "en dur".
 */
export type AITask =
  | "chat.simple"
  | "chat.deep"
  | "emotion.classify"
  | "memory.extract"
  | "memory.consolidate"
  | "initiative.reason"
  | "story.generate"
  | "call.summary";

export type ChatRole = "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface CompletionRequest {
  task: AITask;
  /** Partie stable du system prompt (mise en cache par le fournisseur). */
  system: string;
  /** Partie volatile (heure, état) ajoutée après le bloc caché. */
  systemVolatile?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  /** Signaux pour le routeur. */
  signals?: RoutingSignals;
  /** Identifiants pour la comptabilité des coûts. */
  meta: { userId: string; companionId?: string; feature: string };
}

export interface RoutingSignals {
  relationshipStage?: "new" | "warming" | "established" | "close";
  emotionalIntensity?: number; // 0..1
  hasUpcomingEvent?: boolean;
  userMessageLength?: number;
  /** Quota interne dépassé : dégrader gracieusement. */
  degrade?: boolean;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface CompletionResult {
  text: string;
  model: string;
  /** Nom du fournisseur ayant servi la requête (comptabilité : les modèles locaux coûtent 0). */
  provider: string;
  stopReason: string;
  usage: Usage;
  latencyMs: number;
}

export type CompletionEvent =
  | { type: "delta"; text: string }
  | { type: "done"; result: CompletionResult };

export interface StructuredResult<T> {
  data: T;
  model: string;
  provider: string;
  usage: Usage;
  latencyMs: number;
}

export interface AIProvider {
  readonly name: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
  stream(req: CompletionRequest): AsyncIterable<CompletionEvent>;
  structured<T>(req: CompletionRequest, schema: ZodType<T>, schemaName: string): Promise<StructuredResult<T>>;
}

export interface ModelChoice {
  model: string;
  effort?: "low" | "medium" | "high";
  maxTokens: number;
  /** Utiliser le mode "thinking" adaptatif (modèles qui le supportent). */
  thinking: boolean;
}
