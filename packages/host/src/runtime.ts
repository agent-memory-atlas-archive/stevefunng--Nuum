import { homedir, platform, release } from "node:os";
import path from "node:path";
import {
  DEFAULT_AGENT_NAME,
  HostErrorCode,
  HostEvents,
  RpcError,
  appendAssistantDelta,
  appendAssistantToolCall,
  describeWake,
  projectAgent,
  resolveAvailableModel,
  type AgentCreateParams,
  type AgentRuntime as AgentRuntimeView,
  type AgentSettings,
  type AgentUpdateParams,
  type AgentView,
  type AssistantPart,
  type CreateAgentParams,
  type LocalToolAction,
  type ReadAgentTranscriptParams,
  type SendMessageParams,
  type SendToAgentParams,
  type Settings,
  type StopAgentParams,
  type UpdateAgentParams,
  type SettingsSetParams,
  type ToolDefinition,
  type ToolApproval,
  type ToolPermission,
  type ToolResolution,
  type UpdateStateParams,
  type TranscriptEvent
} from "@nuum/protocol";
import { AgentStore, type AgentRecord } from "./agent-store.js";
import {
  COMPACTION_PROMPT,
  assembleContext,
  describeOutbound,
  deriveName,
  estimateContextTokens,
  partitionForCompaction
} from "./context.js";
import {
  createDelegatedTools,
  type DelegateHost,
  type DelegatedTool,
  type DelegatedToolContext
} from "./delegated-tools.js";
import { spawnKernelClient, type KernelClient } from "./kernel-client.js";
import {
  EXTRACTION_PROMPT,
  MemoryStore,
  isMemorableExchange,
  parseExtraction,
  renderMemory
} from "./memory.js";
import { resolveSessionModel } from "./model.js";
import type { ExpertPort } from "./ports.js";
import { precheck } from "./precheck.js";
import {
  profileDriftNotice,
  renderAgentDirectory,
  renderCompactNotice,
  renderSystemPrompt,
  type AgentIdentity
} from "./prompt.js";
import { AgentScheduler, DEFAULT_MAX_CONCURRENT_RUNS, type RunKind } from "./scheduler.js";
import { MAX_AGENTS, WakeQueue, currentHops, pendingWake } from "./wake.js";

/**
 * 往回扫多少条找上一条 user / wake。一个 turn 里工具事件可以很多，但不会多到
 * 这个量级；真扫不到说明这条转录里根本没有唤醒链，当 0 手是对的。
 */
const HOPS_SCAN_LIMIT = 200;

export type { DelegatedTool };

export interface HostRuntimeOptions {
  dataDir: string;
  kernelCommand: string;
  kernelArgs: string[];
  expert?: ExpertPort | null;
  delegatedTools?: DelegatedTool[];
  maxConcurrentRuns?: number;
  /** 测试接缝；产品按模型表取窗口。 */
  contextWindowTokens?: number;
  /** 测试用的接缝：换掉真 Kernel 进程，才能在单测里驱动事件回路。 */
  spawnKernel?: (command: string, args: string[]) => KernelClient;
}

export class HostRuntime implements Partial<DelegateHost> {
  readonly store: AgentStore;
  readonly scheduler: AgentScheduler;
  private settings!: Settings;
  private kernel: KernelClient | null = null;
  /** 运行态只活在内存里 —— 进程重启后一律回到 idle，磁盘上不存在假 running。 */
  private readonly errored = new Set<string>();
  private readonly buffers = new Map<string, {
    messageId: string;
    parts: AssistantPart[];
    flushed?: boolean;
  }>();
  private readonly pendingTools = new Map<string, ToolApproval>();
  private readonly pendingByAgent = new Map<string, Set<string>>();
  /** 本轮已记进 assistant 事件的 toolCallId，防止 pending → started 重复记。 */
  private readonly recordedCalls = new Map<string, Set<string>>();
  /** toolCallId 只是调用号；落盘时再带上 assistantId，投影不需靠相邻顺序猜归属。 */
  private readonly callOrigins = new Map<string, Map<string, string>>();
  /** Kernel 通知是 fire-and-forget；同一 run 必须串行投影，不同 agent 仍可并行。 */
  private readonly kernelEventChains = new Map<string, Promise<void>>();
  private readonly delegated = new Map<string, DelegatedTool>();
  /** 在跑的后台任务（记忆抽取、压缩、唤醒重放），dispose 时要等它们收尾。 */
  private readonly pending = new Set<Promise<unknown>>();
  private readonly wakes = new WakeQueue();
  private emit: (method: string, params: unknown) => void = () => undefined;
  private readonly toolCache: ToolDefinition[] = [];

  constructor(private readonly options: HostRuntimeOptions) {
    this.store = new AgentStore(options.dataDir);
    this.scheduler = new AgentScheduler(options.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS);
    // 产品工具（§5.2）由 runtime 自己装：它们的副作用全在 runtime 上，没有
    // 别处能提供。options.delegatedTools 留给测试往里塞额外的桩。
    for (const tool of [...createDelegatedTools(this), ...(options.delegatedTools ?? [])]) {
      this.delegated.set(tool.definition.name, tool);
    }
  }

  setEmitter(emit: (method: string, params: unknown) => void): void {
    this.emit = emit;
  }

  async start(): Promise<void> {
    await this.store.init();
    this.settings = await this.store.readSettings();
    this.attachKernel();
    // 重放放最后：它要 kernel 在位，而且不该拖慢 RPC 上线。
    this.background(this.replayPendingWakes());
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([...this.pending, ...this.kernelEventChains.values()]);
    this.kernel?.dispose();
    this.kernel = null;
    await this.store.dispose();
  }

  private attachKernel(): void {
    this.kernel?.dispose();
    const spawn = this.options.spawnKernel ?? spawnKernelClient;
    const client = spawn(this.options.kernelCommand, this.options.kernelArgs);
    this.kernel = client;
    client.onEvent((method, params) => this.enqueueKernelEvent(method, params));
    void client.hello().catch(() => {
      this.kernel = null;
      this.emit(HostEvents.kernelDown, { at: Date.now() });
    });
    void client.tools().then((list) => {
      if (Array.isArray(list)) {
        this.toolCache.splice(0, this.toolCache.length, ...(list as ToolDefinition[]));
      }
    });
  }

