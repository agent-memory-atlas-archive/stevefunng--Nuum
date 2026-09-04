import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import type { KernelClient } from "./kernel-client.js";
import type { RunContext } from "./run-context.js";
import { HostRuntime } from "./runtime.js";

const quietKernel: KernelClient = {
  hello: async () => ({ name: "nuum-kernel", version: "0.1.0" }),
  start: async () => ({ ok: true }),
  cancel: async () => ({ ok: true }),
  decide: async () => ({ ok: true }),
  provideToolResult: async () => ({ ok: true }),
  disposeShell: async () => ({ ok: true }),
  summarize: async () => ({ text: "" }),
  tools: async () => [],
  onEvent: () => undefined,
  dispose: () => undefined
};

async function runtime(t: TestContext, kernel: KernelClient = quietKernel): Promise<HostRuntime> {
  const instance = new HostRuntime({
    dataDir: await mkdtemp(path.join(tmpdir(), "nuum-work-runtime-")),
    kernelCommand: "unused",
    kernelArgs: [],
    spawnKernel: () => kernel
  });
  await instance.start();
  t.after(() => instance.dispose());
  return instance;
}

test("membership is one revisioned slot and moving updates both work projections", async (t) => {
  const host = await runtime(t);
  const agent = await host.createAgent({ name: "Builder" });
  const first = await host.createWork({ name: "First", description: "", projectRoot: null });
  const second = await host.createWork({ name: "Second", description: "", projectRoot: null });

  await host.attachWorkMember({
    workId: first.id,
    agentId: agent.profile.id,
    role: "worker",
    expectedRevision: 0
  });
  assert.equal((await host.getWork(first.id)).members[0]!.profile.id, agent.profile.id);
  await assert.rejects(
    host.attachWorkMember({
      workId: second.id,
      agentId: agent.profile.id,
      role: "worker",
      expectedRevision: 1
    }),
    /already belongs/i
  );

  await host.moveWorkMember({
    fromWorkId: first.id,
    toWorkId: second.id,
    agentId: agent.profile.id,
    role: "coordinator",
    expectedRevision: 1
  });
  assert.equal((await host.getWork(first.id)).members.length, 0);
  assert.equal((await host.getWork(second.id)).members[0]!.settings.workMembership?.binding?.role, "coordinator");
  assert.equal((await host.getAgent(agent.profile.id)).view.settings.workMembership?.revision, 2);
});

test("task mutations use revision CAS and the centralized transition policy", async (t) => {
  const host = await runtime(t);
  const work = await host.createWork({ name: "Launch", description: "", projectRoot: null });
  const task = await host.createWorkTask({
    workId: work.id,
    title: "Ship",
    description: "",
    acceptanceCriteria: [],
    assigneeIds: [],
    dependencyIds: [],
    priority: "normal"
  });
  assert.equal(task.state, "proposed");

  const ready = await host.transitionWorkTask({
    workId: work.id,
    taskId: task.id,
    to: "ready",
    expectedRevision: 1
  });
  const doing = await host.transitionWorkTask({
    workId: work.id,
    taskId: task.id,
    to: "in_progress",
    expectedRevision: ready.revision
  });
  const blocked = await host.transitionWorkTask({
    workId: work.id,
    taskId: task.id,
    to: "blocked",
    expectedRevision: doing.revision,
    blocker: { reason: "Waiting for assets", ownerId: "design" }
  });
  assert.equal(blocked.blocker?.reason, "Waiting for assets");
  assert.deepEqual(blocked.allowedTransitions, ["in_progress", "ready", "cancelled"]);

  await assert.rejects(
    host.transitionWorkTask({
      workId: work.id,
      taskId: task.id,
      to: "done",
      expectedRevision: blocked.revision
    }),
    /not allowed/i
  );
  await assert.rejects(
    host.transitionWorkTask({
      workId: work.id,
      taskId: task.id,
      to: "in_progress",
      expectedRevision: 1
    }),
    /revision/i
  );
});

test("chat and catalog remain Work-owned projections", async (t) => {
  const host = await runtime(t);
  const work = await host.createWork({ name: "Launch", description: "", projectRoot: null });
  await host.postWorkMessage({ workId: work.id, body: "Status?", mentionedAgentIds: [] });
  const catalog = await host.addWorkCatalogEntry({
    workId: work.id,
    expectedRevision: 0,
    entry: {
      kind: "skill",
      name: "Release checks",
      description: "Run the release checklist",
      manifestPath: "/tmp/release/SKILL.md"
    }
  });

  const snapshot = await host.getWork(work.id);
  assert.equal(snapshot.chat[0]!.type, "chat.posted");
  assert.equal(snapshot.catalog.entries[0]!.kind, "skill");
  assert.equal(catalog.revision, 1);
});

test("dispatch bridges the Work timeline to one Agent transcript and handoff returns to Work", async (t) => {
  const started: import("@nuum/protocol").TurnStartParams[] = [];
  const kernel: KernelClient = {
    ...quietKernel,
    start: async (params) => { started.push(params); return { ok: true }; }
  };
  const host = await runtime(t, kernel);
  await host.setSettings({ deepseekApiKey: "test-key" });
  const agent = await host.createAgent({ name: "Builder" });
  const work = await host.createWork({ name: "Launch", description: "Ship it", projectRoot: null });
  await host.attachWorkMember({ workId: work.id, agentId: agent.profile.id, role: "worker", expectedRevision: 0 });
  const task = await host.createWorkTask({
    workId: work.id,
    title: "Build",
    description: "Implement the flow",
    acceptanceCriteria: ["Tests pass"],
    assigneeIds: [agent.profile.id],
    dependencyIds: [],
    priority: "normal"
  });
  const ready = await host.transitionWorkTask({ workId: work.id, taskId: task.id, to: "ready", expectedRevision: task.revision });
  const doing = await host.transitionWorkTask({ workId: work.id, taskId: task.id, to: "in_progress", expectedRevision: ready.revision });
  const dispatched = await host.dispatchWork({ workId: work.id, agentId: agent.profile.id, taskId: task.id, instruction: "Finish this task" });

  assert.equal(started.length, 1);
  assert.match(started[0]!.messages[0]!.content, /Current Work/);
  assert.deepEqual(started[0]!.delegatedTools.map((tool) => tool.name).sort(), ["DelegateWork", "HandoffTask", "PostToWork", "ReadWorkTimeline", "RunWorkCLI"].sort());
  const transcript = await host.getTranscript(agent.profile.id);
  const wake = transcript.entries.find((event) => event.type === "wake");
  assert.equal(wake?.type === "wake" && wake.source.kind, "work");

  const context: RunContext = {
    kind: "work",
    workId: work.id,
    taskId: task.id,
    triggerEventId: "dispatch",
    catalogRevision: 0,
    catalog: [],
    requestedBy: { kind: "user", id: "local-user" }
  };
  await host.handoffTask(agent.profile.id, {
    summary: "Implementation is ready",
    status: "review",
    deliverables: [{ name: "Result", uri: "/tmp/result.txt" }]
  }, { agentId: agent.profile.id, assistantId: "assistant", toolCallId: "tool", runContext: context });
  const snapshot = await host.getWork(work.id);
  assert.equal(snapshot.tasks[0]!.state, "review");
  assert.equal(snapshot.tasks[0]!.revision, doing.revision + 1);
  assert.equal(snapshot.chat.at(-1)!.actor.kind, "agent");
  assert.equal(dispatched.queued, false);
});
