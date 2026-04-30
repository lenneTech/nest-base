/**
 * `/dev/components` — Living style guide for the Dev-Portal component
 * library.
 *
 * Every primitive declared in `clients/components/index.ts` shows up
 * here at least once in its v1 variants. Adding a new variant? Add
 * an example here too — that's the convention.
 */
import { useState } from "react";

import { AdminShell } from "../layout/AdminShell.js";
import {
  Button,
  Checkbox,
  Combobox,
  ComboboxItem,
  DialogModal,
  FileTrigger,
  Menu,
  MenuItem,
  NumberField,
  Radio,
  RadioGroup,
  Select,
  SelectItem,
  Switch,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextField,
  ToastProvider,
  Tooltip,
  useToasts,
} from "../components/index.js";

function ToastDemo() {
  const toasts = useToasts();
  return (
    <Button onPress={() => toasts.push("Hello from a Dev-Portal toast!")} variant="accent">
      Push toast
    </Button>
  );
}

export function ComponentShowcasePage() {
  const [textValue, setTextValue] = useState("");
  const [numberValue, setNumberValue] = useState(42);
  const [switchOn, setSwitchOn] = useState(false);
  const [checked, setChecked] = useState(false);
  const [radio, setRadio] = useState("a");
  const [files, setFiles] = useState<string>("");

  return (
    <AdminShell
      title="Components"
      subtitle="Living style guide for every react-aria-components primitive used by the Dev-Portal."
      currentNav="components"
    >
      <ToastProvider>
        <section className="admin-card">
          <h2 className="admin-card__title">Buttons</h2>
          <div className="dp-component-row">
            <Button>Default</Button>
            <Button variant="accent">Accent</Button>
            <Button variant="ghost">Ghost</Button>
            <Button isDisabled>Disabled</Button>
          </div>
        </section>

        <section className="admin-card">
          <h2 className="admin-card__title">Inputs</h2>
          <div className="dp-component-row">
            <TextField
              label="Name"
              value={textValue}
              onChange={setTextValue}
              placeholder="e.g. Alice"
            />
            <NumberField label="Count" value={numberValue} onChange={setNumberValue} minValue={0} />
          </div>
        </section>

        <section className="admin-card">
          <h2 className="admin-card__title">Toggles</h2>
          <div className="dp-component-row">
            <Switch isSelected={switchOn} onChange={setSwitchOn}>
              Enable feature
            </Switch>
            <Checkbox isSelected={checked} onChange={setChecked}>
              I agree
            </Checkbox>
            <RadioGroup label="Plan" value={radio} onChange={setRadio}>
              <Radio value="a">Free</Radio>
              <Radio value="b">Pro</Radio>
              <Radio value="c">Enterprise</Radio>
            </RadioGroup>
          </div>
        </section>

        <section className="admin-card">
          <h2 className="admin-card__title">Pickers</h2>
          <div className="dp-component-row">
            <Select label="Environment" defaultSelectedKey="dev">
              <SelectItem id="dev">development</SelectItem>
              <SelectItem id="stg">staging</SelectItem>
              <SelectItem id="prd">production</SelectItem>
            </Select>
            <Combobox label="Resource" placeholder="Search…">
              <ComboboxItem id="user">User</ComboboxItem>
              <ComboboxItem id="role">Role</ComboboxItem>
              <ComboboxItem id="policy">Policy</ComboboxItem>
              <ComboboxItem id="webhook">Webhook</ComboboxItem>
            </Combobox>
          </div>
        </section>

        <section className="admin-card">
          <h2 className="admin-card__title">Dialog · Toast · Menu · Tooltip</h2>
          <div className="dp-component-row">
            <DialogModal trigger="Open dialog" title="Confirm action" triggerVariant="accent">
              {({ close }) => (
                <div>
                  <p style={{ color: "var(--fg-muted)", margin: "0 0 1rem" }}>
                    This is a react-aria-components Modal. Close to dismiss.
                  </p>
                  <Button onPress={close}>Close</Button>
                </div>
              )}
            </DialogModal>
            <ToastDemo />
            <Menu trigger="Actions">
              <MenuItem>Copy</MenuItem>
              <MenuItem>Duplicate</MenuItem>
              <MenuItem>Delete</MenuItem>
            </Menu>
            <Tooltip label="Toggle dark mode">{"i"}</Tooltip>
          </div>
        </section>

        <section className="admin-card">
          <h2 className="admin-card__title">Tabs</h2>
          <Tabs>
            <TabList aria-label="Sample tabs">
              <Tab id="overview">Overview</Tab>
              <Tab id="settings">Settings</Tab>
              <Tab id="advanced">Advanced</Tab>
            </TabList>
            <TabPanel id="overview">
              <p>Overview content goes here.</p>
            </TabPanel>
            <TabPanel id="settings">
              <p>Settings content goes here.</p>
            </TabPanel>
            <TabPanel id="advanced">
              <p>Advanced content goes here.</p>
            </TabPanel>
          </Tabs>
        </section>

        <section className="admin-card">
          <h2 className="admin-card__title">FileTrigger</h2>
          <div className="dp-component-row">
            <FileTrigger
              buttonLabel="Choose file…"
              onSelect={(list) => {
                if (!list) return;
                const arr = Array.from(list);
                setFiles(arr.map((f) => f.name).join(", "));
              }}
            />
            {files ? <span style={{ color: "var(--fg-muted)" }}>{files}</span> : null}
          </div>
        </section>
      </ToastProvider>
    </AdminShell>
  );
}