  getPublicSettings() {
    return this.store.publicSettings(this.settings);
  }

  async setSettings(patch: SettingsSetParams): Promise<ReturnType<AgentStore["publicSettings"]>> {
    if (patch.openaiApiKey !== undefined) {
      this.store.secrets.openaiApiKey = patch.openaiApiKey ?? undefined;
    }
    if (patch.anthropicApiKey !== undefined) {
      this.store.secrets.anthropicApiKey = patch.anthropicApiKey ?? undefined;
    }
    if (patch.deepseekApiKey !== undefined) {
      this.store.secrets.deepseekApiKey = patch.deepseekApiKey ?? undefined;
    }
    const requestedModel = patch.defaultModel ?? this.settings.defaultModel;
    this.settings = {
      ...this.settings,
      defaultToolPermission: patch.defaultToolPermission ?? this.settings.defaultToolPermission,
      defaultModel: resolveAvailableModel(this.store.secrets, requestedModel) ?? requestedModel,
      theme: patch.theme ?? this.settings.theme
    };
    await this.store.writeSettings(this.settings);
    return this.getPublicSettings();
  }

  // ── agent 生命周期 ──────────────────────────────────────────────────────

  async createAgent(params: AgentCreateParams = {}): Promise<AgentView> {
    const now = Date.now();
    const settings: AgentSettings = {
      model:
        params.model ??
        resolveAvailableModel(this.store.secrets, this.settings.defaultModel) ??
        this.settings.defaultModel,
      workspace: params.workspace ?? { projectRoot: null, toolPermission: null }
    };
    const record = await this.store.createAgent(
      {
        id: crypto.randomUUID(),
        name: params.name?.trim() || DEFAULT_AGENT_NAME,
        description: params.description?.trim() ?? "",
        ...(params.avatarColor ? { avatarColor: params.avatarColor } : {}),
        ...(params.avatarShape ? { avatarShape: params.avatarShape } : {}),
        createdAt: now
      },
      settings
    );
    const view = await this.viewFor(record);
    this.emit(HostEvents.agentUpdated, { agent: view });
    return view;
  }

  async listAgents(): Promise<AgentView[]> {
    return Promise.all(this.store.listAgents().map((record) => this.viewFor(record)));
  }

  async getAgent(id: string) {
    const record = this.store.requireAgent(id);
    // UI 明确要完整时间线；模型热路径走 readForAssemble，不再全量读。
    const events = await this.store.readTranscript(id);
    const live = this.liveFor(id);
    await this.store.markRead(id);
    return {
      view: await this.viewFor(record),
      events,
      blocks: projectAgent(events, live).blocks,
      live
    };
  }

  async updateAgent(params: AgentUpdateParams): Promise<AgentView> {
    const profile: Record<string, unknown> = {};
    if (params.name !== undefined) profile.name = params.name;
    if (params.description !== undefined) profile.description = params.description;
    if (params.avatarColor !== undefined) profile.avatarColor = params.avatarColor;
    if (params.avatarShape !== undefined) profile.avatarShape = params.avatarShape;
    const settings: Record<string, unknown> = {};
    if (params.model !== undefined) settings.model = params.model;
    if (params.workspace !== undefined) settings.workspace = params.workspace;
    if (params.hiddenFromSidebar !== undefined) settings.hiddenFromSidebar = params.hiddenFromSidebar;
    const record = await this.store.updateAgent(params.id, {
      ...(Object.keys(profile).length ? { profile } : {}),
      ...(Object.keys(settings).length ? { settings } : {})
    });
    const view = await this.viewFor(record);
    this.emit(HostEvents.agentUpdated, { agent: view });
    return view;
  }

  async deleteAgent(id: string): Promise<{ ok: true }> {
    await this.cancel(id);
    const cleanup = this.kernel
      ?.disposeShell(path.join(this.store.agentDir(id), "terminals"))
      .then(() => undefined, () => undefined);
    if (cleanup) await settleWithin(cleanup, 500);
    this.wakes.drop(id);
    this.errored.delete(id);
    this.buffers.delete(id);
    this.recordedCalls.delete(id);
    this.callOrigins.delete(id);
    this.clearAgentPending(id);
    await this.store.deleteAgent(id);
    return { ok: true };
  }

  async getTranscript(id: string, beforeSeq?: number, limit?: number) {
    this.store.requireAgent(id);
    const page = await this.store.readTranscriptPage(id, beforeSeq, limit);
    return { id, ...page };
  }

  // ── 回合 ────────────────────────────────────────────────────────────────

  async send(id: string, content: string): Promise<{ ok: true; runId: string; queued: boolean }> {
    const record = this.store.requireAgent(id);
    const model = resolveSessionModel({
      sessionModel: record.settings.model,
      defaultModel: this.settings.defaultModel,
      secrets: this.store.secrets
    });
    if (this.agentHasPending(id)) {
      throw new RpcError(HostErrorCode.AGENT_BUSY, "Approve or deny the pending tool before sending another message");
    }
    precheck({
      exists: true,
      // 同一 agent 只有一条 transcript，并行跑会把上下文写乱，所以用户路径仍然拒绝。
      // 排队留给第 6 步的 agent 间唤醒（那里 wake 事件定义了顺序语义）。
      busy: this.scheduler.isBusy(id),
      model,
      secrets: this.store.secrets
    });
    if (!this.kernel) throw new RpcError(HostErrorCode.KERNEL_DOWN, "Kernel is not available");
    this.errored.delete(id);

    const { events } = await this.readModelTranscript(id);
    // 用户消息先落盘再排队：即使全局并发已满、这个 run 要等，消息也立刻出现在时间线上。
    const user = await this.store.appendEvent(id, {
      type: "user",
      id: crypto.randomUUID(),
      text: content,
      createdAt: Date.now()
    });
    if (record.profile.name === DEFAULT_AGENT_NAME && events.length === 0) {
      await this.store.updateAgent(id, { profile: { name: deriveName(content) } });
    }
    if (record.settings.model !== model) {
      await this.store.updateAgent(id, { settings: { model } });
    }
    this.emit(HostEvents.agentMessageCompleted, { agentId: id, event: user });

    const { runId, state, started } = this.launch(id, "user");
    this.emit(HostEvents.agentUpdated, { agent: await this.viewFor(this.store.requireAgent(id)) });
    // 立刻起的 run 等它真的进了 Kernel 再回 —— 否则拉起失败会被吞掉，用户以为发出去了。
    await started;
    return { ok: true, runId, queued: state === "queued" };
  }

