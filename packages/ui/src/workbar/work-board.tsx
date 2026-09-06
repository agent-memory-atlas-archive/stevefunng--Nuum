import { t } from "../i18n";
import type {
  AgentView,
  WorkCatalogAddParams,
  WorkSnapshot,
  WorkTaskState
} from "@nuum/protocol";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AutoTextarea } from "../kit/auto-textarea";
import { WorkResizeHandle } from "./work-resize";
import { inspectorBounds, projectInspectorLayout, readInspectorPreference, writeInspectorPreference, workDisplayTitle } from "./work-layout";
import { TaskLanes, WorkDeliverables, STATE_LABELS } from "./work-content";
import { WorkChatDock } from "./work-chat";
import { useAgentDrag } from "./agent-drag";
import { SandIcon } from "../kit/sand-kit-primitives";
import { WorkCapabilityDialog, WorkDialog } from "./work-dialog";
import { AgentAvatar } from "../conversation/agent-avatar";

export function WorkCreation({
  canCancel,
  onCancel,
  onCreate
}: {
  canCancel: boolean;
  onCancel(): void;
  onCreate(input: { name: string; description: string }): void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  return (
    <section className="sand-work-create">
      <div className="sand-work-create__card">
        <span className="sand-work-create__eyebrow">{t("A place for the job, not another chat")}</span>
        <h1>{t("Create a Work")}</h1>
        <p>{t("Keep tasks, shared discussion, Agents, capabilities, and deliverables together.")}</p>
        <label>
          <span>{t("Name")}</span>
          <input autoFocus onChange={(event) => setName(event.target.value)} placeholder={t("e.g. Product launch")} value={name} />
        </label>
        <label>
          <span>{t("Goal")}</span>
          <AutoTextarea onChange={(event) => setDescription(event.target.value)} placeholder={t("What should this Work accomplish?")} value={description} />
        </label>
        <div className="sand-work-create__actions">
          {canCancel ? <button onClick={onCancel} type="button">{t("Cancel")}</button> : null}
          <button disabled={!name.trim()} onClick={() => onCreate({ name: name.trim(), description: description.trim() })} type="button">{t("Create Work")}</button>
        </div>
      </div>
    </section>
  );
}

export interface WorkBoardProps {
  snapshot: WorkSnapshot;
  agents: readonly AgentView[];
  onPostMessage(body: string): void;
  onUpdateWork(patch: { description: string; projectRoot: string | null }): void;
  onCreateTask(input: { title: string; assigneeIds: string[] }): void;
  onTransitionTask(taskId: string, to: WorkTaskState, expectedRevision: number, blockerReason?: string): void;
  onDispatchTask(agentId: string, taskId: string, instruction: string): void;
  onDetachAgent(agentId: string, expectedRevision: number): void;
  onOpenAgent(agentId: string): void;
  onMoveAgentToWork(agentId: string, workId: string): void;
  onPickDirectory(): Promise<string | null>;
  onAddCatalogEntry(entry: WorkCatalogAddParams["entry"]): Promise<boolean>;
  onRemoveCatalogEntry(entryId: string): void;
}

export function WorkBoard({
  snapshot,
  agents,
  onPostMessage,
  onUpdateWork,
  onCreateTask,
  onTransitionTask,
  onDispatchTask,
  onDetachAgent,
  onOpenAgent,
  onMoveAgentToWork,
  onPickDirectory,
  onAddCatalogEntry,
  onRemoveCatalogEntry
}: WorkBoardProps) {
  const mainRef = useRef<HTMLDivElement>(null);
  const [mainSize, setMainSize] = useState({ width: 960, height: 620 });
  const [inspectorPreference, setInspectorPreference] = useState(readInspectorPreference);
  useEffect(() => {
    const element = mainRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setMainSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => writeInspectorPreference(inspectorPreference), [inspectorPreference]);
  const inspector = projectInspectorLayout(inspectorPreference, mainSize.width, mainSize.height);
  const bounds = inspectorBounds(mainSize.width, mainSize.height);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [page, setPage] = useState<"tasks" | "deliverables">("tasks");
  const [taskTitle, setTaskTitle] = useState("");
  const [blockerReason, setBlockerReason] = useState("");
  const [dispatchInstruction, setDispatchInstruction] = useState("");
  const [dialog, setDialog] = useState<"capabilities" | "setup" | "task" | null>(null);
  const [workGoal, setWorkGoal] = useState(snapshot.profile.description);
  const [projectRoot, setProjectRoot] = useState(snapshot.profile.projectRoot ?? "");
  const selectedTask = snapshot.tasks.find((task) => task.id === selectedTaskId) ?? null;
  const memberDrag = useAgentDrag(({ agentId, workId }) => {
    if (workId) { if (workId !== snapshot.profile.id) onMoveAgentToWork(agentId, workId); return; }
    const member = snapshot.members.find((agent) => agent.profile.id === agentId);
    if (member) onDetachAgent(agentId, member.settings.workMembership?.revision ?? 0);
  });
  useEffect(() => {
    setWorkGoal(snapshot.profile.description);
    setProjectRoot(snapshot.profile.projectRoot ?? "");
  }, [snapshot.profile.id, snapshot.profile.description, snapshot.profile.projectRoot]);

  return (
    <section className="sand-work-board">
      <header className="sand-work-board__header">
        <div>
          <h1>{workDisplayTitle(snapshot.profile.name)}</h1>
        </div>
        <div className="sand-work-board__summary">
          <span><i />{snapshot.tasks.filter((task) => task.state === "in_progress").length}{" "}{t("active")}</span>
          {snapshot.tasks.some((task) => task.state === "blocked") ? <span>{snapshot.tasks.filter((task) => task.state === "blocked").length} {t("Blocked")}</span> : null}
          <button className="sand-work-icon-button" aria-label={t("Work settings")} onClick={() => setDialog("setup")} type="button"><SandIcon name="sliders" /></button>
        </div>
      </header>
      <div className="sand-work-board__main" ref={mainRef} style={{ "--work-inspector-width": `${inspector.width}px`, "--work-capability-height": `${inspector.capabilityHeight}px` } as CSSProperties}>
        <div className="sand-work-board__center">
          <div className="sand-work-page-heading">
            <button className="sand-work-page-switch" type="button" title={page === "tasks" ? t("切换到产物") : t("切换到 Tasks")} aria-label={page === "tasks" ? t("切换到产物") : t("切换到 Tasks")}
              onClick={() => setPage(page === "tasks" ? "deliverables" : "tasks")}>
              <strong>{page === "tasks" ? t("Tasks") : t("产物")}</strong>
              <span aria-hidden="true">/</span>
              <small>{page === "tasks" ? t("产物") : t("Tasks")}</small>
            </button>
            {page === "tasks" ? <button className="sand-work-quiet-button" onClick={() => setDialog("task")} type="button"><SandIcon name="plus" size={12} />{" "}{t("New task")}</button> : null}
          </div>
          <div className="sand-work-pages" data-page={page}>
            <div className="sand-work-pages__rotor">
              <section className="sand-work-page sand-work-page--tasks" aria-label={t("Tasks")} inert={page !== "tasks"} aria-hidden={page !== "tasks"}>
                <TaskLanes tasks={snapshot.tasks} agents={agents} onOpen={(id) => { setSelectedTaskId(id); setBlockerReason(""); setDispatchInstruction(""); }} />
              </section>
              <section className="sand-work-page sand-work-page--deliverables" aria-label={t("产物")} inert={page !== "deliverables"} aria-hidden={page !== "deliverables"}>
                <WorkDeliverables tasks={snapshot.tasks} onOpenTask={setSelectedTaskId} />
              </section>
            </div>
          </div>
          <WorkChatDock chat={snapshot.chat} agents={agents} onPostMessage={onPostMessage} />
        </div>

        <aside className="sand-work-inspector">
          <WorkResizeHandle axis="horizontal" label={t("Resize Work inspector")} value={inspector.width} min={bounds.minWidth} max={bounds.maxWidth}
            onChange={(width) => setInspectorPreference((current) => ({ ...current, width }))} />
          <section className="sand-work-inspector__capabilities">
            <div className="sand-work-section-heading"><div><span>{t("Capabilities")}</span><small>{snapshot.catalog.entries.length}</small></div><button className="sand-work-icon-button" aria-label={t("Add capability")} onClick={() => setDialog("capabilities")} type="button"><SandIcon name="plus" size={12} /></button></div>
            <div className="sand-work-capability-list">
              {snapshot.catalog.entries.map((entry) => <div className="sand-work-capability-item" key={entry.id}><div><strong>{entry.name}</strong><small>{t({ "local-tool": "Local tool", skill: "Skill", cli: "CLI", knowledge: "Knowledge" }[entry.kind])}</small></div><button className="sand-work-icon-button" aria-label={t("Remove {name}", { name: entry.name })} onClick={() => onRemoveCatalogEntry(entry.id)} type="button"><SandIcon name="close" size={12} /></button></div>)}
            </div>
          </section>
          <WorkResizeHandle axis="vertical" label={t("Resize capabilities and agents")} value={inspector.capabilityHeight} min={bounds.minHeight} max={bounds.maxHeight}
            onChange={(height) => setInspectorPreference((current) => ({ ...current, split: height / Math.max(1, mainSize.height) }))} />
          <section className="sand-work-inspector__members" data-agent-drop-work={snapshot.profile.id}>
            <div className="sand-work-section-heading"><div><span>{t("Agents")}</span><small>{snapshot.members.length}</small></div></div>
            <div className="sand-work-members">
              {snapshot.members.map((member) => (
                <div
                  className="sand-work-member"
                  onPointerDown={(event) => memberDrag.start(event, member.profile.id, true)}
                  onClickCapture={memberDrag.onClickCapture}
                  onDragStart={(event) => event.preventDefault()}
                  key={member.profile.id}

                >
                  <button className="sand-work-member__identity" onClick={() => onOpenAgent(member.profile.id)} type="button">
                    <AgentAvatar agentId={member.profile.id} color={member.profile.avatarColor} shape={member.profile.avatarShape} size={34} state={member.runtime.status === "running" ? "working" : "idle"} />
                    <span><strong>{member.profile.name}</strong><small>{t({ coordinator: "Coordinator", worker: "Worker", observer: "Observer" }[member.settings.workMembership?.binding?.role ?? "worker"])}</small></span>
                  </button>
                  <button
                    aria-label={t("Remove {name}", { name: member.profile.name })}
                    onClick={() => onDetachAgent(member.profile.id, member.settings.workMembership?.revision ?? 0)}
                    type="button"
                  ><SandIcon name="close" size={12} /></button>
                </div>
              ))}
            </div>
            <div className="sand-work-member-drop-hint"><SandIcon name="sidebar" size={18} /><strong className="sand-work-drop-idle">{t("Drag an Agent here")}</strong><strong className="sand-work-drop-active">{t("Release to add Agent")}</strong><strong className="sand-work-drop-out">{t("Drop outside to remove")}</strong><span>{t("From the sidebar. Drag out to remove.")}</span></div>
          </section>
        </aside>
      </div>
      {selectedTask ? <WorkDialog title={selectedTask.title} subtitle={t(STATE_LABELS[selectedTask.state])} onClose={() => setSelectedTaskId(null)}>
        <div className="sand-work-task-detail">
          <div className="sand-work-task-meta"><span>{t("Assigned to")}</span><strong>{selectedTask.assigneeIds.length ? selectedTask.assigneeIds.map((id) => agents.find((agent) => agent.profile.id === id)?.profile.name ?? t("Agent")).join(", ") : t("Unassigned")}</strong><span>{t("Priority")}</span><strong>{t({ low: "Low", normal: "Normal", high: "High", urgent: "Urgent" }[selectedTask.priority])}</strong></div>
          {selectedTask.description ? <p>{selectedTask.description}</p> : null}
          {selectedTask.acceptanceCriteria.length ? <section><h3>{t("Acceptance criteria")}</h3><ul>{selectedTask.acceptanceCriteria.map((item, index) => <li key={index}>{item}</li>)}</ul></section> : null}
          {selectedTask.blocker ? <p className="sand-work-task-detail__blocker">{t("Blocked:")}{" "}{selectedTask.blocker.reason}</p> : null}
          {selectedTask.deliverables.length ? <section><h3>{t("产物")}</h3>{selectedTask.deliverables.map((file) => <div className="sand-work-task-file" key={file.id}><strong>{file.name}</strong><span>{file.uri}</span></div>)}</section> : null}
                <div className="sand-work-task-detail__actions">
                  {selectedTask.state === "in_progress" && selectedTask.assigneeIds[0] ? (
                    <div className="sand-work-task-dispatch">
                      <input
                        onChange={(event) => setDispatchInstruction(event.target.value)}
                        placeholder={t("Instruction for the Agent")}
                        value={dispatchInstruction}
                      />
                      <button
                        disabled={!dispatchInstruction.trim()}
                        onClick={() => {
                          onDispatchTask(selectedTask.assigneeIds[0]!, selectedTask.id, dispatchInstruction.trim());
                          setDispatchInstruction("");
                        }}
                        type="button"
                      >{t("Run")}</button>
                    </div>
                  ) : null}
                  {selectedTask.allowedTransitions.includes("blocked") ? (
                    <input onChange={(event) => setBlockerReason(event.target.value)} placeholder={t("Blocker reason")} value={blockerReason} />
                  ) : null}
                  {selectedTask.allowedTransitions.map((state) => (
                    <button
                      disabled={state === "blocked" && !blockerReason.trim()}
                      key={state}
                      onClick={() => {
                        onTransitionTask(selectedTask.id, state, selectedTask.revision, state === "blocked" ? blockerReason.trim() : undefined);
                        if (state === "blocked") setBlockerReason("");
                      }}
                      type="button"
                    >
                      {t(STATE_LABELS[state])}
                    </button>
                  ))}
                </div>
        </div>
      </WorkDialog> : null}
      {dialog === "capabilities" ? <WorkCapabilityDialog onClose={() => setDialog(null)} onAdd={onAddCatalogEntry} onPickDirectory={onPickDirectory} /> : null}
      {dialog === "task" ? <WorkDialog title={t("A new task")} subtitle={t("Give the team a clear next step.")} onClose={() => setDialog(null)}>
        <form
                className="sand-work-task-create"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!taskTitle.trim()) return;
                  onCreateTask({ title: taskTitle.trim(), assigneeIds: [] });
                  setTaskTitle(""); setDialog(null);
                }}
              >
                <input onChange={(event) => setTaskTitle(event.target.value)} aria-label={t("Task title")} data-autofocus autoFocus placeholder={t("What needs to happen?")} value={taskTitle} />
                <button className="sand-work-primary" disabled={!taskTitle.trim()} type="submit">{t("Create task")}</button>
              </form></WorkDialog> : null}
      {dialog === "setup" ? <WorkDialog title={t("Work settings")} subtitle={t("A shared goal and a place to work.")} onClose={() => setDialog(null)}>
        <form className="sand-work-dialog-form" onSubmit={(event) => { event.preventDefault(); onUpdateWork({ description: workGoal.trim(), projectRoot: projectRoot.trim() || null }); setDialog(null); }}>
          <label>{t("Goal")}<AutoTextarea value={workGoal} onChange={(event) => setWorkGoal(event.target.value)} /></label>
          <label>{t("Project directory")}<div className="sand-work-path-input"><input value={projectRoot} onChange={(event) => setProjectRoot(event.target.value)} placeholder={t("Choose a local folder")} /><button type="button" onClick={async () => { const path = await onPickDirectory(); if (path) setProjectRoot(path); }}>{t("Browse")}</button></div></label>
          <button className="sand-work-primary" type="submit">{t("Save changes")}</button>
        </form>
      </WorkDialog> : null}

    </section>
  );
}
