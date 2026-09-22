import { useId, type CSSProperties } from "react";
import type { AgentView } from "@nuum/protocol";

// Nuum personas use simple vector silhouettes so they stay crisp at every UI size.
// 形状族对标 Grok Bot 的干净剪影（正圆 / 胖 blob / 水滴 / 云朵 / 圆角方），
// 材质是 Nuum 自己的特色层：哑光 / 玻璃 / 毛绒 / 极光（隐藏款）。

export const AGENT_AVATAR_COLORS = [
  { id: "black", value: "#111111", dark: "#343434" },
  { id: "green", value: "#00c972", dark: "#009957" },
  { id: "blue", value: "#2a92fe", dark: "#0e74e0" },
  { id: "violet", value: "#a97efe", dark: "#804ee0" },
  { id: "orange", value: "#ff781c", dark: "#ff6700" },
  { id: "magenta", value: "#ff5eb1", dark: "#e02a88" }
] as const;

export const AGENT_AVATAR_SHAPES = ["circle", "blob", "droplet", "cloud", "tablet"] as const;
export type AgentAvatarShape = (typeof AGENT_AVATAR_SHAPES)[number];

export const AGENT_AVATAR_MATERIALS = ["matte", "glass", "plush"] as const;
export const AGENT_AVATAR_MATERIAL_HIDDEN = "aurora";
export type AgentAvatarMaterial = (typeof AGENT_AVATAR_MATERIALS)[number] | "aurora";

export type AgentAvatarState = "idle" | "working" | "sending" | "receiving" | "happy";

type AvatarFace = { eyesY: number; eyeLX: number; eyeRX: number };
type AvatarShapeDef = { paths: readonly string[]; face: AvatarFace };

// 统一 229 坐标空间（viewBox -15 -15 259 259）。多段 path 用 nonzero 合并成剪影。
const SHAPES: Record<AgentAvatarShape, AvatarShapeDef> = {
  circle: {
    paths: ["M114 6a108 108 0 1 1 0 216a108 108 0 1 1 0-216Z"],
    face: { eyesY: 108, eyeLX: 86, eyeRX: 142 }
  },
  blob: {
    paths: ["M114 4C170 4 224 42 224 106C224 171 181 224 112 224C48 224 4 184 4 116C4 55 48 4 114 4Z"],
    face: { eyesY: 106, eyeLX: 86, eyeRX: 142 }
  },
  droplet: {
    paths: ["M114 8C140 52 192 98 192 148C192 191 157 224 114 224C71 224 36 191 36 148C36 98 88 52 114 8Z"],
    face: { eyesY: 142, eyeLX: 88, eyeRX: 140 }
  },
  cloud: {
    paths: ["M66 198C40 198 20 178 20 154C20 132 36 114 57 110C63 79 90 56 122 56C152 56 177 76 183 104C204 108 220 126 220 150C220 176 199 198 172 198Z"],
    face: { eyesY: 124, eyeLX: 88, eyeRX: 140 }
  },
  tablet: {
    paths: ["M74 40H154C195 40 228 73 228 114C228 155 195 188 154 188H74C33 188 0 155 0 114C0 73 33 40 74 40Z"],
    face: { eyesY: 106, eyeLX: 86, eyeRX: 142 }
  }
};

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

export function resolveAgentAvatarShape(agentId: string, requested: string | null = "blob"): AgentAvatarShape {
  if (requested && requested in SHAPES) return requested as AgentAvatarShape;
  return AGENT_AVATAR_SHAPES[hash(agentId + "shape") % AGENT_AVATAR_SHAPES.length]!;
}

export function resolveAgentAvatarMaterial(agentId: string, requested?: string | null): AgentAvatarMaterial {
  if (requested && ((AGENT_AVATAR_MATERIALS as readonly string[]).includes(requested) || requested === AGENT_AVATAR_MATERIAL_HIDDEN)) {
    return requested as AgentAvatarMaterial;
  }
  return "matte";
}

const HIDDEN_CHANCE = 0.03;

/**
 * 创建 Nu-nu 时随机定一套形象（色彩 × 形状 × 材质）。材质分普通三档与极光隐藏款，
 * 隐藏款小概率出现；结果在创建时写进 profile，之后与该 Nu-nu 永久绑定。
 */
