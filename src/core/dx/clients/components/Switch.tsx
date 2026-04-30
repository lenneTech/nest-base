/**
 * Dev-Portal Switch — react-aria-components `Switch`.
 *
 * Used for boolean toggles (e.g. feature-flag toggles). The native
 * checkbox-with-role-switch pattern would also be accessible, but
 * `Switch` ships with the right default semantics.
 */
import { Switch as AriaSwitch, type SwitchProps as AriaSwitchProps } from "react-aria-components";

export interface SwitchProps extends AriaSwitchProps {
  children: React.ReactNode;
}

export function Switch({ children, ...rest }: SwitchProps) {
  return (
    <AriaSwitch {...rest} className="dp-switch">
      <div className="dp-switch__track">
        <div className="dp-switch__thumb" />
      </div>
      {children}
    </AriaSwitch>
  );
}
