import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SandIcon } from "./sand-kit-primitives";

/** Settings picker: app-owned surface with native-equivalent keyboard navigation. */
export function SettingsSelect({ value, disabled, children, onChange, "aria-label": label }: {
  value: string; disabled?: boolean; children: ReactNode;
  onChange(event: { target: { value: string } }): void;
  "aria-label"?: string;
}) {
  const options = Children.toArray(children).filter(isValidElement<{ value: string; children: ReactNode }>).map((child) => child.props);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!open || !trigger.current || !popup.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const panel = popup.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(anchor.right - panel.width, window.innerWidth - panel.width - 8)),
      top: anchor.bottom + panel.height + 12 > window.innerHeight ? Math.max(8, anchor.top - panel.height - 6) : anchor.bottom + 6 });
    const buttons = popup.current.querySelectorAll<HTMLButtonElement>('button');
    (buttons[Math.max(0, options.findIndex((item) => item.value === value))])?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close();
    };
    const dismiss = () => close();
    const scroll = (event: Event) => { if (!popup.current?.contains(event.target as Node)) close(); };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    document.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className="sand-settings-select" disabled={disabled} aria-label={label}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(!open)} onKeyDown={(event) => {
        if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); }
      }}>
      <span>{options.find((option) => option.value === value)?.children ?? value}</span>
      <SandIcon name="chevron-right" size={12} />
    </button>
    {open ? createPortal(<div ref={popup} id={id} role="listbox" aria-label={label} className="sand-settings-select-menu" style={position}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
        if (event.key === "Tab") { close(true); return; }
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        let next = -1;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = buttons.length - 1;
        if (event.key === "ArrowDown") next = (current + 1) % buttons.length;
        if (event.key === "ArrowUp") next = (current - 1 + buttons.length) % buttons.length;
        if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
      }}>
      {options.map((option) => <button type="button" role="option" aria-selected={option.value === value} key={option.value}
        onClick={(event) => { event.stopPropagation(); close(true); onChange({ target: { value: option.value } }); }}>
        <span>{option.children}</span><span className="sand-settings-select-menu__check" aria-hidden="true">{option.value === value ? "✓" : ""}</span>
      </button>)}
    </div>, document.body) : null}
  </>;
}
