/**
 * Dev-Portal Menu — react-aria-components `MenuTrigger` + `Menu` +
 * `MenuItem`. Single-press popover menu (e.g. "more actions").
 */
import {
  Button,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  type MenuItemProps as AriaMenuItemProps,
  type MenuProps as AriaMenuProps,
  MenuTrigger,
  Popover,
} from "react-aria-components";

export interface MenuProps<T> extends AriaMenuProps<T> {
  trigger: React.ReactNode;
}

export function Menu<T extends object>({ trigger, children, ...rest }: MenuProps<T>) {
  return (
    <MenuTrigger>
      <Button className="dp-button">{trigger}</Button>
      <Popover className="dp-popover">
        <AriaMenu {...rest} className="dp-listbox">
          {children}
        </AriaMenu>
      </Popover>
    </MenuTrigger>
  );
}

export function MenuItem(props: AriaMenuItemProps) {
  return <AriaMenuItem {...props} className="dp-listbox-item" />;
}
