import { KernelErrorCode, RpcError } from "@nuum/protocol";

export function stringField(
  input: Record<string, unknown>,
  key: string,
  options: { optional?: boolean; allowEmpty?: boolean } = {}
): string | undefined {
  const value = input[key];
  if (value === undefined && options.optional) return undefined;
  if (typeof value !== "string" || (!options.allowEmpty && value.length === 0)) {
    const qualifier = options.allowEmpty ? "string" : "non-empty string";
    throw new RpcError(KernelErrorCode.INVALID, `${key} must be a ${qualifier}.`);
  }
  return value;
}

export function booleanField(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new RpcError(KernelErrorCode.INVALID, `${key} must be a boolean.`);
  }
  return value;
}

export function integerField(
  input: Record<string, unknown>,
  key: string,
  options: { min: number }
): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < options.min) {
    throw new RpcError(KernelErrorCode.INVALID, `${key} must be an integer >= ${options.min}.`);
  }
  return value as number;
}

export function enumField<const T extends readonly string[]>(
  input: Record<string, unknown>,
  key: string,
  values: T,
  fallback: T[number]
): T[number] {
  const value = input[key] ?? fallback;
  if (typeof value !== "string" || !values.includes(value)) {
    throw new RpcError(KernelErrorCode.INVALID, `${key} must be one of: ${values.join(", ")}.`);
  }
  return value as T[number];
}
