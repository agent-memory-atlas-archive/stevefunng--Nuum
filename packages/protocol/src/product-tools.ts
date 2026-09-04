import { z } from "zod";
import type { ToolDefinition } from "./domain.js";
import { OutboundMessage } from "./transcript.js";

/**
 * 委派工具（Host 执行）的名字与 schema。放 protocol 是因为它本来就是
 * Host ↔ Kernel 契约的一部分：Kernel 从这里拿 definition 给模型看，Host 从
 * 同一份拿 schema 校验参数。这样 `@nuum/host` 不必依赖 `@nuum/tools`，
 * 包边界一条规则都不用改（§3.3）。
 */
export const DelegatedToolNames = {
  sendMessage: "SendMessage",
  updateState: "update_state",
  createAgent: "CreateAgent",
  updateAgent: "UpdateAgent",
  sendToAgent: "SendToAgent",
  readAgentTranscript: "ReadAgentTranscript",
  stopAgent: "StopAgent",
  postToWork: "PostToWork",
  handoffTask: "HandoffTask",
  readWorkTimeline: "ReadWorkTimeline",
  runWorkCli: "RunWorkCLI",
  delegateWork: "DelegateWork"
} as const;

export const SendMessageParams = OutboundMessage;
export type SendMessageParams = z.infer<typeof SendMessageParams>;

export const UpdateStateParams = z.discriminatedUnion("target", [
  z.object({
    target: z.literal("profile"),
    action: z.literal("set"),
    name: z.string().optional(),
    description: z.string().optional()
  }),
  z.object({
    target: z.literal("memory"),
    action: z.enum(["write", "forget"]),
    fact: z.string(),
    tier: z.enum(["profile", "log", "note"]).default("log")
  }),
  z.object({
    target: z.literal("settings"),
    action: z.literal("set"),
    project_root: z.string().nullable()
  })
]);
export type UpdateStateParams = z.infer<typeof UpdateStateParams>;

export const CreateAgentParams = z.object({
  name: z.string(),
  description: z.string(),
  first_message: z.string().optional()
});
export type CreateAgentParams = z.infer<typeof CreateAgentParams>;

export const UpdateAgentParams = z.object({
  agent_id: z.string(),
  name: z.string().optional(),
  description: z.string().optional()
});
export type UpdateAgentParams = z.infer<typeof UpdateAgentParams>;

export const SendToAgentParams = z.object({
  agent_id: z.string(),
  message: z.string(),
  priority: z.boolean().optional()
});
export type SendToAgentParams = z.infer<typeof SendToAgentParams>;

export const ReadAgentTranscriptParams = z.object({
  agent_id: z.string(),
  limit: z.number().int().positive().max(200).optional()
});
export type ReadAgentTranscriptParams = z.infer<typeof ReadAgentTranscriptParams>;

export const StopAgentParams = z.object({ agent_id: z.string() });
export type StopAgentParams = z.infer<typeof StopAgentParams>;

export const PostToWorkParams = z.object({ message: z.string().min(1) });
export type PostToWorkParams = z.infer<typeof PostToWorkParams>;

export const HandoffTaskParams = z.object({
  summary: z.string().min(1),
  status: z.enum(["review", "blocked", "done"]),
  blocker_reason: z.string().min(1).optional(),
  deliverables: z.array(z.object({
    name: z.string().min(1),
    uri: z.string().min(1),
    mime_type: z.string().optional()
  })).default([])
});
export type HandoffTaskParams = z.infer<typeof HandoffTaskParams>;

export const ReadWorkTimelineParams = z.object({ limit: z.number().int().positive().max(100).default(30) });
export type ReadWorkTimelineParams = z.infer<typeof ReadWorkTimelineParams>;

export const RunWorkCliParams = z.object({
  capability_id: z.string().min(1),
  args: z.array(z.string()).default([])
});
export type RunWorkCliParams = z.infer<typeof RunWorkCliParams>;

export const DelegateWorkParams = z.object({
  agent_id: z.string().min(1),
  instruction: z.string().min(1),
  task_id: z.string().min(1).optional()
});
export type DelegateWorkParams = z.infer<typeof DelegateWorkParams>;

const AGENT_ID = { type: "string", description: "The agent's id, as listed in your teammate directory." };

