/**
 * Dev-Portal Tabs — react-aria-components `Tabs` / `TabList` / `Tab` /
 * `TabPanel`.
 */
import {
  Tab as AriaTab,
  TabList as AriaTabList,
  TabPanel as AriaTabPanel,
  Tabs as AriaTabs,
  type TabListProps as AriaTabListProps,
  type TabPanelProps as AriaTabPanelProps,
  type TabProps as AriaTabProps,
  type TabsProps as AriaTabsProps,
} from "react-aria-components";

export function Tabs(props: AriaTabsProps) {
  return <AriaTabs {...props} className="dp-tabs" />;
}

export function TabList<T extends object>(props: AriaTabListProps<T>) {
  return <AriaTabList {...props} className="dp-tab-list" />;
}

export function Tab(props: AriaTabProps) {
  return <AriaTab {...props} className="dp-tab" />;
}

export function TabPanel(props: AriaTabPanelProps) {
  return <AriaTabPanel {...props} />;
}
