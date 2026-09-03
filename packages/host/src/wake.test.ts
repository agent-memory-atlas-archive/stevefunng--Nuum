import assert from "node:assert/strict";
import { test } from "node:test";
import type { TranscriptEvent } from "@nuum/protocol";
import { MAX_HOPS, RATE_LIMIT, WakeQueue, currentHops, pendingWake } from "./wake.js";

function agentWake(seq: number, hops = 1): TranscriptEvent {
  return {
    type: "wake",
    id: `w${seq}`,
    seq,
    createdAt: seq,
    source: { kind: "agent", fromId: "a2", fromName: "Scout" },
    text: "check the logs",
    hops
  };
}

test("refusing a self-send is not silent", () => {
  const queue = new WakeQueue();
  const verdict = queue.check("a1", "a1", 1);
  assert.equal(verdict.ok, false);
  // 模型必须读得懂为什么被拦，否则它会一直重试。
  assert.ok(!verdict.ok && verdict.reason.includes("yourself"));
});

test("a chain of wakes stops at the hop limit", () => {
  const queue = new WakeQueue();
  assert.equal(queue.check("a1", "a2", MAX_HOPS).ok, true);
  const refused = queue.check("a1", "a3", MAX_HOPS + 1);
  assert.equal(refused.ok, false);
  assert.ok(!refused.ok && /already \d+ agents away/.test(refused.reason));
});

test("the rate limit is per ordered pair, not per agent", () => {
  const queue = new WakeQueue();
  for (let i = 0; i < RATE_LIMIT; i += 1) {
    assert.equal(queue.check("a1", "a2", 1).ok, true, `send ${i}`);
  }
  assert.equal(queue.check("a1", "a2", 1).ok, false);
  // 换个收件人就该放行 —— 限的是「刷同一个人」，不是「说话太多」。
  assert.equal(queue.check("a1", "a3", 1).ok, true);
  // 反方向也是另一对。
  assert.equal(queue.check("a2", "a1", 1).ok, true);
});

test("the rate window slides, so a limited pair recovers", () => {
  let now = 1_000_000;
  const queue = new WakeQueue(() => now);
  for (let i = 0; i < RATE_LIMIT; i += 1) queue.check("a1", "a2", 1);
  assert.equal(queue.check("a1", "a2", 1).ok, false);
  now += 61_000;
  assert.equal(queue.check("a1", "a2", 1).ok, true);
});

test("a refused send does not spend rate budget", () => {
  const queue = new WakeQueue();
  // 被 hops 拦下的那条不该算进配额，否则一次踩线会顺手废掉本分钟的额度。
  for (let i = 0; i < RATE_LIMIT + 2; i += 1) queue.check("a1", "a2", MAX_HOPS + 1);
  assert.equal(queue.check("a1", "a2", 1).ok, true);
});

test("queued wakes come back in the order they were sent", () => {
  const queue = new WakeQueue();
  queue.enqueue("a2", { fromId: "a1", fromName: "A", text: "first", hops: 1 });
  queue.enqueue("a2", { fromId: "a1", fromName: "A", text: "second", hops: 1 });
  assert.equal(queue.depth("a2"), 2);
  assert.equal(queue.dequeue("a2")!.text, "first");
  assert.equal(queue.dequeue("a2")!.text, "second");
  assert.equal(queue.dequeue("a2"), undefined);
  assert.equal(queue.depth("a2"), 0);
});

test("dropping a queue reports how much was thrown away", () => {
  const queue = new WakeQueue();
  queue.enqueue("a2", { fromId: "a1", fromName: "A", text: "x", hops: 1 });
  queue.enqueue("a2", { fromId: "a1", fromName: "A", text: "y", hops: 1 });
  assert.equal(queue.drop("a2"), 2);
  assert.equal(queue.depth("a2"), 0);
});

test("a run may create one agent, and the quota is per run", () => {
  const queue = new WakeQueue();
  assert.equal(queue.claimCreate("run-1"), true);
  assert.equal(queue.claimCreate("run-1"), false);
  // 下一个 run 重新有额度。
  assert.equal(queue.claimCreate("run-2"), true);
  // 收束后配额跟着 run 一起消失，不会泄漏给同 id 的下一个。
  queue.closeRun("run-1");
  assert.equal(queue.claimCreate("run-1"), true);
});

test("hops come from the transcript, so they survive a restart", () => {
  // 用户消息是 0 手。
  assert.equal(currentHops([{ type: "user", id: "u1", seq: 1, createdAt: 1, text: "go" }]), 0);
  // 唤醒带着投递时写下的手数。
  assert.equal(currentHops([agentWake(1, 2)]), 2);
  // 最近的那条说话 —— 用户中途插话就把链子归零。
  assert.equal(
    currentHops([agentWake(1, 3), { type: "user", id: "u1", seq: 2, createdAt: 2, text: "actually" }]),
    0
  );
  // 中间夹着工具与助手事件不影响。
  assert.equal(
    currentHops([
      agentWake(1, 2),
      { type: "assistant", id: "a1", seq: 2, createdAt: 2, parts: [] },
      { type: "tool", id: "t1", seq: 3, createdAt: 3, toolCallId: "c", name: "read", content: "x" }
    ]),
    2
  );
});

test("a transcript with no prompt at all counts as zero hops, not as unbounded", () => {
  assert.equal(currentHops([]), 0);
});

test("an unanswered wake at the tail is recognised for replay", () => {
  assert.deepEqual(pendingWake([agentWake(1, 2)]), {
    fromId: "a2",
    fromName: "Scout",
    text: "check the logs",
    hops: 2
  });
});

test("a wake that was answered is not replayed", () => {
  const answered: TranscriptEvent[] = [
    agentWake(1),
    { type: "assistant", id: "a1", seq: 2, createdAt: 2, parts: [{ type: "text", text: "ok" }] }
  ];
  assert.equal(pendingWake(answered), null);
  const spoke: TranscriptEvent[] = [
    agentWake(1),
    { type: "message", id: "m1", seq: 2, createdAt: 2, payload: { type: "text", text: "done" } }
  ];
  assert.equal(pendingWake(spoke), null);
});

test("a wake followed only by a tool call is still unanswered", () => {
  // 崩在工具中间的那次唤醒确实没被回应过，重放它是对的。
  const events: TranscriptEvent[] = [
    agentWake(1),
    { type: "tool", id: "t1", seq: 2, createdAt: 2, toolCallId: "c1", name: "read", content: "x", ok: true }
  ];
  assert.equal(pendingWake(events)?.text, "check the logs");
});

test("a half-finished user turn is not replayed behind the user's back", () => {
  const events: TranscriptEvent[] = [
    agentWake(1),
    { type: "user", id: "u1", seq: 2, createdAt: 2, text: "actually do this instead" }
  ];
  // 用户就在跟前，自己会再发一遍；悄悄替他重跑是另一回事。
  assert.equal(pendingWake(events), null);
});

test("an empty transcript has nothing to replay", () => {
  assert.equal(pendingWake([]), null);
});
