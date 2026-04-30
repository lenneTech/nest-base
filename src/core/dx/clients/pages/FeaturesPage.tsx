/**
 * `/dev/features` — verbatim React port of `features-ui.ts`. Same
 * three-tile summary (active / available / total), same per-category
 * card grid with toggles, same "How toggling works" footer card,
 * same restart overlay shown after a `POST /dev/features/:key/toggle`.
 *
 * Data: `/dev/feature-catalog.json` (catalog metadata + active
 * Features). Each toggle POSTs to `/dev/features/:key/toggle` and the
 * page polls `/health/live` until the new dev-server process answers,
 * then full-reloads.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";

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
    queryFn: () => fetchJson<FeatureCatalogResponse>("/dev/feature-catalog.json"),
  });

  const subtitle = data.data
    ? `${data.data.catalog.filter((m) => isActive(data.data!.features, m.key)).length} of ${data.data.catalog.length} feature flags currently enabled.`
    : "Loading…";

  return (
    <AdminShell title="Features" subtitle={subtitle} currentNav="features">
      {data.data ? (
        <FeaturesBody data={data.data} />
      ) : data.isError ? (
        <div className="admin-empty">Failed to load feature catalog.</div>
      ) : (
        <div className="admin-empty">Loading feature catalog…</div>
      )}
    </AdminShell>
  );
}

function FeaturesBody({ data }: { data: FeatureCatalogResponse }): ReactNode {
  const total = data.catalog.length;
  const active = data.catalog.filter((m) => isActive(data.features, m.key)).length;
  const available = total - active;

  // Group catalog by category, preserving the order categories first
  // appear in `data.catalog`.
  const grouped = new Map<string, FeatureMeta[]>();
  for (const meta of data.catalog) {
    const list = grouped.get(meta.category) ?? [];
    list.push(meta);
    grouped.set(meta.category, list);
  }

  return (
    <>
      <div className="feat-summary">
        <div className="feat-tile feat-tile--ok">
          <span className="feat-tile__label">Active</span>
          <span className="feat-tile__value">{active}</span>
        </div>
        <div className="feat-tile">
          <span className="feat-tile__label">Available</span>
          <span className="feat-tile__value">{available}</span>
        </div>
        <div className="feat-tile">
          <span className="feat-tile__label">Total</span>
          <span className="feat-tile__value">{total}</span>
        </div>
      </div>

      {Array.from(grouped.entries()).map(([category, list]) => (
        <div key={category} className="admin-card">
          <h3 className="feat-section__title">{CATEGORY_LABEL[category] ?? category}</h3>
          <div className="feat-card-grid">
            {list.map((meta) => (
              <FeatureCard key={meta.key} meta={meta} active={isActive(data.features, meta.key)} />
            ))}
          </div>
        </div>
      ))}

      <div className="admin-card">
        <h3 className="feat-section__title">How toggling works</h3>
        <p className="admin-meta">
          Flipping a switch above writes the matching <code>FEATURE_*_ENABLED</code> line into{" "}
          <code>.env</code> and touches <code>src/main.ts</code> so <code>bun --watch</code>{" "}
          restarts the API. The page reloads automatically once the new process answers. Module
          imports and controller registration are driven entirely by these flags — see{" "}
          <code>src/core/features/features.ts</code> for the schema.
        </p>
      </div>
    </>
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
      // Poll /health/live until the new process answers, then reload.
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

  const exposes = meta.exposes;

  return (
    <>
      <div className="feat-card" data-on={String(checked)} data-feature-key={meta.key}>
        <div className="feat-card__head">
          <span className="feat-card__name">{meta.label}</span>
          <label className="feat-toggle" title={`Toggle ${meta.label}`}>
            <input
              type="checkbox"
              data-toggle
              data-key={meta.key}
              checked={checked}
              disabled={mutation.isPending}
              onChange={(e) => mutation.mutate(e.target.checked)}
            />
            <span className="feat-toggle__track" />
            <span className="feat-toggle__thumb" />
          </label>
        </div>
        <p className="feat-card__desc">{meta.description}</p>
        <div className="feat-card__exposes">
          {exposes.map((s) => (
            <code key={s}>{s}</code>
          ))}
        </div>
        <div className="feat-card__env">
          <code>
            {meta.envKey}={checked ? "true" : "false"}
          </code>
          <span className="feat-card__env-state">
            {checked ? "✓ enabled" : "set to ON to enable"}
          </span>
        </div>
      </div>
      {overlay.visible ? (
        <div className="feat-restart is-visible">
          <div className="feat-restart__box">
            <div className="feat-restart__spinner" />
            <h3 className="feat-restart__title">Restarting server…</h3>
            <p className="feat-restart__msg">{overlay.message}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
