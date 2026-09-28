import { z, type ZodType } from "zod";
import type { AIProvider, AITask, CompletionEvent, CompletionRequest, CompletionResult, StructuredResult, Usage } from "./types.js";

/**
 * Fournisseur générique "OpenAI-compatible" (/v1/chat/completions). Couvre :
 * - Ollama (`http://127.0.0.1:11434/v1`), llama.cpp server, vLLM, LM Studio : LLM local, texte uniquement ;
 * - Hermes Agent (`http://127.0.0.1:8642/v1`, modèle `hermes-agent`) : l'agent Nous Research avec ses outils,
 *   sa mémoire et ses skills, exposé en OpenAI-compatible par `hermes gateway`.
 *
 * Vitesse : streaming, `stream_options.include_usage`, modèles "fast" pour les tâches de classification,
 * warmup au démarrage pour garder les poids chargés, réponses courtes (max_tokens serrés).
 */
export interface OpenAICompatibleOptions {
  name: string;
  baseUrl: string;
  apiKey?: string;
  models: { fast: string; chat: string; deep: string };
  timeoutMs?: number;
  /** Champs additionnels envoyés tels quels (ex. `keep_alive` pour Ollama). */
  extraBody?: Record<string, unknown>;
  /** Les modèles "thinking" (qwen3, deepseek-r1) émettent <think>…</think> : retiré du texte. */
  stripThinking?: boolean;
  fetchImpl?: typeof fetch;
}

const TASK_TIER: Record<AITask, keyof OpenAICompatibleOptions["models"]> = {
  "chat.simple": "chat",
  "chat.deep": "deep",
  "emotion.classify": "fast",
  "memory.extract": "fast",
  "memory.consolidate": "chat",
  "initiative.reason": "chat",
  "story.generate": "chat",
  "call.summary": "fast",
};

const DEFAULT_MAX_TOKENS: Record<AITask, number> = {
  "chat.simple": 400,
  "chat.deep": 700,
  "emotion.classify": 200,
  "memory.extract": 1200,
  "memory.consolidate": 2000,
  "initiative.reason": 300,
  "story.generate": 300,
  "call.summary": 600,
};

