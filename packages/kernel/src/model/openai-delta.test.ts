import assert from "node:assert/strict";
import { test } from "node:test";
import { textChunksFromDelta, toOpenAIMessage } from "./openai.js";

test("DeepSeek-style reasoning_content becomes a thinking chunk", () => {
  assert.deepEqual(textChunksFromDelta({ reasoning_content: "plan", content: "hello" }), [
    { type: "thinking", text: "plan" },
    { type: "text", text: "hello" }
  ]);
});

test("assemble thinking is sent back as reasoning_content", () => {
  const encoded = toOpenAIMessage({
    id: "a1",
    role: "assistant",
    content: "hello",
    thinking: "plan",
    seq: 1,
    createdAt: 1
  });
  assert.equal(encoded.reasoning_content, "plan");
  assert.equal(encoded.content, "hello");
});

test("OpenAI user messages carry local read images as multimodal content", () => {
  const encoded = toOpenAIMessage({
    id: "image-1",
    role: "user",
    content: "tool image",
    images: [{ mimeType: "image/png", data: "aGVsbG8=" }],
    seq: 2,
    createdAt: 1
  });
  assert.deepEqual(encoded.content, [
    { type: "text", text: "tool image" },
    { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } }
  ]);
});

test("DeepSeek receives a text fallback instead of an unsupported image payload", () => {
  const encoded = toOpenAIMessage({
    id: "image-1",
    role: "user",
    content: "tool image",
    images: [{ mimeType: "image/png", data: "aGVsbG8=" }],
    seq: 2,
    createdAt: 1
  }, false);
  assert.match(String(encoded.content), /provider does not accept image input/i);
});
