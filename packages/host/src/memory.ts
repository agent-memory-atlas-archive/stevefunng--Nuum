import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Agent 级记忆使用可直接被模型 `read` / `grep` 的 Markdown，而不是数据库。
 * `memory/profile.md` 放常驻事实，`memory/log/YYYY-MM.md` 放带日期的事实。
 *
 * 记忆真源只有这些文件。**不加 `memory` 事件** —— 那就是第二真源；
 * `update_state` 的调用痕迹已经在 `tool` 事件里了（§4）。
 */

export type MemoryTier = "profile" | "log" | "note";

export interface MemoryFact {
  fact: string;
  tier: MemoryTier;
  /** log / note 才有日期；profile 是常驻的，没有。 */
  day?: string;
}

/** profile 段的条数上限，对齐 §8「profile 全量到 100 条上限」。 */
const PROFILE_LIMIT = 100;
/** log 段的字符预算。 */
const RECALL_BUDGET = 4000;
/** 近期度的半衰期（天）。 */
const HALF_LIFE_DAYS = 30;

const FACTS_HEADING = "## Facts";
const NOTES_HEADING = "## Notes";

export class MemoryStore {
  constructor(private readonly memoryDir: string) {}

  get dir(): string {
    return this.memoryDir;
  }

  get profilePath(): string {
    return path.join(this.memoryDir, "profile.md");
  }

  logPath(day: Date): string {
    return path.join(this.memoryDir, "log", `${monthKey(day)}.md`);
  }

  /**
   * 写一条事实。归一化 + 去重，重复写同一条只是幂等（对齐
   * `normalizeMemoryContent` / `memoryDedupeKey`）。
   */
  async write(fact: string, tier: MemoryTier, now = new Date()): Promise<{ written: boolean }> {
    const text = normalize(fact);
    if (text.length === 0) return { written: false };
    const existing = await this.all();
    if (existing.some((entry) => dedupeKey(entry.fact) === dedupeKey(text))) {
      return { written: false };
    }
    if (tier === "profile") {
      const lines = await readLines(this.profilePath);
      const body = lines.length > 0 ? lines : ["# Standing facts", ""];
      body.push(`- ${text}`);
      await writeFileEnsured(this.profilePath, `${body.join("\n").trimEnd()}\n`);
      return { written: true };
    }
    const file = this.logPath(now);
    const lines = await readLines(file);
    const body = lines.length > 0 ? lines : [`# ${monthKey(now)}`, "", FACTS_HEADING, "", NOTES_HEADING, ""];
    const heading = tier === "note" ? NOTES_HEADING : FACTS_HEADING;
    const at = body.indexOf(heading);
    const entry = `- ${dayKey(now)} · ${text}`;
    if (at < 0) {
      body.push("", heading, "", entry);
    } else {
      // 插在该小节的最后一行之后，保持时间顺序。
      let insert = at + 1;
      while (insert < body.length && !body[insert]!.startsWith("## ")) insert += 1;
      body.splice(insert, 0, entry);
    }
    await writeFileEnsured(file, `${body.join("\n").trimEnd()}\n`);
    return { written: true };
  }

  /** 按归一化后的内容删除，不管它写在哪个文件的哪一节。 */
  async forget(fact: string): Promise<{ removed: number }> {
    const target = dedupeKey(normalize(fact));
    if (target.length === 0) return { removed: 0 };
    let removed = 0;
    for (const file of await this.files()) {
      const lines = await readLines(file);
      const kept = lines.filter((line) => {
        const parsed = parseLine(line);
        if (!parsed || dedupeKey(parsed.fact) !== target) return true;
        removed += 1;
        return false;
      });
      if (removed > 0) await writeFileEnsured(file, `${kept.join("\n").trimEnd()}\n`);
    }
    return { removed };
  }

