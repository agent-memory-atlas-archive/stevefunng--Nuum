import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, resolveAvailableModel, secretForProvider } from "./domain.js";

test("default model is DeepSeek chat", () => {
  assert.deepEqual(DEFAULT_SETTINGS.defaultModel, { provider: "deepseek", model: "deepseek-chat" });
});

test("local tools default to ask permission", () => {
  assert.equal(DEFAULT_SETTINGS.defaultToolPermission, "ask");
  assert.equal("workspaceRoot" in DEFAULT_SETTINGS, false);
  assert.equal("sandboxMode" in DEFAULT_SETTINGS, false);
});

test("secretForProvider reads the matching key", () => {
  const secrets = { openaiApiKey: "o", anthropicApiKey: "a", deepseekApiKey: "d" };
  assert.equal(secretForProvider(secrets, "openai"), "o");
  assert.equal(secretForProvider(secrets, "anthropic"), "a");
  assert.equal(secretForProvider(secrets, "deepseek"), "d");
});

test("resolveAvailableModel keeps a preferred model when that key exists", () => {
  const preferred = { provider: "deepseek" as const, model: "deepseek-reasoner" };
  assert.deepEqual(resolveAvailableModel({ deepseekApiKey: "d" }, preferred), preferred);
});

test("resolveAvailableModel falls back from OpenAI to DeepSeek when only a DeepSeek key exists", () => {
  assert.deepEqual(
    resolveAvailableModel({ deepseekApiKey: "d" }, { provider: "openai", model: "gpt-4o" }),
    { provider: "deepseek", model: "deepseek-chat" }
  );
});
