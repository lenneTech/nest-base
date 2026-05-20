/**
 * `/dev/brand` — read-only viewer (with reset action) for the
 * project brand configuration.
 *
 * Reset posts to `/dev/brand/reset` which deletes
 * `src/modules/branding/brand.json` and triggers the dev-runner's
 * brand-watcher to restart the API.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { PageError, PageLoading } from "../components/PageState.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";

interface BrandConfig {
  name: string;
  shortName?: string;
  tagline?: string;
  primaryColor: string;
  primaryColorInk: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  mutedTextColor: string;
  fromEmail: string;
  legalEntity?: string;
  supportEmail?: string;
  supportUrl?: string;
  logoUrl?: string;
  logoSvgInline?: string;
}

export function BrandPage(): ReactNode {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery<BrandConfig>({
    queryKey: ["brand"],
    queryFn: () => fetchJson<BrandConfig>("/hub/brand.json"),
  });

  const reset = useMutation({
    mutationFn: async () => {
      const res = await fetch("/hub/brand/reset", { method: "POST" });
      if (!res.ok) throw new Error(`reset failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brand"] });
    },
  });

  return (
    <AdminShell
      title="Brand"
      subtitle="Active brand configuration — reads from src/modules/branding/brand.json (with template fallback)"
      currentNav="brand"
    >
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Active brand</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <PageLoading>Loading…</PageLoading>
            ) : isError ? (
              <PageError>Failed to load brand.</PageError>
            ) : data ? (
              <BrandPreview brand={data} />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reset to default</CardTitle>
            <p className="text-xs text-fg-muted">
              Deletes <code className="font-mono text-accent">src/modules/branding/brand.json</code>{" "}
              and falls back to{" "}
              <code className="font-mono text-accent">src/core/branding/brand.default.json</code>.
              The dev runner restarts the API automatically.
            </p>
          </CardHeader>
          <CardContent>
            <Button
              variant="danger"
              onClick={() => {
                if (
                  window.confirm("Delete src/modules/branding/brand.json and reset to default?")
                ) {
                  reset.mutate();
                }
              }}
              disabled={reset.isPending}
            >
              {reset.isPending ? "Resetting…" : "Reset brand"}
            </Button>
            {reset.isSuccess ? (
              <p className="mt-2 text-sm text-ok">
                Brand reset. The dev runner is restarting the API.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  );
}

function BrandPreview({ brand }: { brand: BrandConfig }): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="m-0 text-xl font-semibold">{brand.name}</h2>
        {brand.tagline ? <p className="mt-1 text-sm text-fg-muted">{brand.tagline}</p> : null}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <ColorSwatch label="primaryColor" value={brand.primaryColor} />
        <ColorSwatch label="primaryColorInk" value={brand.primaryColorInk} />
        <ColorSwatch label="backgroundColor" value={brand.backgroundColor} />
        <ColorSwatch label="surfaceColor" value={brand.surfaceColor} />
        <ColorSwatch label="textColor" value={brand.textColor} />
        <ColorSwatch label="mutedTextColor" value={brand.mutedTextColor} />
      </div>
      <dl className="grid grid-cols-[10rem_1fr] gap-y-1 text-xs">
        {brand.legalEntity ? <Row label="legalEntity" value={brand.legalEntity} /> : null}
        <Row label="fromEmail" value={brand.fromEmail} />
        {brand.supportEmail ? <Row label="supportEmail" value={brand.supportEmail} /> : null}
        {brand.supportUrl ? <Row label="supportUrl" value={brand.supportUrl} /> : null}
      </dl>
    </div>
  );
}

function ColorSwatch({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="rounded-md border border-line bg-surface-2 p-2">
      <div className="mb-2 h-8 w-full rounded" style={{ background: value }} />
      <div className="font-mono text-[0.65rem] text-fg-dim">{label}</div>
      <div className="font-mono text-xs text-fg">{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <>
      <dt className="font-mono text-fg-dim">{label}</dt>
      <dd className="m-0 break-all font-mono text-fg">{value}</dd>
    </>
  );
}
