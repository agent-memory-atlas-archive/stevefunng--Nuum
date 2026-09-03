import type { CSSProperties } from "react";

export type SandIconName =
  | "add"
  | "settings-gear"
  | "arrow-up"
  | "mic"
  | "plus"
  | "attach"
  | "close"
  | "search"
  | "sidebar"
  | "sliders"
  | "stop";

export type SandIconSize = "sm" | "md" | "lg" | number;
export type SandIconColor = string;
export type SandIconVariant = "outline" | "filled";
export type SandIconPlatform = "darwin" | "win32" | "linux";

const PATHS: Record<SandIconName, string> = {
  add: "M6 2v8M2 6h8",
  plus: "M6 2v8M2 6h8",
  "settings-gear": "M6 4.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6M6 1.5l.7 1.3 1.4.3.9-1.1 1.2 1.2-1.1.9.3 1.4L10.5 6l-1.3.7-.3 1.4 1.1.9-1.2 1.2-.9-1.1-1.4.3L6 10.5l-.7-1.3-1.4-.3-.9 1.1-1.2-1.2 1.1-.9-.3-1.4L1.5 6l1.3-.7.3-1.4-1.1-.9 1.2-1.2.9 1.1 1.4-.3z",
  "arrow-up": "M6 10V3M3 6l3-3 3 3",
  mic: "M6 1.8a1.6 1.6 0 0 1 1.6 1.6v3a1.6 1.6 0 1 1-3.2 0v-3A1.6 1.6 0 0 1 6 1.8M3 6.2a3 3 0 0 0 6 0M6 9.2V11",
  attach: "M8.2 3.4 4 7.6a2 2 0 1 0 2.8 2.8l4.4-4.4a1.4 1.4 0 1 0-2-2L5 8.2",
  close: "M3 3l6 6M9 3 3 9",
  search: "M5.2 5.2a2.4 2.4 0 1 1 0 .1M7 7.2 10 10",
  sidebar: "M2.5 2.5h7v7h-7zM4.5 2.5v7",
  sliders: "M2 3.5h8M4 2v3M2 8.5h8M8 7v3",
  stop: "M3.5 3.5h5v5h-5z"
};

export function sandIconGlyph(name: SandIconName, _variant?: SandIconVariant, _platform?: SandIconPlatform): string {
  return PATHS[name] ?? PATHS.add;
}

export function sandIconStyle(size: SandIconSize = "sm", color?: SandIconColor): CSSProperties {
  const px = typeof size === "number" ? size : size === "lg" ? 18 : size === "md" ? 16 : 14;
  return { width: px, height: px, color: color ?? "currentColor" };
}
