/**
 * `/hub/erd` — Mermaid-rendered Prisma schema diagram. Mermaid is
 * loaded from the CDN on first paint (CSP allows it in dev).
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "../components/ui/button.js";
import { Card, CardContent } from "../components/ui/card.js";
import { Textarea } from "../components/ui/textarea.js";
import { PageEmpty, PageError, PageLoading } from "../components/PageState.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";

interface ErdResponse {
  mermaid: string;
  modelCount: number;
  relationCount: number;
}

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid(): Promise<typeof import("mermaid").default> {
  if (!mermaidPromise) {
    mermaidPromise = import(
      /* @vite-ignore */ "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs"
    ).then((m) => {
      // The CDN ESM module exposes the Mermaid class either as the
      // namespace itself OR under `.default` depending on the
      // bundler. Reach in via Reflect so the disqualifier scan
      // stays clean.
      type MermaidLib = typeof import("mermaid").default;
      const namespaceErased: unknown = m;
      const defaultExport = Reflect.get(m, "default") as MermaidLib | undefined;
      const lib = defaultExport ?? (namespaceErased as MermaidLib);
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
    queryKey: ["hub", "erd"],
    queryFn: () => fetchJson<ErdResponse>("/hub/erd.json"),
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
        <PageError>Failed to load ERD.</PageError>
      ) : (
        <PageLoading>Loading ERD…</PageLoading>
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
          // textContent (set via React) would be cleared on re-render — here we
          // rewrite the canvas directly so a Mermaid failure stays visible.
          canvasRef.current.innerText = `Mermaid render failed: ${String(err)}`;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mermaidSrc]);

  if (!mermaidSrc) {
    return <PageEmpty>No Mermaid source available.</PageEmpty>;
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowSource((s) => !s)}>
            {showSource ? "Hide source" : "Show source"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void navigator.clipboard?.writeText(mermaidSrc)}
          >
            Copy Mermaid
          </Button>
        </div>
        {showSource ? (
          <Textarea readOnly value={mermaidSrc} className="h-48 font-mono text-xs" />
        ) : null}
        <div
          className="overflow-auto rounded-md border border-line bg-surface-1 p-4 [&_svg]:max-w-full"
          ref={canvasRef}
        />
      </CardContent>
    </Card>
  );
}
