import type { ModelImage, ToolDefinition } from "@nuum/protocol";
import type { SandboxPort } from "@nuum/sandbox";

export interface ToolContext {
  runId: string;
  sandbox: SandboxPort;
  abortSignal: AbortSignal;
}

export interface Tool {
  definition: ToolDefinition;
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string | ToolOutput>;
}

export interface ToolOutput {
  text: string;
  images?: ModelImage[];
}
