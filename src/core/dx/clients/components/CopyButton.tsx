/**
 * CopyButton — clipboard icon button that copies a text value on click.
 *
 * Pure vanilla React with no external deps: uses the standard
 * `navigator.clipboard.writeText` API and shows transient "Copied!" feedback
 * for 1.5 s before resetting to the default icon. No third-party clipboard
 * library needed because hub pages are server-rendered for developer
 * environments where the Clipboard API is always available over HTTPS / localhost.
 */
import { useState } from "react";
import type { ReactNode } from "react";

import { cn } from "../lib/utils.js";

export interface CopyButtonProps {
  /** Text to copy to the clipboard when the button is clicked. */
  text: string;
  className?: string;
}

export function CopyButton({ text, className }: CopyButtonProps): ReactNode {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      // Reset the icon after a short delay so the user sees the confirmation.
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? "Copied!" : "Copy to clipboard"}
      aria-label={copied ? "Copied!" : "Copy to clipboard"}
      className={cn(
        "inline-flex items-center justify-center rounded p-0.5 text-fg-faint transition-colors hover:bg-surface-3 hover:text-fg-muted",
        copied && "text-ok",
        className,
      )}
    >
      {copied ? (
        // Checkmark icon — signals successful copy.
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        // Clipboard icon — communicates "copy" affordance.
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="9" y="2" width="10" height="4" rx="1" />
          <path d="M9 2H7a2 2 0 00-2 2v16a2 2 0 002 2h10a2 2 0 002-2V4a2 2 0 00-2-2h-2" />
        </svg>
      )}
    </button>
  );
}
