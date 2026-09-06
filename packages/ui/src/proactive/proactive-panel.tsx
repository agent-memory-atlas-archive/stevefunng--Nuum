import type { ProactiveConfigureParams, ProactiveSnapshot } from "@nuum/protocol";
import { t, getLanguage } from "../i18n";
import { SettingsSelect } from "../kit/settings-select";
import { SandIcon } from "../kit/sand-kit-primitives";

const STATES = { disabled: "Proactive is off", paused: "Taking a pause", "waiting-context": "Waiting for context", ready: "Ready to check", checking: "Checking context", error: "Check needs attention" };
const ACTIVITIES = { enabled: "Proactive enabled", disabled: "Proactive disabled", paused: "Paused", resumed: "Resumed", configured: "Configuration updated", "waiting-context": "No context sources connected", "context-ready": "Context ready; actions not connected", "no-change": "No new context", error: "Context check failed" };

export function ProactivePanel({ snapshot, busy, error, onConfigure, onCheck, onOpenAgent, onOpenMain, onQuit, onRetry }: {
  snapshot: ProactiveSnapshot | null; busy: boolean; error: boolean;
  onConfigure(patch: ProactiveConfigureParams): void; onCheck(agentId: string): void;
  onOpenAgent(agentId: string): void; onOpenMain(): void; onQuit(): void; onRetry(): void;
}) {
  const agent = snapshot?.agents.find((agent) => agent.agentId === snapshot.defaultAgentId);
  const state = agent?.state ?? "disabled";
  const patch = (value: Partial<ProactiveConfigureParams>) => onConfigure({ agentId: agent?.agentId, expectedRevision: agent?.policy.revision ?? 0, ...value });
  return <main className="nuum-proactive-panel">
    <header className="nuum-proactive-heading"><span className="nuum-proactive-wordmark">Nuum</span><span>Proactive mode</span></header>
    <section className="nuum-proactive-status" data-state={state}>
      <div className="nuum-proactive-status__top"><span className="nuum-proactive-status__dot" /><span>{t(snapshot ? STATES[state] : "Connecting to Nuum…")}</span></div>
      <h1>{agent?.name ?? "Nu-nu"}</h1>
      <p>{t(state === "paused" ? "Your companion will resume after this break." : "A quieter kind of help, at the right moment.")}</p>
      <div className="nuum-proactive-toggle-row"><span>{t("Proactive mode")}</span>
        <button className="sand-switch" role="switch" aria-label={t("Enable proactive mode")} aria-checked={agent?.policy.enabled ?? false} disabled={busy || !snapshot}
          onClick={() => patch({ enabled: !agent?.policy.enabled, pausedUntil: null })}><span className="sand-switch__knob" /></button>
      </div>
    </section>
    <div className="nuum-proactive-tools">
      {state === "paused" ? <button className="nuum-proactive-secondary" disabled={busy} onClick={() => patch({ pausedUntil: null })}>{t("Resume now")}</button>
        : <SettingsSelect aria-label={t("Pause proactive mode")} value="pause" disabled={busy || !agent?.policy.enabled} onChange={(event) => { if (event.target.value !== "pause") patch({ pausedUntil: Date.now() + Number(event.target.value) }); }}>
          <option value="pause">{t("Pause…")}</option><option value="1800000">{t("For 30 minutes")}</option><option value="3600000">{t("For 1 hour")}</option>
        </SettingsSelect>}
      <button className="nuum-proactive-secondary" disabled={busy || !agent?.policy.enabled || state === "paused" || state === "checking"} onClick={() => agent && onCheck(agent.agentId)}>{t("Check setup")}</button>
    </div>
    {state === "paused" && agent?.policy.pausedUntil ? <p className="nuum-proactive-resume">{t("Resumes at {time}", { time: new Date(agent.policy.pausedUntil).toLocaleTimeString(getLanguage(), { hour: "2-digit", minute: "2-digit" }) })}</p> : null}
    <section className="nuum-proactive-readiness" aria-label={t("Connections")}>
      <div><span>{t("Context sources")}</span><small>{t(snapshot?.availableSourceIds.length ? "Available" : "Not connected")}</small></div>
      <div><span>{t("Agent actions")}</span><small>{t("Not connected")}</small></div>
      <p>{t("Setup is ready. Context collection and autonomous actions are not enabled in this version.")}</p>
    </section>
    <section className="nuum-proactive-activity"><h2>{t("Recent activity")}</h2>
      {!agent?.activity.length ? <p>{t("Activity will appear here when you turn it on.")}</p> : <ol>{agent.activity.slice(0, 3).map((item) => <li key={item.id}><span>{t(ACTIVITIES[item.kind])}</span><time>{new Date(item.at).toLocaleTimeString(getLanguage(), { hour: "2-digit", minute: "2-digit" })}</time></li>)}</ol>}
    </section>
    {error ? <div className="nuum-proactive-error" role="alert">{t("Could not update proactive mode.")}<button onClick={onRetry}>{t("Retry")}</button></div> : null}
    <footer className="nuum-proactive-footer"><button onClick={() => agent ? onOpenAgent(agent.agentId) : onOpenMain()}>{t(agent ? "Open Nu-nu" : "Open Nuum")}<SandIcon name="chevron-right" size={12} /></button><button onClick={onQuit}>{t("Quit")}</button></footer>
  </main>;
}
