import { useCallback, useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

/** Content-sized form field; only long text scrolls, and layout changes reflow it. */
export function AutoTextarea({ value, minHeight = 72, maxHeight = 240, style, ...props }:
  TextareaHTMLAttributes<HTMLTextAreaElement> & { minHeight?: number; maxHeight?: number }
) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = useCallback(() => {
    const field = ref.current;
    if (!field || field.getBoundingClientRect().width === 0) return;
    const scrollTop = field.scrollTop;
    const computed = getComputedStyle(field);
    const border = parseFloat(computed.borderTopWidth) + parseFloat(computed.borderBottomWidth);
    field.style.overflowY = "hidden";
    field.style.height = "auto";
    const height = Math.min(maxHeight, Math.max(minHeight, field.scrollHeight + border));
    field.style.height = `${height}px`;
    field.style.overflowY = field.scrollHeight + border > maxHeight ? "auto" : "hidden";
    field.scrollTop = scrollTop;
  }, [minHeight, maxHeight]);
  useLayoutEffect(resize, [resize, value]);
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    let width = field.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const next = field.getBoundingClientRect().width;
      if (next !== width) { width = next; resize(); }
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [resize]);
  return <textarea {...props} ref={ref} value={value} rows={1} style={{ ...style, boxSizing: "border-box", minHeight, maxHeight, resize: "none" }} />;
}
