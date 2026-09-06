import assert from "node:assert/strict";
import test from "node:test";
import { projectResponsiveSidebar } from "../conversation/sidebar-resize";
import { inspectorBounds, projectInspectorLayout, workDisplayTitle } from "./work-layout";

test("sidebar shrinks then collapses without losing the user's expanded width", () => {
  const saved = { expandedWidth: 360, isCollapsed: false };
  assert.equal(projectResponsiveSidebar(saved, 1040).width, 300);
  assert.deepEqual(projectResponsiveSidebar(saved, 800), { width: 88, isCollapsed: true });
  assert.equal(projectResponsiveSidebar(saved, 1400).width, 360);
  assert.deepEqual(projectResponsiveSidebar({ ...saved, isCollapsed: true }, 1400), { width: 88, isCollapsed: true });
});

test("inspector reserves usable task and member areas and restores preferred dimensions", () => {
  const preference = { width: 360, split: .8 };
  for (const width of [712, 800, 1100]) {
    const layout = projectInspectorLayout(preference, width, 460);
    assert.ok(width - layout.width >= 440);
    assert.ok(layout.width >= 184);
    assert.ok(460 - layout.capabilityHeight >= 190);
  }
  assert.equal(projectInspectorLayout(preference, 1200, 900).width, 360);
  assert.equal(projectInspectorLayout({ width: 250, split: .1 }, 712, 460).capabilityHeight, 120);
  const bounds = inspectorBounds(712, 460);
  assert.ok(bounds.maxWidth >= bounds.minWidth);
  assert.ok(bounds.maxHeight >= bounds.minHeight);
});

test("work title removes only the redundant leading Work Bar label", () => {
  assert.equal(workDisplayTitle("Work Bar · Design review"), "Design review");
  assert.equal(workDisplayTitle("WorkBar: Design review"), "Design review");
  assert.equal(workDisplayTitle("Build the Work Bar"), "Build the Work Bar");
  assert.equal(workDisplayTitle("Work Bar"), "Work Bar");
});
