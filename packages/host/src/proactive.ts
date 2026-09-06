import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { ProactiveActivity, ProactivePolicy, type ModelRef, type ProactiveAgentSnapshot, type ProactiveConfigureParams, type ProactiveSnapshot } from "@nuum/protocol";
import type { AgentRecord, AgentStore } from "./agent-store.js";

/** Host-owned adapters are explicitly registered; Desktop never supplies executable collectors. */
export interface ProactiveContextSource {
  id: string;
  collect(agentId: string, signal: AbortSignal): Promise<string[]>;
}

export class ProactiveService {
  private sources = new Map<string, ProactiveContextSource>();
  private active = new Map<string, AbortController>();
  private lastCheck = new Map<string, number>();
  private errors = new Set<string>();
  private history = new Map<string, ProactiveActivity[]>();
  private controls: Promise<unknown> = Promise.resolve();
  private jobs = new Map<string, Promise<ProactiveSnapshot>>();
  private activityWrites = new Map<string, Promise<void>>();
  private historyLoads = new Map<string, Promise<ProactiveActivity[]>>();
  private timer?: ReturnType<typeof setInterval>;
  private disposed = false;
  private observed = new Map<string, string>();

  constructor(private store: AgentStore, private model: () => ModelRef,
    private changed: (agentId?: string) => void, private now = () => Date.now()) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, 1000);
    this.timer.unref();
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    clearInterval(this.timer);
    for (const controller of this.active.values()) controller.abort();
    await Promise.allSettled([this.controls, ...this.jobs.values(), ...this.activityWrites.values()]);
  }
  registerSource(source: ProactiveContextSource): void {
    if (this.sources.has(source.id)) throw new Error(`Duplicate proactive source: ${source.id}`);
    this.sources.set(source.id, source);
  }
  private defaultAgent(): AgentRecord | undefined {
    return this.store.listAgents().find((record) => record.settings.proactive?.isDefault);
  }
  private policy(record: AgentRecord): ProactivePolicy {
    return record.settings.proactive ?? ProactivePolicy.parse({ revision: 0 });
  }
  private state(record: AgentRecord): ProactiveAgentSnapshot["state"] {
    const policy = this.policy(record);
    if (!policy.enabled) return "disabled";
    if (policy.pausedUntil && policy.pausedUntil > this.now()) return "paused";
    if (this.active.has(record.profile.id)) return "checking";
    if (this.errors.has(record.profile.id)) return "error";
    return policy.sourceIds.length && policy.sourceIds.every((id) => this.sources.has(id)) ? "ready" : "waiting-context";
  }
  async snapshot(): Promise<ProactiveSnapshot> {
    const records = this.store.listAgents().filter((agent) => agent.settings.proactive);
    return {
      defaultAgentId: this.defaultAgent()?.profile.id ?? null,
      availableSourceIds: [...this.sources.keys()], actionsAvailable: false,
      agents: await Promise.all(records.map(async (record) => ({ agentId: record.profile.id, name: record.profile.name,
        policy: this.policy(record), state: this.state(record), activity: await this.readActivity(record.profile.id) })))
    };
  }
  configure(params: ProactiveConfigureParams): Promise<ProactiveSnapshot> {
    const task = this.controls.then(async () => {
      if (this.disposed) throw new Error("Proactive service stopped");
      for (const id of params.sourceIds ?? []) if (!this.sources.has(id)) throw new Error(`Unknown proactive source: ${id}`);
      let record = params.agentId ? this.store.requireAgent(params.agentId) : this.defaultAgent();
      if (!record) {
        if (params.expectedRevision !== 0) throw new Error("Proactive policy revision conflict");
        record = await this.store.createAgent({ id: crypto.randomUUID(), name: "Nu-nu", description: "", tags: ["proactive"], avatarColor: "purple", createdAt: this.now() }, {
          model: this.model(), workspace: { projectRoot: null, toolPermission: "ask" },
          proactive: ProactivePolicy.parse({ revision: 0, isDefault: true })
        });
      }
      const previous = this.policy(record);
      if (previous.revision !== params.expectedRevision) throw new Error("Proactive policy revision conflict");
      const policy = ProactivePolicy.parse({ ...previous, ...params, revision: previous.revision + 1,
        pausedUntil: params.enabled === false ? null : params.pausedUntil === undefined ? previous.pausedUntil : params.pausedUntil });
      this.active.get(record.profile.id)?.abort();
      await this.store.updateAgent(record.profile.id, { settings: { proactive: policy } });
      this.errors.delete(record.profile.id);
      const kind: ProactiveActivity["kind"] = !policy.enabled ? "disabled" : !previous.enabled ? "enabled"
        : policy.pausedUntil && policy.pausedUntil > this.now() ? "paused" : previous.pausedUntil ? "resumed" : "configured";
      await this.record(record.profile.id, kind);
      this.changed(record.profile.id);
      return this.snapshot();
    });
    this.controls = task.catch(() => undefined);
    return task;
  }
  async check(agentId: string): Promise<ProactiveSnapshot> {
    const record = this.store.requireAgent(agentId);
    const policy = this.policy(record);
    if (!policy.enabled) throw new Error("Proactive mode disabled");
    if (policy.pausedUntil && policy.pausedUntil > this.now()) throw new Error("Proactive mode paused");
    if (this.disposed) throw new Error("Proactive service stopped");
    // Repeated requests are normal UI input: share the running check or return its recent snapshot.
    const existing = this.jobs.get(agentId);
    if (existing) return existing;
    if (this.now() - (this.lastCheck.get(agentId) ?? -Infinity) < 5000) return this.snapshot();
    const task = this.performCheck(agentId).finally(() => this.jobs.delete(agentId));
    this.jobs.set(agentId, task);
    return task;
  }
  private async performCheck(agentId: string): Promise<ProactiveSnapshot> {
    const record = this.store.requireAgent(agentId);
    const policy = this.policy(record);
    const controller = new AbortController();
    this.active.set(agentId, controller);
    this.lastCheck.set(agentId, this.now());
    this.changed();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 10_000);
    try {
      const sources = policy.sourceIds.flatMap((id) => this.sources.get(id) ?? []);
      if (!sources.length || sources.length !== policy.sourceIds.length) await this.record(agentId, "waiting-context");
      else {
        const aborted = new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
        });
        const refs = await Promise.race([Promise.all(sources.map((source) => source.collect(agentId, controller.signal))).then((groups) => groups.flat()), aborted]);
        const current = this.store.getAgent(agentId);
        if (controller.signal.aborted || this.disposed || current?.settings.proactive?.revision !== policy.revision) return this.snapshot();
        // This foundation stops at context references. No model run or action execution is wired yet.
        await this.record(agentId, refs.length ? "context-ready" : "no-change", [...new Set(refs)].slice(0, 100));
      }
      this.errors.delete(agentId);
    } catch {
      if (!this.disposed && (!controller.signal.aborted || timedOut) && this.store.getAgent(agentId)?.settings.proactive?.revision === policy.revision) {
        this.errors.add(agentId);
        await this.record(agentId, "error");
      }
    } finally {
      clearTimeout(timeout);
      this.active.delete(agentId);
      if (!this.disposed) this.changed();
    }
    return this.snapshot();
  }
  async forget(agentId: string): Promise<void> {
    this.active.get(agentId)?.abort();
    await Promise.allSettled([this.jobs.get(agentId), this.activityWrites.get(agentId)]);
    this.history.delete(agentId); this.lastCheck.delete(agentId); this.errors.delete(agentId); this.observed.delete(agentId);
    this.historyLoads.delete(agentId); this.activityWrites.delete(agentId);
  }
  private async tick(): Promise<void> {
    if (this.disposed) return;
    for (const record of this.store.listAgents()) {
      if (!record.settings.proactive) continue;
      const state = this.state(record), id = record.profile.id;
      if (this.observed.get(id) !== state) { this.observed.set(id, state); this.changed(); }
      if ((state === "ready" || state === "error") && this.now() - (this.lastCheck.get(id) ?? 0) >= this.policy(record).intervalMs) {
        void this.check(id).catch(() => undefined);
      }
    }
  }
  private async readActivity(id: string): Promise<ProactiveActivity[]> {
    if (this.history.has(id)) return this.history.get(id)!;
    if (!this.historyLoads.has(id)) {
      const file = path.join(this.store.agentDir(id), "proactive-activity.json");
      this.historyLoads.set(id, readFile(file, "utf8").then((raw) => ProactiveActivity.array().parse(JSON.parse(raw))).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }).then((items) => { this.history.set(id, items.slice(0, 50)); return this.history.get(id)!; }));
    }
    return this.historyLoads.get(id)!;
  }
  private record(id: string, kind: ProactiveActivity["kind"], contextRefs: string[] = []): Promise<void> {
    const task = (this.activityWrites.get(id) ?? Promise.resolve()).then(async () => {
      const items = [{ id: crypto.randomUUID(), at: this.now(), kind, contextRefs }, ...await this.readActivity(id)].slice(0, 50);
      const file = path.join(this.store.agentDir(id), "proactive-activity.json");
      const temp = `${file}.${crypto.randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(items));
      await rename(temp, file);
      this.history.set(id, items);
    });
    this.activityWrites.set(id, task.catch(() => undefined));
    return task;
  }
}
