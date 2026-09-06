import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";

export interface AgentDrop { agentId: string; workId: string | null; sectionId?: string; beforePinnedId?: string }

// Pointer capture keeps entity dragging inside the app and makes cancellation explicit.
export function useAgentDrag(onDrop: (drop: AgentDrop) => void, { holdToDrag = false } = {}) {
  const cleanup = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => () => cleanup.current?.(), []);
  return {
    onClickCapture(event: ReactMouseEvent) {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault(); event.stopPropagation();
    },
    start(event: ReactPointerEvent<HTMLElement>, agentId: string, fromWork = false) {
      if (event.button !== 0 || !event.isPrimary) return;
      cleanup.current?.();
      suppressClick.current = false;
      const source = event.currentTarget;
      const pointerId = event.pointerId;
      const startX = event.clientX, startY = event.clientY;
      let ghost: HTMLElement | null = null;
      let target: HTMLElement | null = null;
      let dragging = false;
      let holdTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        clearTimeout(holdTimer);
        ghost?.remove(); target?.removeAttribute("data-agent-drag-over");
        document.body.removeAttribute("data-agent-dragging");
        source.removeAttribute("data-agent-drag-source");
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        window.removeEventListener("pointercancel", cancel, true);
        source.removeEventListener("lostpointercapture", cancel);
        window.removeEventListener("keydown", key, true);
        window.removeEventListener("blur", cancel);
        if (source.hasPointerCapture(pointerId)) source.releasePointerCapture(pointerId);
        cleanup.current = null;
      };
      const begin = () => {
        if (dragging || !source.isConnected) return;
        clearTimeout(holdTimer);
        dragging = true; suppressClick.current = true;
        source.setPointerCapture(pointerId);
        source.setAttribute("data-agent-drag-source", "true");
        document.body.dataset.agentDragging = fromWork ? "member" : "agent";
        if (holdToDrag) {
          ghost = document.createElement("div");
          ghost.className = "sand-agent-drag-ghost sand-agent-drag-ghost--tile";
          for (const selector of [".sand-agent-item__avatar", ".sand-agent-item__name"]) {
            const child = source.querySelector(selector);
            if (child) ghost.append(child.cloneNode(true));
          }
        } else {
          ghost = source.cloneNode(true) as HTMLElement;
          ghost.classList.add("sand-agent-drag-ghost");
        }
        ghost.setAttribute("aria-hidden", "true");
        ghost.style.width = `${holdToDrag ? 92 : Math.min(source.getBoundingClientRect().width, 220)}px`;
        ghost.style.left = `${Math.max(8, Math.min(startX + 14, window.innerWidth - Math.min(source.getBoundingClientRect().width, 220) - 8))}px`;
        ghost.style.top = `${startY + 12}px`;
        document.body.append(ghost);
      };
      const move = (next: PointerEvent) => {
        if (next.pointerId !== pointerId) return;
        if (!dragging && Math.hypot(next.clientX - startX, next.clientY - startY) < 6) return;
        begin();
        next.preventDefault();
        if (ghost) { ghost.style.left = `${Math.max(8, Math.min(next.clientX + 14, window.innerWidth - ghost.offsetWidth - 8))}px`; ghost.style.top = `${next.clientY + 12}px`; }
        const hit = document.elementFromPoint(next.clientX, next.clientY)?.closest<HTMLElement>("[data-agent-drop-work], [data-agent-drop-section], [data-agent-drop-pin-before]") ?? null;
        if (target !== hit) { target?.removeAttribute("data-agent-drag-over"); target = hit; target?.setAttribute("data-agent-drag-over", "true"); }
      };
      const up = (next: PointerEvent) => {
        if (next.pointerId !== pointerId) return;
        const workId = document.elementFromPoint(next.clientX, next.clientY)?.closest<HTMLElement>("[data-agent-drop-work]")?.dataset.agentDropWork ?? null;
        const sectionId = document.elementFromPoint(next.clientX, next.clientY)?.closest<HTMLElement>("[data-agent-drop-section]")?.dataset.agentDropSection;
        const beforePinnedId = document.elementFromPoint(next.clientX, next.clientY)?.closest<HTMLElement>("[data-agent-drop-pin-before]")?.dataset.agentDropPinBefore;
        const inside = next.clientX >= 0 && next.clientY >= 0 && next.clientX < window.innerWidth && next.clientY < window.innerHeight;
        finish();
        if (dragging && inside && (workId || fromWork || sectionId || beforePinnedId)) onDrop({ agentId, workId, sectionId, beforePinnedId });
      };
      const cancel = () => { suppressClick.current = false; finish(); };
      const key = (next: KeyboardEvent) => { if (next.key === "Escape") { next.preventDefault(); next.stopPropagation(); cancel(); } };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", cancel, true);
      source.addEventListener("lostpointercapture", cancel);
      window.addEventListener("keydown", key, true);
      window.addEventListener("blur", cancel);
      cleanup.current = finish;
      if (holdToDrag) holdTimer = setTimeout(begin, 300);
    }
  };
}