  async all(): Promise<MemoryFact[]> {
    const out: MemoryFact[] = [];
    for (const line of await readLines(this.profilePath)) {
      const parsed = parseLine(line);
      if (parsed) out.push({ fact: parsed.fact, tier: "profile" });
    }
    const logDir = path.join(this.memoryDir, "log");
    for (const name of await listMonthFiles(logDir)) {
      let tier: MemoryTier = "log";
      for (const line of await readLines(path.join(logDir, name))) {
        if (line.startsWith("## ")) {
          tier = line.trim() === NOTES_HEADING ? "note" : "log";
          continue;
        }
        const parsed = parseLine(line);
        if (parsed) out.push({ fact: parsed.fact, tier, day: parsed.day });
      }
    }
    return out;
  }

  private async files(): Promise<string[]> {
    const logDir = path.join(this.memoryDir, "log");
    const months = await listMonthFiles(logDir);
    return [this.profilePath, ...months.map((name) => path.join(logDir, name))];
  }
}

/**
 * 渲染 system prompt 的第 6 段。profile 事实全量到上限，log / note 按
 * rank 排序后按字符预算截断，末尾告诉模型剩下的在磁盘上、去哪 grep。
 */
export function renderMemory(facts: readonly MemoryFact[], memoryDir: string, now = new Date()): string {
  const standing = facts.filter((entry) => entry.tier === "profile").slice(0, PROFILE_LIMIT);
  const dated = facts
    .filter((entry) => entry.tier !== "profile")
    .sort((a, b) => recallRank(b, now) - recallRank(a, now));

  const kept: MemoryFact[] = [];
  let budget = RECALL_BUDGET;
  for (const entry of dated) {
    const cost = entry.fact.length + 16;
    if (cost > budget) break;
    budget -= cost;
    kept.push(entry);
  }
  // 截断后按时间读起来才顺，排序只用来决定「留谁」。
  kept.sort((a, b) => (a.day ?? "").localeCompare(b.day ?? ""));

  const lines = ["## Memory", ""];
  if (standing.length === 0 && kept.length === 0) {
    lines.push("You have not recorded anything about this user yet.");
  }
  if (standing.length > 0) {
    lines.push("What you know about this user and your work together:", "");
    for (const entry of standing) lines.push(`- ${entry.fact}`);
    lines.push("");
  }
  if (kept.length > 0) {
    lines.push("Recent:", "");
    for (const entry of kept) lines.push(`- ${entry.day} · ${entry.fact}`);
    lines.push("");
  }
  const hidden = dated.length - kept.length;
  if (hidden > 0) {
    lines.push(`${hidden} older entries did not fit here. They are on disk — grep them.`, "");
  }
  lines.push(
    `Your memory lives in ${memoryDir} as Markdown: profile.md for standing`,
    "facts, log/YYYY-MM.md for dated ones. Read or grep them directly when you",
    "need more than the above.",
    "",
    "Record something with update_state when it will still matter in a later",
    "conversation — a preference, a decision, a name, how this project works.",
    "Do not record what you can read off disk again."
  );
  return lines.join("\n").trimEnd();
}

/**
 * `log2(importance) + 近期度`（§2.Q4）。importance 由 tier 给：log 是模型
 * 判定为事实的，note 是旁注。这样文件里不必埋一个只有程序看得懂的权重字段，
 * 而 tier 本来就要写在文件里给人和模型看。
 */
export function recallRank(entry: MemoryFact, now: Date): number {
  const importance = entry.tier === "note" ? 1 : 2;
  const ageDays = entry.day ? (now.getTime() - Date.parse(`${entry.day}T00:00:00Z`)) / 86_400_000 : 0;
  return Math.log2(importance) - Math.max(0, ageDays) / HALF_LIFE_DAYS;
}

/**
 * 值不值得自动抽取（对齐 `isMemorableExchange`）。「谢谢」「好的」这类客套
 * 不该每轮都去调一次模型。
 */
const SMALL_TALK = new Set([
  "thanks",
  "thank you",
  "ok",
  "okay",
  "sure",
  "yes",
  "no",
  "got it",
  "nice",
  "cool",
  "谢谢",
  "好的",
  "好",
  "行",
  "嗯",
  "收到"
]);

