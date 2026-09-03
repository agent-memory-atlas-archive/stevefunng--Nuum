import { forwardRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import "./sand-kit-primitives.css";
import { sandIconGlyph, sandIconStyle, type SandIconName, type SandIconSize, type SandIconVariant } from "./sand-icon-registry";

export type SandButtonVariant = "primary" | "secondary";
export type SandButtonSize = "sm" | "md";
export type SandSentiment = "neutral" | "accent" | "danger";

const KIT_BUTTON_BASE = "sand-kit-button";
const ICON_BUTTON_BASE = "sand-kit-icon-button";

export function SandIcon({
  name,
  className,
  size = "sm",
  title,
  variant = "outline"
}: {
  name: SandIconName;
  className?: string;
  size?: SandIconSize;
  title?: string;
  variant?: SandIconVariant;
}): ReactNode {
  const style = sandIconStyle(size) as CSSProperties;
  return (
    <svg
      aria-hidden={title == null ? true : undefined}
      className={["ui-icon", className].filter(Boolean).join(" ")}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.3"
      style={style}
      viewBox="0 0 12 12"
    >
      <path d={sandIconGlyph(name, variant)} />
    </svg>
  );
}

export const SandButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: SandButtonVariant;
  size?: SandButtonSize;
  sentiment?: SandSentiment;
}>(function SandButton({ className, variant = "primary", size = "md", sentiment = "neutral", type = "button", ...props }, ref) {
  return (
    <button
      {...props}
      className={[KIT_BUTTON_BASE, size === "sm" ? "sand-1iorvi4" : "sand-1yrsyyn", variant === "primary" ? "sand-1wclgxm" : "sand-1tiofj7", sentiment === "danger" ? "sand-18he5m" : "", className].filter(Boolean).join(" ")}
      data-sentiment={sentiment}
      data-size={size}
      data-variant={variant}
      ref={ref}
      type={type}
    />
  );
});

export const SandIconButton = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: SandIconName;
  label?: string;
  size?: SandIconSize;
  shape?: "square" | "circle";
}>(function SandIconButton({ className, icon, label, title, type = "button", size = "sm", shape = "square", ...props }, ref) {
  return (
    <button
      {...props}
      aria-label={label ?? title}
      className={[
        ICON_BUTTON_BASE,
        size === "sm" || size === 14 ? "sand-vy4d1p" : size === "lg" || size === 18 ? "sand-exx8yu" : "",
        shape === "circle" ? "sand-149ho13" : "sand-1kogg8i",
        className
      ].filter(Boolean).join(" ")}
      data-size={typeof size === "number" ? undefined : size}
      ref={ref}
      title={title ?? label}
      type={type}
    >
      <SandIcon name={icon} size={size} />
    </button>
  );
});
