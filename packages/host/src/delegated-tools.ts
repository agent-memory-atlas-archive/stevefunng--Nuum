import {
  DELEGATED_TOOL_DEFINITIONS,
  DelegatedToolNames,
  ReadAgentTranscriptParams,
  SendMessageParams,
  SendToAgentParams,
  StopAgentParams,
  UpdateAgentParams,
  UpdateStateParams,
  CreateAgentParams,
  type ToolDefinition
} from "@nuum/protocol";

/**
 * Host 自己执行的工具。Kernel 只拿到 definition，撞上就委派过来（§3.2）。
 */
export interface DelegatedTool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, context: DelegatedToolContext): Promise<string>;
}

export interface DelegatedToolContext {
  agentId: string;
  assistantId: string;
  toolCallId: string;
}

/**
 * Host 执行的产品工具（§5.2）。它们没有本地 `execute`，Kernel 撞上就走
 * `turn.tool.delegate` 委派过来。
 *
 * 这里只负责「校验参数 → 调 Host 能力 → 回一句给模型看的话」。真正的副作用
 * 都在 `HostRuntime` 上，这样工具层没有自己的状态。
 */
export interface DelegateHost {
  sendMessage(
    agentId: string,
    params: SendMessageParams,
    source: Pick<DelegatedToolContext, "assistantId" | "toolCallId">
  ): Promise<string>;
  updateState(agentId: string, params: UpdateStateParams): Promise<string>;
  createAgentFromModel(agentId: string, params: CreateAgentParams): Promise<string>;
  updateAgentFromModel(agentId: string, params: UpdateAgentParams): Promise<string>;
  sendToAgent(agentId: string, params: SendToAgentParams): Promise<string>;
  readAgentTranscript(agentId: string, params: ReadAgentTranscriptParams): Promise<string>;
  stopAgent(agentId: string, params: StopAgentParams): Promise<string>;
}

type Handler = (args: Record<string, unknown>, context: DelegatedToolContext) => Promise<string>;

/**
 * 工具集由「handler 在不在」决定，不由一份写死的名单决定。这样一个工具要么
 * 真能跑、要么模型根本看不见它 —— 不存在「声明了但调用就报没实现」这种状态。
 */
export function createDelegatedTools(host: Partial<DelegateHost>): DelegatedTool[] {
  const handlers: Record<string, Handler | undefined> = {
    [DelegatedToolNames.sendMessage]: host.sendMessage
      ? (args, context) => host.sendMessage!(context.agentId, SendMessageParams.parse(args), context)
      : undefined,
    [DelegatedToolNames.updateState]: host.updateState
      ? (args, context) => host.updateState!(context.agentId, UpdateStateParams.parse(args))
      : undefined,
    [DelegatedToolNames.createAgent]: host.createAgentFromModel
      ? (args, context) => host.createAgentFromModel!(context.agentId, CreateAgentParams.parse(args))
      : undefined,
    [DelegatedToolNames.updateAgent]: host.updateAgentFromModel
      ? (args, context) => host.updateAgentFromModel!(context.agentId, UpdateAgentParams.parse(args))
      : undefined,
    [DelegatedToolNames.sendToAgent]: host.sendToAgent
      ? (args, context) => host.sendToAgent!(context.agentId, SendToAgentParams.parse(args))
      : undefined,
    [DelegatedToolNames.readAgentTranscript]: host.readAgentTranscript
      ? (args, context) => host.readAgentTranscript!(context.agentId, ReadAgentTranscriptParams.parse(args))
      : undefined,
    [DelegatedToolNames.stopAgent]: host.stopAgent
      ? (args, context) => host.stopAgent!(context.agentId, StopAgentParams.parse(args))
      : undefined
  };

  return DELEGATED_TOOL_DEFINITIONS.filter(
    (definition: ToolDefinition) => handlers[definition.name] !== undefined
  ).map((definition: ToolDefinition) => ({
    definition,
    execute: async (args, context) => {
      try {
        return await handlers[definition.name]!(args, context);
      } catch (error) {
        // schema 错要说清哪儿错了 —— 模型只能靠这句话改参数重试。
        throw new Error(describeToolFailure(definition.name, error));
      }
    }
  }));
}

function describeToolFailure(name: string, error: unknown): string {
  if (error instanceof Error && error.name === "ZodError") {
    return `${name}: invalid arguments — ${compactZodMessage(error.message)}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function compactZodMessage(raw: string): string {
  try {
    const issues = JSON.parse(raw) as { path?: (string | number)[]; message?: string }[];
    return issues
      .map((issue) => `${(issue.path ?? []).join(".") || "(root)"}: ${issue.message ?? "invalid"}`)
      .join("; ");
  } catch {
    return raw.replace(/\s+/g, " ").slice(0, 300);
  }
}
