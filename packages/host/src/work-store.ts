import { mkdir, open, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  EMPTY_WORK_CATALOG,
  HostErrorCode,
  RpcError,
  WorkCatalog,
  WorkEvent,
  WorkProfile,
  type WorkChatMessage,
  type WorkEventDraft,
  type WorkProjection,
  type WorkTask
} from "@nuum/protocol";

interface WorkRecord {
  profile: WorkProfile;
  lastSeq: number;
  lastActivityAt: number;
}

export class WorkStore {
  private readonly works = new Map<string, WorkRecord>();
  private readonly appendChains = new Map<string, Promise<unknown>>();

  constructor(readonly dataDir: string) {}

  async init(): Promise<void> {
    await mkdir(this.worksRoot(), { recursive: true });
    this.works.clear();
    for (const id of await readdir(this.worksRoot())) {
      const profile = await readJson(path.join(this.workDir(id), "profile.json"), WorkProfile);
      if (!profile) continue;
      await repairFinalLine(this.timelineFile(id));
      const events = await this.readTimeline(id);
      const tail = events.at(-1);
      this.works.set(id, {
        profile,
        lastSeq: tail?.seq ?? 0,
        lastActivityAt: Math.max(profile.createdAt, tail?.createdAt ?? 0)
      });
    }
  }

  private worksRoot(): string {
    return path.join(this.dataDir, "works");
  }

  workDir(id: string): string {
    return path.join(this.worksRoot(), id);
  }

  timelineFile(id: string): string {
    return path.join(this.workDir(id), "timeline.jsonl");
  }

  async createWork(profile: WorkProfile): Promise<WorkProfile> {
    if (this.works.has(profile.id)) throw new Error(`Work ${profile.id} already exists`);
    const parsed = WorkProfile.parse(profile);
    await mkdir(this.workDir(parsed.id), { recursive: true });
    await writeJsonAtomic(path.join(this.workDir(parsed.id), "profile.json"), parsed);
    await writeJsonAtomic(path.join(this.workDir(parsed.id), "catalog.json"), EMPTY_WORK_CATALOG);
    this.works.set(parsed.id, {
      profile: parsed,
      lastSeq: 0,
      lastActivityAt: parsed.createdAt
    });
    return parsed;
  }

  listWorks(): WorkProfile[] {
    return [...this.works.values()]
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .map((record) => record.profile);
  }

  getWork(id: string): WorkProfile {
    return this.requireWork(id).profile;
  }

  async updateWork(id: string, patch: Partial<Pick<WorkProfile, "name" | "description" | "projectRoot">>): Promise<WorkProfile> {
    const current = this.requireWork(id);
    const profile = WorkProfile.parse({ ...current.profile, ...patch, id: current.profile.id });
    await writeJsonAtomic(path.join(this.workDir(id), "profile.json"), profile);
    this.works.set(id, { ...current, profile });
    return profile;
  }

  requireWork(id: string): WorkRecord {
    const record = this.works.get(id);
    if (!record) throw new RpcError(HostErrorCode.WORK_NOT_FOUND, `Work ${id} not found`);
    return record;
  }

  async readCatalog(id: string): Promise<WorkCatalog> {
    this.requireWork(id);
    return (
      (await readJson(path.join(this.workDir(id), "catalog.json"), WorkCatalog)) ??
      structuredClone(EMPTY_WORK_CATALOG)
    );
  }

  updateCatalog(
    id: string,
    expectedRevision: number,
    update: (catalog: WorkCatalog) => WorkCatalog
  ): Promise<WorkCatalog> {
    return this.chain(id, async () => {
      const current = await this.readCatalog(id);
      if (current.revision !== expectedRevision) {
        throw new RpcError(
          HostErrorCode.WORK_CONFLICT,
          `Work catalog revision is ${current.revision}, expected ${expectedRevision}`
        );
      }
      const next = WorkCatalog.parse(update(structuredClone(current)));
      if (next.revision !== current.revision + 1) {
        throw new Error("Catalog update must advance revision by one");
      }
      await writeJsonAtomic(path.join(this.workDir(id), "catalog.json"), next);
      return next;
    });
  }

