import assert from "node:assert/strict";
import test from "node:test";
import { assignSidebarAgent, projectSidebarAgents, toggleSidebarPin, removeSidebarSection } from "./sidebar-organization";

const agents = ["a", "b", "c"].map((id) => ({ profile: { id } }));
const original = { pinnedAgentIds: ["a"], sections: [{ id: "research", name: "Research", agentIds: ["a", "b"], isCollapsed: false }] };

test("pinned agents appear once and unpinning returns them to their original group", () => {
  const before = projectSidebarAgents(agents, original);
  assert.deepEqual(before.pinned.map((a) => a.profile.id), ["a"]);
  assert.deepEqual(before.sections[0].agents.map((a) => a.profile.id), ["b"]);
  assert.deepEqual(before.unassigned.map((a) => a.profile.id), ["c"]);
  const after = projectSidebarAgents(agents, toggleSidebarPin(original, "a"));
  assert.deepEqual(after.sections[0].agents.map((a) => a.profile.id), ["a", "b"]);
});

test("moving an agent replaces its group, while dissolving a group preserves agents", () => {
  const state = { ...original, sections: [...original.sections, { id: "design", name: "Design", agentIds: [], isCollapsed: false }] };
  const moved = assignSidebarAgent(state, "a", "design");
  assert.deepEqual(moved.pinnedAgentIds, []);
  assert.deepEqual(moved.sections.map((s) => s.agentIds), [["b"], ["a"]]);
  const removed = projectSidebarAgents(agents, removeSidebarSection(moved, "design"));
  assert.deepEqual(removed.unassigned.map((a) => a.profile.id), ["a", "c"]);
  assert.deepEqual(original.sections[0].agentIds, ["a", "b"]);
});

test("unknown groups do not lose membership and stale IDs do not create fake agents", () => {
  assert.deepEqual(assignSidebarAgent(original, "a", "missing"), original);
  const result = projectSidebarAgents(agents.slice(1), original);
  assert.deepEqual(result.pinned, []);
  assert.equal(result.sections[0].agents.length, 1);
});
