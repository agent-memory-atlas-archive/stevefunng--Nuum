import {
  HostEvents,
  HostMethods,
  DEFAULT_MODEL_ID,
  appendAssistantDelta,
  projectAgent,
  type AgentSnapshot,
  type AgentView,
  type LiveAssistant,
  type ProviderId,
  type PublicSettings,
  type ThemePreference,
  type ToolPermission,
  type ToolResolution,
  type TranscriptEvent,
  type WorkCatalogAddParams,
  type WorkProfile,
  type WorkSnapshot
} from "@nuum/protocol";
import {
  ConversationSidebar,
  ConversationWorkspace,
  SettingsOverlay,
  WorkBoard,
  WorkCreation,
  createRuntimeThemeInstaller,
  readSidebarLayout,
  writeSidebarLayout,
  type RuntimeThemeMode,
  type SidebarLayoutState
} from "@nuum/ui";
import { useEffect, useMemo, useRef, useState } from "react";

function resolveTheme(preference: ThemePreference): RuntimeThemeMode {
  if (preference === "light" || preference === "dark") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

type AgentPane = {
  events: TranscriptEvent[];
  live: LiveAssistant | null;
  notice: string | null;
  pendingTool: {
    toolCallId: string;
    name: string;
    arguments: Record<string, unknown>;
    action: "read-file" | "list-directory" | "write-file" | "run-command";
    target: string;
  } | null;
  draft: string;
};

const emptyPane: AgentPane = { events: [], live: null, notice: null, pendingTool: null, draft: "" };

/**
 * Host 通知与 agent.get 快照可能交错到达。JSONL 的 seq 才是顺序真值；
 * renderer 只做去重和排序，不发明第二条时间线。
 */
function mergeTranscriptEvents(...sources: readonly (readonly TranscriptEvent[])[]): TranscriptEvent[] {
  const byId = new Map<string, TranscriptEvent>();
  for (const source of sources) {
    for (const event of source) byId.set(event.id, event);
  }
  return [...byId.values()].sort((left, right) => left.seq - right.seq || left.id.localeCompare(right.id));
}

function applyPanePatch(
  current: Record<string, AgentPane>,
  id: string,
  patch: Partial<AgentPane> | ((current: AgentPane) => Partial<AgentPane>)
): Record<string, AgentPane> {
  const previous = current[id] ?? emptyPane;
  const next = typeof patch === "function" ? patch(previous) : patch;
  return { ...current, [id]: { ...previous, ...next } };
}

export function App() {
  const [agents, setAgents] = useState<AgentView[]>([]);
  const [works, setWorks] = useState<WorkProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeWorkId, setActiveWorkId] = useState<string | null>(null);
  const [workSnapshot, setWorkSnapshot] = useState<WorkSnapshot | null>(null);
  const [creatingWork, setCreatingWork] = useState(false);
  const [workNotice, setWorkNotice] = useState<string | null>(null);
  const [floatingAgentId, setFloatingAgentId] = useState<string | null>(null);
  const [panes, setPanes] = useState<Record<string, AgentPane>>({});
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"general" | "models">("general");
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [deepseekKey, setDeepseekKey] = useState("");
  const [themePref, setThemePref] = useState<ThemePreference>("dark");
  const [sidebarLayout, setSidebarLayout] = useState<SidebarLayoutState>(() =>
    typeof localStorage === "undefined" ? { expandedWidth: 236, isCollapsed: false } : readSidebarLayout()
  );
  const themeHandle = useRef<ReturnType<typeof createRuntimeThemeInstaller> | null>(null);
  const activeWorkIdRef = useRef<string | null>(null);
  activeWorkIdRef.current = activeWorkId;

  const active = useMemo(
    () => agents.find((agent) => agent.profile.id === activeId) ?? null,
    [agents, activeId]
  );
  const pane = (activeId ? panes[activeId] : undefined) ?? emptyPane;
  const draft = activeId ? pane.draft : "";
  const blocks = projectAgent(pane.events, pane.live).blocks;
  const floatingAgent = useMemo(
    () => agents.find((agent) => agent.profile.id === floatingAgentId) ?? null,
    [agents, floatingAgentId]
  );
  const floatingPane = (floatingAgentId ? panes[floatingAgentId] : undefined) ?? emptyPane;
  const floatingBlocks = projectAgent(floatingPane.events, floatingPane.live).blocks;

  function patchPane(id: string, patch: Partial<AgentPane> | ((current: AgentPane) => Partial<AgentPane>)): void {
    setPanes((current) => applyPanePatch(current, id, patch));
  }

  useEffect(() => {
    const handle = createRuntimeThemeInstaller(document as never, resolveTheme(themePref));
    themeHandle.current = handle;
    return () => {
      handle.dispose();
      themeHandle.current = null;
    };
  }, []);

  useEffect(() => {
    themeHandle.current?.update(resolveTheme(themePref));
    document.documentElement.className = resolveTheme(themePref) === "dark" ? "nuum-dark" : "nuum-light";
    document.documentElement.style.colorScheme = resolveTheme(themePref);
  }, [themePref]);

  useEffect(() => {
    if (window.nuum == null) return;
    void refresh();
    return window.nuum.host.onEvent((method, params) => {
      const payload = params as Record<string, any>;
      const agentId = typeof payload.agentId === "string" ? payload.agentId : "";
      if (method === HostEvents.agentUpdated && payload.agent) {
        setAgents((current) => upsert(current, payload.agent as AgentView));
      }
      if (method === HostEvents.agentMessageDelta && agentId) {
        setPanes((current) => applyPanePatch(current, agentId, (pane) => {
          const messageId = String(payload.messageId);
          const base = pane.live?.messageId === messageId ? pane.live.parts : [];
          return {
            live: {
              messageId,
              parts: appendAssistantDelta(base, payload.part === "thinking" ? "thinking" : "text", String(payload.delta ?? ""))
            }
          };
        }));
      }
      if (method === HostEvents.agentMessageCompleted && agentId && payload.event) {
        const event = payload.event as TranscriptEvent;
        setPanes((current) => applyPanePatch(current, agentId, (pane) => ({
          events: mergeTranscriptEvents(pane.events, [event]),
          live: event.type === "assistant" && pane.live?.messageId === event.id ? null : pane.live
        })));
      }
      if (method === HostEvents.agentToolPending && agentId) {
        setPanes((current) => applyPanePatch(current, agentId, {
          pendingTool: {
            toolCallId: payload.toolCallId,
            name: payload.name,
            arguments: payload.arguments ?? {},
            action: payload.action,
            target: payload.target
          }
        }));
      }
      if (method === HostEvents.agentToolCompleted && agentId) {
        setPanes((current) => applyPanePatch(current, agentId, { pendingTool: null }));
      }
      if (method === HostEvents.agentError && agentId) {
        setPanes((current) => applyPanePatch(current, agentId, {
          notice: String(payload.message ?? "Host error"),
          live: null
        }));
      }
      if (method === HostEvents.agentEnded && agentId) {
        setPanes((current) => applyPanePatch(current, agentId, {
          live: null,
          // 被掐和跑完是两回事，不能都静悄悄地收场。
          ...(payload.status === "cancelled" ? { notice: "Stopped." } : {})
        }));
      }
      if (method === HostEvents.workUpdated && payload.work) {
        setWorks((current) => upsertWork(current, payload.work as WorkProfile));
      }
      if (
        (method === HostEvents.workEventAppended || method === HostEvents.workCatalogUpdated) &&
        typeof payload.workId === "string" &&
        payload.workId === activeWorkIdRef.current
      ) {
        void loadWork(payload.workId);
      }
    });
  }, []);

  async function refresh(): Promise<void> {
    const [list, workList, publicSettings] = await Promise.all([
      window.nuum.host.request(HostMethods.agentList) as Promise<AgentView[]>,
      window.nuum.host.request(HostMethods.workList) as Promise<WorkProfile[]>,
      window.nuum.host.request(HostMethods.settingsGet) as Promise<PublicSettings>
    ]);
    setAgents(list);
    setWorks(workList);
    setSettings(publicSettings);
    setThemePref(publicSettings.theme ?? "dark");
    const secrets = await window.nuum.desktop.getSecrets();
    setOpenaiKey(secrets.openaiApiKey ?? "");
    setAnthropicKey(secrets.anthropicApiKey ?? "");
    setDeepseekKey(secrets.deepseekApiKey ?? "");
    if (!activeId && list[0]) {
      setCreatingAgent(false);
      await openAgent(list[0].profile.id);
    } else if (list.length === 0) {
      setActiveId(null);
      setCreatingAgent(true);
    }
  }

  async function openAgent(id: string): Promise<void> {
    setCreatingAgent(false);
    setCreatingWork(false);
    setCreationError(null);
    setActiveWorkId(null);
    setWorkSnapshot(null);
    setFloatingAgentId(null);
    setActiveId(id);
    await loadAgent(id);
  }

  async function loadAgent(id: string): Promise<void> {
    const snapshot = await window.nuum.host.request(HostMethods.agentGet, { id }) as AgentSnapshot;
    setAgents((current) => upsert(current, snapshot.view));
    setPanes((current) => {
      const previous = current[id] ?? emptyPane;
      return {
        ...current,
        [id]: {
          ...previous,
          events: mergeTranscriptEvents(snapshot.events, previous.events),
          live: snapshot.live
        }
      };
    });
  }

  async function loadWork(id: string): Promise<void> {
    const snapshot = await window.nuum.host.request(HostMethods.workGet, { id }) as WorkSnapshot;
    setWorkSnapshot(snapshot);
  }

  async function openWork(id: string): Promise<void> {
    setCreatingAgent(false);
    setCreatingWork(false);
    setActiveId(null);
    setActiveWorkId(id);
    setFloatingAgentId(null);
    setWorkNotice(null);
    await loadWork(id);
  }

  function newAgent(): void {
    setActiveId(null);
    setActiveWorkId(null);
    setWorkSnapshot(null);
    setCreatingWork(false);
    setFloatingAgentId(null);
    setCreationError(null);
    setCreatingAgent(true);
  }

  function newWork(): void {
    setCreatingAgent(false);
    setCreatingWork(true);
    setActiveId(null);
    setActiveWorkId(null);
    setWorkSnapshot(null);
    setFloatingAgentId(null);
  }

  async function createWork(input: { name: string; description: string }): Promise<void> {
    const created = await window.nuum.host.request(HostMethods.workCreate, {
      ...input,
      projectRoot: null
    }) as WorkProfile;
    setWorks((current) => upsertWork(current, created));
    await openWork(created.id);
  }

  async function createAgent(profile: {
    name: string;
    description: string;
    avatarColor: string;
    avatarShape: string;
  }): Promise<void> {
    setCreationError(null);
    try {
      const created = await window.nuum.host.request(HostMethods.agentCreate, profile) as AgentView;
      setAgents((current) => upsert(current, created));
      setCreatingAgent(false);
      await openAgent(created.profile.id);
    } catch (error) {
      setCreationError(error instanceof Error ? error.message : String(error));
    }
  }

  function cancelCreate(): void {
    const fallback = agents[0];
    if (fallback) void openAgent(fallback.profile.id);
  }

  async function send(): Promise<void> {
    const id = activeId;
    if (!id) return;
    await sendAgent(id);
  }

  async function sendAgent(id: string): Promise<void> {
    const targetPane = panes[id] ?? emptyPane;
    if (!targetPane.draft.trim()) return;
    const content = targetPane.draft;
    try {
      patchPane(id, { draft: "", notice: null });
      await window.nuum.host.request(HostMethods.agentSend, { id, content });
    } catch (error) {
      if (id) {
        patchPane(id, { notice: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  async function approve(resolution: ToolResolution): Promise<void> {
    if (!activeId) return;
    await approveAgent(activeId, resolution);
  }

  async function approveAgent(id: string, resolution: ToolResolution): Promise<void> {
    const pendingTool = (panes[id] ?? emptyPane).pendingTool;
    if (!pendingTool) return;
    const method = resolution === "deny" ? HostMethods.agentDenyTool : HostMethods.agentApproveTool;
    await window.nuum.host.request(method, {
      id,
      toolCallId: pendingTool.toolCallId,
      resolution
    });
    patchPane(id, { pendingTool: null });
  }

  async function refreshActiveWork(): Promise<void> {
    if (activeWorkId) await loadWork(activeWorkId);
  }

  async function runWorkMutation(work: () => Promise<unknown>): Promise<void> {
    setWorkNotice(null);
    try {
      await work();
      const [agentList, workList] = await Promise.all([
        window.nuum.host.request(HostMethods.agentList) as Promise<AgentView[]>,
        window.nuum.host.request(HostMethods.workList) as Promise<WorkProfile[]>
      ]);
      setAgents(agentList);
      setWorks(workList);
      await refreshActiveWork();
    } catch (error) {
      setWorkNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function moveAgentToWork(agentId: string, workId: string): void {
    const target = agents.find((agent) => agent.profile.id === agentId);
    if (!target) return;
    const membership = target.settings.workMembership ?? { revision: 0, binding: null };
    const binding = membership.binding;
    if (binding?.workId === workId) return;
    void runWorkMutation(() => binding
      ? window.nuum.host.request(HostMethods.workMemberMove, {
          fromWorkId: binding.workId,
          toWorkId: workId,
          agentId,
          role: "worker",
          expectedRevision: membership.revision
        })
      : window.nuum.host.request(HostMethods.workMemberAttach, {
          workId,
          agentId,
          role: "worker",
          expectedRevision: membership.revision
        }));
  }

  function detachAgentFromWork(agentId: string): void {
    const target = agents.find((agent) => agent.profile.id === agentId);
    const membership = target?.settings.workMembership;
    if (!membership?.binding) return;
    const workId = membership.binding.workId;
    void runWorkMutation(() => window.nuum.host.request(HostMethods.workMemberDetach, {
      workId,
      agentId,
      expectedRevision: membership.revision
    }));
  }

  async function saveSettings(): Promise<void> {
    await window.nuum.desktop.setSecrets({
      openaiApiKey: openaiKey || undefined,
      anthropicApiKey: anthropicKey || undefined,
      deepseekApiKey: deepseekKey || undefined
    });
    const defaultModel =
      deepseekKey && !openaiKey && settings?.defaultModel.provider === "openai"
        ? { provider: "deepseek" as const, model: DEFAULT_MODEL_ID.deepseek }
        : settings?.defaultModel;
    const next = await window.nuum.host.request(HostMethods.settingsSet, {
      defaultToolPermission: settings?.defaultToolPermission,
      defaultModel,
      openaiApiKey: openaiKey || null,
      anthropicApiKey: anthropicKey || null,
      deepseekApiKey: deepseekKey || null
    }) as PublicSettings;
    setSettings(next);
    setSettingsOpen(false);
  }

  async function updateActiveWorkspace(patch: {
    projectRoot?: string | null;
    toolPermission?: ToolPermission | null;
  }): Promise<void> {
    if (!active) return;
    const current = active.settings.workspace ?? { projectRoot: null, toolPermission: null };
    const updated = await window.nuum.host.request(HostMethods.agentUpdate, {
      id: active.profile.id,
      workspace: {
        projectRoot: patch.projectRoot !== undefined ? patch.projectRoot : current.projectRoot,
        toolPermission: patch.toolPermission !== undefined ? patch.toolPermission : current.toolPermission
      }
    }) as AgentView;
    setAgents((items) => upsert(items, updated));
  }

  return (
    <div className="sand-app">
      <div className="sand-cover-drag" />
      <ConversationSidebar
        agents={agents}
        works={works}
        activeId={activeId}
        activeWorkId={activeWorkId}
        layout={sidebarLayout}
        onLayoutChange={(next) => {
          setSidebarLayout(next);
          if (!next.isDragging) writeSidebarLayout(next);
        }}
        onNewAgent={newAgent}
        onNewWork={newWork}
        onOpen={(id) => void openAgent(id)}
        onOpenWork={(id) => void openWork(id)}
        onMoveAgentToWork={moveAgentToWork}
        onDetachAgent={detachAgentFromWork}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className="sand-workspace">
        {creatingWork ? (
          <WorkCreation
            canCancel={agents.length > 0 || works.length > 0}
            onCancel={() => works[0] ? void openWork(works[0].id) : cancelCreate()}
            onCreate={(input) => void createWork(input)}
          />
        ) : activeWorkId && workSnapshot ? (
          <WorkBoard
            agents={agents}
            snapshot={workSnapshot}
            onUpdateWork={(patch) => void runWorkMutation(() => window.nuum.host.request(HostMethods.workUpdate, {
              id: activeWorkId,
              ...patch
            }))}
            onPostMessage={(body) => void runWorkMutation(() => window.nuum.host.request(HostMethods.workPostMessage, {
              workId: activeWorkId,
              body,
              mentionedAgentIds: []
            }))}
            onCreateTask={({ title, assigneeIds }) => void runWorkMutation(() => window.nuum.host.request(HostMethods.workTaskCreate, {
              workId: activeWorkId,
              title,
              description: "",
              acceptanceCriteria: [],
              assigneeIds,
              dependencyIds: [],
              priority: "normal"
            }))}
            onTransitionTask={(taskId, to, expectedRevision, blockerReason) => void runWorkMutation(() =>
              window.nuum.host.request(HostMethods.workTaskTransition, {
                workId: activeWorkId,
                taskId,
                to,
                expectedRevision,
                ...(blockerReason ? { blocker: { reason: blockerReason } } : {})
              })
            )}
            onDispatchTask={(agentId, taskId, instruction) => void runWorkMutation(() =>
              window.nuum.host.request(HostMethods.workDispatch, {
                workId: activeWorkId,
                agentId,
                taskId,
                instruction
              })
            )}
            onAttachAgent={(agentId, role) => {
              const target = agents.find((agent) => agent.profile.id === agentId);
              void runWorkMutation(() => window.nuum.host.request(HostMethods.workMemberAttach, {
                workId: activeWorkId,
                agentId,
                role,
                expectedRevision: target?.settings.workMembership?.revision ?? 0
              }));
            }}
            onDetachAgent={(agentId, expectedRevision) => void runWorkMutation(() =>
              window.nuum.host.request(HostMethods.workMemberDetach, {
                workId: activeWorkId,
                agentId,
                expectedRevision
              })
            )}
            onOpenAgent={(agentId) => {
              setFloatingAgentId(agentId);
              void loadAgent(agentId);
            }}
            onAddCatalogEntry={(entry: WorkCatalogAddParams["entry"]) => void runWorkMutation(() =>
              window.nuum.host.request(HostMethods.workCatalogAdd, {
                workId: activeWorkId,
                expectedRevision: workSnapshot.catalog.revision,
                entry
              })
            )}
            onRemoveCatalogEntry={(entryId) => void runWorkMutation(() =>
              window.nuum.host.request(HostMethods.workCatalogRemove, {
                workId: activeWorkId,
                entryId,
                expectedRevision: workSnapshot.catalog.revision
              })
            )}
          />
        ) : (
          <ConversationWorkspace
            agent={active}
            blocks={blocks}
            creatingAgent={creatingAgent}
            canCancelCreate={agents.length > 0}
            creationError={creationError}
            pendingTool={pane.pendingTool}
            draft={draft}
            notice={pane.notice}
            onDraftChange={(value) => {
              if (activeId) patchPane(activeId, { draft: value });
            }}
            onSubmit={() => void send()}
            onCancel={() => activeId && void window.nuum.host.request(HostMethods.agentCancel, { id: activeId })}
            onCancelCreate={cancelCreate}
            onCreateAgent={(profile) => void createAgent(profile)}
            onApprove={(resolution) => void approve(resolution)}
          />
        )}
        {workNotice ? <div className="sand-work-notice" role="alert">{workNotice}</div> : null}
        {activeWorkId && floatingAgent && floatingAgentId ? (
          <div aria-label={`Conversation with ${floatingAgent.profile.name}`} className="sand-work-agent-float" role="dialog">
            <button aria-label="Close conversation" className="sand-work-agent-float__close" onClick={() => setFloatingAgentId(null)} type="button">×</button>
            <ConversationWorkspace
              agent={floatingAgent}
              autoFocusInput
              blocks={floatingBlocks}
              pendingTool={floatingPane.pendingTool}
              draft={floatingPane.draft}
              notice={floatingPane.notice}
              onDraftChange={(value) => patchPane(floatingAgentId, { draft: value })}
              onSubmit={() => void sendAgent(floatingAgentId)}
              onCancel={() => void window.nuum.host.request(HostMethods.agentCancel, { id: floatingAgentId })}
              onCancelCreate={() => undefined}
              onCreateAgent={() => undefined}
              onApprove={(resolution) => void approveAgent(floatingAgentId, resolution)}
            />
          </div>
        ) : null}
      </div>
      <SettingsOverlay
        open={settingsOpen}
        section={settingsSection}
        onSection={setSettingsSection}
        onClose={() => setSettingsOpen(false)}
      >
        {settingsSection === "general" ? (
          <div className="sand-settings-stack">
            <div className="sand-settings-row">
              <div className="sand-settings-copy">
                <span>Dark mode</span>
                <small>Keep the current dark shell, or switch to the light palette.</small>
              </div>
              <div className="sand-settings-control">
                <button
                  aria-checked={resolveTheme(themePref) === "dark"}
                  className="sand-switch"
                  onClick={() => {
                    const next = resolveTheme(themePref) === "dark" ? "light" : "dark";
                    setThemePref(next);
                    if (window.nuum != null) {
                      void window.nuum.host.request(HostMethods.settingsSet, { theme: next }).then((value) => {
                        setSettings(value as PublicSettings);
                      });
                    }
                  }}
                  role="switch"
                  type="button"
                >
                  <span className="sand-switch__knob" />
                </button>
              </div>
            </div>
            <div className="sand-settings-row">
              <div className="sand-settings-copy">
                <span>Active agent project</span>
                <small>Pre-approved read/write scope and default working directory for this agent.</small>
              </div>
              <div className="sand-settings-control">
                <SandWorkspace
                  value={active?.settings.workspace?.projectRoot ?? ""}
                  onPick={async () => {
                    const folder = await window.nuum.desktop.pickWorkspace();
                    if (!folder) return;
                    await updateActiveWorkspace({ projectRoot: folder });
                  }}
                  onClear={() => void updateActiveWorkspace({ projectRoot: null })}
                />
              </div>
            </div>
            <div className="sand-settings-row">
              <div className="sand-settings-copy">
                <span>Active agent permission</span>
                <small>Override the global default for local file and command actions.</small>
              </div>
              <div className="sand-settings-control">
                <select
                  value={active?.settings.workspace?.toolPermission ?? "follow"}
                  onChange={(event) => void updateActiveWorkspace({
                    toolPermission: event.target.value === "follow" ? null : event.target.value as ToolPermission
                  })}
                >
                  <option value="follow">Follow global</option>
                  <option value="ask">Ask</option>
                  <option value="always">Always</option>
                  <option value="never">Never</option>
                </select>
              </div>
            </div>
            <div className="sand-settings-row">
              <div className="sand-settings-copy">
                <span>Default local-tool permission</span>
                <small>Used by agents that follow the global setting. Hard safety blocks always remain.</small>
              </div>
              <div className="sand-settings-control">
                <select
                  value={settings?.defaultToolPermission ?? "ask"}
                  onChange={async (event) => {
                    const next = await window.nuum.host.request(HostMethods.settingsSet, {
                      defaultToolPermission: event.target.value
                    }) as PublicSettings;
                    setSettings(next);
                  }}
                >
                  <option value="ask">Ask</option>
                  <option value="always">Always</option>
                  <option value="never">Never</option>
                </select>
              </div>
            </div>
            <div className="sand-settings-actions">
              <button className="sand-kit-button sand-1wclgxm" onClick={() => void saveSettings()} type="button">Save</button>
            </div>
          </div>
        ) : (
          <div className="sand-settings-stack">
            <div className="sand-settings-row">
              <div className="sand-settings-copy">
                <span>Default provider</span>
                <small>Used for new chats until you change the session model.</small>
              </div>
              <div className="sand-settings-control">
                <select
                  value={settings?.defaultModel.provider ?? "deepseek"}
                  onChange={async (event) => {
                    const provider = event.target.value as ProviderId;
                    const next = await window.nuum.host.request(HostMethods.settingsSet, {
                      defaultModel: { provider, model: DEFAULT_MODEL_ID[provider] }
                    }) as PublicSettings;
                    setSettings(next);
                  }}
                >
                  <option value="deepseek">DeepSeek</option>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </div>
            </div>
            {settings?.defaultModel.provider === "deepseek" ? (
              <div className="sand-settings-row">
                <div className="sand-settings-copy">
                  <span>DeepSeek model</span>
                  <small>deepseek-chat for everyday use. deepseek-reasoner for longer reasoning.</small>
                </div>
                <div className="sand-settings-control">
                  <select
                    value={settings.defaultModel.model}
                    onChange={async (event) => {
                      const next = await window.nuum.host.request(HostMethods.settingsSet, {
                        defaultModel: { provider: "deepseek", model: event.target.value }
                      }) as PublicSettings;
                      setSettings(next);
                    }}
                  >
                    <option value="deepseek-chat">deepseek-chat</option>
                    <option value="deepseek-reasoner">deepseek-reasoner</option>
                  </select>
                </div>
              </div>
            ) : null}
            <div className="sand-settings-row">
              <div className="sand-settings-copy">
                <span>DeepSeek API key</span>
                <small>Stored in the OS keychain and injected into Host memory only.</small>
              </div>
              <div className="sand-settings-control">
                <input onChange={(event) => setDeepseekKey(event.target.value)} type="password" value={deepseekKey} />
              </div>
            </div>
            <div className="sand-settings-row">
              <div className="sand-settings-copy">
                <span>OpenAI API key</span>
                <small>Optional. Used when the default provider is OpenAI.</small>
              </div>
              <div className="sand-settings-control">
                <input onChange={(event) => setOpenaiKey(event.target.value)} type="password" value={openaiKey} />
              </div>
            </div>
            <div className="sand-settings-row">
              <div className="sand-settings-copy">
                <span>Anthropic API key</span>
                <small>Optional. Used when the default provider is Anthropic.</small>
              </div>
              <div className="sand-settings-control">
                <input onChange={(event) => setAnthropicKey(event.target.value)} type="password" value={anthropicKey} />
              </div>
            </div>
            <div className="sand-settings-actions">
              <button className="sand-kit-button sand-1wclgxm" onClick={() => void saveSettings()} type="button">Save</button>
            </div>
          </div>
        )}
      </SettingsOverlay>
    </div>
  );
}

function SandWorkspace({ value, onPick, onClear }: { value: string; onPick(): void; onClear(): void }) {
  return (
    <>
      <input readOnly value={value || "No workspace selected"} />
      <button className="sand-kit-button sand-1tiofj7" onClick={onPick} type="button">Choose</button>
      {value ? <button className="sand-kit-button sand-1tiofj7" onClick={onClear} type="button">Clear</button> : null}
    </>
  );
}

function upsert(list: AgentView[], agent: AgentView): AgentView[] {
  return [agent, ...list.filter((item) => item.profile.id !== agent.profile.id)].sort(
    (a, b) => b.runtime.lastActivityAt - a.runtime.lastActivityAt
  );
}

function upsertWork(list: WorkProfile[], work: WorkProfile): WorkProfile[] {
  return [work, ...list.filter((item) => item.id !== work.id)].sort(
    (a, b) => b.createdAt - a.createdAt
  );
}
