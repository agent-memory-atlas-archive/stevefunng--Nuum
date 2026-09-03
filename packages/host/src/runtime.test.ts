import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { HostRuntime } from "./runtime.js";

/**
 * 这些用例只验证 Host 自己的不变式，不需要真 Kernel：指向一个立刻退出的命令，
 * hello() 失败后 kernel 置空，其余逻辑照常可测。
 */
async function openRuntime(t: TestContext, dataDir: string): Promise<HostRuntime> {
  const runtime = new HostRuntime({
    dataDir,
    kernelCommand: process.execPath,
    kernelArgs: ["-e", "process.exit(0)"]
  });
  t.after(() => runtime.dispose());
  await runtime.start();
  return runtime;
}

test("a fresh agent has no persisted runtime state at all", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "nuum-runtime-"));
  const runtime = await openRuntime(t, dir);
  const created = await runtime.createAgent({ name: "Scout" });

  assert.equal(created.runtime.status, "idle");
  assert.equal(created.runtime.unread, false);

  const files = await readdir(path.join(dir, "agents", created.profile.id));
  assert.deepEqual(new Set(files), new Set(["profile.json", "settings.json"]));
  const onDisk = await Promise.all(
    files.map((file) => readFile(path.join(dir, "agents", created.profile.id, file), "utf8"))
  );
  for (const raw of onDisk) {
    const keys = Object.keys(JSON.parse(raw) as Record<string, unknown>);
    for (const derived of ["status", "unread", "lastActivityAt", "preview"]) {
      assert.equal(keys.includes(derived), false, `${derived} must stay derived`);
    }
  }
});

test("runtime status comes back idle after a restart", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "nuum-runtime-"));
  const first = await openRuntime(t, dir);
  const created = await first.createAgent({ name: "Scout" });
  // 模拟一个回合进行中就崩掉的进程：内存里 busy，磁盘上什么都没留。
  await first.store.appendEvent(created.profile.id, {
    type: "user",
    id: "u1",
    text: "long job",
    createdAt: Date.now()
  });
  await first.dispose();

  const restarted = await openRuntime(t, dir);
  const listed = await restarted.listAgents();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.runtime.status, "idle");
});

test("unknown agents are rejected on every id-taking call", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "nuum-runtime-"));
  const runtime = await openRuntime(t, dir);
  await assert.rejects(() => runtime.getAgent("nope"), /Agent not found/);
  await assert.rejects(() => runtime.getTranscript("nope"), /Agent not found/);
  await assert.rejects(() => runtime.send("nope", "hi"), /Agent not found/);
  await assert.rejects(() => runtime.updateAgent({ id: "nope", name: "x" }), /Agent not found/);
});

test("opening an agent clears unread and projects its transcript", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "nuum-runtime-"));
  const runtime = await openRuntime(t, dir);
  const created = await runtime.createAgent({ name: "Scout" });
  const id = created.profile.id;
  await runtime.store.appendEvent(id, { type: "user", id: "u1", text: "list files", createdAt: 1 });
  await runtime.store.appendEvent(id, {
    type: "assistant",
    id: "a1",
    parts: [{ type: "text", text: "here" }],
    createdAt: 2
  });

  assert.equal((await runtime.listAgents())[0]!.runtime.unread, true);
  const snapshot = await runtime.getAgent(id);
  assert.deepEqual(
    snapshot.blocks.map((block) => block.type),
    ["user"]
  );
  // 普通 assistant text 是模型私有 scratchpad，只有 SendMessage 投递才进用户时间线。
  assert.equal(snapshot.view.runtime.unread, false);
  assert.equal((await runtime.listAgents())[0]!.runtime.unread, false);
});

test("opening an agent never writes model-only tool repairs into the transcript truth", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "nuum-runtime-"));
  const runtime = await openRuntime(t, dir);
  const id = (await runtime.createAgent({ name: "Scout" })).profile.id;
  await runtime.store.appendEvent(id, {
    type: "assistant",
    id: "a1",
    parts: [{ type: "tool_call", id: "call-1", name: "read", arguments: { path: "a.ts" } }],
    createdAt: 1
  });

  const snapshot = await runtime.getAgent(id);
  assert.deepEqual(snapshot.events.map((event) => event.type), ["assistant"]);
  assert.deepEqual((await runtime.getTranscript(id)).entries.map((event) => event.type), ["assistant"]);
});

test("update merges the given fields and leaves the rest alone", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "nuum-runtime-"));
  const runtime = await openRuntime(t, dir);
  const created = await runtime.createAgent({ name: "Scout", description: "scans things" });
  const renamed = await runtime.updateAgent({ id: created.profile.id, name: "Ranger" });
  assert.equal(renamed.profile.name, "Ranger");
  assert.equal(renamed.profile.description, "scans things");
  assert.deepEqual(renamed.settings.model, created.settings.model);

  const hidden = await runtime.updateAgent({ id: created.profile.id, hiddenFromSidebar: true });
  assert.equal(hidden.profile.name, "Ranger");
  assert.equal(hidden.settings.hiddenFromSidebar, true);
});

test("delete removes the agent directory and drops it from the list", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "nuum-runtime-"));
  const runtime = await openRuntime(t, dir);
  const created = await runtime.createAgent({ name: "Scout" });
  await runtime.deleteAgent(created.profile.id);
  assert.deepEqual(await runtime.listAgents(), []);
  assert.deepEqual(await readdir(path.join(dir, "agents")), []);
});