export const DELEGATED_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: DelegatedToolNames.sendMessage,
    description:
      "Say something to the user. This is your only voice: plain text you write outside this tool is a scratchpad the user does not read. Call it as soon as you have something worth saying, and again when you are done.",
    inputSchema: {
      type: "object",
      required: ["type"],
      properties: {
        type: { type: "string", enum: ["text", "attachment", "widget"] },
        text: { type: "string", description: "For type=text: what to say." },
        images: {
          type: "array",
          items: { type: "string" },
          description: "For type=text: absolute paths to images to show inline."
        },
        path: { type: "string", description: "For type=attachment: absolute path to the file." },
        caption: { type: "string", description: "For type=attachment: one line about it." },
        widget: { type: "string", description: "For type=widget: the widget name." },
        props: { type: "object", description: "For type=widget: its props." }
      }
    },
    mutating: false
  },
  {
    name: DelegatedToolNames.updateState,
    description:
      "Change your own persistent state. target=profile rewrites your own name or description; target=memory records or forgets a durable fact; target=settings sets or clears your project directory. Fields you do not pass are left alone.",
    inputSchema: {
      type: "object",
      required: ["target", "action"],
      properties: {
        target: { type: "string", enum: ["profile", "memory", "settings"] },
        action: { type: "string", enum: ["set", "write", "forget"] },
        name: { type: "string", description: "For target=profile." },
        description: { type: "string", description: "For target=profile." },
        project_root: { type: ["string", "null"], description: "For target=settings: absolute project directory, or null to clear it." },
        fact: { type: "string", description: "For target=memory: one self-contained fact." },
        tier: {
          type: "string",
          enum: ["profile", "log", "note"],
          description: "For target=memory: profile for standing facts, log for dated ones."
        }
      }
    },
    mutating: false
  },
  {
    name: DelegatedToolNames.createAgent,
    description:
      "Create a new teammate agent with its own chat, persona, and memory. It appears in the user's sidebar immediately. You have no tool to delete an agent, so only create one when it is genuinely useful and long-lived — for a one-off task, just do the task yourself.",
    inputSchema: {
      type: "object",
      required: ["name", "description"],
      properties: {
        name: { type: "string", description: "Short, human, and distinct from existing teammates." },
        description: { type: "string", description: "What this teammate is for." },
        first_message: { type: "string", description: "Optional first instruction to wake it with." }
      }
    },
    mutating: false
  },
  {
    name: DelegatedToolNames.updateAgent,
    description: "Rename another agent or rewrite its description. Fields you do not pass are left alone.",
    inputSchema: {
      type: "object",
      required: ["agent_id"],
      properties: { agent_id: AGENT_ID, name: { type: "string" }, description: { type: "string" } }
    },
    mutating: false
  },
  {
    name: DelegatedToolNames.sendToAgent,
    description:
      "Send a message to another agent. Delivery is asynchronous; this returns immediately, and a later SendToAgent reply from that teammate wakes you here. Use priority to interrupt what it is currently doing.",
    inputSchema: {
      type: "object",
      required: ["agent_id", "message"],
      properties: {
        agent_id: AGENT_ID,
        message: { type: "string", description: "Self-contained: the other agent cannot see your chat." },
        priority: { type: "boolean", description: "Interrupt its current work instead of queueing." }
      }
    },
    mutating: false
  },
  {
    name: DelegatedToolNames.readAgentTranscript,
    description:
      "Read the tail of another agent's chat, to see what it has been up to or what it answered. Read-only.",
    inputSchema: {
      type: "object",
      required: ["agent_id"],
      properties: { agent_id: AGENT_ID, limit: { type: "number", description: "How many entries, newest last." } }
    },
    mutating: false
  },
  {
    name: DelegatedToolNames.stopAgent,
    description: "Stop what another agent is currently doing. Anything queued for it is dropped too.",
    inputSchema: { type: "object", required: ["agent_id"], properties: { agent_id: AGENT_ID } },
    mutating: false
  },
  {
    name: DelegatedToolNames.postToWork,
    description: "Post a progress update to the current Work shared room.",
    inputSchema: {
      type: "object",
      required: ["message"],
      properties: { message: { type: "string" } }
    },
    mutating: false
  },
  {
    name: DelegatedToolNames.handoffTask,
    description: "Hand the current Work task back for review, report it blocked, or—when you are the coordinator—mark a reviewed task done. This also posts the summary in the shared room.",
    inputSchema: {
      type: "object",
      required: ["summary", "status"],
      properties: {
        summary: { type: "string" },
        status: { type: "string", enum: ["review", "blocked", "done"] },
        blocker_reason: { type: "string" },
        deliverables: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "uri"],
            properties: { name: { type: "string" }, uri: { type: "string" }, mime_type: { type: "string" } }
          }
        }
      }
    },
    mutating: false
  },
  {
    name: DelegatedToolNames.readWorkTimeline,
    description: "Read the latest entries from the current Work timeline.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number" } }
    },
    mutating: false
  },
  {
    name: DelegatedToolNames.runWorkCli,
    description: "Run a CLI capability explicitly installed in the current Work. No shell expansion is performed.",
    inputSchema: {
      type: "object",
      required: ["capability_id"],
      properties: {
        capability_id: { type: "string" },
        args: { type: "array", items: { type: "string" } }
      }
    },
    mutating: true
  },
  {
    name: DelegatedToolNames.delegateWork,
    description: "Delegate work to another Agent in the current Work. Only a coordinator can use this.",
    inputSchema: {
      type: "object",
      required: ["agent_id", "instruction"],
      properties: {
        agent_id: AGENT_ID,
        instruction: { type: "string" },
        task_id: { type: "string" }
      }
    },
    mutating: false
  }
];