  /**
   * 把一个 agent 交给调度器。用户消息（`send`）与 agent 唤醒（`wake`）共用
   * 这一条路：区别只在追什么事件，起 run 的动作是同一个。上下文每次从转录
   * 重新拼，所以起因是谁不影响这里。
   */
  private launch(
    id: string,
    kind: RunKind
  ): { runId: string; state: "started" | "queued"; started?: Promise<void> } {
    const submitted = this.scheduler.submit({
      agentId: id,
      kind,
      start: async (activeRunId) => {
        const record = this.store.requireAgent(id);
        const model = resolveSessionModel({
          sessionModel: record.settings.model,
          defaultModel: this.settings.defaultModel,
          secrets: this.store.secrets
        });
        let { events: replayed, compact } = await this.readModelTranscript(id);
        let prompt = await this.buildSystemPrompt(id, Boolean(compact));
        let assembled = assembleContext({
          transcript: replayed,
          systemPrompt: prompt.text,
          notices: prompt.notices
        });
        if (estimateContextTokens(assembled) > this.contextWindow(model) * 0.75) {
          try {
            const compacted = await this.compact(id, activeRunId, replayed, model);
            if (compacted) {
              ({ events: replayed, compact } = await this.readModelTranscript(id));
              prompt = await this.buildSystemPrompt(id, Boolean(compact));
              assembled = assembleContext({
                transcript: replayed,
                systemPrompt: prompt.text,
                notices: prompt.notices
              });
            }
          } catch {
            // 压缩是容量优化，不是用户回合的前置条件；失败时带原上下文继续，
            // 下次达到阈值会再试。
          }
        }
        const approvals = await this.store.readApprovals(id);
        await this.kernel!.start({
          runId: activeRunId,
          messages: assembled,
          model,
          roots: this.toolRoots(record),
          toolPermission: record.settings.workspace?.toolPermission ?? this.settings.defaultToolPermission,
          approvals: approvals.always,
          refused: approvals.refused,
          localToolNames: this.toolCache.map((tool) => tool.name),
          delegatedTools: [...this.delegated.values()].map((tool) => tool.definition),
          secrets: this.store.secrets
        });
      }
    });
    return submitted;
  }

  async cancel(id: string): Promise<{ ok: true }> {
    // 只取消这个 agent 的 run，别的 agent 照跑。排着的唤醒一起丢 ——
    // 用户按下停止，意思是「别忙了」，不是「先停这个再接着忙下一个」。
    this.wakes.drop(id);
    for (const runId of this.scheduler.cancelAgent(id)) {
      await this.kernel?.cancel(runId);
    }
    return { ok: true };
  }

  async decide(id: string, toolCallId: string, resolution: ToolResolution): Promise<{ ok: true }> {
    const pending = this.pendingTools.get(pendingKey(id, toolCallId));
    if (pending && resolution !== "once") {
      const stored = await this.store.readApprovals(id);
      const always = stored.always.filter((item) => !sameApproval(item, pending));
      const refused = stored.refused.filter((item) => !sameApproval(item, pending));
      if (resolution === "always") always.push(pending);
      if (resolution === "deny" || resolution === "never") refused.push(pending);
      await this.store.writeApprovals(id, { always, refused });
    }
    if (resolution === "never") {
      const record = this.store.requireAgent(id);
      const updated = await this.store.updateAgent(id, {
        settings: {
          workspace: {
            projectRoot: record.settings.workspace?.projectRoot ?? null,
            toolPermission: "never"
          }
        }
      });
      this.emit(HostEvents.agentUpdated, { agent: await this.viewFor(updated) });
    }
    if (!this.kernel) throw new RpcError(HostErrorCode.KERNEL_DOWN, "Kernel is not available");
    const runId = this.scheduler.activeRunFor(id);
    if (!runId) throw new RpcError(HostErrorCode.AGENT_NOT_FOUND, "No running turn to decide on");
    this.forgetPending(id, toolCallId);
    await this.kernel.decide({ runId, toolCallId, resolution }, resolution === "deny");
    return { ok: true };
  }

  /** Kernel 本地工具 + Host 委派工具，合起来才是模型看得见的全集。 */
  tools(): ToolDefinition[] {
    return [...this.toolCache, ...[...this.delegated.values()].map((tool) => tool.definition)];
  }

  // ── 委派工具的 handler（§5.2）────────────────────────────────────────────

  /**
   * SendMessage：助手对用户说话的唯一出口。追一条 `message` 事件到真源，UI
   * 拿它画气泡；模型侧仍保留原 SendMessage tool_call，不把该事件
   * 重复回放成 assistant 消息（§2.Q6）。
   */
  async sendMessage(
    agentId: string,
    params: SendMessageParams,
    source: Pick<DelegatedToolContext, "assistantId" | "toolCallId">
  ): Promise<string> {
    this.store.requireAgent(agentId);
    // 消息发出去意味着「这条要给用户看」，所以先把在写的助手块收口，
    // 气泡才会排在它自己那段工作痕迹之后而不是之前。
    await this.flushAssistant(agentId);
    const event = await this.store.appendEvent(agentId, {
      type: "message",
      id: crypto.randomUUID(),
      assistantId: source.assistantId,
      toolCallId: source.toolCallId,
      payload: params,
      createdAt: Date.now()
    });
    this.emit(HostEvents.agentMessageCompleted, { agentId, event });
    if (params.type === "text") return "Delivered.";
    if (params.type === "attachment") return `Delivered ${params.path}.`;
    return `Delivered the ${params.widget} widget.`;
  }

