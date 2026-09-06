import { useId, type CSSProperties } from "react";

// Nuum personas use simple vector silhouettes so they stay crisp at every UI size.
const BLOB_PATH = "M114 4C170 4 224 42 224 106C224 171 181 224 112 224C48 224 4 184 4 116C4 55 48 4 114 4Z";
const TABLET_PATH = "M74 40H154C195 40 228 73 228 114C228 155 195 188 154 188H74C33 188 0 155 0 114C0 73 33 40 74 40Z";

export const AGENT_AVATAR_COLORS = [
  { id: "black", value: "#111111", dark: "#343434" },
  { id: "green", value: "#00c972", dark: "#009957" },
  { id: "blue", value: "#2a92fe", dark: "#0e74e0" },
  { id: "violet", value: "#a97efe", dark: "#804ee0" },
  { id: "orange", value: "#ff781c", dark: "#ff6700" },
  { id: "magenta", value: "#ff5eb1", dark: "#e02a88" }
] as const;

export const AGENT_AVATAR_SHAPES = ["blob", "tablet"] as const;
export type AgentAvatarState = "idle" | "working" | "sending" | "receiving" | "happy";

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  }
  return result >>> 0;
}

export function resolveAgentAvatarColor(agentId: string, requested?: string | null) {
  const selected = AGENT_AVATAR_COLORS.find((color) => color.id === requested);
  return selected ?? AGENT_AVATAR_COLORS[hash(agentId) % AGENT_AVATAR_COLORS.length]!;
}

export function resolveAgentAvatarShape(agentId: string, requested: string | null = "blob") {
  return requested === "tablet" || requested === "blob"
    ? requested
    : AGENT_AVATAR_SHAPES[hash(agentId) % AGENT_AVATAR_SHAPES.length]!;
}

export function AgentAvatar({
  agentId,
  color,
  shape = "blob",
  size = 34,
  state = "idle",
  className = ""
}: {
  agentId: string;
  color?: string | null;
  shape?: string | null;
  size?: number;
  state?: AgentAvatarState;
  className?: string;
}) {
  const gradientId = `sand-avatar-${useId().replace(/:/g, "")}`;
  const ink = resolveAgentAvatarColor(agentId, color);
  const resolvedShape = resolveAgentAvatarShape(agentId, shape);
  const path = resolvedShape === "tablet" ? TABLET_PATH : BLOB_PATH;
  const happy = state === "happy" || state === "receiving";
  const style = { "--sand-avatar-size": `${size}px` } as CSSProperties;
  return (
    <span
      aria-hidden="true"
      className={["sand-agent-avatar", className].filter(Boolean).join(" ")}
      data-state={state}
      style={style}
    >
      <svg height={size} viewBox="-15 -15 259 259" width={size} xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor={ink.value} />
            <stop offset="1" stopColor={ink.dark} />
          </linearGradient>
        </defs>
        <g className="sand-agent-avatar__face">
          <path d={path} fill={`url(#${gradientId})`} />
          <g className="sand-agent-avatar__eyes" fill="#fff">
            <ellipse cx="85.2705" cy="106.2705" rx="10" ry="7" />
            <ellipse cx="143.2705" cy="106.2705" rx="10" ry="7" />
          </g>
          {happy ? (
            <path
              d="M94.2705 138.2705Q114.2705 152.2705 134.2705 138.2705"
              fill="none"
              stroke="#fff"
              strokeLinecap="round"
              strokeWidth="5"
            />
          ) : null}
        </g>
      </svg>
    </span>
  );
}
