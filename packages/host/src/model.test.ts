import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSessionModel } from "./model.js";

test("an OpenAI session uses DeepSeek when only a DeepSeek key is present", () => {
  const model = resolveSessionModel({
    sessionModel: { provider: "openai", model: "gpt-4o" },
    defaultModel: { provider: "openai", model: "gpt-4o" },
    secrets: { deepseekApiKey: "sk-deepseek" }
  });
  assert.deepEqual(model, { provider: "deepseek", model: "deepseek-chat" });
});

test("a DeepSeek session keeps its model id when the DeepSeek key exists", () => {
  const preferred = { provider: "deepseek" as const, model: "deepseek-reasoner" };
  const model = resolveSessionModel({
    sessionModel: preferred,
    defaultModel: { provider: "deepseek", model: "deepseek-chat" },
    secrets: { deepseekApiKey: "sk-deepseek" }
  });
  assert.deepEqual(model, preferred);
});
