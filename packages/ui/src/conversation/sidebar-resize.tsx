import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

export const SIDEBAR_LAYOUT_DEFAULTS = {
  expandedWidth: 236,
  isCollapsed: false
} as const;

export const SIDEBAR_LAYOUT_BOUNDS = {
  minExpandedWidth: 220,
  maxExpandedWidth: 400,
  collapsedWidth: 88,
  collapseBelow: 208
} as const;

export interface SidebarLayoutState {
  expandedWidth: number;
  isCollapsed: boolean;
  liveWidth?: number;
  isDragging?: boolean;
}

const STORAGE_KEY = "nuum.ui.sidebar.v2";

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_LAYOUT_BOUNDS.maxExpandedWidth, Math.max(SIDEBAR_LAYOUT_BOUNDS.minExpandedWidth, width));
}

export function clampLiveWidth(width: number): number {
  return Math.min(
    SIDEBAR_LAYOUT_BOUNDS.maxExpandedWidth,
    Math.max(SIDEBAR_LAYOUT_BOUNDS.collapsedWidth, Math.round(width))
  );
}

export function projectSidebarWidth(state: SidebarLayoutState): number {
  if (state.isDragging && state.liveWidth != null) return state.liveWidth;
  return state.isCollapsed ? SIDEBAR_LAYOUT_BOUNDS.collapsedWidth : state.expandedWidth;
}

export function applySidebarDrag(state: SidebarLayoutState, width: number): SidebarLayoutState {
  const liveWidth = clampLiveWidth(width);
  const collapsing = liveWidth < SIDEBAR_LAYOUT_BOUNDS.collapseBelow;
  return {
    expandedWidth: collapsing ? state.expandedWidth : clampSidebarWidth(liveWidth),
    isCollapsed: collapsing,
    liveWidth,
    isDragging: true
  };
}

export function settleSidebarLayout(state: SidebarLayoutState): SidebarLayoutState {
  const live = state.liveWidth ?? projectSidebarWidth(state);
  if (live < SIDEBAR_LAYOUT_BOUNDS.collapseBelow) {
    return {
      expandedWidth: clampSidebarWidth(state.expandedWidth),
      isCollapsed: true
    };
  }
  return {
    expandedWidth: clampSidebarWidth(live),
    isCollapsed: false
  };
}

export function readSidebarLayout(): SidebarLayoutState {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "") as Partial<SidebarLayoutState>;
    return {
      expandedWidth: clampSidebarWidth(Number(raw.expandedWidth) || SIDEBAR_LAYOUT_DEFAULTS.expandedWidth),
      isCollapsed: raw.isCollapsed === true
    };
  } catch {
    return { ...SIDEBAR_LAYOUT_DEFAULTS };
  }
}

export function writeSidebarLayout(state: SidebarLayoutState): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ expandedWidth: state.expandedWidth, isCollapsed: state.isCollapsed })
  );
}

export function SidebarResizeHandle({
  onResize,
  onResizeEnd
}: {
  onResize(width: number): void;
  onResizeEnd(): void;
}) {
  const startLeft = useRef(0);
  const cleanupRef = useRef<(() => void) | null>(null);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (cleanupRef.current != null) return;
    const parent = event.currentTarget.parentElement;
    if (parent == null) return;
    event.preventDefault();
    startLeft.current = parent.getBoundingClientRect().left;
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    target.setPointerCapture(pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId === pointerId) onResize(moveEvent.clientX - startLeft.current);
    };
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") cleanup();
    };
    function cleanup() {
      if (cleanupRef.current !== cleanup) return;
      cleanupRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      window.removeEventListener("blur", cleanup);
      window.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("lostpointercapture", cleanup);
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onResizeEnd();
    }
    cleanupRef.current = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
    window.addEventListener("blur", cleanup);
    window.addEventListener("keydown", onKeyDown);
    target.addEventListener("lostpointercapture", cleanup);
  };
  useEffect(() => () => cleanupRef.current?.(), []);
  return (
    <div
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      className="sand-sidebar-resize-handle"
      onPointerDown={onPointerDown}
      role="separator"
    />
  );
}
