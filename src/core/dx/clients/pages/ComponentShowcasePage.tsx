/**
 * `/dev/components` — Living style guide for the Dev-Portal shadcn-ui
 * component library.
 *
 * Every primitive vendored under `components/ui/` shows up here in
 * each meaningful variant. Adding a new variant? Add an example here
 * too — that's the convention.
 */
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { Checkbox } from "../components/ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Progress } from "../components/ui/progress.js";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import { Separator } from "../components/ui/separator.js";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../components/ui/sheet.js";
import { Switch } from "../components/ui/switch.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.js";
import { Textarea } from "../components/ui/textarea.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip.js";

import { AdminShell } from "../layout/AdminShell.js";

export function ComponentShowcasePage(): ReactNode {
  const [textValue, setTextValue] = useState("");
  const [textareaValue, setTextareaValue] = useState("");
  const [switchOn, setSwitchOn] = useState(false);
  const [checked, setChecked] = useState(false);
  const [radio, setRadio] = useState("a");
  const [select, setSelect] = useState("medium");
  const [progress, setProgress] = useState(45);

  return (
    <AdminShell
      title="Components"
      subtitle="Living style guide for every shadcn-ui primitive used by the Dev-Portal."
      currentNav="components"
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section title="Buttons">
          <div className="flex flex-wrap gap-2">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
            <Button disabled>Disabled</Button>
          </div>
          <Separator />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">Small</Button>
            <Button>Default</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" aria-label="Search">
              ⌕
            </Button>
          </div>
        </Section>

        <Section title="Badges">
          <div className="flex flex-wrap gap-2">
            <Badge>default</Badge>
            <Badge variant="secondary">secondary</Badge>
            <Badge variant="outline">outline</Badge>
            <Badge variant="destructive">destructive</Badge>
            <Badge variant="ok">ok</Badge>
            <Badge variant="warn">warn</Badge>
            <Badge variant="err">err</Badge>
            <Badge variant="info">info</Badge>
          </div>
        </Section>

        <Section title="Inputs">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="demo-input">Text input</Label>
              <Input
                id="demo-input"
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                placeholder="Type here…"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="demo-textarea">Textarea</Label>
              <Textarea
                id="demo-textarea"
                value={textareaValue}
                onChange={(e) => setTextareaValue(e.target.value)}
                placeholder="Multi-line input…"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="demo-select">Select</Label>
              <Select value={select} onValueChange={setSelect}>
                <SelectTrigger id="demo-select" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="small">Small</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="large">Large</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </Section>

        <Section title="Toggles">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Switch checked={switchOn} onCheckedChange={setSwitchOn} id="demo-switch" />
              <Label htmlFor="demo-switch">Switch — {switchOn ? "on" : "off"}</Label>
            </div>
            <div className="flex items-center gap-3">
              <Checkbox checked={checked} onCheckedChange={(v) => setChecked(Boolean(v))} id="demo-checkbox" />
              <Label htmlFor="demo-checkbox">Checkbox</Label>
            </div>
            <RadioGroup value={radio} onValueChange={setRadio}>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="a" id="r-a" />
                <Label htmlFor="r-a">Option A</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="b" id="r-b" />
                <Label htmlFor="r-b">Option B</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="c" id="r-c" />
                <Label htmlFor="r-c">Option C</Label>
              </div>
            </RadioGroup>
          </div>
        </Section>

        <Section title="Tabs">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
              <TabsTrigger value="logs">Logs</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <p className="text-sm text-fg-muted">Overview tab content.</p>
            </TabsContent>
            <TabsContent value="settings">
              <p className="text-sm text-fg-muted">Settings tab content.</p>
            </TabsContent>
            <TabsContent value="logs">
              <p className="text-sm text-fg-muted">Logs tab content.</p>
            </TabsContent>
          </Tabs>
        </Section>

        <Section title="Progress">
          <div className="flex flex-col gap-3">
            <Progress value={progress} />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setProgress((p) => Math.max(0, p - 10))}>
                −10
              </Button>
              <Button size="sm" variant="outline" onClick={() => setProgress((p) => Math.min(100, p + 10))}>
                +10
              </Button>
              <span className="ml-auto self-center font-mono text-xs text-fg-muted">{progress}%</span>
            </div>
          </div>
        </Section>

        <Section title="Overlays">
          <div className="flex flex-wrap gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Open dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Confirm action</DialogTitle>
                  <DialogDescription>This is a shadcn `Dialog` example.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline">Cancel</Button>
                  <Button>Confirm</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">Open sheet</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Drawer</SheetTitle>
                  <SheetDescription>Right-aligned drawer / sheet.</SheetDescription>
                </SheetHeader>
                <p className="mt-4 text-sm text-fg-muted">
                  Sheet content goes here. Used by the Realtime Inspector for socket and event
                  details.
                </p>
              </SheetContent>
            </Sheet>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline">Hover for tooltip</Button>
              </TooltipTrigger>
              <TooltipContent>Tiny help text.</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">Open menu</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Profile</DropdownMenuItem>
                <DropdownMenuItem>Settings</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-err">Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => toast.success("Hello from a Dev-Portal toast!")}>
              Push toast
            </Button>
          </div>
        </Section>

        <Section title="Tables" className="xl:col-span-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Endpoint</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Latency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { ep: "/v1/projects", method: "GET", status: "200", lat: "12 ms" },
                { ep: "/v1/projects", method: "POST", status: "201", lat: "84 ms" },
                { ep: "/v1/projects/:id", method: "DELETE", status: "204", lat: "39 ms" },
              ].map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{row.ep}</TableCell>
                  <TableCell>
                    <Badge variant="info" className="font-mono text-[0.65rem]">
                      {row.method}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono">{row.status}</TableCell>
                  <TableCell className="font-mono">{row.lat}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>

        <Section title="Brand Tokens" className="xl:col-span-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
            {[
              "bg",
              "surface-1",
              "surface-2",
              "surface-3",
              "accent",
              "ok",
              "warn",
              "err",
              "fg",
              "fg-muted",
              "fg-dim",
              "fg-faint",
            ].map((name) => (
              <div key={name} className="flex flex-col gap-1.5">
                <div
                  className="h-12 w-full rounded-md border border-line"
                  style={{ background: `var(--${name})` }}
                />
                <span className="font-mono text-[0.65rem] text-fg-dim">--{name}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </AdminShell>
  );
}

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}
