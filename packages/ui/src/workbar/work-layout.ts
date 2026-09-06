export interface InspectorPreference { width: number; split: number }
const STORAGE_KEY = "nuum.ui.workInspector.v1";

export function inspectorBounds(width: number, height: number) {
  return { minWidth: 184, maxWidth: Math.max(184, Math.min(380, width - 440)), minHeight: 120, maxHeight: Math.max(120, height - 190) };
}

export function projectInspectorLayout(preference: InspectorPreference, width: number, height: number) {
  const bounds = inspectorBounds(width, height);
  return {
    width: Math.min(bounds.maxWidth, Math.max(bounds.minWidth, preference.width)),
    capabilityHeight: Math.min(bounds.maxHeight, Math.max(bounds.minHeight, height * preference.split))
  };
}

export function readInspectorPreference(): InspectorPreference {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "");
    if (Number.isFinite(saved.width) && Number.isFinite(saved.split)) {
      return { width: Math.min(380, Math.max(184, saved.width)), split: Math.min(1, Math.max(0, saved.split)) };
    }
  } catch { /* Missing or unavailable storage uses the default layout. */ }
  return { width: 250, split: .32 };
}

export function writeInspectorPreference(preference: InspectorPreference) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preference)); } catch { /* Resizing still works without storage. */ }
}

export function workDisplayTitle(name: string): string {
  return name.replace(/^work\s*bar\s*[·:：—–-]\s*/i, "").trim() || name;
}
