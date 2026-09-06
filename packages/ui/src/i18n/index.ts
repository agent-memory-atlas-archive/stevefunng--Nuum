import { useSyncExternalStore } from "react";
import type { Language } from "@nuum/protocol";
import { messages } from "./messages";

let language: Language = "zh-CN";
const listeners = new Set<() => void>();
const sourceKeys = new Map<string, string>();
for (const [key, versions] of Object.entries(messages)) {
  for (const text of Object.values(versions)) if (!sourceKeys.has(text)) sourceKeys.set(text, key);
}
export function getLanguage(): Language { return language; }
export function setLanguage(next: Language): void {
  if (next === language) return;
  language = next;
  listeners.forEach((listener) => listener());
}
export function useLanguage(): Language {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, getLanguage, getLanguage);
}
/** Translate only interface copy. User-authored names, content and paths bypass this function. */
export function t(key: string, values: Record<string, string | number> = {}): string {
  const source = messages[key] ? key : sourceKeys.get(key);
  const text = source ? messages[source]![language] : key;
  return text.replace(/\{(\w+)\}/g, (token, name: string) => String(values[name] ?? token));
}
