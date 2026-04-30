/**
 * `/dev/erd` — verbatim React port of `erd-ui.ts`. Same toolbar
 * (toggle source / copy Mermaid), same Mermaid-rendered canvas in
 * the dark theme.
 *
 * Mermaid is loaded from the CDN as an ESM module on first paint —
 * the legacy server page does the same. CSP allows
 * `cdn.jsdelivr.net` in dev (see `security-headers.ts`).
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";

interface ErdResponse {
  mermaid: string;
  modelCount: number;
  relationCount: number;
}

// Cached Mermaid module promise — load once per session.
let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid(): Promise<typeof import("mermaid").default> {
  if (!mermaidPromise) {
    mermaidPromise = import(
      /* @vite-ignore */ "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs"
    ).then((m) => {
      const lib =
        (m as unknown as { default?: typeof import("mermaid").default }).default ??
        (m as unknown as typeof import("mermaid").default);
      lib.initialize({
        startOnLoad: false,
        theme: "dark",
        themeVariables: { fontFamily: "monospace", fontSize: "13px" },
      });
      return lib;
    });
  }
  return mermaidPromise;
}

export function ErdPage(): ReactNode {
  const data = useQuery({
    queryKey: ["dev", "erd"],
    queryFn: () => fetchJson<ErdResponse>("/dev/erd.json"),
  });

  const subtitle =
    data.data && data.data.modelCount === 0
      ? "Live Prisma schema diagram. No models found in prisma/schema.prisma. Did you run `bun run prepare:schema`?"
      : data.data
        ? `Live Prisma schema diagram. ${data.data.modelCount} model(s), ${data.data.relationCount} relation(s).`
        : "Live Prisma schema diagram.";

  return (
    <AdminShell title="ERD" subtitle={subtitle} currentNav="erd">
      {data.data ? (
        <ErdBody mermaidSrc={data.data.mermaid} />
      ) : data.isError ? (
        <div className="admin-empty">Failed to load ERD.</div>
      ) : (
        <div className="admin-empty">Loading ERD…</div>
      )}
    </AdminShell>
  );
}

function ErdBody({ mermaidSrc }: { mermaidSrc: string }): ReactNode {
  const [showSource, setShowSource] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = await loadMermaid();
        const id = `erd-${Date.now()}`;
        const result = await mermaid.render(id, mermaidSrc);
        if (cancelled) return;
        if (canvasRef.current) {
          canvasRef.current.innerHTML = result.svg;
        }
      } catch (err) {
        if (cancelled) return;
        if (canvasRef.current) {
          canvasRef.current.innerHTML = `<div class="admin-empty">Mermaid render failed: ${String(err)}</div>`;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mermaidSrc]);

  return (
    <div className="erd-card">
      <div className="erd-toolbar">
        <button type="button" onClick={() => setShowSource((s) => !s)}>
          {showSource ? "Hide source" : "Show source"}
        </button>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(mermaidSrc);
          }}
        >
          Copy Mermaid
        </button>
      </div>
      {showSource ? <textarea className="erd-source" readOnly value={mermaidSrc} /> : null}
      <div className="erd-canvas" ref={canvasRef} />
    </div>
  );
}
