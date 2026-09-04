import type {
  AgentView,
  WorkCatalogAddParams,
  WorkSnapshot,
  WorkRole,
  WorkTaskState
} from "@nuum/protocol";
import { useEffect, useMemo, useState, type FormEvent } from "react";
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
        <span className="sand-work-create__eyebrow">A place for the job, not another chat</span>
        <h1>Create a Work</h1>
        <p>Keep tasks, shared discussion, Agents, capabilities, and deliverables together.</p>
        <label>
          <span>Name</span>
          <input autoFocus onChange={(event) => setName(event.target.value)} placeholder="e.g. Product launch" value={name} />
        </label>
        <label>
          <span>Goal</span>
          <textarea onChange={(event) => setDescription(event.target.value)} placeholder="What should this Work accomplish?" value={description} />
        </label>
        <div className="sand-work-create__actions">
          {canCancel ? <button onClick={onCancel} type="button">Cancel</button> : null}
          <button disabled={!name.trim()} onClick={() => onCreate({ name: name.trim(), description: description.trim() })} type="button">Create Work</button>
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
  onAttachAgent(agentId: string, role: WorkRole): void;
  onDetachAgent(agentId: string, expectedRevision: number): void;
  onOpenAgent(agentId: string): void;
  onAddCatalogEntry(entry: WorkCatalogAddParams["entry"]): void;
  onRemoveCatalogEntry(entryId: string): void;
}

const STATE_LABELS: Record<WorkTaskState, string> = {
  proposed: "Proposed",
  ready: "Ready",
  in_progress: "In progress",
  blocked: "Blocked",
  review: "Review",
  done: "Done",
  cancelled: "Cancelled"
};

