import type { ZodType } from "zod";
import type { AIProvider, AITask, CompletionEvent, CompletionRequest, CompletionResult, StructuredResult } from "./types.js";

export type ProviderSlot = "chat" | "fast" | "deep";

const TASK_SLOT: Record<AITask, ProviderSlot> = {
  "chat.simple": "chat",
  "chat.deep": "deep",
  "emotion.classify": "fast",
  "memory.extract": "fast",
  "memory.consolidate": "chat",
  "initiative.reason": "chat",
  "story.generate": "chat",
  "call.summary": "fast",
};

/**
 * Routeur multi-fournisseurs : chaque tâche va vers un "slot" (chat / fast / deep) et chaque slot
 * vers un fournisseur (Hermes Agent, LLM local, Anthropic, factice). Exemple recommandé :
 *   chat → Hermes Agent (ou Ollama hermes3:8b), fast → Ollama petit modèle, deep → Anthropic ou modèle local plus gros.
 */
export class RoutedAIProvider implements AIProvider {
  readonly name: string;
  constructor(private slots: Record<ProviderSlot, AIProvider>) {
    this.name = `routed(chat=${slots.chat.name},fast=${slots.fast.name},deep=${slots.deep.name})`;
  }
  providerFor(task: AITask): AIProvider {
    return this.slots[TASK_SLOT[task]];
  }
  complete(req: CompletionRequest): Promise<CompletionResult> {
    return this.providerFor(req.task).complete(req);
  }
  stream(req: CompletionRequest): AsyncIterable<CompletionEvent> {
    return this.providerFor(req.task).stream(req);
  }
  structured<T>(req: CompletionRequest, schema: ZodType<T>, schemaName: string): Promise<StructuredResult<T>> {
    return this.providerFor(req.task).structured(req, schema, schemaName);
  }
}