export function isMemorableExchange(userText: string): boolean {
  const text = userText.trim();
  if (text.length === 0) return false;
  if (SMALL_TALK.has(text.toLowerCase().replace(/[.!?。！？]+$/, ""))) return false;
  return estimateTokens(text) > 10 || text.includes("?") || text.includes("？");
}

/**
 * 门槛按 token 粗估而不是字符数，避免英文字符阈值误伤中文短句：
 * 一句 30 字的中文远比 30 字的英文说得多，按字符数量会被判成客套话漏掉。
 * CJK 约一字一 token，拉丁约四字一 token。
 */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? []).length;
  return cjk + Math.ceil((text.length - cjk) / 4);
}

export const EXTRACTION_PROMPT = [
  "You extract durable facts from one exchange between a user and their agent.",
  "",
  "Emit one line per fact, each prefixed by its tier:",
  "",
  "  profile: <a standing fact — a preference, a name, how this project works>",
  "  log: <a dated fact — a decision made, a thing done, a problem found>",
  "  note: <a minor observation worth keeping but not important>",
  "  remove: <a previously recorded fact that this exchange contradicts>",
  "",
  "Rules:",
  "- Each line must stand alone. A reader with no other context must understand",
  "  it, so no pronouns pointing outside the line and no 'as discussed'.",
  "- Only what will still matter in a later conversation. Nothing that can be",
  "  read off disk again, nothing about this exchange's mechanics.",
  "- Most exchanges yield nothing. Emitting no lines at all is the common and",
  "  correct answer. Do not pad.",
  "- No preamble, no explanation, no blank lines. Just the prefixed lines."
].join("\n");

export interface ExtractedMemory {
  writes: { fact: string; tier: MemoryTier }[];
  removals: string[];
}

export function parseExtraction(raw: string): ExtractedMemory {
  const writes: { fact: string; tier: MemoryTier }[] = [];
  const removals: string[] = [];
  for (const line of raw.split("\n")) {
    const match = /^\s*(profile|log|note|remove)\s*:\s*(.+)$/i.exec(line);
    if (!match) continue;
    const kind = match[1]!.toLowerCase();
    const fact = normalize(match[2]!);
    if (fact.length === 0) continue;
    if (kind === "remove") removals.push(fact);
    else writes.push({ fact, tier: kind as MemoryTier });
  }
  return { writes, removals };
}

/** 归一化：折叠空白、去掉包裹的 markdown 列表符号与尾部句号。 */
export function normalize(fact: string): string {
  return fact
    .replace(/\s+/g, " ")
    .replace(/^[-*•]\s*/, "")
    .trim()
    .replace(/\s*[.。]$/, "");
}

/** 去重键：大小写与标点不算区别。 */
export function dedupeKey(fact: string): string {
  return normalize(fact)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLine(line: string): { fact: string; day?: string } | null {
  const match = /^\s*-\s+(.*)$/.exec(line);
  if (!match) return null;
  const body = match[1]!.trim();
  if (body.length === 0) return null;
  const dated = /^(\d{4}-\d{2}-\d{2})\s+·\s+(.*)$/.exec(body);
  if (dated) return { day: dated[1]!, fact: dated[2]!.trim() };
  return { fact: body };
}

async function readLines(file: string): Promise<string[]> {
  try {
    const raw = await readFile(file, "utf8");
    return raw.split("\n");
  } catch {
    return [];
  }
}

async function listMonthFiles(logDir: string): Promise<string[]> {
  try {
    const entries = await readdir(logDir);
    return entries.filter((name) => /^\d{4}-\d{2}\.md$/.test(name)).sort();
  } catch {
    return [];
  }
}

async function writeFileEnsured(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}

function monthKey(day: Date): string {
  return day.toISOString().slice(0, 7);
}

function dayKey(day: Date): string {
  return day.toISOString().slice(0, 10);
}
