import { z } from "zod";

export const JsonRpcId = z.union([z.string(), z.number()]);
export type JsonRpcId = z.infer<typeof JsonRpcId>;

export const JsonRpcRequest = z.object({
  jsonrpc: z.literal("2.0"),
  id: JsonRpcId,
  method: z.string(),
  params: z.unknown().optional()
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequest>;

export const JsonRpcErrorObject = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional()
});
export type JsonRpcErrorObject = z.infer<typeof JsonRpcErrorObject>;

export const JsonRpcResponse = z.object({
  jsonrpc: z.literal("2.0"),
  id: JsonRpcId,
  result: z.unknown().optional(),
  error: JsonRpcErrorObject.optional()
});
export type JsonRpcResponse = z.infer<typeof JsonRpcResponse>;

export const JsonRpcEvent = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string(),
  params: z.unknown().optional()
});
export type JsonRpcEvent = z.infer<typeof JsonRpcEvent>;

export type JsonRpcFrame = JsonRpcRequest | JsonRpcResponse | JsonRpcEvent;

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return JsonRpcRequest.safeParse(value).success && !("result" in (value as object)) && !("error" in (value as object));
}

export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  if (typeof value !== "object" || value === null || !("id" in value) || !("jsonrpc" in value)) return false;
  return "result" in value || "error" in value;
}

export function isJsonRpcEvent(value: unknown): value is JsonRpcEvent {
  return JsonRpcEvent.safeParse(value).success && !("id" in (value as object));
}
