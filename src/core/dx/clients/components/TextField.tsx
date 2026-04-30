/**
 * Dev-Portal TextField — react-aria-components `TextField` + `Input`
 * + `Label` + `FieldError`, wired with our CSS classes.
 *
 * Use this for every plain-text input in the Dev-Portal. The native
 * `<input>` is wrapped by react-aria-components so screen-readers and
 * keyboard navigation stay correct.
 */
import {
  FieldError,
  Input,
  Label,
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
} from "react-aria-components";

export interface TextFieldProps extends AriaTextFieldProps {
  label: string;
  placeholder?: string;
  errorMessage?: string;
}

export function TextField({ label, placeholder, errorMessage, ...rest }: TextFieldProps) {
  return (
    <AriaTextField {...rest} className="dp-field">
      <Label className="dp-field__label">{label}</Label>
      <Input className="dp-field__input" placeholder={placeholder} />
      {errorMessage ? <FieldError className="dp-field__error">{errorMessage}</FieldError> : null}
    </AriaTextField>
  );
}
