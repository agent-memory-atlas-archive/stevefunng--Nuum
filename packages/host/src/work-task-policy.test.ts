import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedTaskTransitions, assertTaskTransition } from "./work-task-policy.js";

test("blocked can resume, return to ready, or be cancelled", () => {
  assert.deepEqual(allowedTaskTransitions("blocked", "worker"), ["in_progress"]);
  assert.deepEqual(allowedTaskTransitions("blocked", "coordinator"), [
    "in_progress",
    "ready",
    "cancelled"
  ]);
});

test("only a user or coordinator can mark review as done", () => {
  assert.throws(
    () => assertTaskTransition("review", "done", "worker"),
    /not allowed/i
  );
  assert.doesNotThrow(() => assertTaskTransition("review", "done", "coordinator"));
  assert.doesNotThrow(() => assertTaskTransition("review", "done", "user"));
});

test("transition rules are exposed through one policy instead of UI conditionals", () => {
  assert.deepEqual(allowedTaskTransitions("review", "user"), ["done", "in_progress", "cancelled"]);
  assert.deepEqual(allowedTaskTransitions("done", "user"), ["in_progress"]);
});