  /**
   * update_state：agent 改自己。
   *
   * profile 改名 / 改描述会公告进时间线（`profile` 事件），但**不** bump epoch ——
   * 系统段保持冻结，当轮靠尾部飘移说明告知（§6.1）。
   *
   * 显式写记忆**要** bump epoch：用户说「记住我用 pnpm」时期待的是下一句就生效，
   * 而不是等某次压缩。代价是一次 cache miss，那恰好是最值得付的一次。
   */
  async updateState(agentId: string, params: UpdateStateParams): Promise<string> {
    if (params.target === "profile") {
      const patch: { name?: string; description?: string } = {};
      if (params.name !== undefined) patch.name = params.name.trim();
      if (params.description !== undefined) patch.description = params.description.trim();
      if (Object.keys(patch).length === 0) return "Nothing to change: pass name or description.";
      const record = await this.store.updateAgent(agentId, { profile: patch });
      const event = await this.store.appendEvent(agentId, {
        type: "profile",
        id: crypto.randomUUID(),
        patch,
        createdAt: Date.now()
      });
      this.emit(HostEvents.agentMessageCompleted, { agentId, event });
      this.emit(HostEvents.agentUpdated, { agent: await this.viewFor(record) });
      return `Profile updated. You are now "${record.profile.name}".`;
    }

    if (params.target === "settings") {
      const record = this.store.requireAgent(agentId);
      const projectRoot = params.project_root?.trim() ? path.resolve(params.project_root) : null;
      const updated = await this.store.updateAgent(agentId, {
        settings: {
          workspace: {
            projectRoot,
            toolPermission: record.settings.workspace?.toolPermission ?? null
          }
        }
      });
      this.emit(HostEvents.agentUpdated, { agent: await this.viewFor(updated) });
      return projectRoot ? `Project directory set to ${projectRoot}.` : "Project directory cleared.";
    }

    const memory = new MemoryStore(this.store.memoryDir(agentId));
    if (params.action === "forget") {
      const { removed } = await memory.forget(params.fact);
      if (removed === 0) return "Nothing matched that, so nothing was removed.";
      await this.store.bumpPromptEpoch(agentId);
      return `Forgotten (${removed} ${removed === 1 ? "entry" : "entries"} removed).`;
    }
    const { written } = await memory.write(params.fact, params.tier);
    if (!written) return "Already recorded — nothing to do.";
    await this.store.bumpPromptEpoch(agentId);
    return `Recorded to ${params.tier === "profile" ? "your standing facts" : "your log"}.`;
  }

  /**
   * CreateAgent：建一个真的队友 —— 自己的目录、自己的 transcript、自己的 run。
   * 创建免审批，约束靠提示词守则、没有删除工具和这里的硬护栏：
   * 单轮最多 1 个、全局上限 50。
   */
  async createAgentFromModel(agentId: string, params: CreateAgentParams): Promise<string> {
    const runId = this.scheduler.activeRunFor(agentId);
    if (!this.wakes.claimCreate(runId)) {
      return `Refused: you have already created an agent this turn. Use it, or ask the user before creating more.`;
    }
    if (this.store.listAgents().length >= MAX_AGENTS) {
      return `Refused: there are already ${MAX_AGENTS} agents. Ask the user to delete one first.`;
    }
    const view = await this.createAgent({
      name: params.name,
      description: params.description
    });
    const created = view.profile;
    if (!params.first_message) {
      return `Created "${created.name}" (id ${created.id}). It has no instructions yet — use SendToAgent to give it work.`;
    }
    const delivered = await this.sendToAgent(agentId, {
      agent_id: created.id,
      message: params.first_message
    });
    return `Created "${created.name}" (id ${created.id}). ${delivered}`;
  }

  /** UpdateAgent：改**别的** agent 的 name / description。不传的字段不动。 */
  async updateAgentFromModel(agentId: string, params: UpdateAgentParams): Promise<string> {
    if (params.agent_id === agentId) {
      return "That is you. Use update_state target=profile to change your own profile.";
    }
    const target = this.store.getAgent(params.agent_id);
    if (!target) return `No agent with id ${params.agent_id}.`;
    const patch: { name?: string; description?: string } = {};
    if (params.name !== undefined) patch.name = params.name.trim();
    if (params.description !== undefined) patch.description = params.description.trim();
    if (Object.keys(patch).length === 0) return "Nothing to change: pass name or description.";
    const record = await this.store.updateAgent(params.agent_id, { profile: patch });
    const event = await this.store.appendEvent(params.agent_id, {
      type: "profile",
      id: crypto.randomUUID(),
      patch,
      createdAt: Date.now()
    });
    this.emit(HostEvents.agentMessageCompleted, { agentId: params.agent_id, event });
    this.emit(HostEvents.agentUpdated, { agent: await this.viewFor(record) });
    return `Updated "${record.profile.name}".`;
  }

