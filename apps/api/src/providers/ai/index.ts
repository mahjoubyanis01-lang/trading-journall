import type { AppConfig } from "../../config.js";
import { AnthropicAIProvider } from "./anthropic.js";
import { FakeAIProvider } from "./fake.js";
import type { AIProvider } from "./types.js";

export function createAIProvider(config: AppConfig): AIProvider {
  if (config.aiProvider === "anthropic") return new AnthropicAIProvider(config.ANTHROPIC_API_KEY);
  return new FakeAIProvider();
}
export * from "./types.js";
export * from "./router.js";
export { AnthropicAIProvider, FakeAIProvider };