export function rollAgentAvatar(): { color: string; shape: string; material: string } {
  const materialRoll = Math.random();
  const material =
    materialRoll < HIDDEN_CHANCE
      ? AGENT_AVATAR_MATERIAL_HIDDEN
      : materialRoll < HIDDEN_CHANCE + 0.55
        ? "matte"
        : materialRoll < HIDDEN_CHANCE + 0.55 + 0.28
          ? "glass"
          : "plush";
  return {
    color: AGENT_AVATAR_COLORS[Math.floor(Math.random() * AGENT_AVATAR_COLORS.length)]!.id,
    shape: AGENT_AVATAR_SHAPES[Math.floor(Math.random() * AGENT_AVATAR_SHAPES.length)]!,
    material
  };
}

const SPARKLE_PATH = "M0 -7L1.8 -1.8L7 0L1.8 1.8L0 7L-1.8 1.8L-7 0L-1.8 -1.8Z";
const SPARKLES = [
  { x: 66, y: 64, scale: 1 },
  { x: 164, y: 96, scale: 0.7 },
  { x: 96, y: 166, scale: 0.85 }
] as const;
// 参考图的眼睛：斜置的竖椭圆，顶部微微内倾，干净不抢戏。
const EYE_TILT = 14;
const EYE_RX = 10;
const EYE_RY = 16;

export function AgentAvatar({
  agentId,
  color,
  shape = "blob",
  material,
  size = 34,
  state = "idle",
  className = ""
}: {
  agentId: string;
  color?: string | null;
  shape?: string | null;
  material?: string | null;
  size?: number;
  state?: AgentAvatarState;
  className?: string;
}) {
  const uid = `sand-avatar-${useId().replace(/:/g, "")}`;
  const ink = resolveAgentAvatarColor(agentId, color);
  const resolvedShape = resolveAgentAvatarShape(agentId, shape);
  const resolvedMaterial = resolveAgentAvatarMaterial(agentId, material);
  const def = SHAPES[resolvedShape]!;
  const happy = state === "happy" || state === "receiving";
  const style = { "--sand-avatar-size": `${size}px` } as CSSProperties;

  const silhouette = (props: Record<string, unknown>) => (
    <g {...props}>
      {def.paths.map((path, index) => <path key={index} d={path} />)}
    </g>
  );
  // 表情整体裁剪进剪影，眨眼再怎么动也绝不越过身体轮廓。
  const face = (
    <g clipPath={`url(#${uid}-clip)`}>
      {[def.face.eyeLX, def.face.eyeRX].map((cx, index) => (
        <g key={index} transform={`rotate(${EYE_TILT} ${cx} ${def.face.eyesY})`}>
          <ellipse
            className="sand-agent-avatar__eye"
            style={{ animationDelay: `${index * 0.08}s` } as CSSProperties}
            cx={cx}
            cy={def.face.eyesY}
            rx={EYE_RX}
            ry={EYE_RY}
            fill="#fff"
          />
        </g>
      ))}
      {happy ? (
        <path
          d={`M${def.face.eyeLX + 10} ${def.face.eyesY + 34}Q114 ${def.face.eyesY + 48} ${def.face.eyeRX - 10} ${def.face.eyesY + 34}`}
          fill="none"
          stroke="#fff"
          strokeLinecap="round"
          strokeWidth="7"
        />
      ) : null}
    </g>
  );

  return (
    <span
      aria-hidden="true"
      className={["sand-agent-avatar", className].filter(Boolean).join(" ")}
      data-state={state}
      data-material={resolvedMaterial}
      style={style}
    >
      <svg height={size} viewBox="-15 -15 259 259" width={size} xmlns="http://www.w3.org/2000/svg">
        <defs>
          {/* clipPath 里不能包 <g>（会被 SVG 忽略），必须平铺 path。 */}
          <clipPath id={`${uid}-clip`}>
            {def.paths.map((path, index) => <path key={index} d={path} />)}
          </clipPath>
          {resolvedMaterial === "glass" ? (
            <linearGradient id={`${uid}-ink`} x1="0.15" y1="0" x2="0.55" y2="1">
              <stop offset="0" stopColor={ink.value} stopOpacity="0.9" />
              <stop offset="0.5" stopColor={ink.value} stopOpacity="0.5" />
              <stop offset="1" stopColor={ink.dark} stopOpacity="0.78" />
            </linearGradient>
          ) : resolvedMaterial === "plush" ? (
            <>
              <radialGradient id={`${uid}-ink`} cx="0.34" cy="0.26" r="1.1">
                <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
                <stop offset="0.4" stopColor={ink.value} />
                <stop offset="1" stopColor={ink.dark} />
              </radialGradient>
              <filter id={`${uid}-fuzz`} x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="7" />
              </filter>
            </>
          ) : resolvedMaterial === "aurora" ? (
            <linearGradient id={`${uid}-ink`} x1="0" y1="0" x2="0.9" y2="1">
              <stop offset="0" stopColor="#34d3e0" />
              <stop offset="0.35" stopColor="#6d8dff" />
              <stop offset="0.65" stopColor="#c86bff" />
              <stop offset="1" stopColor="#ff7ac2" />
            </linearGradient>
          ) : (
            <linearGradient id={`${uid}-ink`} x1="0.5" y1="0" x2="0.5" y2="1">
              <stop offset="0" stopColor={ink.value} />
              <stop offset="1" stopColor={ink.dark} />
            </linearGradient>
          )}
        </defs>
        <g className="sand-agent-avatar__body">
          {resolvedMaterial === "plush" ? silhouette({ fill: ink.value, opacity: 0.55, filter: `url(#${uid}-fuzz)` }) : null}
          {silhouette({ fill: `url(#${uid}-ink)` })}
          {resolvedMaterial === "glass" ? (
            <>
              <g clipPath={`url(#${uid}-clip)`}>
                <ellipse cx="78" cy="58" rx="104" ry="40" fill="#fff" opacity="0.55" transform="rotate(-16 78 58)" />
                <ellipse cx="170" cy="216" rx="86" ry="32" fill="#fff" opacity="0.25" />
              </g>
              {silhouette({ fill: "none", stroke: "#ffffff", strokeOpacity: 0.5, strokeWidth: 4 })}
            </>
          ) : null}
          {resolvedMaterial === "plush" ? (
            <g clipPath={`url(#${uid}-clip)`}>
              <ellipse cx="84" cy="54" rx="92" ry="38" fill="#fff" opacity="0.28" transform="rotate(-14 84 54)" />
            </g>
          ) : null}
          {resolvedMaterial === "aurora" ? (
            <>
              <g clipPath={`url(#${uid}-clip)`}>
                <ellipse cx="80" cy="52" rx="100" ry="36" fill="#fff" opacity="0.4" transform="rotate(-14 80 52)" />
                {SPARKLES.map((sparkle, index) => (
                  <g key={index} transform={`translate(${sparkle.x} ${sparkle.y}) scale(${sparkle.scale})`}>
                    <path
                      d={SPARKLE_PATH}
                      fill="#fff"
                      className="sand-agent-avatar__sparkle"
                      style={{ animationDelay: `${index * 0.45}s` } as CSSProperties}
                    />
                  </g>
                ))}
              </g>
              {silhouette({ fill: "none", stroke: "#ffffff", strokeOpacity: 0.45, strokeWidth: 4 })}
            </>
          ) : null}
          {face}
        </g>
      </svg>
    </span>
  );
}