  /**
   * SendToAgent：往对方的 transcript 追一条 `wake`，然后调度它的 run。
   *
   * fire-and-forget：**立刻**回投递确认，不等对方跑完 —— 对方在自己的时间线上
   * 回话，不在这条。发送方这边不额外写出站事件：这次调用的 `tool` 事件已经把
   * 「我发了什么给谁」记在发送方时间线里了。
   */
  async sendToAgent(agentId: string, params: SendToAgentParams): Promise<string> {
    const from = this.store.getAgent(agentId);
    const target = this.store.getAgent(params.agent_id);
    if (!target) return `No agent with id ${params.agent_id}.`;
    const hops = (await this.hopsOf(agentId)) + 1;
    const verdict = this.wakes.check(agentId, params.agent_id, hops);
    if (!verdict.ok) return verdict.reason;

    const fromName = from?.profile.name ?? "another agent";
    const event = await this.store.appendEvent(params.agent_id, {
      type: "wake",
      id: crypto.randomUUID(),
      source: {
        kind: "agent",
        fromId: agentId,
        fromName,
        ...(params.priority ? { priority: true } : {})
      },
      text: params.message,
      hops,
      createdAt: Date.now()
    });
    this.emit(HostEvents.agentMessageCompleted, { agentId: params.agent_id, event });

    const wake = { fromId: agentId, fromName, text: params.message, hops };
    if (params.priority && this.scheduler.isBusy(params.agent_id)) {
      // priority 做成「取消后重起一个 run」而不是 steer：模型会重新看到完整
      // 上下文（含这条新指令），代价是丢掉当前 turn 已做的中间推理（§2.Q5）。
      //
      // 排队而不是立刻起：槽位要等 Kernel 确认 `turn.ended` 才腾出来，抢在
      // 那之前起第二个 run 会让同一个 agent 有两个 run 同时写同一条转录。
      // `cancel` 顺手清了队列，所以这条一定在队头。
      await this.cancel(params.agent_id);
      this.wakes.enqueue(params.agent_id, wake);
      return `Sent to ${target.profile.name} as priority. It is dropping what it was doing to take this.`;
    }
    if (this.scheduler.isBusy(params.agent_id)) {
      this.wakes.enqueue(params.agent_id, wake);
      return `Sent to ${target.profile.name}. It is busy, so this is queued behind what it is doing.`;
    }
    const { started } = this.launch(params.agent_id, "agent");
    this.emit(HostEvents.agentUpdated, { agent: await this.viewFor(this.store.requireAgent(params.agent_id)) });
    try {
      // 投递是 fire-and-forget（不等对方跑完），但**起 run** 这一步要等 ——
      // 不等的话拉起失败会被吞掉，调用方以为发出去了，而对方永远不会响应。
      await started;
    } catch (error) {
      return `Delivered to ${target.profile.name}, but it could not start: ${
        error instanceof Error ? error.message : String(error)
      }. It will pick the message up next time it runs.`;
    }
    return `Sent to ${target.profile.name}.`;
  }

  /** ReadAgentTranscript：读对方时间线的文本投影。只读。 */
  async readAgentTranscript(agentId: string, params: ReadAgentTranscriptParams): Promise<string> {
    const target = this.store.getAgent(params.agent_id);
    if (!target) return `No agent with id ${params.agent_id}.`;
    const requestedLimit = params.limit ?? 40;
    // 读取窗口比展示窗口大：投影会丢掉 thinking、消息工具回执和旧版修复行，
    // 不能让这些内部事件把真正有意义的末尾内容挤出去。
    const scanLimit = Math.min(200, requestedLimit * 8);
    const { entries } = await this.store.readTranscriptPage(params.agent_id, undefined, scanLimit);
    if (entries.length === 0) return `"${target.profile.name}" has not said anything yet.`;
    const lines = entries
      .flatMap((event) => renderForPeer(event, target.profile.name))
      .slice(-requestedLimit);
    if (lines.length === 0) return `"${target.profile.name}" has no user-visible updates yet.`;
    const busy = this.scheduler.isBusy(params.agent_id) ? " (still working)" : "";
    const noun = lines.length === 1 ? "update" : "updates";
    return [`Last ${lines.length} ${noun} from "${target.profile.name}"${busy}:`, "", ...lines].join("\n");
  }

  /** StopAgent：掐掉对方当前的 run，排着的唤醒也一起丢。 */
  async stopAgent(agentId: string, params: StopAgentParams): Promise<string> {
    if (params.agent_id === agentId) return "That would stop you. Just stop calling tools instead.";
    const target = this.store.getAgent(params.agent_id);
    if (!target) return `No agent with id ${params.agent_id}.`;
    if (!this.scheduler.isBusy(params.agent_id)) {
      return `"${target.profile.name}" is not doing anything.`;
    }
    const dropped = this.wakes.depth(params.agent_id);
    await this.cancel(params.agent_id);
    return dropped > 0
      ? `Stopped "${target.profile.name}" and dropped ${dropped} queued message(s).`
      : `Stopped "${target.profile.name}".`;
  }

  // ── 提示词 ──────────────────────────────────────────────────────────────