  appendEvent(id: string, draft: WorkEventDraft): Promise<WorkEvent> {
    return this.chain(id, async () => {
      const record = this.requireWork(id);
      if (draft.workId !== id) throw new Error(`Work event ${draft.id} belongs to ${draft.workId}, not ${id}`);
      const event = WorkEvent.parse({ ...draft, seq: record.lastSeq + 1 });
      await mkdir(this.workDir(id), { recursive: true });
      const handle = await open(this.timelineFile(id), "a");
      try {
        await handle.writeFile(`${JSON.stringify(event)}\n`);
      } finally {
        await handle.close();
      }
      this.works.set(id, {
        ...record,
        lastSeq: event.seq,
        lastActivityAt: Math.max(record.lastActivityAt, event.createdAt)
      });
      return event;
    });
  }

  async readTimeline(id: string): Promise<WorkEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.timelineFile(id), "utf8");
    } catch {
      return [];
    }
    const events: WorkEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const parsed = parseWorkEvent(line);
      if (parsed) events.push(parsed);
    }
    return events;
  }

  /** 侧栏摘要：work 的最近动态时间与最近一条群聊消息。work 数量少，整读即可。 */
  async readActivity(id: string): Promise<{ lastActivityAt: number; preview?: string }> {
    let lastActivityAt = 0;
    let preview: string | undefined;
    for (const event of await this.readTimeline(id)) {
      lastActivityAt = Math.max(lastActivityAt, event.createdAt);
      if (event.type === "chat.posted") {
        const text = event.body.replace(/\s+/g, " ").trim().slice(0, 160);
        if (text) preview = text;
      }
    }
    return { lastActivityAt, ...(preview ? { preview } : {}) };
  }

  private chain<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = this.appendChains.get(id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(work);
    this.appendChains.set(id, current.then(() => undefined, () => undefined));
    return current;
  }
}

/** Work timeline 是唯一事实；任务轨道和公共聊天室都只是它的 fold。 */
export function projectWork(events: WorkEvent[]): WorkProjection {
  const tasks = new Map<string, WorkTask>();
  const chat: WorkChatMessage[] = [];

  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.type === "chat.posted") {
      chat.push(event);
      continue;
    }
    if (event.type === "task.created") {
      if (!tasks.has(event.task.id)) tasks.set(event.task.id, structuredClone(event.task));
      continue;
    }
    if (event.type === "task.assigned") {
      const task = tasks.get(event.taskId);
      if (!task || event.revision <= task.revision) continue;
      tasks.set(event.taskId, {
        ...task,
        assigneeIds: [...event.assigneeIds],
        revision: event.revision,
        updatedAt: event.createdAt
      });
      continue;
    }
    if (event.type === "task.transitioned") {
      const task = tasks.get(event.taskId);
      if (!task || task.state !== event.from || event.revision <= task.revision) continue;
      const { blocker: _previousBlocker, ...withoutBlocker } = task;
      tasks.set(event.taskId, {
        ...withoutBlocker,
        state: event.to,
        revision: event.revision,
        updatedAt: event.createdAt,
        ...(event.to === "blocked" && event.blocker
          ? { blocker: { ...event.blocker, createdAt: event.createdAt } }
          : {})
      });
      continue;
    }
    if (event.type === "task.handed_off") {
      const task = tasks.get(event.taskId);
      if (!task || event.revision <= task.revision) continue;
      const { blocker: _previousBlocker, ...withoutBlocker } = task;
      tasks.set(event.taskId, {
        ...withoutBlocker,
        state: event.nextStatus,
        revision: event.revision,
        deliverables: [...task.deliverables, ...event.deliverables],
        updatedAt: event.createdAt,
        ...(event.nextStatus === "blocked" && event.blockerReason
          ? { blocker: { reason: event.blockerReason, ownerId: event.actor.kind === "agent" ? event.actor.id : undefined, createdAt: event.createdAt } }
          : {})
      });
    }
  }

  return { tasks: [...tasks.values()], chat };
}

function parseWorkEvent(line: string): WorkEvent | null {
  try {
    return WorkEvent.parse(JSON.parse(line));
  } catch {
    return null;
  }
}

async function repairFinalLine(file: string): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return;
  }
  if (!raw || raw.endsWith("\n")) return;
  const lastBreak = raw.lastIndexOf("\n");
  const tail = raw.slice(lastBreak + 1);
  const repaired = parseWorkEvent(tail) ? `${raw}\n` : raw.slice(0, lastBreak + 1);
  await writeFile(file, repaired);
}

async function readJson<T>(
  file: string,
  schema: { parse(value: unknown): T }
): Promise<T | null> {
  try {
    return schema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return null;
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}
