import {
  KernelErrorCode,
  KernelEvents,
  KernelMethods,
  RpcError,
  ShellDisposeParams,
  SummarizeRunParams,
  TurnRunParams,
  TurnStartParams,
  TurnToolDecision,
  TurnToolResult,
  type KernelHello
} from "@nuum/protocol";
import { JsonRpcPeer, createStdioDuplex } from "@nuum/protocol/node";
import { ToolRegistry } from "@nuum/tools";
import { disposeAllShells, disposePersistentShell } from "@nuum/sandbox";
import { startTurn, type TurnHandle } from "./loop.js";
import { runSummarize } from "./summarize.js";

export function createKernelServer(registry = new ToolRegistry()): { peer: JsonRpcPeer; hello: KernelHello } {
  const duplex = createStdioDuplex(process.stdin, process.stdout);
  const peer = new JsonRpcPeer(duplex);
  // 键是 runId，不是 agentId —— 多个 agent 必须能同时跑，Kernel 也不认识 agent。
  const runs = new Map<string, TurnHandle>();
  const hello: KernelHello = { name: "nuum-kernel", version: "0.1.0" };

  const emit = (method: string, params: unknown): void => {
    if (method === KernelEvents.turnEnded && params && typeof params === "object" && "runId" in params) {
      runs.delete(String((params as { runId: string }).runId));
    }
    peer.notify(method, params);
  };

  peer.setHandler(async (method, raw) => {
    switch (method) {
      case KernelMethods.sysHello:
        return hello;
      case KernelMethods.sysPing:
        return { ok: true, at: Date.now() };
      case KernelMethods.sysShutdown:
        setImmediate(() => void disposeAllShells().finally(() => process.exit(0)));
        return { ok: true };
      case KernelMethods.toolsList:
        return registry.list();
      case KernelMethods.shellDispose: {
        const params = ShellDisposeParams.parse(raw);
        await disposePersistentShell(params.terminals);
        return { ok: true };
      }
      case KernelMethods.turnStart: {
        const params = TurnStartParams.parse(raw);
        if (runs.has(params.runId)) {
          throw new RpcError(KernelErrorCode.TURN_BUSY, `Run ${params.runId} is already running`);
        }
        runs.set(params.runId, startTurn(params, emit, registry));
        return { ok: true, runId: params.runId };
      }
      case KernelMethods.turnCancel: {
        const params = TurnRunParams.parse(raw);
        runs.get(params.runId)?.cancel();
        return { ok: true };
      }
      case KernelMethods.turnApproveTool:
      case KernelMethods.turnDenyTool: {
        const params = TurnToolDecision.parse(raw);
        const handle = requireRun(params.runId);
        handle.decide(params.toolCallId, method === KernelMethods.turnDenyTool ? "deny" : params.resolution);
        return { ok: true };
      }
      case KernelMethods.turnProvideToolResult: {
        const params = TurnToolResult.parse(raw);
        requireRun(params.runId).provideToolResult(params.toolCallId, params.ok, params.output);
        return { ok: true };
      }
      case KernelMethods.summarizeRun: {
        // 不进 `runs`：这是一次单发调用，没有工具、不发事件、不可取消。
        return runSummarize(SummarizeRunParams.parse(raw));
      }
      default:
        throw new RpcError(KernelErrorCode.INVALID, `Unknown kernel method: ${method}`);
    }
  });

  return { peer, hello };

  function requireRun(runId: string): TurnHandle {
    const handle = runs.get(runId);
    if (!handle) throw new RpcError(KernelErrorCode.INVALID, `No running turn for ${runId}`);
    return handle;
  }
}
