import assert from "node:assert/strict";
import { test } from "node:test";
import { HostErrorCode, RpcError } from "@nuum/protocol";
import { precheck } from "./precheck.js";

const base = {
  exists: true,
  busy: false,
  model: { provider: "deepseek" as const, model: "deepseek-chat" }
};

test("precheck accepts a DeepSeek key", () => {
  precheck({ ...base, secrets: { deepseekApiKey: "sk-test" } });
});

test("precheck fails when the DeepSeek key is missing", () => {
  assert.throws(
    () => precheck({ ...base, secrets: {} }),
    (error: unknown) => error instanceof RpcError && error.code === HostErrorCode.NO_API_KEY
  );
});
