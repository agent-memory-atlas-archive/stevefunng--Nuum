import { t } from "../i18n";
import type { AgentProfile, AgentUpdateParams } from "@nuum/protocol";
import { useEffect, useRef, useState } from "react";
import { AgentAvatar } from "./agent-avatar";
import { SandIconButton } from "../kit/sand-kit-primitives";
import "./agent-profile-panel.css";
import { AutoTextarea } from "../kit/auto-textarea";

export type AgentProfilePatch = Pick<AgentUpdateParams, "name" | "tags" | "description">;

function ProfileField({ label, value, multiline, placeholder, onSave }: {
  label: string; value: string; multiline?: boolean; placeholder?: string;
  onSave(value: string): Promise<string>;
}) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const previous = useRef(value);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const sequence = useRef(0);
  useEffect(() => {
    // Host events refresh untouched fields while keeping a user's in-progress edit.
    if (draftRef.current === previous.current) {
      draftRef.current = value;
      setDraft(value);
    }
    previous.current = value;
  }, [value]);
  const save = async () => {
    const submitted = draftRef.current;
    if (submitted === previous.current) return;
    const version = ++sequence.current;
    setStatus("saving"); setError("");
    try {
      const normalized = await onSave(submitted);
      if (sequence.current !== version) return;
      if (draftRef.current === submitted) { draftRef.current = normalized; setDraft(normalized); }
      setStatus("saved");
    } catch (cause) {
      if (sequence.current !== version) return;
      setStatus("error"); setError(cause instanceof Error ? cause.message : t("Could not save. Please try again."));
    }
  };
  const field = {
    value: draft, placeholder,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      draftRef.current = event.target.value; setDraft(event.target.value); setStatus("idle");
    },
    onBlur: () => void save(),
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing && (!multiline || event.metaKey || event.ctrlKey)) {
        event.preventDefault(); event.currentTarget.blur();
      }
    },
    "aria-invalid": status === "error" || undefined
  };
  return <label className="sand-profile-field">
    <span>{label}</span>
    {multiline ? <AutoTextarea {...field} /> : <input {...field} />}
    {status === "error" ? <small role="alert">{t(error)} <button type="button" onClick={() => void save()}>{t("Retry")}</button></small>
      : status !== "idle" ? <small className="sand-profile-field__status" role="status">{status === "saving" ? t("Saving…") : t("Saved")}</small> : null}
  </label>;
}

export function AgentProfilePanel({ profile, onSave, onClose }: {
  profile: AgentProfile; onSave(patch: AgentProfilePatch): Promise<void>; onClose(): void;
}) {
  return <aside className="sand-agent-profile-panel" aria-label={t("Agent profile")}>
    <header><span>{t("Edit profile")}</span><SandIconButton icon="chevron-right" label={t("Close profile")} aria-label={t("Close profile")} onClick={onClose} size="sm" /></header>
    <div className="sand-agent-profile-panel__body">
      <div className="sand-agent-profile-panel__avatar"><AgentAvatar agentId={profile.id} color={profile.avatarColor} shape={profile.avatarShape} size={88} /></div>
      <ProfileField label={t("Name")} value={profile.name} onSave={async (value) => {
        const name = value.trim();
        if (!name) throw new Error(t("Name cannot be empty."));
        await onSave({ name }); return name;
      }} />
      <ProfileField label={t("Tags (optional)")} value={(profile.tags ?? []).join(", ")} placeholder={t("Research, design, operations")} onSave={async (value) => {
        const tags = [...new Set(value.split(/[,，、\n]/).map((tag) => tag.trim()).filter(Boolean))];
        await onSave({ tags }); return tags.join(", ");
      }} />
      <ProfileField label={t("Description")} value={profile.description} multiline placeholder={t("What should this Agent do?")} onSave={async (value) => {
        const description = value.trim(); await onSave({ description }); return description;
      }} />
    </div>
  </aside>;
}
