/**
 * Dev-Portal RadioGroup — react-aria-components `RadioGroup` + `Radio`.
 */
import {
  Label,
  Radio as AriaRadio,
  RadioGroup as AriaRadioGroup,
  type RadioGroupProps as AriaRadioGroupProps,
  type RadioProps as AriaRadioProps,
} from "react-aria-components";

export interface RadioGroupProps extends AriaRadioGroupProps {
  label: string;
  children: React.ReactNode;
}

export function RadioGroup({ label, children, ...rest }: RadioGroupProps) {
  return (
    <AriaRadioGroup
      {...rest}
      className="dp-field"
      style={{ gap: "0.6rem", display: "flex", flexDirection: "column" }}
    >
      <Label className="dp-field__label">{label}</Label>
      {children}
    </AriaRadioGroup>
  );
}

export interface RadioProps extends AriaRadioProps {
  children: React.ReactNode;
}

export function Radio({ children, ...rest }: RadioProps) {
  return (
    <AriaRadio {...rest} className="dp-radio">
      <span className="dp-radio__circle">
        <span
          className="dp-radio__dot"
          style={{ display: "inline-block", width: 6, height: 6, borderRadius: 999 }}
        />
      </span>
      {children}
    </AriaRadio>
  );
}
