import assert from "node:assert/strict";
import { test } from "node:test";
import { ToolRegistry } from "./registry.js";
import type { Tool } from "./types.js";

function stub(name: string): Tool {
  return {
    definition: { name, description: name, inputSchema: { type: "object", properties: {} }, mutating: false },
    execute: async () => name
  };
}

test("no filter means every tool", () => {
  const registry = new ToolRegistry([stub("read"), stub("write")]);
  assert.deepEqual(registry.list().map((tool) => tool.name), ["read", "write"]);
});

test("an empty filter means no tool at all", () => {
  const registry = new ToolRegistry([stub("read"), stub("write")]);
  // 曾经空数组会返回全部，于是「这个 run 不许用本地工具」被静默放行成全开。
  assert.deepEqual(registry.list([]), []);
});

test("a filter keeps registry order and ignores names it does not know", () => {
  const registry = new ToolRegistry([stub("read"), stub("write"), stub("shell")]);
  assert.deepEqual(registry.list(["shell", "ghost", "read"]).map((tool) => tool.name), ["read", "shell"]);
});
