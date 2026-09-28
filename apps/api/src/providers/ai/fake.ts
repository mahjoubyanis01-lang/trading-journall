import type { ZodType } from "zod";
import type { AIProvider, CompletionEvent, CompletionRequest, CompletionResult, StructuredResult } from "./types.js";

type Scripted = string | ((req: CompletionRequest) => string);

/**
 * Fournisseur déterministe pour les tests et le développement sans clé.
 * Il n'imite pas l'intelligence du modèle : il renvoie des réponses scriptées
 * (file d'attente) ou une réponse par défaut explicite, et enregistre chaque requête
 * pour que les tests puissent vérifier le contexte construit par les moteurs.
 */
export class FakeAIProvider implements AIProvider {
  readonly name = "fake";
  readonly requests: CompletionRequest[] = [];
  private queue: Scripted[] = [];
  private structuredQueue: unknown[] = [];

  /** Vide les files et l'historique des requêtes (à appeler entre deux tests). */
  reset() {
    this.queue.length = 0;
    this.structuredQueue.length = 0;
    this.requests.length = 0;
    return this;
  }

  enqueue(...responses: Scripted[]) {
    this.queue.push(...responses);
    return this;
  }
  enqueueStructured(...data: unknown[]) {
    this.structuredQueue.push(...data);
    return this;
  }

  private next(req: CompletionRequest): string {
    const s = this.queue.shift();
    if (s === undefined) return `[fake:${req.task}] ok`;
    return typeof s === "function" ? s(req) : s;
  }

  private result(req: CompletionRequest, text: string): CompletionResult {
    return {
      text,
      model: "fake",
      stopReason: "end_turn",
      usage: { inputTokens: Math.ceil((req.system.length + req.messages.reduce((n, m) => n + m.content.length, 0)) / 4), outputTokens: Math.ceil(text.length / 4), cacheReadTokens: 0, cacheWriteTokens: 0 },
      latencyMs: 1,
    };
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.requests.push(req);
    return this.result(req, this.next(req));
  }

  async *stream(req: CompletionRequest): AsyncIterable<CompletionEvent> {
    this.requests.push(req);
    const text = this.next(req);
    // Découpe en petits deltas pour exercer le streaming côté appelant.
    for (const part of text.match(/.{1,12}/gs) ?? []) yield { type: "delta", text: part };
    yield { type: "done", result: this.result(req, text) };
  }

  async structured<T>(req: CompletionRequest, schema: ZodType<T>, schemaName: string): Promise<StructuredResult<T>> {
    this.requests.push(req);
    const raw = this.structuredQueue.shift();
    if (raw === undefined) throw new Error(`FakeAIProvider: aucune réponse structurée en file pour ${schemaName}`);
    const data = schema.parse(raw);
    return { data, model: "fake", usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 }, latencyMs: 1 };
  }
}
