/**
 * Dev-Portal Button — react-aria-components `Button` with our
 * design-token CSS classes wired in.
 *
 * Native `<button>` elements are forbidden in `clients/`; everything
 * goes through this wrapper so the focus ring, pressed state, and
 * disabled state stay consistent.
 */
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from "react-aria-components";

export interface ButtonProps extends AriaButtonProps {
  variant?: "default" | "accent" | "ghost";
}

export function Button({ variant = "default", className, ...rest }: ButtonProps) {
  const variantClass =
    variant === "accent"
      ? "dp-button dp-button--accent"
      : variant === "ghost"
        ? "dp-button dp-button--ghost"
        : "dp-button";
  return (
    <AriaButton
      {...rest}
      className={(rs) =>
        `${variantClass}${typeof className === "function" ? ` ${className(rs)}` : className ? ` ${className}` : ""}`
      }
    />
  );
}
