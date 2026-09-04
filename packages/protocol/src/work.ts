import { z } from "zod";

export const WorkProfile = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  avatar: z.string().optional(),
  projectRoot: z.string().nullable(),
  createdAt: z.number()
});
export type WorkProfile = z.infer<typeof WorkProfile>;

export const WorkRole = z.enum(["coordinator", "worker", "observer"]);
export type WorkRole = z.infer<typeof WorkRole>;

export const WorkGrants = z.object({
  canPost: z.boolean(),
  canManageOwnTasks: z.boolean(),
  canAssignTasks: z.boolean(),
  canEditCatalog: z.boolean()
});
export type WorkGrants = z.infer<typeof WorkGrants>;

export const WorkBinding = z.object({
  workId: z.string().min(1),
  role: WorkRole,
  joinedAt: z.number(),
  grants: WorkGrants
});
export type WorkBinding = z.infer<typeof WorkBinding>;

/** 一期只有一个动态槽位；revision 让拖入、拖出与换 Work 能做 CAS。 */
export const WorkMembership = z.object({
  revision: z.number().int().nonnegative(),
  binding: WorkBinding.nullable()
});
export type WorkMembership = z.infer<typeof WorkMembership>;

export const WorkTaskState = z.enum([
  "proposed",
  "ready",
  "in_progress",
  "blocked",
  "review",
  "done",
  "cancelled"
]);
export type WorkTaskState = z.infer<typeof WorkTaskState>;

export const WorkTaskPriority = z.enum(["low", "normal", "high"]);
export type WorkTaskPriority = z.infer<typeof WorkTaskPriority>;

export const WorkDeliverable = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  uri: z.string().min(1),
  mimeType: z.string().optional(),
  createdAt: z.number()
});
export type WorkDeliverable = z.infer<typeof WorkDeliverable>;

export const WorkTask = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
  state: WorkTaskState,
  assigneeIds: z.array(z.string()),
  dependencyIds: z.array(z.string()),
  priority: WorkTaskPriority,
  revision: z.number().int().positive(),
  deliverables: z.array(WorkDeliverable),
  blocker: z.object({
    reason: z.string().min(1),
    ownerId: z.string().optional(),
    resumeCondition: z.string().optional(),
    createdAt: z.number()
  }).optional(),
  createdAt: z.number(),
  updatedAt: z.number()
});
export type WorkTask = z.infer<typeof WorkTask>;

const CatalogBase = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  enabled: z.boolean()
});

export const WorkCatalogEntry = z.discriminatedUnion("kind", [
  CatalogBase.extend({
    kind: z.literal("skill"),
    manifestPath: z.string().min(1)
  }),
  CatalogBase.extend({
    kind: z.literal("cli"),
    executable: z.string().min(1),
    allowedSubcommands: z.array(z.string())
  }),
  CatalogBase.extend({
    kind: z.literal("knowledge"),
    roots: z.array(z.string().min(1)),
    readOnly: z.literal(true)
  }),
  CatalogBase.extend({
    kind: z.literal("local-tool"),
    toolNames: z.array(z.string().min(1))
  })
]);
export type WorkCatalogEntry = z.infer<typeof WorkCatalogEntry>;

export const WorkCatalog = z.object({
  revision: z.number().int().nonnegative(),
  entries: z.array(WorkCatalogEntry)
});
export type WorkCatalog = z.infer<typeof WorkCatalog>;

export const WorkActor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), id: z.string().min(1) }),
  z.object({ kind: z.literal("agent"), id: z.string().min(1) }),
  z.object({ kind: z.literal("system"), id: z.string().min(1) })
]);
export type WorkActor = z.infer<typeof WorkActor>;

const EventBase = z.object({
  id: z.string().min(1),
  workId: z.string().min(1),
  seq: z.number().int().positive(),
  createdAt: z.number(),
  actor: WorkActor,
  causationId: z.string().optional(),
  correlationId: z.string().optional(),
  clientEventId: z.string().optional(),
  serverWatermark: z.number().int().positive().optional()
});

export const WorkEvent = z.discriminatedUnion("type", [
  EventBase.extend({
    type: z.literal("chat.posted"),
    messageId: z.string().min(1),
    body: z.string().min(1),
    mentionedAgentIds: z.array(z.string())
  }),
  EventBase.extend({ type: z.literal("task.created"), task: WorkTask }),
  EventBase.extend({
    type: z.literal("task.assigned"),
    taskId: z.string().min(1),
    assigneeIds: z.array(z.string()),
    revision: z.number().int().positive()
  }),
  EventBase.extend({
    type: z.literal("task.transitioned"),
    taskId: z.string().min(1),
    from: WorkTaskState,
    to: WorkTaskState,
    revision: z.number().int().positive(),
    blocker: z.object({
      reason: z.string().min(1),
      ownerId: z.string().optional(),
      resumeCondition: z.string().optional()
    }).optional()
  }),
  EventBase.extend({
    type: z.literal("task.progressed"),
    taskId: z.string().min(1),
    summary: z.string().min(1)
  }),
  EventBase.extend({
    type: z.literal("task.handed_off"),
    taskId: z.string().min(1),
    summary: z.string().min(1),
    deliverables: z.array(WorkDeliverable),
    nextStatus: z.enum(["review", "blocked", "done"]),
    blockerReason: z.string().min(1).optional(),
    revision: z.number().int().positive()
  }),
  EventBase.extend({
    type: z.literal("dispatch.requested"),
    bridgeId: z.string().min(1),
    agentId: z.string().min(1),
    taskId: z.string().optional(),
    instruction: z.string().min(1)
  }),
  EventBase.extend({
    type: z.literal("dispatch.acknowledged"),
    bridgeId: z.string().min(1),
    agentId: z.string().min(1),
    transcriptEventId: z.string().min(1)
  }),
  EventBase.extend({
    type: z.literal("member.attached"),
    membershipOperationId: z.string().min(1),
    agentId: z.string().min(1),
    role: WorkRole,
    membershipRevision: z.number().int().positive()
  }),
  EventBase.extend({
    type: z.literal("member.detached"),
    membershipOperationId: z.string().min(1),
    agentId: z.string().min(1),
    membershipRevision: z.number().int().positive()
  })
]);
export type WorkEvent = z.infer<typeof WorkEvent>;

type WithoutSeq<T> = T extends unknown ? Omit<T, "seq"> : never;
export type WorkEventDraft = WithoutSeq<WorkEvent>;

export type WorkChatMessage = Extract<WorkEvent, { type: "chat.posted" }>;

export interface WorkProjection {
  tasks: WorkTask[];
  chat: WorkChatMessage[];
}

export const WorkTaskView = WorkTask.extend({
  allowedTransitions: z.array(WorkTaskState)
});
export type WorkTaskView = z.infer<typeof WorkTaskView>;

export const EMPTY_WORK_CATALOG: WorkCatalog = { revision: 0, entries: [] };
