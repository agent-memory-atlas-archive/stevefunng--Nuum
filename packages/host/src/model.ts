import { resolveAvailableModel, type ModelRef, type Secrets } from "@nuum/protocol";

export function resolveSessionModel(input: {
  sessionModel: ModelRef;
  defaultModel: ModelRef;
  secrets: Secrets;
}): ModelRef {
  return (
    resolveAvailableModel(input.secrets, input.sessionModel) ??
    resolveAvailableModel(input.secrets, input.defaultModel) ??
    input.sessionModel
  );
}
