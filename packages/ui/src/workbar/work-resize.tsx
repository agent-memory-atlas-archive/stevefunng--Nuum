import { useEffect, useRef, type PointerEvent } from "react";

export function WorkResizeHandle({ axis, label, value, min, max, onChange }: {
  axis: "horizontal" | "vertical";
  label: string;
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
}) {
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);
  const change = (next: number) => onChange(Math.min(max, Math.max(min, next)));
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || cleanupRef.current) return;
    event.preventDefault();
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const origin = axis === "horizontal" ? event.clientX : event.clientY;
    const previousCursor = document.body.style.cursor;
    const previousSelection = document.body.style.userSelect;
    target.setPointerCapture(pointerId);
    target.dataset.resizing = "true";
    document.body.style.cursor = axis === "horizontal" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    const move = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      change(value + (axis === "horizontal" ? origin - event.clientX : event.clientY - origin));
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onChange(value); cleanup(); }
    };
    function cleanup() {
      if (cleanupRef.current !== cleanup) return;
      cleanupRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      window.removeEventListener("blur", cleanup);
      window.removeEventListener("keydown", key);
      target.removeEventListener("lostpointercapture", cleanup);
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      delete target.dataset.resizing;
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelection;
    }
    cleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
    window.addEventListener("blur", cleanup);
    window.addEventListener("keydown", key);
    target.addEventListener("lostpointercapture", cleanup);
  };
  return <div className={`sand-work-resize sand-work-resize--${axis}`} role="separator" tabIndex={0}
    aria-label={label} aria-orientation={axis === "horizontal" ? "vertical" : "horizontal"}
    aria-valuenow={Math.round(value)} aria-valuemin={Math.round(min)} aria-valuemax={Math.round(max)}
    onPointerDown={start} onKeyDown={(event) => {
      const increase = axis === "horizontal" ? "ArrowLeft" : "ArrowDown";
      const decrease = axis === "horizontal" ? "ArrowRight" : "ArrowUp";
      if (![increase, decrease, "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      change(event.key === "Home" ? min : event.key === "End" ? max : value + (event.key === increase ? 16 : -16));
    }} />;
}
