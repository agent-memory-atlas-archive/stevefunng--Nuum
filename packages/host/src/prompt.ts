/**
 * 分段 system prompt。段落之间用空行拼接、段内使用 Markdown 标题，
 * 保持稳定前缀以便命中 provider cache。
 */

export interface AgentIdentity {
  name: string;
  description: string;
  tags?: string[];
}

export interface PromptPaths {
  /** profile.json 的本机绝对路径，写进提示词让模型能自己读。 */
  profile: string;
  settings: string;
  agentDir: string;
  scratchDir: string;
}

export interface PromptEnvironment {
  os: string;
  now: Date;
  timeZone: string;
  /** 该 agent 的项目目录，没设就是 null。 */
  projectRoot: string | null;
  /** 当前权限档位的人话描述 —— 模型得知道自己会不会被审批卡拦。 */
  permission: string;
}

export interface SystemPromptInput {
  identity: AgentIdentity;
  paths: PromptPaths;
  environment: PromptEnvironment;
  /**
   * 按 epoch 冻结的 profile 段。给了就照用，不按 identity 重渲染 ——
   * 为的是让 system prompt 前缀逐字节稳定，命中 provider 的 prefix cache。
   */
  frozenProfile?: string;
  /** 第 6 段：记忆。同样按 epoch 冻结。 */
  memory?: string;
  /** 第 7 段：队友名录。 */
  agentDirectory?: string;
  /** 当前运行领域的对外沟通协议。 */
  communication?: string;
  /** 第 8 段：上文被压缩过的说明。 */
  compactNotice?: string;
}

export interface SystemPromptRender {
  text: string;
  segments: { id: string; text: string }[];
  /** 本轮按 identity 渲染出的 profile 段，供调用方冻结落盘。 */
  liveProfile: string;
}

const IDENTITY = [
  "You are Nuum, a local agent running on the user's own Mac.",
  "",
  "You work on that machine directly: real files, real shell, real state.",
  "There is no scratch copy to undo, so read before you write and prefer the",
  "smallest change that does the job.",
  "",
  "Be concise. Answer what was asked, lead with the outcome, and skip",
  "preamble. When you are unsure, say so and check rather than guess."
].join("\n");

const TOOL_GUIDANCE = [
  "## Tools",
  "",
  "- Prefer reading the real thing over recalling it. A file you have not",
  "  opened this turn is a guess.",
  "- File and command actions outside your project and scratch follow the",
  "  permission level named above. In ask mode, a new exact action raises an",
  "  approval card and waits; remembered approval never covers a parent path.",
  "- The local execution root, protected host files, other agents' writable",
  "  state, and destructive-command guard are hard limits no approval bypasses.",
  "- A denial is an answer. Adapt or ask; do not resubmit the same call and",
  "  do not look for a way around the check.",
  "- shell is persistent for this agent: cd and exported variables survive",
  "  later calls. A slow command moves to the background instead of being",
  "  killed; inspect its returned shell_id and read the output file for full logs.",
  "- Give absolute paths unless a tool says otherwise. A relative path is",
  "  resolved against the project directory for file tools; shell uses its",
  "  own current directory, which can persist after cd."
].join("\n");

const SEND_MESSAGE = [
  "## Talking to the user",
  "",
  "SendMessage is your only voice. Plain text you write is a scratchpad the",
  "user never sees — if you answer without calling SendMessage, from their",
  "side you said nothing at all.",
  "",
  "- Call it as soon as you have something worth saying, not only at the end.",
  "  On a long task, one message up front beats silence.",
  "- One thought per call. Do not batch a whole session into a final wall of",
  "  text.",
  "- The user cannot see your tool calls or their output. Say what came of",
  "  them in your own words."
].join("\n");

export function renderSystemPrompt(input: SystemPromptInput): SystemPromptRender {
  const liveProfile = renderProfile(input.identity, input.paths);
  const segments = [
    { id: "identity", text: IDENTITY },
    { id: "agent-profile", text: input.frozenProfile ?? liveProfile },
    { id: "environment", text: renderEnvironment(input.environment, input.paths) },
    { id: "tool-guidance", text: TOOL_GUIDANCE },
    { id: "send-message", text: input.communication ?? SEND_MESSAGE },
    { id: "memory", text: input.memory ?? "" },
    { id: "agent-directory", text: input.agentDirectory ?? "" },
    { id: "compact-notice", text: input.compactNotice ?? "" }
  ].filter((segment): segment is { id: string; text: string } => segment.text.length > 0);
  return { text: segments.map((segment) => segment.text).join("\n\n"), segments, liveProfile };
}

/**
 * profile 段被冻结在某个 epoch 上，所以用户中途改名后系统段仍是旧名字。
 * 这里不 bump epoch（那会为一次改名
 * 作废整个前缀缓存），而是在上下文尾部补一条飘移说明。前缀因此保持稳定，模型
 * 又能当轮就知道自己改名了。
 */
