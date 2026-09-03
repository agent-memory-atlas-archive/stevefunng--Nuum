import type { TranscriptEvent } from "@nuum/protocol";

/**
 * Agent 间唤醒的队列与护栏。
 *
 * 队列**只在内存**。不落 `inbox.jsonl` —— wake 事件已经写进对方 transcript
 * 了，文件队列只是重复记录同一件事。崩溃恢复靠扫 transcript 尾部：末条 `wake`
 * 之后没有任何 assistant / message 事件，就说明这次唤醒没被响应过，重放它。
 */

export interface QueuedWake {
  fromId: string;
  fromName: string;
  text: string;
  hops: number;
}

/** 唤醒最多传几手。用户唤醒是 0，agent 唤醒是 parent + 1。 */
export const MAX_HOPS = 3;
/** 同一有序对 (from, to) 每分钟最多几条。 */
export const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 60_000;
/** 一个 turn 最多建几个 agent。 */
export const MAX_CREATES_PER_RUN = 1;
/** 全局 agent 数上限。 */
export const MAX_AGENTS = 50;

/**
 * 从转录尾部认出「没被响应过的唤醒」，用于重启重放。
 *
 * 判据是末条 `wake` 之后没有任何 assistant / message 事件。只认 agent 唤醒：
 * 用户那条半截的 turn 不该在启动时被悄悄重跑 —— 用户就在跟前，自己会再发一遍。
 */
export function pendingWake(events: readonly TranscriptEvent[]): QueuedWake | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (event.type === "assistant" || event.type === "message") return null;
    if (event.type === "user") return null;
    if (event.type === "wake") {
      if (event.source.kind !== "agent") return null;
      return {
        fromId: event.source.fromId,
        fromName: event.source.fromName,
        text: event.text,
        hops: event.hops
      };
    }
  }
  return null;
}

/**
 * 这个 agent 当前的工作离用户有几手。
 *
 * 从转录派生，**不**从 run 的内存记账查。记账那条路要先拿 runId，而 runId 查
 * 不到时只能回落成 0 —— 那等于护栏失败时开门，方向正好错了。转录里的 `hops`
 * 是投递时写下的事实，重启也还在。
 */
export function currentHops(events: readonly TranscriptEvent[]): number {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (event.type === "user") return 0;
    if (event.type === "wake") return event.hops;
  }
  return 0;
}

export class WakeQueue {
  private readonly queued = new Map<string, QueuedWake[]>();
  private readonly rate = new Map<string, number[]>();
  private readonly creates = new Map<string, number>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /**
   * 护栏判定。拒绝**不静默** —— 原因作为工具结果回给调用方，让模型知道自己
   * 被限了，而不是以为发出去了（本地必须硬做，我们没有云端限流）。
   */
  check(fromId: string, toId: string, hops: number): { ok: true } | { ok: false; reason: string } {
    if (fromId === toId) {
      return { ok: false, reason: "That is you. Do the work yourself instead of messaging yourself." };
    }
    if (hops > MAX_HOPS) {
      return {
        ok: false,
        reason: `Refused: this message is already ${hops - 1} agents away from the user. Answer it yourself instead of passing it on.`
      };
    }
    const key = `${fromId}>${toId}`;
    const recent = (this.rate.get(key) ?? []).filter((at) => this.now() - at < RATE_WINDOW_MS);
    if (recent.length >= RATE_LIMIT) {
      return {
        ok: false,
        reason: `Refused: you have already sent ${RATE_LIMIT} messages to that agent this minute. Wait for it to answer.`
      };
    }
    recent.push(this.now());
    this.rate.set(key, recent);
    return { ok: true };
  }

  /** 目标忙时排队。 */
  enqueue(toId: string, wake: QueuedWake): void {
    const queue = this.queued.get(toId) ?? [];
    queue.push(wake);
    this.queued.set(toId, queue);
  }

  dequeue(toId: string): QueuedWake | undefined {
    const queue = this.queued.get(toId);
    if (!queue || queue.length === 0) return undefined;
    const next = queue.shift()!;
    if (queue.length === 0) this.queued.delete(toId);
    return next;
  }

  /** StopAgent 与删除 agent 都要把排着的唤醒一起丢掉。 */
  drop(toId: string): number {
    const dropped = this.queued.get(toId)?.length ?? 0;
    this.queued.delete(toId);
    return dropped;
  }

  depth(toId: string): number {
    return this.queued.get(toId)?.length ?? 0;
  }

  // ── 每 run 的账 ─────────────────────────────────────────────────────────

  closeRun(runId: string): void {
    this.creates.delete(runId);
  }

  /** CreateAgent 的单轮配额。免审批是刻意的，所以护栏得硬（§5.2）。 */
  claimCreate(runId: string | undefined): boolean {
    if (!runId) return true;
    const used = this.creates.get(runId) ?? 0;
    if (used >= MAX_CREATES_PER_RUN) return false;
    this.creates.set(runId, used + 1);
    return true;
  }
}
