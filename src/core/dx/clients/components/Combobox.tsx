/**
 * Dev-Portal Combobox — react-aria-components `ComboBox`.
 *
 * Single-selection autocomplete. For multi-selection, use the (yet to
 * be added) TagGroup pattern.
 */
import {
  ComboBox as AriaComboBox,
  type ComboBoxProps as AriaComboBoxProps,
  Button,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  type ListBoxItemProps,
  Popover,
} from "react-aria-components";

export interface ComboboxProps<T extends object = object> extends AriaComboBoxProps<T> {
  label: string;
  children: React.ReactNode;
  placeholder?: string;
}

export function Combobox<T extends object>({
  label,
  children,
  placeholder,
  ...rest
}: ComboboxProps<T>) {
  return (
    <AriaComboBox {...rest} className="dp-field">
      <Label className="dp-field__label">{label}</Label>
      <div style={{ display: "flex", gap: "0.25rem" }}>
        <Input className="dp-combobox-input" placeholder={placeholder} />
        <Button className="dp-button" aria-label="Open">
          ▾
        </Button>
      </div>
      <Popover className="dp-popover">
        <ListBox className="dp-listbox">{children}</ListBox>
      </Popover>
    </AriaComboBox>
  );
}

export function ComboboxItem(props: ListBoxItemProps) {
  return <ListBoxItem {...props} className="dp-listbox-item" />;
}