const WORK_GROUP_MAX_MEMBERS = 4;

/**
 * Work bar 的群头像：成员的 Nu-nu 头像拼进一个圆角方块，样式取自 Grok Bot
 * 的群聊头像（每个成员占一个象限）。成员 id 就够了 —— 头像色可由 id 哈希推出，
 * agents 只用来尊重用户自定义的头像色与形状。
 */
export function WorkGroupAvatar({
  memberIds,
  agents,
  size = 34,
  className = ""
}: {
  memberIds: readonly string[];
  agents?: readonly AgentView[];
  size?: number;
  className?: string;
}) {
  if (memberIds.length === 0) return null;
  const profileOf = (id: string) => agents?.find((agent) => agent.profile.id === id);
  if (memberIds.length === 1) {
    const agent = profileOf(memberIds[0]!);
    return <AgentAvatar agentId={memberIds[0]!} color={agent?.profile.avatarColor} shape={agent?.profile.avatarShape} material={agent?.profile.avatarMaterial} size={size} className={className} />;
  }
  const shown = memberIds.slice(0, WORK_GROUP_MAX_MEMBERS);
  const cell = Math.ceil(size / 2);
  return (
    <span
      aria-hidden="true"
      className={["sand-work-avatar", className].filter(Boolean).join(" ")}
      data-count={shown.length}
      style={{ width: size, height: size } as CSSProperties}
    >
      {shown.map((id) => {
        const agent = profileOf(id);
        return (
          <span key={id} className="sand-work-avatar__cell">
            <AgentAvatar agentId={id} color={agent?.profile.avatarColor} shape={agent?.profile.avatarShape} material={agent?.profile.avatarMaterial} size={Math.ceil(cell * 1.4)} />
          </span>
        );
      })}
    </span>
  );
}
