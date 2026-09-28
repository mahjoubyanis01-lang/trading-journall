import type { AppConfig, ProviderKind } from "../../config.js";
import { AnthropicAIProvider } from "./anthropic.js";
import { FakeAIProvider } from "./fake.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import { RoutedAIProvider } from "./routed.js";
import type { AIProvider } from "./types.js";

export interface AIStack {
  provider: AIProvider;
  /** Instances par type, pour le warmup et le diagnostic. */
  instances: Partial<Record<ProviderKind, AIProvider>>;
}

export function createAIStack(config: AppConfig): AIStack {
  const instances: Partial<Record<ProviderKind, AIProvider>> = {};
  const get = (kind: ProviderKind): AIProvider => {
    if (instances[kind]) return instances[kind]!;
    let p: AIProvider;
    switch (kind) {
      case "anthropic":
        p = new AnthropicAIProvider(config.ANTHROPIC_API_KEY);
        break;
      case "local":
        p = new OpenAICompatibleProvider({
          name: "local",
          baseUrl: config.LOCAL_LLM_BASE_URL,
          apiKey: config.LOCAL_LLM_API_KEY,
          models: { fast: config.LOCAL_FAST_MODEL, chat: config.LOCAL_CHAT_MODEL, deep: config.LOCAL_DEEP_MODEL ?? config.LOCAL_CHAT_MODEL },
        });
        break;
      case "hermes":
        p = new OpenAICompatibleProvider({
          name: "hermes",
          baseUrl: config.HERMES_AGENT_BASE_URL,
          apiKey: config.HERMES_AGENT_API_KEY,
          models: { fast: config.HERMES_AGENT_MODEL, chat: config.HERMES_AGENT_MODEL, deep: config.HERMES_AGENT_MODEL },
          timeoutMs: 300_000, // l'agent peut utiliser des outils
        });
        break;
      default:
        p = new FakeAIProvider();
    }
    instances[kind] = p;
    return p;
  };
  const { chat, fast, deep } = config.aiSlots;
  const provider = chat === fast && fast === deep ? get(chat) : new RoutedAIProvider({ chat: get(chat), fast: get(fast), deep: get(deep) });
  return { provider, instances };
}

/** Compatibilité : fournisseur unique. */
export function createAIProvider(config: AppConfig): AIProvider {
  return createAIStack(config).provider;
}

export * from "./types.js";
export * from "./router.js";
export { AnthropicAIProvider, FakeAIProvider, OpenAICompatibleProvider, RoutedAIProvider };