  /**
   * 拼这一轮的 system prompt。profile 段按 epoch 冻结：命中快照就照用，模型看到
   * 的前缀因此逐字节不变；identity 与快照不一致时不去 bump epoch（一次改名不值
   * 得作废整个前缀缓存），而是在上下文尾部补一条飘移说明（§6.1）。
   */
  async buildSystemPrompt(id: string, hasCompact?: boolean): Promise<{ text: string; notices: string[] }> {
    const record = this.store.requireAgent(id);
    const expert = this.options.expert?.resolve(id);
    if (expert) return { text: expert.systemPrompt, notices: [] };

    const identity: AgentIdentity = {
      name: record.profile.name,
      description: record.profile.description
    };
    const cache = await this.store.readPromptCache(id);
    const agentDir = this.store.agentDir(id);
    const memoryDir = this.store.memoryDir(id);
    // 记忆段同样按 epoch 冻结。没有快照才去读磁盘上的 Markdown 重渲染。
    const memory =
      cache.memory ?? renderMemory(await new MemoryStore(memoryDir).all(), memoryDir);
    const compacted = hasCompact ?? Boolean((await this.store.readForAssemble(id)).compact);
    const render = renderSystemPrompt({
      identity,
      paths: {
        profile: path.join(agentDir, "profile.json"),
        settings: path.join(agentDir, "settings.json"),
        agentDir,
        scratchDir: this.store.scratchDir(id)
      },
      environment: {
        os: `${platform()} ${release()}`,
        now: new Date(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        // 第 8 步换成每 agent 的 AgentSettings.workspace.projectRoot。
        projectRoot: record.settings.workspace?.projectRoot ?? null,
        permission: describePermission(
          record.settings.workspace?.toolPermission ?? this.settings.defaultToolPermission
        )
      },
      frozenProfile: cache.profile?.render,
      memory,
      agentDirectory: renderAgentDirectory(
        id,
        this.store
          .listAgents()
          .filter((mate) => mate.profile.id !== id && !mate.settings.hiddenFromSidebar)
          // 按 createdAt 排序，让这一段在队友集合不变时逐字节相同。
          .sort((a, b) => a.profile.createdAt - b.profile.createdAt)
          .map((mate) => ({
            id: mate.profile.id,
            name: mate.profile.name,
            description: mate.profile.description
          })),
        path.join(this.options.dataDir, "agents")
      ),
      compactNotice: compacted ? renderCompactNotice(this.store.transcriptFile(id)) : undefined
    });

    if (!cache.profile || !cache.memory) {
      await this.store.writePromptCache(id, {
        epoch: cache.epoch,
        profile: cache.profile ?? { render: render.liveProfile, identity },
        memory
      });
    }
    const frozenIdentity = cache.profile?.identity;
    const notice = frozenIdentity ? profileDriftNotice(frozenIdentity, identity) : null;
    return { text: render.text, notices: notice ? [notice] : [] };
  }

  private contextWindow(model: AgentSettings["model"]): number {
    if (this.options.contextWindowTokens) return this.options.contextWindowTokens;
    const known: Record<string, number> = {
      "deepseek:deepseek-chat": 128_000,
      "openai:gpt-4o": 128_000,
      "anthropic:claude-sonnet-4-20250514": 128_000
    };
    return known[`${model.provider}:${model.model}`] ?? 128_000;
  }

  private toolRoots(record: AgentRecord) {
    const dataParent = path.dirname(this.options.dataDir);
    return {
      home: path.resolve(process.env.NUUM_LOCAL_EXEC_ROOT || homedir()),
      project: record.settings.workspace?.projectRoot ?? null,
      scratch: this.store.scratchDir(record.profile.id),
      terminals: path.join(this.store.agentDir(record.profile.id), "terminals"),
      denied: [
        path.join(dataParent, "secrets.bin"),
        path.join(this.options.dataDir, "host-secrets.json"),
        path.join(this.options.dataDir, "credentials.json"),
        path.join(this.options.dataDir, "secrets.json")
      ]
    };
  }

  private async compact(
    agentId: string,
    runId: string,
    transcript: TranscriptEvent[],
    model: AgentSettings["model"]
  ): Promise<boolean> {
    if (!this.kernel) return false;
    const partition = partitionForCompaction(transcript);
    if (!partition) return false;
    const { text } = await this.kernel.summarize({
      runId: `${runId}:compact`,
      systemPrompt: COMPACTION_PROMPT,
      messages: partition.messagesToSummarize,
      model,
      secrets: this.store.secrets
    });
    const summary = text.trim();
    if (!summary) return false;
    const nextEpoch = (await this.store.readPromptCache(agentId)).epoch + 1;
    await this.store.appendEvent(agentId, {
      type: "compact",
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      epoch: nextEpoch,
      throughSeq: partition.throughSeq,
      tailFromSeq: partition.tailFromSeq,
      summary
    });
    await this.store.bumpPromptEpoch(agentId);
    return true;
  }

  /**
   * turn 收束后的记忆抽取（§8）。**异步、不阻塞 UI、不 bump epoch** ——
   * 这条路径高频且用户无感，攒到下次压缩统一进提示词，别每轮打碎前缀缓存。
   */
  private async extractMemory(agentId: string, runId: string): Promise<void> {
    const record = this.store.getAgent(agentId);
    if (!record || !this.kernel) return;
    const { events } = await this.store.readForAssemble(agentId);
    const lastPrompt = [...events]
      .reverse()
      .find((event) => event.type === "user" || event.type === "wake");
    if (!lastPrompt) return;
    const prompt = lastPrompt.type === "user" ? lastPrompt.text : lastPrompt.text;
    if (!isMemorableExchange(prompt)) return;

    const since = events.filter((event) => event.seq >= lastPrompt.seq);
    const { text } = await this.kernel.summarize({
      runId,
      systemPrompt: EXTRACTION_PROMPT,
      messages: assembleContext({ transcript: since, systemPrompt: "" }).slice(1),
      model: record.settings.model,
      secrets: this.store.secrets
    });
    const { writes, removals } = parseExtraction(text);
    if (writes.length === 0 && removals.length === 0) return;
    const memory = new MemoryStore(this.store.memoryDir(agentId));
    for (const removal of removals) await memory.forget(removal);
    for (const entry of writes) await memory.write(entry.fact, entry.tier);
  }

  // ── Kernel 事件 ─────────────────────────────────────────────────────────

  private async onKernelEvent(method: string, raw: unknown): Promise<void> {
    const params = (raw ?? {}) as Record<string, any>;
    const runId = String(params.runId ?? "");
    // Kernel 只认 runId，agent 的归属在 Host 这边查。查不到说明该 run 已收束，
    // 迟到的事件直接丢，别把它记到别人账上。
    const agentId = this.scheduler.agentIdFor(runId);
    if (!agentId) return;

    if (method === "turn.delta") {
      const part = params.part === "thinking" ? "thinking" : "text";
      const current = this.openBuffer(agentId, String(params.messageId));
      current.parts = appendAssistantDelta(current.parts, part, String(params.delta ?? ""));
      this.buffers.set(agentId, current);
      this.emit(HostEvents.agentMessageDelta, {
        agentId,
        runId,
        messageId: current.messageId,
        delta: params.delta,
        part
      });
      return;
    }
    if (method === "turn.tool.pending") {
      this.rememberPending(agentId, String(params.toolCallId), {
        action: params.action as LocalToolAction,
        target: String(params.target)
      });
      await this.recordToolCall(agentId, params);
      this.emit(HostEvents.agentToolPending, { ...params, agentId, runId });
      return;
    }
    if (method === "turn.tool.started") {
      await this.recordToolCall(agentId, params);
      this.emit(HostEvents.agentToolStarted, { ...params, agentId, runId });
      return;
    }
    if (method === "turn.tool.delegate") {
      const assistantId = await this.recordToolCall(agentId, params);
      await this.runDelegatedTool(agentId, runId, params, assistantId);
      return;
    }
    if (method === "turn.tool.completed") {
      // 硬拒与 anti-nag 不经过 pending/started，也一样必须把 tool_call 记下来，
      // 否则下一轮会出现孤立 tool result。
      const assistantId = await this.recordToolCall(agentId, params);
      // 序号来自内存里的 lastSeq —— 不再为了算下一个序号而整文件重读。
      const event = await this.store.appendEvent(agentId, {
        type: "tool",
        id: crypto.randomUUID(),
        assistantId,
        name: params.name,
        toolCallId: params.toolCallId,
        content: String(params.output ?? ""),
        ok: params.ok !== false,
        createdAt: Date.now()
      });
      this.forgetPending(agentId, String(params.toolCallId));
      this.emit(HostEvents.agentMessageCompleted, { agentId, event });
      this.emit(HostEvents.agentToolCompleted, { ...params, agentId, runId });
      return;
    }
    if (method === "turn.error") {
      this.clearAgentPending(agentId);
      this.emit(HostEvents.agentError, { ...params, agentId, runId });
      return;
    }
    if (method === "turn.ended") {
      await this.flushAssistant(agentId);
      this.buffers.delete(agentId);
      this.recordedCalls.delete(agentId);
      this.callOrigins.delete(agentId);
      this.clearAgentPending(agentId);
      const status: "idle" | "error" | "cancelled" =
        params.status === "error" ? "error" : params.status === "cancelled" ? "cancelled" : "idle";
      // 先摘掉 run 再算派生运行态，否则 agentUpdated 里还会带着 running。
      this.scheduler.settle(runId);
      await this.mark(agentId, status);
      this.emit(HostEvents.agentEnded, { agentId, runId, status });
      this.wakes.closeRun(runId);
      if (status === "idle") {
        // 抽取失败不该影响这一轮 —— 它是后台工作，用户没在等它。
        this.background(this.extractMemory(agentId, runId));
      }
      // 腾出槽位就接着跑排着的唤醒。取消路径已经把队列清了，所以只有正常
      // 收束才会有下一条。
      await this.pumpWakes(agentId);
    }
  }

  /**
   * stdio event 没有 request/response 的 await 语义。若直接调 async handler，
   * completed / ended 会交叉落盘；按 runId 串行后，seq 才是可信的发生顺序。
   */
  private enqueueKernelEvent(method: string, raw: unknown): void {
    const params = (raw ?? {}) as Record<string, unknown>;
    const runId = String(params.runId ?? "");
    const previous = this.kernelEventChains.get(runId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => this.onKernelEvent(method, raw));
    this.kernelEventChains.set(runId, current);
    void current
      .catch((error) => {
        const message = error instanceof Error ? error.stack ?? error.message : String(error);
        process.stderr.write(`[nuum-host] kernel event ${method} failed: ${message}\n`);
      })
      .finally(() => {
        if (this.kernelEventChains.get(runId) === current) this.kernelEventChains.delete(runId);
      });
  }

  /** 当前工作离用户几手（护栏用）。从转录派生，见 `currentHops` 的注释。 */
  private async hopsOf(id: string): Promise<number> {
    const { entries } = await this.store.readTranscriptPage(id, undefined, HOPS_SCAN_LIMIT);
    return currentHops(entries);
  }

  /** 起下一条排着的唤醒。wake 事件早在投递时就写进转录了，这里只是起 run。 */
  private async pumpWakes(agentId: string): Promise<void> {
    if (this.scheduler.isBusy(agentId)) return;
    const next = this.wakes.dequeue(agentId);
    if (!next) return;
    this.launch(agentId, "agent");
    const record = this.store.getAgent(agentId);
    if (record) this.emit(HostEvents.agentUpdated, { agent: await this.viewFor(record) });
  }

  /**
   * 启动时重放没被响应过的唤醒（§2.Q5）。判据在转录尾部，不需要 inbox 文件：
   * 末条 `wake` 之后没有 assistant / message 就说明上次没跑完。
   */
  private async replayPendingWakes(): Promise<void> {
    for (const record of this.store.listAgents()) {
      const id = record.profile.id;
      const { entries } = await this.store.readTranscriptPage(id, undefined, 20);
      const wake = pendingWake(entries);
      if (!wake) continue;
      if (this.scheduler.isBusy(id)) this.wakes.enqueue(id, wake);
      else this.launch(id, "agent");
    }
  }

  /**
   * 后台任务。记账是为了让 `dispose()` 能等它们结束：不等的话进程退出时
   * 半写的记忆文件会留在磁盘上，而测试里则会漏出「测试结束后还在写文件」。
   */
  private background(work: Promise<unknown>): void {
    const tracked = work.catch(() => undefined).finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }

  /**
   * 委派工具的往返：Host 执行完把结果塞回 Kernel，Kernel 接着跑 loop。
   * 无论成败都必须回一条结果，否则那个 run 会永远卡在等待里。
   */
  private async runDelegatedTool(
    agentId: string,
    runId: string,
    params: Record<string, any>,
    assistantId: string
  ): Promise<void> {
    const name = String(params.name ?? "");
    const toolCallId = String(params.toolCallId ?? "");
    const tool = this.delegated.get(name);
    let ok = true;
    let output: string;
    if (!tool) {
      ok = false;
      output = `Unknown delegated tool: ${name}`;
    } else {
      try {
        output = await tool.execute((params.arguments ?? {}) as Record<string, unknown>, {
          agentId,
          assistantId,
          toolCallId
        });
      } catch (error) {
        ok = false;
        output = error instanceof Error ? error.message : String(error);
      }
    }
    await this.kernel?.provideToolResult({ runId, toolCallId, ok, output });
  }

  // ── 派生视图 ────────────────────────────────────────────────────────────

  private async viewFor(record: AgentRecord): Promise<AgentView> {
    return {
      profile: record.profile,
      settings: record.settings,
      runtime: await this.runtimeFor(record.profile.id, record.lastActivityAt)
    };
  }

  private async runtimeFor(id: string, lastActivityAt: number): Promise<AgentRuntimeView> {
    return {
      status: this.scheduler.isBusy(id) ? "running" : this.errored.has(id) ? "error" : "idle",
      unread: await this.store.isUnread(id),
      lastActivityAt
    };
  }

  /**
   * 只读模型活跃窗口。缺失的 tool result 由 assembleContext 纯投影修补，
   * 不追加回 JSONL：「推断为中断」不是真实发生的交互。
   */
  private readModelTranscript(id: string): Promise<{
    events: TranscriptEvent[];
    compact?: Extract<TranscriptEvent, { type: "compact" }>;
  }> {
    return this.store.readForAssemble(id);
  }

  private agentHasPending(id: string): boolean {
    return (this.pendingByAgent.get(id)?.size ?? 0) > 0;
  }

  private rememberPending(agentId: string, toolCallId: string, approval: ToolApproval): void {
    this.pendingTools.set(pendingKey(agentId, toolCallId), approval);
    const current = this.pendingByAgent.get(agentId) ?? new Set<string>();
    current.add(toolCallId);
    this.pendingByAgent.set(agentId, current);
  }

  private forgetPending(agentId: string, toolCallId: string): void {
    this.pendingTools.delete(pendingKey(agentId, toolCallId));
    const current = this.pendingByAgent.get(agentId);
    if (!current) return;
    current.delete(toolCallId);
    if (current.size === 0) this.pendingByAgent.delete(agentId);
  }

  private clearAgentPending(agentId: string): void {
    const current = this.pendingByAgent.get(agentId);
    if (current) {
      for (const toolCallId of current) this.pendingTools.delete(pendingKey(agentId, toolCallId));
    }
    this.pendingByAgent.delete(agentId);
  }

  /**
   * 把一次工具调用记进在写的 assistant 事件，然后收口。
   *
   * 必须对**每个**工具都做，不只是要审批的那些。否则转录里会留下一条没有对应
   * `tool_call` 的孤立 tool 结果 —— 下一轮 assemble 就会给 provider 发一条
   * 「凭空冒出来的 tool 消息」，OpenAI 兼容接口一律 400。而且不收口的话
   * assistant 事件会排在它自己的 tool 结果之后，顺序也是反的。
   *
   * 幂等：mutating 工具先走 pending 再走 started，同一个 toolCallId 只记一次。
   */
  private async recordToolCall(agentId: string, params: Record<string, any>): Promise<string> {
    const toolCallId = String(params.toolCallId ?? "");
    const recorded = this.recordedCalls.get(agentId) ?? new Set<string>();
    const origins = this.callOrigins.get(agentId) ?? new Map<string, string>();
    if (recorded.has(toolCallId)) {
      return origins.get(toolCallId) ?? String(params.messageId ?? toolCallId);
    }
    recorded.add(toolCallId);
    this.recordedCalls.set(agentId, recorded);

    const existing = this.buffers.get(agentId);
    const current = this.openBuffer(
      agentId,
      existing && !existing.flushed ? existing.messageId : crypto.randomUUID()
    );
    current.parts = appendAssistantToolCall(current.parts, {
      id: toolCallId,
      name: String(params.name),
      arguments: params.arguments ?? {}
    });
    origins.set(toolCallId, current.messageId);
    this.callOrigins.set(agentId, origins);
    this.buffers.set(agentId, current);
    await this.flushAssistant(agentId);
    return current.messageId;
  }

  private openBuffer(agentId: string, messageId: string) {
    const existing = this.buffers.get(agentId);
    if (existing && !existing.flushed && existing.messageId === messageId) return existing;
    return { messageId, parts: [] as AssistantPart[] };
  }

  private liveFor(id: string) {
    const buffer = this.buffers.get(id);
    if (!buffer || buffer.flushed) return null;
    return { messageId: buffer.messageId, parts: buffer.parts };
  }

  private async flushAssistant(agentId: string): Promise<void> {
    const buffer = this.buffers.get(agentId);
    if (!buffer || buffer.flushed) return;
    buffer.flushed = true;
    const event = await this.store.appendEvent(agentId, {
      type: "assistant",
      id: buffer.messageId,
      parts: buffer.parts,
      createdAt: Date.now()
    });
    this.emit(HostEvents.agentMessageCompleted, { agentId, event });
  }

  private async mark(id: string, status: "idle" | "error" | "cancelled"): Promise<void> {
    if (status === "error") this.errored.add(id);
    else this.errored.delete(id);
    const record = this.store.getAgent(id);
    if (!record) return;
    this.emit(HostEvents.agentUpdated, { agent: await this.viewFor(record) });
  }
}

/**
 * 把对方的事件渲染成一行给同伴看的话。给的是**投影**而不是原始事件：
 * 队友要知道那边说了什么、干了什么，不需要它的 thinking。
 */
function renderForPeer(event: TranscriptEvent, name: string): string[] {
  if (event.type === "user") return [`user: ${event.text}`];
  if (event.type === "wake") return [`${describeWake(event)}`];
  if (event.type === "message") return [`${name}: ${describeOutbound(event.payload)}`];
  if (event.type === "tool") {
    // 迁移期生成的补洞行和消息控制工具都不是对方聊天里的可见更新。
    if (event.id.startsWith("missing-tool-") || event.content === "Tool call was interrupted and did not return a result.") {
      return [];
    }
    if (event.name === "SendMessage" || event.name === "SendToAgent" || event.name === "ReadAgentTranscript") return [];
    return [`${name} ran ${event.name} → ${truncate(event.content, 200)}`];
  }
  if (event.type === "profile") return [`${name} changed its profile.`];
  if (event.type === "compact") return ["(earlier messages were summarized)"];
  // assistant 事件里只有草稿与 thinking，对同伴没有信息量，跳过。
  return [];
}

function truncate(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`;
}

/** 权限档位要进提示词，模型才知道自己会不会被审批卡拦。 */
function describePermission(permission: ToolPermission): string {
  if (permission === "always") {
    return "always allow local tool actions inside the hard local-execution boundary; protected host state and destructive commands remain blocked.";
  }
  if (permission === "never") return "never allow local tool actions outside pre-approved project and scratch paths.";
  return "ask before each new local action outside project and scratch; exact approvals can be remembered, and denials are not asked again.";
}

function sameApproval(left: ToolApproval, right: ToolApproval): boolean {
  return left.action === right.action && left.target === right.target;
}

function pendingKey(agentId: string, toolCallId: string): string {
  return `${agentId}\0${toolCallId}`;
}

function settleWithin(promise: Promise<void>, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    void promise.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
