import { WorkTaskState, type WorkSnapshot } from "@nuum/protocol";

export type TaskView = WorkSnapshot["tasks"][number];
export const TASK_STATES = WorkTaskState.options;

/**
 * 看板只投影活跃的四状态：待开始 / 进行中 / 阻塞中。proposed（提案）在 UI 上
 * 并入待开始；review 与 done 收进产物页（completedTasks）；cancelled 不展示。
 * 协议层七态不变，这只是投影口径。
 */
export const BOARD_LANES = ["ready", "in_progress", "blocked"] as const;
export type BoardLane = (typeof BOARD_LANES)[number];

export function laneOf(state: TaskView["state"]): BoardLane | null {
  if (state === "proposed") return "ready";
  return BOARD_LANES.includes(state as BoardLane) ? (state as BoardLane) : null;
}

export function taskLanes(tasks: readonly TaskView[]) {
  return BOARD_LANES.map((state) => ({ state, tasks: tasks.filter((task) => laneOf(task.state) === state) }));
}

/** 已完成（含待验收）任务卡片，收进产物页展示。 */
export function completedTasks(tasks: readonly TaskView[]) {
  return tasks.filter((task) => task.state === "done" || task.state === "review");
}

export function workDeliverables(tasks: readonly TaskView[]) {
  return tasks.flatMap((task) => task.deliverables.map((file) => ({ file, task })))
    .sort((a, b) => b.file.createdAt - a.file.createdAt);
}
