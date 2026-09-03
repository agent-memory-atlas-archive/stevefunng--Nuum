import { KernelErrorCode, RpcError, secretForProvider, type ModelRef, type Secrets } from "@nuum/protocol";
import { AnthropicModel } from "./anthropic.js";
import { OpenAIModel } from "./openai.js";
import type { ModelPort } from "./types.js";

export function selectModel(model: ModelRef, secrets: Secrets): { port: ModelPort; apiKey: string } {
  const apiKey = secretForProvider(secrets, model.provider);
  if (!apiKey) throw new RpcError(KernelErrorCode.INVALID, `API key missing for ${model.provider}`);
  if (model.provider === "anthropic") {
    return { port: new AnthropicModel(), apiKey };
  }
  if (model.provider === "deepseek") {
    return { port: new OpenAIModel("https://api.deepseek.com/v1", "DeepSeek"), apiKey };
  }
  return { port: new OpenAIModel(), apiKey };
}
