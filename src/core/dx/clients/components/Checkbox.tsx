/**
 * Dev-Portal Checkbox — react-aria-components `Checkbox`.
 */
import {
  Checkbox as AriaCheckbox,
  type CheckboxProps as AriaCheckboxProps,
} from "react-aria-components";

export interface CheckboxProps extends AriaCheckboxProps {
  children: React.ReactNode;
}

export function Checkbox({ children, ...rest }: CheckboxProps) {
  return (
    <AriaCheckbox {...rest} className="dp-checkbox">
      <div className="dp-checkbox__box">
        <svg
          className="dp-checkbox__check"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="3 8 7 12 13 4" />
        </svg>
      </div>
      {children}
    </AriaCheckbox>
  );
}
