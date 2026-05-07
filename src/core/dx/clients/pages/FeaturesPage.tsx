/**
 * `/dev/features` — feature-flag dashboard. Three-tile summary +
 * per-category card grid with switches; flipping a switch POSTs to
 * `/dev/features/:key/toggle`, then polls `/health/live` until the
 * dev-server restart completes and reloads the page.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { Switch } from "../components/ui/switch.js";
import { PageError, PageLoading, StatTile } from "../components/PageState.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";
import { cn } from "../lib/utils.js";

interface FeatureMeta {
  key: string;
  label: string;
  description: string;
  envKey: string;
  category: "infrastructure" | "communication" | "data" | "integration" | "observability";
  exposes: string[];
}

interface FeatureCatalogResponse {
  catalog: FeatureMeta[];
  features: Record<string, { enabled?: boolean }>;
}

const CATEGORY_LABEL: Record<string, string> = {
  infrastructure: "Infrastructure",
  communication: "Communication",
  data: "Data",
  integration: "Integration",
  observability: "Observability",
};

function isActive(features: FeatureCatalogResponse["features"], key: string): boolean {
  const section = features[key];
  if (!section || typeof section !== "object") return false;
  return Boolean((section as { enabled?: unknown }).enabled);
}

export function FeaturesPage(): ReactNode {
  const data = useQuery({
    queryKey: ["dev", "feature-catalog"],
    queryFn: () => fetchJson<FeatureCatalogResponse>("/hub/feature-catalog.json"),
  });

  const subtitle = data.data
    ? `${data.data.catalog.filter((m) => isActive(data.data!.features, m.key)).length} of ${data.data.catalog.length} feature flags currently enabled.`
    : "Loading…";

  return (
    <AdminShell title="Features" subtitle={subtitle} currentNav="features">
      {data.data ? (
        <FeaturesBody data={data.data} />
      ) : data.isError ? (
        <PageError>Failed to load feature catalog.</PageError>
      ) : (
        <PageLoading>Loading feature catalog…</PageLoading>
      )}
    </AdminShell>
  );
}

function FeaturesBody({ data }: { data: FeatureCatalogResponse }): ReactNode {
  const total = data.catalog.length;
  const active = data.catalog.filter((m) => isActive(data.features, m.key)).length;
  const available = total - active;

  const grouped = new Map<string, FeatureMeta[]>();
  for (const meta of data.catalog) {
    const list = grouped.get(meta.category) ?? [];
    list.push(meta);
    grouped.set(meta.category, list);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Active" value={active} tone="ok" />
        <StatTile label="Available" value={available} />
        <StatTile label="Total" value={total} />
      </div>

      {Array.from(grouped.entries()).map(([category, list]) => (
        <Card key={category}>
          <CardHeader>
            <CardTitle>{CATEGORY_LABEL[category] ?? category}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {list.map((meta) => (
                <FeatureCard
                  key={meta.key}
                  meta={meta}
                  active={isActive(data.features, meta.key)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>How toggling works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-fg-muted">
          Flipping a switch above writes the matching{" "}
          <code className="font-mono text-accent">FEATURE_*_ENABLED</code> line into{" "}
          <code className="font-mono text-accent">.env</code> and touches{" "}
          <code className="font-mono text-accent">src/main.ts</code> so{" "}
          <code className="font-mono text-accent">bun --watch</code> restarts the API. The page
          reloads automatically once the new process answers. Module imports and controller
          registration are driven entirely by these flags — see{" "}
          <code className="font-mono text-accent">src/core/features/features.ts</code> for the
          schema.
        </CardContent>
      </Card>
    </div>
  );
}

interface FeatureCardProps {
  meta: FeatureMeta;
  active: boolean;
}

function FeatureCard({ meta, active }: FeatureCardProps): ReactNode {
  const [overlay, setOverlay] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "Applying feature change. The page will reload when the API is back.",
  });
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const checked = optimistic ?? active;

  const mutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      setOptimistic(enabled);
      const res = await fetch(`/dev/features/${encodeURIComponent(meta.key)}/toggle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Toggle failed: ${res.status} ${text}`);
      }
      return enabled;
    },
    onSuccess: () => {
      setOverlay({ visible: true, message: "Restarting server…" });
      const start = Date.now();
      const deadline = start + 30_000;
      const poll = async (): Promise<void> => {
        await new Promise((r) => setTimeout(r, 600));
        try {
          const r = await fetch("/health/live", { cache: "no-store" });
          if (r.ok) {
            await new Promise((res) => setTimeout(res, 200));
            window.location.reload();
            return;
          }
        } catch {
          /* expected during restart */
        }
        if (Date.now() < deadline) {
          setTimeout(() => void poll(), 500);
        } else {
          setOverlay({
            visible: true,
            message: "Restart took longer than expected. Reload manually.",
          });
        }
      };
      void poll();
    },
    onError: (err) => {
      setOptimistic(null);
      setOverlay({ visible: true, message: String(err?.message ?? err) });
      setTimeout(() => setOverlay({ visible: false, message: "" }), 3000);
    },
  });

  return (
    <>
      <div
        className={cn(
          "rounded-lg border bg-surface-1 p-4 transition-colors",
          checked ? "border-line-accent" : "border-line",
        )}
        data-on={String(checked)}
        data-feature-key={meta.key}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">{meta.label}</span>
          <Switch
            data-toggle
            data-key={meta.key}
            checked={checked}
            disabled={mutation.isPending}
            onCheckedChange={(value) => mutation.mutate(value)}
            aria-label={`Toggle ${meta.label}`}
          />
        </div>
        <p className="mb-3 text-xs text-fg-muted">{meta.description}</p>
        <div className="mb-2 flex flex-wrap gap-1">
          {meta.exposes.map((s) => (
            <code
              key={s}
              className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[0.65rem] text-fg-dim"
            >
              {s}
            </code>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 text-[0.7rem]">
          <code className="font-mono text-fg-muted">
            {meta.envKey}={checked ? "true" : "false"}
          </code>
          <span className={cn("text-[0.65rem]", checked ? "text-ok" : "text-fg-faint")}>
            {checked ? "✓ enabled" : "set to ON to enable"}
          </span>
        </div>
      </div>
      <Dialog open={overlay.visible} onOpenChange={(open) => (!open ? null : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restarting server…</DialogTitle>
            <DialogDescription>{overlay.message}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center py-2">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
