import type { AgentView } from "@nuum/protocol";
import { useMemo, useRef, useState } from "react";
import { SandIcon, SandIconButton } from "../kit/sand-kit-primitives";
import { AgentAvatar } from "./agent-avatar";
import {
  SidebarResizeHandle,
  applySidebarDrag,
  projectSidebarWidth,
  settleSidebarLayout,
  type SidebarLayoutState
} from "./sidebar-resize";

export interface ConversationSidebarProps {
  agents: readonly AgentView[];
  activeId: string | null;
  layout: SidebarLayoutState;
  onLayoutChange(next: SidebarLayoutState): void;
  onNewAgent(): void;
  onOpen(id: string): void;
  onOpenSettings(): void;
}

function relativeTime(updatedAt: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

export function agentAccent(id: string): string {
  const hues = [210, 32, 152, 98, 268, 18];
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${hues[hash % hues.length]} 48% 48%)`;
}

export function ConversationSidebar({
  agents,
  activeId,
  layout,
  onLayoutChange,
  onNewAgent,
  onOpen,
  onOpenSettings
}: ConversationSidebarProps) {
  const [query, setQuery] = useState("");
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const collapsed = layout.isCollapsed;
  const visible = useMemo(() => {
    const listed = agents.filter((agent) => !agent.settings.hiddenFromSidebar);
    const needle = query.trim().toLowerCase();
    if (!needle) return listed;
    return listed.filter((agent) => {
      return (
        agent.profile.name.toLowerCase().includes(needle) ||
        agent.profile.description.toLowerCase().includes(needle)
      );
    });
  }, [query, agents]);

  return (
    <aside
      aria-label="Agents"
      className={[
        "sand-agents-sidebar",
        collapsed ? "is-collapsed" : "",
        layout.isDragging ? "is-resizing" : ""
      ].filter(Boolean).join(" ")}
      data-sidebar-collapsed={collapsed || undefined}
      style={{ width: projectSidebarWidth(layout) }}
    >
      <header className="sand-agents-sidebar__header">
        {collapsed ? null : (
          <div className="sand-agents-sidebar__new-actions">
            <SandIconButton
              aria-label="New"
              className="sand-agents-sidebar__new"
              icon="plus"
              label="New"
              onClick={onNewAgent}
              size="sm"
              title="New agent"
            />
          </div>
        )}
      </header>
      {collapsed ? null : (
        <label className="sand-agents-sidebar__search">
          <SandIcon name="search" size="sm" />
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            type="search"
            value={query}
          />
        </label>
      )}
      <nav aria-label="Agent list" className="sand-agents-list" data-sidebar-collapsed={collapsed || undefined}>
        {!collapsed && visible.length > 0 ? (
          <div className="sand-agents-list__label">
            <span>Agents</span>
            <span>{visible.length}</span>
          </div>
        ) : null}
        {visible.length === 0 ? (
          <div className="sand-agents-section__empty">{agents.length === 0 ? "No agents yet" : "No matching agents"}</div>
        ) : (
          <div className="sand-agents-section__rows">
            {visible.map(({ profile, runtime }) => (
              <button
                className="sand-agent-item"
                data-active={profile.id === activeId || undefined}
                key={profile.id}
                onClick={() => onOpen(profile.id)}
                title={profile.name}
                type="button"
              >
                <span className="sand-agent-item__avatar">
                  <AgentAvatar
                    agentId={profile.id}
                    color={profile.avatarColor}
                    shape={profile.avatarShape}
                    size={34}
                    state={runtime.status === "running" ? "working" : "idle"}
                  />
                  {runtime.status === "running" ? <span className="sand-status-dot" /> : null}
                </span>
                <span className="sand-agent-item__body">
                  <span className="sand-agent-item__name">{profile.name}</span>
                  <span className="sand-agent-item__preview">{profile.description || "New Agent"}</span>
                </span>
                <span className="sand-agent-item__trailing">
                  <span>{relativeTime(runtime.lastActivityAt)}</span>
                  {runtime.status === "running" ? <span className="sand-agent-item__activity">Working</span> : null}
                </span>
              </button>
            ))}
          </div>
        )}
      </nav>
      <footer className="sand-agents-sidebar__footer">
        {collapsed ? (
          <SandIconButton
            aria-label="New"
            className="sand-agents-sidebar__new"
            icon="plus"
            label="New"
            onClick={onNewAgent}
            shape="circle"
            size="sm"
            title="New agent"
          />
        ) : null}
        <SandIconButton
          aria-label="Settings"
          className="sand-agents-sidebar__settings"
          icon="settings-gear"
          label="Settings"
          onClick={onOpenSettings}
          size="sm"
          title="Settings"
        />
      </footer>
      <SidebarResizeHandle
        onResize={(width) => onLayoutChange(applySidebarDrag(layoutRef.current, width))}
        onResizeEnd={() => onLayoutChange(settleSidebarLayout(layoutRef.current))}
      />
    </aside>
  );
}
