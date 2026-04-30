/**
 * Dev-Portal NumberField — react-aria-components `NumberField`.
 *
 * Native `<input type="number">` is banned in `clients/`. NumberField
 * provides locale-aware formatting + accessible increment/decrement
 * behaviour for free.
 */
import {
  Input,
  Label,
  NumberField as AriaNumberField,
  type NumberFieldProps as AriaNumberFieldProps,
} from "react-aria-components";

export interface NumberFieldProps extends AriaNumberFieldProps {
  label: string;
}

export function NumberField({ label, ...rest }: NumberFieldProps) {
  return (
    <AriaNumberField {...rest} className="dp-field">
      <Label className="dp-field__label">{label}</Label>
      <Input className="dp-field__input" />
    </AriaNumberField>
  );
}
