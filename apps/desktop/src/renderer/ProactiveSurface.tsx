import { useEffect, useRef, useState } from "react";
import { HostEvents, HostMethods, type ProactiveConfigureParams, type ProactiveSnapshot, type PublicSettings } from "@nuum/protocol";
import { ProactivePanel, createRuntimeThemeInstaller, setLanguage, useLanguage } from "@nuum/ui";

export function ProactiveSurface() {
  useLanguage();
  const [snapshot, setSnapshot] = useState<ProactiveSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  async function refresh() {
    const current = ++generation.current;
    try {
      const next = await window.nuum.host.request(HostMethods.proactiveGet) as ProactiveSnapshot;
      if (current === generation.current) { setSnapshot(next); setError(false); }
    } catch { if (current === generation.current) { setSnapshot(null); setError(true); } }
  }
  useEffect(() => {
    let alive = true;
    const theme = createRuntimeThemeInstaller(document as never, "light");
    const apply = (preferences: PublicSettings) => {
      if (!alive) return;
      setLanguage(preferences.language ?? "zh-CN");
      document.documentElement.lang = preferences.language ?? "zh-CN";
      const mode = preferences.theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : preferences.theme ?? "dark";
      theme.update(mode);
      document.documentElement.className = mode === "dark" ? "nuum-dark" : "nuum-light";
      document.documentElement.style.colorScheme = mode;
    };
    void window.nuum.host.request(HostMethods.settingsGet).then((value) => apply(value as PublicSettings)).catch(() => { if (alive) setError(true); });
    void refresh();
    const unsubscribe = window.nuum.host.onEvent((method, params) => {
      if (method === HostEvents.proactiveUpdated || method === HostEvents.agentUpdated) void refresh();
      if (method === HostEvents.settingsUpdated) apply(params as PublicSettings);
      if (method === HostEvents.kernelDown) void refresh();
    });
    return () => { alive = false; unsubscribe(); theme.dispose(); };
  }, []);
  async function mutate(method: string, params: unknown) {
    setBusy(true); setError(false);
    try { await window.nuum.host.request(method, params); await refresh(); }
    catch { await refresh(); setError(true); }
    finally { setBusy(false); }
  }
  return <ProactivePanel snapshot={snapshot} busy={busy} error={error}
    onConfigure={(params: ProactiveConfigureParams) => void mutate(HostMethods.proactiveConfigure, params)}
    onCheck={(agentId) => void mutate(HostMethods.proactiveCheck, { agentId })}
    onOpenAgent={(agentId) => { void window.nuum.desktop.openProactiveAgent(agentId).catch(() => setError(true)); }}
    onOpenMain={() => void window.nuum.desktop.showMain()} onQuit={() => void window.nuum.desktop.quit()} onRetry={() => void refresh()} />;
}
