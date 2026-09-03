import { HostErrorCode, RpcError, secretForProvider, type ModelRef, type Secrets } from "@nuum/protocol";

export function precheck(input: {
  exists: boolean;
  busy: boolean;
  model: ModelRef;
  secrets: Secrets;
}): void {
  if (!input.exists) throw new RpcError(HostErrorCode.AGENT_NOT_FOUND, "Agent not found");
  if (input.busy) throw new RpcError(HostErrorCode.AGENT_BUSY, "Agent is already running a turn");
  const key = secretForProvider(input.secrets, input.model.provider);
  if (!key) throw new RpcError(HostErrorCode.NO_API_KEY, `Missing API key for ${input.model.provider}`);
}
