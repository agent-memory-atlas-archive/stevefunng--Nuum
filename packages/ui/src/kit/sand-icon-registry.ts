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
  | "stop"
  | "pin"
  | "folder"
  | "copy"
  | "edit"
  | "chevron-left"
  | "chevron-right"
  | "arrow-down"
  | "ungroup";

export type SandIconSize = "sm" | "md" | "lg" | number;
export type SandIconColor = string;
export type SandIconVariant = "outline" | "filled";
export type SandIconPlatform = "darwin" | "win32" | "linux";

const PATHS: Record<SandIconName, string> = {
  add: "M6 2v8M2 6h8",
  plus: "M6 2v8M2 6h8",
  "settings-gear": "M6 4.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6M6 1.5l.7 1.3 1.4.3.9-1.1 1.2 1.2-1.1.9.3 1.4L10.5 6l-1.3.7-.3 1.4 1.1.9-1.2 1.2-.9-1.1-1.4.3L6 10.5l-.7-1.3-1.4-.3-.9 1.1-1.2-1.2 1.1-.9-.3-1.4L1.5 6l1.3-.7.3-1.4-1.1-.9 1.2-1.2.9 1.1 1.4-.3z",
  "arrow-up": "M6 9.5v-7M3 5.5l3-3 3 3",
  mic: "M6 1.8a1.6 1.6 0 0 1 1.6 1.6v3a1.6 1.6 0 1 1-3.2 0v-3A1.6 1.6 0 0 1 6 1.8M3 6.2a3 3 0 0 0 6 0M6 9.2V11",
  attach: "M8.5 4v4a2.5 2.5 0 0 1-5 0V3.25a1.75 1.75 0 0 1 3.5 0V8a1 1 0 0 1-2 0V4",
  close: "M3 3l6 6M9 3 3 9",
  search: "M5.2 5.2a2.4 2.4 0 1 1 0 .1M7 7.2 10 10",
  sidebar: "M2.5 2.5h7v7h-7zM4.5 2.5v7",
  sliders: "M2 3.5h8M4 2v3M2 8.5h8M8 7v3",
  stop: "M3.5 3.5h5v5h-5z",
  pin: "M7 1.5 10.5 5 8 5.5 6.5 8 4 5.5 6.5 4zM4 8 1.5 10.5",
  folder: "M1.5 3h3l1-1h2l1 1h2v6.5h-9z",
  copy: "M4.5 4.5h6v6h-6zM7.5 3V1.5h-6v6H3",
  edit: "M2 8.5 8.5 2l1.5 1.5L3.5 10H2zM7 3.5 8.5 5",
  "chevron-left": "M7.5 2.5 4 6l3.5 3.5",
  "chevron-right": "M4.5 2.5 8 6 4.5 9.5",
  "arrow-down": "M6 2.5v7M3 6.5l3 3 3-3",
  ungroup: "M1.5 3h3l1-1h2l1 1h2v3M1.5 3v6.5H5M7 8l3 3M10 8l-3 3"
};

export function sandIconGlyph(name: SandIconName, _variant?: SandIconVariant, _platform?: SandIconPlatform): string {
  return PATHS[name] ?? PATHS.add;
}

export function sandIconStyle(size: SandIconSize = "sm", color?: SandIconColor): CSSProperties {
  const px = typeof size === "number" ? size : size === "lg" ? 18 : size === "md" ? 16 : 14;
  return { width: px, height: px, color: color ?? "currentColor" };
}
