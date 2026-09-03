import assert from "node:assert/strict";
import { test } from "node:test";
import type { SummarizeRunParams } from "@nuum/protocol";
import { runSummarize } from "./summarize.js";
import type { NormalizedChatRequest, NormalizedChunk } from "./model/types.js";

function model(chunks: NormalizedChunk[]): {
  deps: { selectModel: any };
  requests: NormalizedChatRequest[];
} {
  const requests: NormalizedChatRequest[] = [];
  return {
    requests,
    deps: {
      selectModel: () => ({
        apiKey: "k",
        port: {
          streamChat(req: NormalizedChatRequest): AsyncIterable<NormalizedChunk> {
            requests.push({ ...req, messages: [...req.messages] });
            return (async function* () {
              for (const chunk of chunks) yield chunk;
            })();
          }
        }
      })
    }
  };
}

function params(overrides: Partial<SummarizeRunParams> = {}): SummarizeRunParams {
  return {
    runId: "run-1",
    systemPrompt: "You summarize.",
    messages: [{ id: "u1", role: "user", content: "long history", seq: 1, createdAt: 1 }],
    model: { provider: "deepseek", model: "deepseek-chat" },
    secrets: { deepseekApiKey: "k" },
    ...overrides
  };
}

test("the given system prompt leads the call, and only text comes back", async () => {
  const { deps, requests } = model([
    { type: "thinking", text: "let me think" },
    { type: "text", text: "  a summary  " }
  ]);
  const result = await runSummarize(params(), deps);
  // thinking 不该混进结果 —— 调用方要的是摘要本身。
  assert.deepEqual(result, { text: "a summary" });
  assert.deepEqual(
    requests[0]!.messages.map((message) => [message.role, message.content]),
    [
      ["system", "You summarize."],
      ["user", "long history"]
    ]
  );
});

test("summarize gets no tools at all, so it cannot wander off", async () => {
  const { deps, requests } = model([{ type: "text", text: "x" }]);
  await runSummarize(params(), deps);
  assert.deepEqual(requests[0]!.tools, []);
});

test("a model that says nothing yields an empty string, not a crash", async () => {
  const { deps } = model([]);
  assert.deepEqual(await runSummarize(params(), deps), { text: "" });
});
