import { WorkTaskState, type WorkSnapshot } from "@nuum/protocol";

export type TaskView = WorkSnapshot["tasks"][number];
export const TASK_STATES = WorkTaskState.options;

export function taskLanes(tasks: readonly TaskView[]) {
  return TASK_STATES.map((state) => ({ state, tasks: tasks.filter((task) => task.state === state) }));
}

export function workDeliverables(tasks: readonly TaskView[]) {
  return tasks.flatMap((task) => task.deliverables.map((file) => ({ file, task })))
    .sort((a, b) => b.file.createdAt - a.file.createdAt);
}
