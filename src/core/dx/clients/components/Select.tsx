/**
 * Dev-Portal Select — react-aria-components `Select` + listbox.
 *
 * Replaces native `<select>` everywhere in `clients/`. The popup is a
 * Portal so it correctly overlays modals and tabs.
 */
import {
  Button,
  Label,
  ListBox,
  ListBoxItem,
  type ListBoxItemProps,
  Popover,
  Select as AriaSelect,
  SelectValue,
  type SelectProps as AriaSelectProps,
} from "react-aria-components";

export interface SelectProps<T extends object = object> extends AriaSelectProps<T> {
  label: string;
  children: React.ReactNode;
}

export function Select<T extends object>({ label, children, ...rest }: SelectProps<T>) {
  return (
    <AriaSelect {...rest} className="dp-field">
      <Label className="dp-field__label">{label}</Label>
      <Button className="dp-select-button">
        <SelectValue />
        <span aria-hidden="true">▾</span>
      </Button>
      <Popover className="dp-popover">
        <ListBox className="dp-listbox">{children}</ListBox>
      </Popover>
    </AriaSelect>
  );
}

export function SelectItem(props: ListBoxItemProps) {
  return <ListBoxItem {...props} className="dp-listbox-item" />;
}
