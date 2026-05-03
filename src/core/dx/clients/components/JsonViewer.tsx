/**
 * JSON Viewer with collapse / expand / search / copy.
 *
 * Re-implementation of the legacy server-rendered viewer on top of
 * Tailwind utilities + shadcn primitives. Same behaviour as before:
 * collapsed-by-default at `depth >= 3`, key-search highlight, raw-JSON
 * copy + open-in-new-tab.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { cn } from "../lib/utils.js";

import { Button } from "./ui/button.js";
import { Card } from "./ui/card.js";
import { Input } from "./ui/input.js";

interface JsonViewerProps {
  /** Value to render. */
  value: unknown;
  /** Optional href for the "Raw .json" link in the toolbar. */
  rawJsonHref?: string;
}

export function JsonViewer({ value, rawJsonHref }: JsonViewerProps): ReactNode {
  const [filter, setFilter] = useState("");
  const [expandSignal, setExpandSignal] = useState<"all" | "collapse" | "auto">("auto");
  const [copied, setCopied] = useState(false);

  const rawJson = useMemo(() => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "<<unserializable>>";
    }
  }, [value]);

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(rawJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard API may be blocked, ignore */
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2/60 p-3">
        <Input
          type="search"
          className="h-8 max-w-xs"
          placeholder="Filter keys (highlights matches)…"
          autoComplete="off"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setExpandSignal("all")}>
            Expand all
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setExpandSignal("collapse")}
          >
            Collapse all
          </Button>
          <Button type="button" size="sm" variant="default" onClick={() => void onCopy()}>
            Copy JSON
          </Button>
          {rawJsonHref ? (
            <Button asChild size="sm" variant="outline">
              <a href={rawJsonHref} target="_blank" rel="noopener noreferrer">
                Raw .json ↗
              </a>
            </Button>
          ) : null}
        </div>
      </div>
      <pre className="m-0 overflow-auto bg-surface-1 p-4 font-mono text-xs leading-relaxed text-fg">
        <code>
          <Value
            value={value}
            depth={0}
            ancestors={EMPTY_ANCESTORS}
            filter={filter.trim().toLowerCase()}
            expandSignal={expandSignal}
          />
        </code>
      </pre>
      <div
        className={cn(
          "pointer-events-none absolute bottom-4 right-4 rounded-md border border-line-accent bg-surface-1 px-3 py-1.5 text-xs text-accent shadow-md transition-opacity",
          copied ? "opacity-100" : "opacity-0",
        )}
      >
        ✓ Copied to clipboard
      </div>
    </Card>
  );
}

interface ValueProps {
  value: unknown;
  depth: number;
  /**
   * Immutable chain of ancestor objects on the path from the root to
   * this node. We pass a per-call snapshot (not a shared mutable
   * `WeakSet`) so React's StrictMode double-render in dev builds —
   * which used to flag every node as `[Circular]` because siblings
   * inherited each other's seen-set — no longer leaks state between
   * branches. Length is O(depth), and JSON parsed from `fetch().json()`
   * cannot be circular anyway; this guard exists only to keep the
   * viewer robust if someone hands it a non-JSON object graph.
   */
  ancestors: readonly object[];
  filter: string;
  expandSignal: "all" | "collapse" | "auto";
}

const EMPTY_ANCESTORS: readonly object[] = Object.freeze([]);

function Value({ value, depth, ancestors, filter, expandSignal }: ValueProps): ReactNode {
  if (value === null) return <span className="text-fg-muted">null</span>;
  if (value === undefined) return <span className="text-fg-muted">undefined</span>;
  switch (typeof value) {
    case "string":
      return <span className="text-ok">{JSON.stringify(value)}</span>;
    case "number":
      return <span className="text-warn">{String(value)}</span>;
    case "boolean":
      return <span className="text-warn">{String(value)}</span>;
    case "bigint":
      return <span className="text-warn">{`${String(value)}n`}</span>;
    case "symbol":
      return <span className="text-fg-muted">{String(value)}</span>;
    case "function":
      return <span className="text-fg-muted">[Function]</span>;
    case "object":
      break;
    default:
      return <span className="text-fg-muted">{String(value)}</span>;
  }
  if (ancestors.includes(value as object)) {
    return <span className="text-fg-muted">[Circular]</span>;
  }
  const childAncestors: readonly object[] = [...ancestors, value as object];

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-fg-dim">[]</span>;
    return (
      <ContainerNode
        depth={depth}
        autoCollapsed={false}
        expandSignal={expandSignal}
        countLabel={`${value.length} items`}
        open="["
        close="]"
      >
        {value.map((item, idx) => (
          <span key={idx}>
            <span className="inline-block w-4" />
            <Value
              value={item}
              depth={depth + 1}
              ancestors={childAncestors}
              filter={filter}
              expandSignal={expandSignal}
            />
            {idx < value.length - 1 ? <span className="text-fg-dim">,</span> : null}
            {"\n"}
          </span>
        ))}
      </ContainerNode>
    );
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span className="text-fg-dim">{"{}"}</span>;
  return (
    <ContainerNode
      depth={depth}
      autoCollapsed={depth >= 3}
      expandSignal={expandSignal}
      countLabel={`${entries.length} keys`}
      open="{"
      close="}"
    >
      {entries.map(([k, v], idx) => {
        const matches = filter.length > 0 && k.toLowerCase().includes(filter);
        return (
          <span key={k}>
            <span className="inline-block w-4" />
            <span
              className={cn(
                "text-accent",
                matches && "rounded bg-accent-soft px-0.5 ring-1 ring-accent",
              )}
            >
              {JSON.stringify(k)}
            </span>
            <span className="text-fg-dim">: </span>
            <Value
              value={v}
              depth={depth + 1}
              ancestors={childAncestors}
              filter={filter}
              expandSignal={expandSignal}
            />
            {idx < entries.length - 1 ? <span className="text-fg-dim">,</span> : null}
            {"\n"}
          </span>
        );
      })}
    </ContainerNode>
  );
}

interface ContainerNodeProps {
  depth: number;
  autoCollapsed: boolean;
  expandSignal: "all" | "collapse" | "auto";
  countLabel: string;
  open: string;
  close: string;
  children: ReactNode;
}

function ContainerNode({
  autoCollapsed,
  expandSignal,
  countLabel,
  open,
  close,
  children,
}: ContainerNodeProps): ReactNode {
  const [collapsed, setCollapsed] = useState(autoCollapsed);
  // React to global expand/collapse-all signals.
  useReactToSignal(expandSignal, setCollapsed);
  return (
    <span data-collapsed={String(collapsed)} data-count={countLabel}>
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          aria-label={collapsed ? "Expand" : "Collapse"}
          onClick={() => setCollapsed((c) => !c)}
          className="font-mono text-fg-dim hover:text-accent"
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <span className="text-fg-dim">{open}</span>
        {collapsed ? <span className="text-fg-faint">{` … ${countLabel} `}</span> : null}
      </span>
      {!collapsed ? (
        <span>
          {"\n"}
          {children}
        </span>
      ) : null}
      <span className="text-fg-dim">{close}</span>
    </span>
  );
}

function useReactToSignal(
  signal: "all" | "collapse" | "auto",
  setCollapsed: (next: boolean) => void,
): void {
  useEffect(() => {
    if (signal === "all") setCollapsed(false);
    else if (signal === "collapse") setCollapsed(true);
  }, [signal, setCollapsed]);
}
