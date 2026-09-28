import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { z } from "zod";
import { OpenAICompatibleProvider, extractJson } from "./openai-compatible.js";
import { RoutedAIProvider } from "./routed.js";
import { FakeAIProvider } from "./fake.js";
import type { CompletionRequest } from "./types.js";

/** Serveur OpenAI-compatible factice : renvoie ce que le test a programmé, enregistre les requêtes. */
let server: http.Server;
let baseUrl = "";
const received: { path: string; body: Record<string, unknown>; auth?: string }[] = [];
let script: { status?: number; text?: string; stream?: string[]; json?: unknown }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url?.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ data: [{ id: "test-model" }] }));
      }
      const body = raw ? JSON.parse(raw) : {};
      received.push({ path: req.url ?? "", body, auth: req.headers.authorization });
      const next = script.shift() ?? { text: "ok" };
      if (next.status) {
        res.writeHead(next.status, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "response_format not supported" } }));
      }
      if (body.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (const chunk of next.stream ?? ["ok"]) {
          if (chunk.startsWith(":") || chunk.startsWith("event:")) res.write(`${chunk}\n\n`);
          else res.write(`data: ${JSON.stringify({ model: body.model, choices: [{ delta: { content: chunk } }] })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ model: body.model, choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 5 } })}\n\n`);
        res.write("data: [DONE]\n\n");
        return res.end();
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          model: body.model,
          choices: [{ message: { role: "assistant", content: next.json !== undefined ? JSON.stringify(next.json) : next.text }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 3 },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const provider = () => new OpenAICompatibleProvider({ name: "local", baseUrl, apiKey: "k", models: { fast: "small", chat: "medium", deep: "large" } });
const req = (task: CompletionRequest["task"], extra: Partial<CompletionRequest> = {}): CompletionRequest => ({
  task,
  system: "SYS",
  systemVolatile: "VOL",
  messages: [{ role: "user", content: "salut" }],
  meta: { userId: "u", feature: "t" },
  ...extra,
});

describe("OpenAICompatibleProvider", () => {
  it("complete : modèle par tâche, system fusionné, auth Bearer, usage, provider", async () => {
    received.length = 0;
    script = [{ text: "<think>hmm</think>coucou" }];
    const r = await provider().complete(req("chat.simple"));
    expect(r.text).toBe("coucou");
    expect(r.model).toBe("medium");
    expect(r.provider).toBe("local");
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 });
    const sent = received[0]!;
    expect(sent.path).toBe("/v1/chat/completions");
    expect(sent.auth).toBe("Bearer k");
    expect((sent.body.messages as { role: string; content: string }[])[0]).toEqual({ role: "system", content: "SYS\n\nVOL" });
    expect(sent.body.max_tokens).toBe(400);
    expect((await provider().complete(req("emotion.classify"))).model).toBe("small");
    expect((await provider().complete(req("chat.deep"))).model).toBe("large");
  });

  it("stream : deltas, keepalive et événements nommés ignorés, <think> filtré, usage final", async () => {
    script = [{ stream: [": keepalive", "event: hermes.tool.progress", "<think>ré", "flexion</think>sa", "lut ", "toi"] }];
    const deltas: string[] = [];
    let done: { text: string; usage: { inputTokens: number } } | null = null;
    for await (const ev of provider().stream(req("chat.simple"))) {
      if (ev.type === "delta") deltas.push(ev.text);
      else done = ev.result;
    }
    expect(deltas.join("")).toBe("salut toi");
    expect(done!.text).toBe("salut toi");
    expect(done!.usage.inputTokens).toBe(12);
  });

  it("structured : json_schema, puis repli json_object si 400, puis réparation si JSON invalide", async () => {
    const schema = z.object({ mood: z.enum(["ok", "bad"]), score: z.number() });
    received.length = 0;
    script = [{ json: { mood: "ok", score: 0.4 } }];
    const r = await provider().structured(req("emotion.classify"), schema, "mood");
    expect(r.data).toEqual({ mood: "ok", score: 0.4 });
    expect((received[0]!.body.response_format as { type: string }).type).toBe("json_schema");
    expect(String((received[0]!.body.messages as { content: string }[])[0]!.content)).toContain('"enum"');

    received.length = 0;
    script = [{ status: 400 }, { text: "```json\n{\"mood\":\"bad\",\"score\":1}\n```" }];
    const r2 = await provider().structured(req("emotion.classify"), schema, "mood");
    expect(r2.data).toEqual({ mood: "bad", score: 1 });
    expect((received[1]!.body.response_format as { type: string }).type).toBe("json_object");

    received.length = 0;
    script = [{ text: "{\"mood\":\"meh\"}" }, { json: { mood: "ok", score: 2 } }];
    const r3 = await provider().structured(req("emotion.classify"), schema, "mood");
    expect(r3.data.score).toBe(2);
    expect(received).toHaveLength(2);
    expect(String((received[1]!.body.messages as { content: string }[]).at(-1)!.content)).toContain("JSON invalide");
    expect(r3.usage.inputTokens).toBe(20);
  });

  it("ping et extraction JSON", async () => {
    expect(await provider().ping()).toBe(true);
    expect(extractJson('bla {"a":1} bla')).toBe('{"a":1}');
    expect(extractJson("```json\n{\"a\":{\"b\":2}}\n```")).toBe('{"a":{"b":2}}');
  });
});

describe("RoutedAIProvider", () => {
  it("dirige chaque tâche vers le bon slot", async () => {
    const chat = new FakeAIProvider().enqueue("chat");
    const fast = new FakeAIProvider().enqueue("fast");
    const deep = new FakeAIProvider().enqueue("deep");
    const r = new RoutedAIProvider({ chat, fast, deep });
    expect((await r.complete(req("chat.simple"))).text).toBe("chat");
    expect((await r.complete(req("memory.extract"))).text).toBe("fast");
    expect((await r.complete(req("chat.deep"))).text).toBe("deep");
    expect(r.name).toContain("chat=fake");
  });
});
