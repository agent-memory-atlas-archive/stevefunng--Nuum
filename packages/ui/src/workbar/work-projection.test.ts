import assert from "node:assert/strict";
import test from "node:test";
import { WorkTask, WorkTaskState } from "@nuum/protocol";
import { taskLanes, workDeliverables, type TaskView } from "./work-projection";

function task(id: string, state: TaskView["state"], deliverables: TaskView["deliverables"] = []): TaskView {
  return { ...WorkTask.parse({ id, title: `Task ${id}`, description: "", acceptanceCriteria: [], state,
    assigneeIds: [], dependencyIds: [], priority: "normal", revision: 1, deliverables,
    createdAt: 1, updatedAt: 1 }), allowedTransitions: [] };
}

test("every protocol state remains visible; a changed task moves to exactly one lane", () => {
  const original = task("a", "ready");
  const before = taskLanes([original]);
  const after = taskLanes([{ ...original, state: "in_progress" }]);
  assert.deepEqual(before.map((lane) => lane.state), WorkTaskState.options);
  assert.equal(before.find((lane) => lane.state === "ready")?.tasks.length, 1);
  assert.equal(after.find((lane) => lane.state === "ready")?.tasks.length, 0);
  assert.deepEqual(after.find((lane) => lane.state === "in_progress")?.tasks.map((item) => item.id), ["a"]);
  assert.equal(after.flatMap((lane) => lane.tasks).length, 1);
});

test("outputs include review handoffs, sorted newest first with their source task", () => {
  const draft = { id: "draft", name: "Research draft", uri: "/tmp/research.md", mimeType: "text/markdown", createdAt: 5 };
  const final = { id: "final", name: "Final report", uri: "/tmp/report.pdf", mimeType: "application/pdf", createdAt: 10 };
  const results = workDeliverables([task("a", "review", [draft]), task("b", "done", [final])]);
  assert.deepEqual(results.map(({ file, task }) => [file, task.id]), [[final, "b"], [draft, "a"]]);
});

test("completed tasks without handoff files do not invent outputs", () => {
  assert.deepEqual(workDeliverables([task("a", "done")]), []);
  assert.ok(taskLanes([]).every((lane) => lane.tasks.length === 0));
});
