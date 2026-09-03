import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenAIModel } from "./openai.js";
import { selectModel } from "./router.js";

test("DeepSeek uses the OpenAI-compatible endpoint and DeepSeek key", () => {
  const { port, apiKey } = selectModel(
    { provider: "deepseek", model: "deepseek-chat" },
    { deepseekApiKey: "sk-deepseek" }
  );
  assert.equal(apiKey, "sk-deepseek");
  assert.ok(port instanceof OpenAIModel);
  assert.equal(port.baseUrl, "https://api.deepseek.com/v1");
  assert.equal(port.label, "DeepSeek");
});
