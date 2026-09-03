import {
  AgentCreateParams,
  AgentIdParams,
  AgentSendParams,
  AgentToolDecision,
  AgentUpdateParams,
  HostErrorCode,
  HostMethods,
  RpcError,
  SettingsSetParams,
  TranscriptQuery
} from "@nuum/protocol";
import { JsonRpcPeer, createStdioDuplex } from "@nuum/protocol/node";
import { HostRuntime, type HostRuntimeOptions } from "./runtime.js";

export async function createHostServer(options: HostRuntimeOptions): Promise<HostRuntime> {
  const runtime = new HostRuntime(options);
  await runtime.start();
  const peer = new JsonRpcPeer(createStdioDuplex(process.stdin, process.stdout));
  runtime.setEmitter((method, params) => peer.notify(method, params));

  peer.setHandler(async (method, raw) => {
    switch (method) {
      case HostMethods.sysHello:
        return { name: "nuum-host", version: "0.1.0" };
      case HostMethods.sysPing:
        return { ok: true, at: Date.now() };
      case HostMethods.sysShutdown:
        setImmediate(() => {
          void runtime.dispose().finally(() => process.exit(0));
        });
        return { ok: true };
      case HostMethods.settingsGet:
        return runtime.getPublicSettings();
      case HostMethods.settingsSet:
        return runtime.setSettings(SettingsSetParams.parse(raw));
      case HostMethods.agentCreate:
        return runtime.createAgent(AgentCreateParams.parse(raw ?? {}));
      case HostMethods.agentList:
        return runtime.listAgents();
      case HostMethods.agentGet:
        return runtime.getAgent(AgentIdParams.parse(raw).id);
      case HostMethods.agentUpdate:
        return runtime.updateAgent(AgentUpdateParams.parse(raw));
      case HostMethods.agentDelete:
        return runtime.deleteAgent(AgentIdParams.parse(raw).id);
      case HostMethods.agentGetTranscript: {
        const params = TranscriptQuery.parse(raw);
        return runtime.getTranscript(params.id, params.beforeSeq, params.limit);
      }
      case HostMethods.agentSend: {
        const params = AgentSendParams.parse(raw);
        return runtime.send(params.id, params.content);
      }
      case HostMethods.agentCancel:
        return runtime.cancel(AgentIdParams.parse(raw).id);
      case HostMethods.agentApproveTool:
      case HostMethods.agentDenyTool: {
        const params = AgentToolDecision.parse(raw);
        return runtime.decide(
          params.id,
          params.toolCallId,
          method === HostMethods.agentDenyTool ? "deny" : params.resolution
        );
      }
      case HostMethods.toolsList:
        return runtime.tools();
      default:
        throw new RpcError(HostErrorCode.AGENT_NOT_FOUND, `Unknown host method: ${method}`);
    }
  });

  return runtime;
}