type ChatCompletion = {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export class OpenAICompatibleProvider implements AIProvider {
  readonly name: string;
  private fetchImpl: typeof fetch;

  constructor(private opts: OpenAICompatibleOptions) {
    this.name = opts.name;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  modelFor(task: AITask): string {
    return this.opts.models[TASK_TIER[task]];
  }

  private headers() {
    return {
      "content-type": "application/json",
      ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
    };
  }

  private body(req: CompletionRequest, extra: Record<string, unknown> = {}) {
    const system = req.systemVolatile ? `${req.system}\n\n${req.systemVolatile}` : req.system;
    return {
      model: this.modelFor(req.task),
      messages: [{ role: "system", content: system }, ...req.messages.map((m) => ({ role: m.role, content: m.content }))],
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS[req.task],
      temperature: req.task.startsWith("chat") ? 0.8 : 0.2,
      ...(this.opts.extraBody ?? {}),
      ...extra,
    };
  }

  private async post(body: unknown, signal?: AbortSignal): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 120_000);
    signal?.addEventListener("abort", () => ctrl.abort());
    try {
      const res = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new ProviderHttpError(res.status, `${this.name}: HTTP ${res.status} ${text.slice(0, 300)}`);
      }
      return res;
    } finally {
      // Le timer est nettoyé par l'appelant pour les flux ; ici on ne coupe que si non-stream.
      if (!(body as { stream?: boolean }).stream) clearTimeout(timer);
    }
  }

  private clean(text: string): string {
    if (this.opts.stripThinking === false) return text;
    return text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
  }

  private usage(u: ChatCompletion["usage"]): Usage {
    return { inputTokens: u?.prompt_tokens ?? 0, outputTokens: u?.completion_tokens ?? 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();
    const res = await this.post(this.body(req, { stream: false }));
    const data = (await res.json()) as ChatCompletion;
    const choice = data.choices?.[0];
    return {
      text: this.clean(choice?.message?.content ?? ""),
      model: data.model ?? this.modelFor(req.task),
      provider: this.name,
      stopReason: choice?.finish_reason ?? "stop",
      usage: this.usage(data.usage),
      latencyMs: Date.now() - started,
    };
  }

  async *stream(req: CompletionRequest): AsyncIterable<CompletionEvent> {
    const started = Date.now();
    const res = await this.post(this.body(req, { stream: true, stream_options: { include_usage: true } }));
    const reader = res.body?.getReader();
    if (!reader) throw new Error(`${this.name}: réponse sans corps`);
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    let model = this.modelFor(req.task);
    let finish = "stop";
    let inThink = false;

    const handle = function* (this: OpenAICompatibleProvider, line: string): Generator<CompletionEvent> {
      if (!line.startsWith("data:")) return; // commentaires keepalive (": ...") et lignes "event:" ignorés
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") return;
      let json: { model?: string; choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[]; usage?: ChatCompletion["usage"] };
      try {
        json = JSON.parse(payload);
      } catch {
        return;
      }
      if (json.model) model = json.model;
      if (json.usage) usage = this.usage(json.usage);
      const choice = json.choices?.[0];
      if (choice?.finish_reason) finish = choice.finish_reason;
      let delta = choice?.delta?.content ?? "";
      if (!delta) return;
      // Filtrage <think> en streaming.
      if (this.opts.stripThinking !== false) {
        let out = "";
        while (delta.length) {
          if (inThink) {
            const end = delta.indexOf("</think>");
            if (end < 0) return;
            delta = delta.slice(end + 8).replace(/^\s+/, "");
            inThink = false;
          } else {
            const start = delta.indexOf("<think>");
            if (start < 0) {
              out += delta;
              delta = "";
            } else {
              out += delta.slice(0, start);
              delta = delta.slice(start + 7);
              inThink = true;
            }
          }
        }
        delta = out;
        if (!delta) return;
      }
      text += delta;
      yield { type: "delta", text: delta };
    }.bind(this);

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, "");
        buffer = buffer.slice(idx + 1);
        yield* handle(line);
      }
    }
    if (buffer.trim()) yield* handle(buffer.trim());
    yield { type: "done", result: { text: text.trim(), model, provider: this.name, stopReason: finish, usage, latencyMs: Date.now() - started } };
  }

  async structured<T>(req: CompletionRequest, schema: ZodType<T>, schemaName: string): Promise<StructuredResult<T>> {
    const started = Date.now();
    const jsonSchema = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" });
    const instruction = `Réponds UNIQUEMENT avec un objet JSON valide conforme à ce schéma (aucun texte autour) :\n${JSON.stringify(jsonSchema)}`;
    const baseReq: CompletionRequest = { ...req, system: `${req.system}\n\n${instruction}` };

    let raw: ChatCompletion | null = null;
    try {
      const res = await this.post(this.body(baseReq, { stream: false, response_format: { type: "json_schema", json_schema: { name: schemaName, schema: jsonSchema, strict: true } } }));
      raw = (await res.json()) as ChatCompletion;
    } catch (e) {
      // Serveur sans json_schema : on retombe sur json_object, le schéma est déjà dans le prompt.
      if (!(e instanceof ProviderHttpError && e.status === 400)) throw e;
      const res = await this.post(this.body(baseReq, { stream: false, response_format: { type: "json_object" } }));
      raw = (await res.json()) as ChatCompletion;
    }

    let usage = this.usage(raw.usage);
    let text = this.clean(raw.choices?.[0]?.message?.content ?? "");
    let parsed = tryParse(schema, text);
    if (!parsed.ok) {
      // Une seule tentative de réparation : on renvoie l'erreur au modèle.
      const repairReq: CompletionRequest = {
        ...baseReq,
        messages: [...baseReq.messages, { role: "assistant", content: text || "{}" }, { role: "user", content: `JSON invalide : ${parsed.error}. Renvoie uniquement l'objet JSON corrigé.` }],
      };
      const res = await this.post(this.body(repairReq, { stream: false, response_format: { type: "json_object" } }));
      const again = (await res.json()) as ChatCompletion;
      const u2 = this.usage(again.usage);
      usage = { ...usage, inputTokens: usage.inputTokens + u2.inputTokens, outputTokens: usage.outputTokens + u2.outputTokens };
      text = this.clean(again.choices?.[0]?.message?.content ?? "");
      parsed = tryParse(schema, text);
      if (!parsed.ok) throw new Error(`${this.name}: sortie structurée invalide (${schemaName}) : ${parsed.error}`);
    }
    return { data: parsed.data, model: raw.model ?? this.modelFor(req.task), provider: this.name, usage, latencyMs: Date.now() - started };
  }

  /** Charge les modèles en mémoire (Ollama décharge après inactivité). */
  async warmup(): Promise<{ model: string; ok: boolean; ms: number }[]> {
    const models = Array.from(new Set(Object.values(this.opts.models)));
    return Promise.all(
      models.map(async (model) => {
        const t = Date.now();
        try {
          await this.post({ model, messages: [{ role: "user", content: "ok" }], max_tokens: 1, ...(this.opts.extraBody ?? {}) });
          return { model, ok: true, ms: Date.now() - t };
        } catch {
          return { model, ok: false, ms: Date.now() - t };
        }
      }),
    );
  }

  /** Vérifie que l'endpoint répond (GET /models). */
  async ping(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/$/, "")}/models`, { headers: this.headers(), signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export class ProviderHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body.trim();
}

function tryParse<T>(schema: ZodType<T>, text: string): { ok: true; data: T } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(text));
  } catch (e) {
    return { ok: false, error: `JSON.parse: ${(e as Error).message}` };
  }
  const r = schema.safeParse(json);
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return { ok: true, data: r.data };
}
