/**
 * Dev-Portal FileTrigger — react-aria-components `FileTrigger`.
 *
 * Native `<input type="file">` is hidden behind an accessible Button,
 * giving us a styled trigger without losing keyboard support.
 */
import {
  Button,
  FileTrigger as AriaFileTrigger,
  type FileTriggerProps as AriaFileTriggerProps,
} from "react-aria-components";

export interface FileTriggerProps extends AriaFileTriggerProps {
  buttonLabel: string;
}

export function FileTrigger({ buttonLabel, ...rest }: FileTriggerProps) {
  return (
    <AriaFileTrigger {...rest}>
      <Button className="dp-button">{buttonLabel}</Button>
    </AriaFileTrigger>
  );
}
