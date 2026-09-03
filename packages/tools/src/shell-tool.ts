import { KernelErrorCode, RpcError } from "@nuum/protocol";
import type { ShellResult } from "@nuum/sandbox";
import type { Tool } from "./types.js";
import { integerField, stringField } from "./validation.js";

export const shellTool: Tool = {
  definition: {
    name: "shell",
    description: "Run a command in this agent's persistent bash, or inspect a background job by shell_id.",
    mutating: true,
    action: "run-command",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        working_directory: { type: "string" },
        block_until_ms: { type: "integer", minimum: 0, default: 30_000 },
        shell_id: { type: "string" }
      },
      oneOf: [{ required: ["command"] }, { required: ["shell_id"] }]
    }
  },
  execute: async (input, ctx) => {
    const command = stringField(input, "command", { optional: true });
    const shellId = stringField(input, "shell_id", { optional: true });
    if ((command === undefined) === (shellId === undefined)) {
      throw new RpcError(KernelErrorCode.INVALID, "Provide exactly one of command or shell_id.");
    }
    const workingDirectory = stringField(input, "working_directory", { optional: true });
    const blockUntilMs = integerField(input, "block_until_ms", { min: 0 });
    if (shellId && (workingDirectory !== undefined || blockUntilMs !== undefined)) {
      throw new RpcError(
        KernelErrorCode.INVALID,
        "working_directory and block_until_ms apply only when starting a command."
      );
    }
    const result = await ctx.sandbox.shell({
      ...(command ? { command } : {}),
      ...(shellId ? { shellId } : {}),
      ...(workingDirectory ? { workingDirectory } : {}),
      ...(blockUntilMs !== undefined ? { blockUntilMs } : {}),
      abortSignal: ctx.abortSignal
    });
    return formatShellResult(result);
  }
};

function formatShellResult(result: ShellResult): string {
  const status = result.background
    ? `Shell job ${result.shellId} is still running in the background.`
    : `Shell job ${result.shellId} completed with exit code ${result.exitCode}.`;
  return [
    result.notice,
    status,
    `pid: ${result.pid}`,
    `cwd: ${result.cwd}`,
    `running_for_ms: ${result.runningForMs}`,
    result.tail ? `output tail:\n${result.tail}` : "output tail: (no output yet)",
    `full output: ${result.path}`
  ].filter((line): line is string => Boolean(line)).join("\n");
}