/**
 * 第 7 段：队友名录（对齐 `renderAgentDirectorySystemPrompt`，删掉 group）。
 *
 * 这一段不按 epoch 冻结，但它是**确定的**：条目按 createdAt 排序，agent 集合
 * 不变时逐字节相同。和 `environment` 里的时钟不一样 —— 那个每轮必变，这个只在
 * 真的多了 / 改了队友时才变，那时候本来就该让模型知道。
 *
 * 没有 `ListAgents` 工具是刻意的（§5.2）：名录直接进提示词，比每次花一次工具
 * 往返列名单省；要更全的信息就自己去 `read` 那些 profile.json。
 */
export function renderAgentDirectory(
  self: string,
  teammates: readonly { id: string; name: string; description: string; tags?: string[] }[],
  agentsRoot: string
): string {
  const lines = ["## Your teammates", ""];
  if (teammates.length === 0) {
    lines.push(
      "You are the only agent right now. CreateAgent makes a new teammate with",
      "its own chat, persona, and memory — worth doing for a standing role, not",
      "for a one-off task you could just do yourself."
    );
  } else {
    for (const mate of teammates) {
      lines.push(`- ${mate.name} (id ${mate.id})${mate.description ? ` — ${mate.description}` : ""}`);
      if (mate.tags?.length) lines.push(`  Tags: ${mate.tags.join(", ")}`);
    }
    lines.push(
      "",
      "SendToAgent messages a teammate asynchronously, like texting. The call",
      "returns as soon as delivery succeeds. If that teammate later replies with",
      "SendToAgent, its message will arrive here and wake you. Do not busy-poll",
      "ReadAgentTranscript; use it only when you explicitly need to inspect a",
      "teammate's visible history without asking them a new question.",
      "",
      "They cannot see this conversation. Say everything the message needs."
    );
  }
  lines.push(
    "",
    `Every agent's profile.json lives under ${agentsRoot}. Read them when you`,
    "need more than the lines above.",
    `Your own id is ${self}.`
  );
  return lines.join("\n");
}

export function profileDriftNotice(frozen: AgentIdentity, live: AgentIdentity): string | null {
  if (frozen.name === live.name && frozen.description === live.description && JSON.stringify(frozen.tags ?? []) === JSON.stringify(live.tags ?? [])) return null;
  return [
    "<agent_profile_update>",
    "Your agent profile changed. The Agent profile section above is a frozen",
    "snapshot and still shows the old values; these are the current ones.",
    `Current name: ${live.name || "(no name)"}`,
    `Current description: ${live.description || "(no description)"}`,
    `Current tags: ${live.tags?.join(", ") || "(no tags)"}`,
    "Use this identity until a future conversation summary folds it into that",
    "section.",
    "</agent_profile_update>"
  ].join("\n");
}

export function renderCompactNotice(transcriptFile: string): string {
  return [
    "## Earlier context",
    "",
    "Earlier conversation was summarized to fit the model context window.",
    `The original events remain unchanged in ${transcriptFile}`,
    "Use read or grep on that file if an exact historical detail matters."
  ].join("\n");
}

function renderProfile(identity: AgentIdentity, paths: PromptPaths): string {
  const name = identity.name.trim();
  const description = identity.description.trim();
  const lines = ["## Agent profile", ""];
  if (name.length > 0) {
    lines.push(`Title: ${name}`);
    lines.push(`Your agent name is "${name}". If the user asks for your name, answer with "${name}".`);
  }
  if (description.length > 0) lines.push(`Description: ${description}`);
  if (identity.tags?.length) lines.push(`Tags: ${identity.tags.join(", ")}`);
  lines.push("");
  // 插了变长路径的句子不预先折行 —— 路径一长，硬换行的位置就会断得莫名其妙。
  lines.push(
    `Your profile is a JSON config file with "name", "tags" and "description" fields at ${paths.profile}`,
    `Your per-agent settings are at ${paths.settings}`,
    "Both are readable with your file tools.",
    "",
    "Rewrite your own name, tags or description with update_state target=profile when",
    "the user asks you to become something else, or when what you actually do",
    "has drifted from what your description claims. Do not edit those files by",
    "hand — the app is their only writer."
  );
  return lines.join("\n");
}

function renderEnvironment(environment: PromptEnvironment, paths: PromptPaths): string {
  const lines = [
    "## Environment",
    "",
    `OS: ${environment.os}`,
    // 只到日期粒度。带上时分秒的话每一轮 system prompt 都不一样，前缀缓存
    // 一次都命中不了；要精确时间让模型自己去 shell 里看。
    `Today's date: ${formatDate(environment.now, environment.timeZone)}`,
    `Time zone: ${environment.timeZone}`,
    "",
    environment.projectRoot
      ? `Your project directory: ${environment.projectRoot}`
      : "You have no project directory. Ask the user where to work before touching files outside your own directories.",
    `Your agent directory: ${paths.agentDir}`,
    `Your scratch directory: ${paths.scratchDir}`,
    "Use scratch for intermediate files, downloads, and notes.",
    "",
    `Tool permission: ${environment.permission}`
  ];
  return lines.join("\n");
}

/**
 * `Thursday Sep 3, 2026`，无时分秒。
 * 自己拼分隔符而不是直接用 `format()`，免得输出随 ICU 版本变样。
 */
function formatDate(now: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric"
    }).formatToParts(now);
    const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
    return `${pick("weekday")} ${pick("month")} ${pick("day")}, ${pick("year")}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
