/**
 * Dev-Portal Tooltip — react-aria-components `TooltipTrigger` +
 * `Tooltip`.
 */
import { Button, Tooltip as AriaTooltip, TooltipTrigger } from "react-aria-components";

export interface TooltipProps {
  label: string;
  children: React.ReactNode;
}

export function Tooltip({ label, children }: TooltipProps) {
  return (
    <TooltipTrigger>
      <Button className="dp-button dp-button--ghost" aria-label={label}>
        {children}
      </Button>
      <AriaTooltip className="dp-tooltip">{label}</AriaTooltip>
    </TooltipTrigger>
  );
}