export function WorkBoard({
  snapshot,
  agents,
  onPostMessage,
  onUpdateWork,
  onCreateTask,
  onTransitionTask,
  onDispatchTask,
  onAttachAgent,
  onDetachAgent,
  onOpenAgent,
  onAddCatalogEntry,
  onRemoveCatalogEntry
}: WorkBoardProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(snapshot.tasks[0]?.id ?? null);
  const [message, setMessage] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskAgentId, setTaskAgentId] = useState("");
  const [agentToAdd, setAgentToAdd] = useState("");
  const [agentRole, setAgentRole] = useState<WorkRole>("worker");
  const [blockerReason, setBlockerReason] = useState("");
  const [dispatchInstruction, setDispatchInstruction] = useState("");
  const [capabilityKind, setCapabilityKind] = useState<"skill" | "cli" | "knowledge" | "local-tool">("skill");
  const [capabilityName, setCapabilityName] = useState("");
  const [capabilityPath, setCapabilityPath] = useState("");
  const [workGoal, setWorkGoal] = useState(snapshot.profile.description);
  const [projectRoot, setProjectRoot] = useState(snapshot.profile.projectRoot ?? "");
  const selectedTask = snapshot.tasks.find((task) => task.id === selectedTaskId) ?? snapshot.tasks[0] ?? null;
  const availableAgents = useMemo(
    () => agents.filter((agent) => !agent.settings.workMembership?.binding),
    [agents]
  );
  useEffect(() => {
    setWorkGoal(snapshot.profile.description);
    setProjectRoot(snapshot.profile.projectRoot ?? "");
  }, [snapshot.profile.id, snapshot.profile.description, snapshot.profile.projectRoot]);

  const submitMessage = (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim()) return;
    onPostMessage(message.trim());
    setMessage("");
  };

  return (
    <section className="sand-work-board">
      <header className="sand-work-board__header">
        <div>
          <span className="sand-work-board__eyebrow">Work</span>
          <h1>{snapshot.profile.name}</h1>
          {snapshot.profile.description ? <p>{snapshot.profile.description}</p> : null}
        </div>
        <div className="sand-work-board__summary">
          <span>{snapshot.tasks.filter((task) => task.state === "in_progress").length} active</span>
          <span>{snapshot.tasks.filter((task) => task.state === "blocked").length} blocked</span>
        </div>
      </header>

      <div className="sand-work-board__main">
        <div className="sand-work-board__center">
          <section className="sand-work-tasks">
            <div className="sand-work-section-heading">
              <div><span>Tasks</span><small>{snapshot.tasks.length}</small></div>
              <form
                className="sand-work-task-create"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!taskTitle.trim()) return;
                  onCreateTask({ title: taskTitle.trim(), assigneeIds: taskAgentId ? [taskAgentId] : [] });
                  setTaskTitle("");
                }}
              >
                <input onChange={(event) => setTaskTitle(event.target.value)} placeholder="New task" value={taskTitle} />
                <select onChange={(event) => setTaskAgentId(event.target.value)} value={taskAgentId}>
                  <option value="">Unassigned</option>
                  {snapshot.members.map((member) => <option key={member.profile.id} value={member.profile.id}>{member.profile.name}</option>)}
                </select>
                <button disabled={!taskTitle.trim()} type="submit">Add</button>
              </form>
            </div>
            <div className="sand-work-task-lane">
              {snapshot.tasks.length === 0 ? <div className="sand-work-empty-card">Create the first task for this Work.</div> : null}
              {snapshot.tasks.map((task) => (
                <button
                  className="sand-work-task-card"
                  data-selected={task.id === selectedTask?.id || undefined}
                  data-state={task.state}
                  key={task.id}
                  onClick={() => setSelectedTaskId(task.id)}
                  type="button"
                >
                  <span className="sand-work-task-card__state">{STATE_LABELS[task.state]}</span>
                  <strong>{task.title}</strong>
                  <span>{task.assigneeIds.length ? `${task.assigneeIds.length} assigned` : "Unassigned"}</span>
                </button>
              ))}
            </div>
            {selectedTask ? (
              <div className="sand-work-task-detail">
                <div>
                  <span>{STATE_LABELS[selectedTask.state]}</span>
                  <h2>{selectedTask.title}</h2>
                  {selectedTask.description ? <p>{selectedTask.description}</p> : null}
                  {selectedTask.blocker ? <p className="sand-work-task-detail__blocker">Blocked: {selectedTask.blocker.reason}</p> : null}
                </div>
                <div className="sand-work-task-detail__actions">
                  {selectedTask.state === "in_progress" && selectedTask.assigneeIds[0] ? (
                    <div className="sand-work-task-dispatch">
                      <input
                        onChange={(event) => setDispatchInstruction(event.target.value)}
                        placeholder="Instruction for the Agent"
                        value={dispatchInstruction}
                      />
                      <button
                        disabled={!dispatchInstruction.trim()}
                        onClick={() => {
                          onDispatchTask(selectedTask.assigneeIds[0]!, selectedTask.id, dispatchInstruction.trim());
                          setDispatchInstruction("");
                        }}
                        type="button"
                      >Run</button>
                    </div>
                  ) : null}
                  {selectedTask.allowedTransitions.includes("blocked") ? (
                    <input onChange={(event) => setBlockerReason(event.target.value)} placeholder="Blocker reason" value={blockerReason} />
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
                      {STATE_LABELS[state]}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <section className="sand-work-chat">
            <div className="sand-work-section-heading"><div><span>Shared room</span><small>{snapshot.chat.length}</small></div></div>
            <div className="sand-work-chat__timeline" role="log">
              {snapshot.chat.length === 0 ? <div className="sand-work-chat__empty">Discussion and handoffs will appear here.</div> : null}
              {snapshot.chat.map((event) => event.type === "chat.posted" ? (
                <article className="sand-work-chat__message" key={event.id}>
                  <span>{event.actor.kind === "user" ? "You" : event.actor.id}</span>
                  <p>{event.body}</p>
                </article>
              ) : null)}
            </div>
            <form className="sand-work-chat__composer" onSubmit={submitMessage}>
              <textarea onChange={(event) => setMessage(event.target.value)} placeholder="Message the Work" value={message} />
              <button disabled={!message.trim()} type="submit">Post</button>
            </form>
          </section>
        </div>

        <aside className="sand-work-inspector">
          <section className="sand-work-inspector__catalog">
            <div className="sand-work-section-heading"><div><span>Capabilities</span><small>r{snapshot.catalog.revision}</small></div></div>
            <form
              className="sand-work-settings"
              onSubmit={(event) => {
                event.preventDefault();
                onUpdateWork({ description: workGoal.trim(), projectRoot: projectRoot.trim() || null });
              }}
            >
              <textarea onChange={(event) => setWorkGoal(event.target.value)} placeholder="Work goal" value={workGoal} />
              <input onChange={(event) => setProjectRoot(event.target.value)} placeholder="Project directory" value={projectRoot} />
              <button type="submit">Save Work setup</button>
            </form>
            <div className="sand-work-catalog-list">
              {snapshot.catalog.entries.map((entry) => (
                <div className="sand-work-catalog-item" key={entry.id}>
                  <span>{entry.kind}</span>
                  <strong>{entry.name}</strong>
                  <button aria-label={`Remove ${entry.name}`} onClick={() => onRemoveCatalogEntry(entry.id)} type="button">×</button>
                </div>
              ))}
            </div>
            <form
              className="sand-work-catalog-add"
              onSubmit={(event) => {
                event.preventDefault();
                if (!capabilityName.trim() || !capabilityPath.trim()) return;
                const base = { name: capabilityName.trim(), description: "" };
                if (capabilityKind === "skill") {
                  onAddCatalogEntry({ ...base, kind: "skill", manifestPath: capabilityPath.trim() });
                } else if (capabilityKind === "cli") {
                  const [executable, ...allowedSubcommands] = capabilityPath.trim().split(/\s+/);
                  onAddCatalogEntry({ ...base, kind: "cli", executable: executable!, allowedSubcommands });
                } else if (capabilityKind === "knowledge") {
                  onAddCatalogEntry({ ...base, kind: "knowledge", roots: [capabilityPath.trim()], readOnly: true });
                } else {
                  onAddCatalogEntry({ ...base, kind: "local-tool", toolNames: capabilityPath.split(",").map((item) => item.trim()).filter(Boolean) });
                }
                setCapabilityName("");
                setCapabilityPath("");
              }}
            >
              <select onChange={(event) => setCapabilityKind(event.target.value as typeof capabilityKind)} value={capabilityKind}>
                <option value="skill">Skill</option>
                <option value="cli">CLI</option>
                <option value="knowledge">Knowledge</option>
                <option value="local-tool">Local tools</option>
              </select>
              <input onChange={(event) => setCapabilityName(event.target.value)} placeholder="Name" value={capabilityName} />
              <input
                onChange={(event) => setCapabilityPath(event.target.value)}
                placeholder={capabilityKind === "skill" ? "SKILL.md path" : capabilityKind === "cli" ? "Executable path, then allowed subcommands" : capabilityKind === "knowledge" ? "Read-only directory" : "Tool names, comma separated"}
                value={capabilityPath}
              />
              <button disabled={!capabilityName.trim() || !capabilityPath.trim()} type="submit">Add capability</button>
            </form>
          </section>

          <section className="sand-work-inspector__members">
            <div className="sand-work-section-heading"><div><span>Agents</span><small>{snapshot.members.length}</small></div></div>
            <div className="sand-work-members">
              {snapshot.members.map((member) => (
                <div
                  className="sand-work-member"
                  draggable
                  key={member.profile.id}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("application/x-nuum-agent-id", member.profile.id);
                  }}
                >
                  <button className="sand-work-member__identity" onClick={() => onOpenAgent(member.profile.id)} type="button">
                    <AgentAvatar agentId={member.profile.id} color={member.profile.avatarColor} shape={member.profile.avatarShape} size={34} state={member.runtime.status === "running" ? "working" : "idle"} />
                    <span><strong>{member.profile.name}</strong><small>{member.settings.workMembership?.binding?.role ?? "worker"}</small></span>
                  </button>
                  <button
                    aria-label={`Remove ${member.profile.name}`}
                    onClick={() => onDetachAgent(member.profile.id, member.settings.workMembership?.revision ?? 0)}
                    type="button"
                  >×</button>
                </div>
              ))}
            </div>
            <div className="sand-work-member-add">
              <select onChange={(event) => setAgentToAdd(event.target.value)} value={agentToAdd}>
                <option value="">Add an Agent</option>
                {availableAgents.map((agent) => <option key={agent.profile.id} value={agent.profile.id}>{agent.profile.name}</option>)}
              </select>
              <select onChange={(event) => setAgentRole(event.target.value as WorkRole)} value={agentRole}>
                <option value="worker">Worker</option>
                <option value="coordinator">Coordinator</option>
                <option value="observer">Observer</option>
              </select>
              <button disabled={!agentToAdd} onClick={() => { onAttachAgent(agentToAdd, agentRole); setAgentToAdd(""); }} type="button">Add</button>
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}
