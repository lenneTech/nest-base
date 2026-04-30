/**
 * Faithful React port of `json-viewer-ui.ts`'s server-side renderer.
 * Same syntax-highlighted output, same collapse/expand behaviour
 * (collapsed by default at `depth >= 3`), same key-search highlight,
 * same toolbar (Expand all / Collapse all / Copy / Raw .json).
 *
 * The recursion is intentional — strings, numbers, booleans, nulls,
 * undefineds, BigInts, Symbols, functions, cycles get the same
 * special-cased rendering the server does. Cycles fall back to
 * `[Circular]`.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";

interface JsonViewerProps {
  /** Value to render. */
  value: unknown;
  /** Optional href for the "Raw .json ↗" link in the toolbar. */
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
    <div className="admin-card">
      <div className="jv-toolbar">
        <input
          type="search"
          className="jv-search"
          placeholder="Filter keys (highlights matches)…"
          autoComplete="off"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="jv-actions">
          <button type="button" className="jv-btn" onClick={() => setExpandSignal("all")}>
            Expand all
          </button>
          <button type="button" className="jv-btn" onClick={() => setExpandSignal("collapse")}>
            Collapse all
          </button>
          <button type="button" className="jv-btn jv-btn--accent" onClick={() => void onCopy()}>
            Copy JSON
          </button>
          {rawJsonHref ? (
            <a className="jv-btn" href={rawJsonHref} target="_blank" rel="noopener noreferrer">
              Raw .json ↗
            </a>
          ) : null}
        </div>
      </div>
      <pre className="jv">
        <code className="jv__root">
          <Value
            value={value}
            depth={0}
            seen={new WeakSet()}
            filter={filter.trim().toLowerCase()}
            expandSignal={expandSignal}
          />
        </code>
      </pre>
      <div className={`jv__copied${copied ? " is-visible" : ""}`}>✓ Copied to clipboard</div>
    </div>
  );
}

interface ValueProps {
  value: unknown;
  depth: number;
  seen: WeakSet<object>;
  filter: string;
  expandSignal: "all" | "collapse" | "auto";
}

function Value({ value, depth, seen, filter, expandSignal }: ValueProps): ReactNode {
  if (value === null) return <span className="jv__null">null</span>;
  if (value === undefined) return <span className="jv__special">undefined</span>;
  switch (typeof value) {
    case "string":
      return <span className="jv__string">{JSON.stringify(value)}</span>;
    case "number":
      return <span className="jv__number">{String(value)}</span>;
    case "boolean":
      return <span className="jv__boolean">{String(value)}</span>;
    case "bigint":
      return <span className="jv__number">{`${String(value)}n`}</span>;
    case "symbol":
      return <span className="jv__special">{String(value)}</span>;
    case "function":
      return <span className="jv__special">[Function]</span>;
    case "object":
      break;
    default:
      return <span className="jv__special">{String(value)}</span>;
  }
  if (seen.has(value as object)) {
    return <span className="jv__special">[Circular]</span>;
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="jv__brace">[]</span>;
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
            <span className="jv__indent" />
            <Value
              value={item}
              depth={depth + 1}
              seen={seen}
              filter={filter}
              expandSignal={expandSignal}
            />
            {idx < value.length - 1 ? <span className="jv__comma">,</span> : null}
            {"\n"}
          </span>
        ))}
      </ContainerNode>
    );
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span className="jv__brace">{"{}"}</span>;
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
            <span className="jv__indent" />
            <span className={`jv__key${matches ? " jv__key--match" : ""}`}>
              {JSON.stringify(k)}
            </span>
            <span className="jv__comma">: </span>
            <Value
              value={v}
              depth={depth + 1}
              seen={seen}
              filter={filter}
              expandSignal={expandSignal}
            />
            {idx < entries.length - 1 ? <span className="jv__comma">,</span> : null}
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
    <span className="jv__node" data-collapsed={String(collapsed)} data-count={countLabel}>
      <span className="jv__summary">
        <span
          className={`jv__toggle ${collapsed ? "jv__toggle--collapsed" : "jv__toggle--expanded"}`}
          onClick={() => setCollapsed((c) => !c)}
        />
        <span className="jv__brace">{open}</span>
      </span>
      <span className="jv__children">
        {"\n"}
        {children}
      </span>
      <span className="jv__brace">{close}</span>
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
