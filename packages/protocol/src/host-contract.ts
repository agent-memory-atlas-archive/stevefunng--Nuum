import { z } from "zod";
import {
  AgentSettings,
  AgentView,
  ModelRef,
  PublicSettings,
  Settings,
  ToolDefinition,
  ToolPermission,
  ToolResolution
} from "./domain.js";
import { LiveAssistant, TranscriptEvent, ViewBlock } from "./transcript.js";

export const HostMethods = {
  sysHello: "sys.hello",
  sysPing: "sys.ping",
  sysShutdown: "sys.shutdown",
  settingsGet: "settings.get",
  settingsSet: "settings.set",
  agentCreate: "agent.create",
  agentList: "agent.list",
  agentGet: "agent.get",
  agentUpdate: "agent.update",
  agentDelete: "agent.delete",
  agentGetTranscript: "agent.getTranscript",
  agentSend: "agent.send",
  agentCancel: "agent.cancel",
  agentApproveTool: "agent.approveTool",
  agentDenyTool: "agent.denyTool",
  toolsList: "tools.list"
} as const;

export const HostEvents = {
  agentUpdated: "agent.updated",
  agentMessageDelta: "agent.message.delta",
  agentMessageCompleted: "agent.message.completed",
  agentToolPending: "agent.tool.pending",
  agentToolStarted: "agent.tool.started",
  agentToolCompleted: "agent.tool.completed",
  agentError: "agent.error",
  agentEnded: "agent.ended",
  kernelDown: "host.kernel.down"
} as const;

export const SettingsSetParams = z.object({
  defaultToolPermission: ToolPermission.optional(),
  defaultModel: ModelRef.optional(),
  theme: Settings.shape.theme.optional(),
  openaiApiKey: z.string().nullable().optional(),
  anthropicApiKey: z.string().nullable().optional(),
  deepseekApiKey: z.string().nullable().optional()
});
export type SettingsSetParams = z.infer<typeof SettingsSetParams>;

export const AgentCreateParams = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  avatarColor: z.string().optional(),
  avatarShape: z.string().optional(),
  model: ModelRef.optional(),
  workspace: AgentSettings.shape.workspace.optional()
});
export type AgentCreateParams = z.infer<typeof AgentCreateParams>;

export const AgentIdParams = z.object({ id: z.string() });
export type AgentIdParams = z.infer<typeof AgentIdParams>;

/** 合并语义：未给的字段不动；`name` 给了就不能为空。 */
export const AgentUpdateParams = z.object({
  id: z.string(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  avatarColor: z.string().optional(),
  avatarShape: z.string().optional(),
  model: ModelRef.optional(),
  workspace: AgentSettings.shape.workspace.optional(),
  hiddenFromSidebar: z.boolean().optional()
});
export type AgentUpdateParams = z.infer<typeof AgentUpdateParams>;

export const TranscriptQuery = z.object({
  id: z.string(),
  beforeSeq: z.number().int().optional(),
  limit: z.number().int().positive().optional()
});
export type TranscriptQuery = z.infer<typeof TranscriptQuery>;

export const TranscriptPage = z.object({
  id: z.string(),
  entries: z.array(TranscriptEvent),
  nextBeforeSeq: z.number().int().optional()
});
export type TranscriptPage = z.infer<typeof TranscriptPage>;

export const AgentSendParams = z.object({
  id: z.string(),
  content: z.string().min(1)
});
export type AgentSendParams = z.infer<typeof AgentSendParams>;

export const AgentToolDecision = z.object({
  id: z.string(),
  toolCallId: z.string(),
  resolution: ToolResolution
});
export type AgentToolDecision = z.infer<typeof AgentToolDecision>;

export const AgentSnapshot = z.object({
  view: AgentView,
  events: z.array(TranscriptEvent),
  blocks: z.array(ViewBlock),
  live: LiveAssistant.nullable()
});
export type AgentSnapshot = z.infer<typeof AgentSnapshot>;

export const AgentUpdatedEvent = z.object({
  agent: AgentView
});
export type AgentUpdatedEvent = z.infer<typeof AgentUpdatedEvent>;

/** 事件都带 runId，供 UI 区分并行的 run。runId 不落盘。 */
export const AgentMessageDeltaEvent = z.object({
  agentId: z.string(),
  runId: z.string(),
  messageId: z.string(),
  delta: z.string(),
  part: z.enum(["text", "thinking"]).default("text")
});
export type AgentMessageDeltaEvent = z.infer<typeof AgentMessageDeltaEvent>;

export const AgentMessageCompletedEvent = z.object({
  agentId: z.string(),
  event: TranscriptEvent
});
export type AgentMessageCompletedEvent = z.infer<typeof AgentMessageCompletedEvent>;

export const AgentToolPendingEvent = z.object({
  agentId: z.string(),
  runId: z.string(),
  toolCallId: z.string(),
  name: z.string(),
  arguments: z.record(z.unknown()),
  action: z.enum(["read-file", "list-directory", "write-file", "run-command"]),
  target: z.string()
});
export type AgentToolPendingEvent = z.infer<typeof AgentToolPendingEvent>;

export const AgentToolStartedEvent = AgentToolPendingEvent.omit({ action: true, target: true });
export type AgentToolStartedEvent = z.infer<typeof AgentToolStartedEvent>;

export const AgentToolCompletedEvent = z.object({
  agentId: z.string(),
  runId: z.string(),
  toolCallId: z.string(),
  name: z.string(),
  ok: z.boolean(),
  output: z.string()
});
export type AgentToolCompletedEvent = z.infer<typeof AgentToolCompletedEvent>;

export const AgentErrorEvent = z.object({
  agentId: z.string(),
  runId: z.string(),
  code: z.number(),
  message: z.string()
});
export type AgentErrorEvent = z.infer<typeof AgentErrorEvent>;

/** `cancelled` 是第三档：UI 得能分清「跑完了」和「被用户掐了」。 */
export const AgentEndedEvent = z.object({
  agentId: z.string(),
  runId: z.string(),
  status: z.enum(["idle", "error", "cancelled"])
});
export type AgentEndedEvent = z.infer<typeof AgentEndedEvent>;

export type HostHello = { name: "nuum-host"; version: string };

export const PublicSettingsSchema = PublicSettings;
export const ToolDefinitionList = z.array(ToolDefinition);
export const AgentSettingsSchema = AgentSettings;
