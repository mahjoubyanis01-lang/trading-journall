import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ZodType } from "zod";
import type { AIProvider, CompletionEvent, CompletionRequest, CompletionResult, StructuredResult, Usage } from "./types.js";
import { chooseModel } from "./router.js";

/**
 * Implémentation Anthropic de AIProvider. La clé est lue côté serveur uniquement.
 * - system prompt stable mis en cache (cache_control) ; partie volatile après.
 * - streaming pour le chat ; structured outputs pour l'extraction/classification.
 */
export class AnthropicAIProvider implements AIProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
  }

  private buildParams(req: CompletionRequest) {
    const choice = chooseModel(req.task, req.signals);
    const system: Anthropic.TextBlockParam[] = [
      { type: "text", text: req.system, cache_control: { type: "ephemeral" } },
    ];
    if (req.systemVolatile) system.push({ type: "text", text: req.systemVolatile });
    const messages: Anthropic.MessageParam[] = req.messages.map((m) => ({ role: m.role, content: m.content }));
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: choice.model,
      max_tokens: req.maxTokens ?? choice.maxTokens,
      system,
      messages,
    };
    if (choice.thinking) {
      params.thinking = { type: "adaptive" };
      if (choice.effort) params.output_config = { effort: choice.effort };
    }
    return { params, choice };
  }

  private toUsage(u: Anthropic.Usage | undefined): Usage {
    return {
      inputTokens: u?.input_tokens ?? 0,
      outputTokens: u?.output_tokens ?? 0,
      cacheReadTokens: u?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
    };
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();
    const { params } = this.buildParams(req);
    const res = await this.client.messages.create(params);
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return { text, model: res.model, provider: this.name, stopReason: res.stop_reason ?? "end_turn", usage: this.toUsage(res.usage), latencyMs: Date.now() - started };
  }

  async *stream(req: CompletionRequest): AsyncIterable<CompletionEvent> {
    const started = Date.now();
    const { params } = this.buildParams(req);
    const stream = this.client.messages.stream(params);
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "delta", text: event.delta.text };
      }
    }
    const final = await stream.finalMessage();
    const text = final.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    yield {
      type: "done",
      result: { text, model: final.model, provider: this.name, stopReason: final.stop_reason ?? "end_turn", usage: this.toUsage(final.usage), latencyMs: Date.now() - started },
    };
  }

  async structured<T>(req: CompletionRequest, schema: ZodType<T>, schemaName: string): Promise<StructuredResult<T>> {
    const started = Date.now();
    const { params } = this.buildParams(req);
    const res = await this.client.messages.parse({
      ...params,
      output_config: { ...(params.output_config ?? {}), format: zodOutputFormat(schema) },
    });
    if (res.parsed_output == null) {
      throw new Error(`Sortie structurée invalide (${schemaName}, stop_reason=${res.stop_reason})`);
    }
    return { data: res.parsed_output, model: res.model, provider: this.name, usage: this.toUsage(res.usage), latencyMs: Date.now() - started };
  }
}
