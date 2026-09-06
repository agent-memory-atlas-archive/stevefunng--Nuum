import { z } from "zod";

/** Capability policy belongs to an Agent; the default designation is only a rollout choice. */
export const ProactivePolicy = z.object({
  revision: z.number().int().nonnegative(),
  isDefault: z.boolean().default(false),
  enabled: z.boolean().default(false),
  pausedUntil: z.number().int().nonnegative().nullable().default(null),
  sourceIds: z.array(z.string().min(1)).max(20).refine((ids) => new Set(ids).size === ids.length, "Duplicate context source").default([]),
  intervalMs: z.number().int().min(60_000).max(3_600_000).default(300_000)
});
export type ProactivePolicy = z.infer<typeof ProactivePolicy>;
export const ProactiveConfigureParams = z.object({
  agentId: z.string().min(1).optional(),
  expectedRevision: z.number().int().nonnegative(),
  enabled: z.boolean().optional(),
  pausedUntil: z.number().int().nonnegative().nullable().optional(),
  sourceIds: z.array(z.string().min(1)).max(20).refine((ids) => new Set(ids).size === ids.length, "Duplicate context source").optional(),
  intervalMs: z.number().int().min(60_000).max(3_600_000).optional()
});
export type ProactiveConfigureParams = z.infer<typeof ProactiveConfigureParams>;
export const ProactiveCheckParams = z.object({ agentId: z.string().min(1) });
export const ProactiveActivity = z.object({
  id: z.string(), at: z.number(),
  kind: z.enum(["enabled", "disabled", "paused", "resumed", "configured", "waiting-context", "context-ready", "no-change", "error"]),
  /** References only. Context bodies and credentials never belong in the activity ledger. */
  contextRefs: z.array(z.string()).default([])
});
export type ProactiveActivity = z.infer<typeof ProactiveActivity>;
export const ProactiveAgentSnapshot = z.object({
  agentId: z.string(), name: z.string(), policy: ProactivePolicy,
  state: z.enum(["disabled", "paused", "waiting-context", "ready", "checking", "error"]),
  activity: z.array(ProactiveActivity)
});
export type ProactiveAgentSnapshot = z.infer<typeof ProactiveAgentSnapshot>;
export const ProactiveSnapshot = z.object({
  defaultAgentId: z.string().nullable(), agents: z.array(ProactiveAgentSnapshot),
  availableSourceIds: z.array(z.string()), actionsAvailable: z.literal(false)
});
export type ProactiveSnapshot = z.infer<typeof ProactiveSnapshot>;
