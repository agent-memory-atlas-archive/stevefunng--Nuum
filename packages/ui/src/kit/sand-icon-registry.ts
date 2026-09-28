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
  | "ungroup"
  | "people"
  | "shuffle"
  | "nunu-plus";

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
  search: "M5.25 8.5a3.25 3.25 0 1 1 0-6.5 3.25 3.25 0 0 1 0 6.5M7.65 7.65 10.5 10.5",
  sidebar: "M2.5 2.5h7v7h-7zM4.5 2.5v7",
  sliders: "M2 3.5h8M4 2v3M2 8.5h8M8 7v3",
  stop: "M3.5 3.5h5v5h-5z",
  pin: "M6 1.5c.83 0 1.5.67 1.5 1.5v2.3l1.7 2.2H2.8L4.5 5.3V3c0-.83.67-1.5 1.5-1.5zM6 7.5v3",
  folder: "M2 4.2c0-.66.54-1.2 1.2-1.2h1.6l1.2 1.2h3.8c.66 0 1.2.54 1.2 1.2v3.6c0 .66-.54 1.2-1.2 1.2H3.2c-.66 0-1.2-.54-1.2-1.2z",
  copy: "M8.7 3.2V3c0-.66-.54-1.2-1.2-1.2H3.2c-.66 0-1.2.54-1.2 1.2v4.3c0 .66.54 1.2 1.2 1.2h.3M4.8 4.8h3.6c.72 0 1.3.58 1.3 1.3v3.6c0 .72-.58 1.3-1.3 1.3H4.8c-.72 0-1.3-.58-1.3-1.3V6.1c0-.72.58-1.3 1.3-1.3z",
  edit: "M8.6 1.7a1.2 1.2 0 0 1 1.7 1.7L3.9 9.8 1.6 10.4l.6-2.3zM7.6 2.7l1.7 1.7",
  "chevron-left": "M7.5 2.5 4 6l3.5 3.5",
  "chevron-right": "M4.5 2.5 8 6 4.5 9.5",
  "arrow-down": "M6 2.5v7M3 6.5l3 3 3-3",
  ungroup: "M1.5 3h3l1-1h2l1 1h2v3M1.5 3v6.5H5M7 8l3 3M10 8l-3 3",
  people: "M4.2 5.9a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2M1 10.4v-.5a3.2 3.2 0 0 1 6.4 0v.5M8.2 5.7a1.9 1.9 0 1 0-.6-3.7M8.9 6.8a3 3 0 0 1 2.1 2.9v.4",
  shuffle: "M1.5 3h1.5c3.2 0 4.3 6 7.5 6M10.5 9l-1.6-1.4M10.5 9l-1.6 1.4M1.5 9h1.5c1.2 0 2.1-.9 2.9-2.1M5.9 5.1C6.7 4 7.6 3 9 3M10.5 3l-1.6-1.4M10.5 3l-1.6 1.4",
  "nunu-plus": "M1 6.8c0-1.32 1.08-2.4 2.4-2.4h3.8c1.32 0 2.4 1.08 2.4 2.4v1c0 1.32-1.08 2.4-2.4 2.4H3.4c-1.32 0-2.4-1.08-2.4-2.4zM3.6 7.3v.01M6.6 7.3v.01M10 1.1v2.6M8.7 2.4h2.6"
};

export function sandIconGlyph(name: SandIconName, _variant?: SandIconVariant, _platform?: SandIconPlatform): string {
  return PATHS[name] ?? PATHS.add;
}

export function sandIconStyle(size: SandIconSize = "sm", color?: SandIconColor): CSSProperties {
  const px = typeof size === "number" ? size : size === "lg" ? 18 : size === "md" ? 16 : 14;
  return { width: px, height: px, color: color ?? "currentColor" };
}
