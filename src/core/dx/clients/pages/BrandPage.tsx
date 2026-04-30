/**
 * `/dev/brand` — read-only viewer (with reset action) for the
 * project brand configuration.
 *
 * The form-based editor with live preview + color pickers is a
 * follow-up slice; this minimal page already satisfies the route +
 * shows the operator what the active brand looks like and lets them
 * reset to the template default with one click.
 *
 * Data: `/dev/brand.json` (effective brand). Reset posts to
 * `/dev/brand/reset` which deletes `src/modules/branding/brand.json`
 * and triggers the dev-runner's brand-watcher to restart the API.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

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
    queryFn: () => fetchJson<BrandConfig>("/dev/brand.json"),
  });

  const reset = useMutation({
    mutationFn: async () => {
      const res = await fetch("/dev/brand/reset", { method: "POST" });
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
      <div className="admin-card">
        {isLoading ? (
          <p className="admin-page__subtitle">Loading…</p>
        ) : isError ? (
          <p className="admin-page__subtitle">Failed to load brand.</p>
        ) : data ? (
          <BrandPreview brand={data} />
        ) : null}
      </div>

      <div className="admin-card" style={{ marginTop: "1rem" }}>
        <h2 style={{ margin: "0 0 0.5rem 0" }}>Reset to default</h2>
        <p className="admin-page__subtitle">
          Deletes <code>src/modules/branding/brand.json</code> and falls back to{" "}
          <code>src/core/branding/brand.default.json</code>. The dev runner restarts the API
          automatically.
        </p>
        <button
          type="button"
          className="admin-btn"
          onClick={() => {
            // eslint-disable-next-line no-alert
            if (window.confirm("Delete src/modules/branding/brand.json and reset to default?")) {
              reset.mutate();
            }
          }}
          disabled={reset.isPending}
        >
          {reset.isPending ? "Resetting…" : "Reset brand"}
        </button>
        {reset.isSuccess ? (
          <p className="admin-page__subtitle" style={{ marginTop: "0.5rem", color: "var(--ok)" }}>
            Brand reset. The dev runner is restarting the API.
          </p>
        ) : null}
      </div>
    </AdminShell>
  );
}

function BrandPreview({ brand }: { brand: BrandConfig }): ReactNode {
  return (
    <div>
      <h2 style={{ margin: "0 0 1rem 0" }}>{brand.name}</h2>
      {brand.tagline ? (
        <p className="admin-page__subtitle" style={{ marginBottom: "1rem" }}>
          {brand.tagline}
        </p>
      ) : null}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "0.75rem",
        }}
      >
        <ColorSwatch label="primaryColor" value={brand.primaryColor} />
        <ColorSwatch label="primaryColorInk" value={brand.primaryColorInk} />
        <ColorSwatch label="backgroundColor" value={brand.backgroundColor} />
        <ColorSwatch label="surfaceColor" value={brand.surfaceColor} />
        <ColorSwatch label="textColor" value={brand.textColor} />
        <ColorSwatch label="mutedTextColor" value={brand.mutedTextColor} />
      </div>
      <dl style={{ marginTop: "1.5rem" }}>
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
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-sm)",
        padding: "0.5rem",
        background: "var(--surface-2)",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "32px",
          background: value,
          borderRadius: "var(--radius-sm)",
          marginBottom: "0.5rem",
        }}
      />
      <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--fg-dim)" }}>
        {label}
      </div>
      <div style={{ fontSize: "12px", fontFamily: "var(--font-mono)", color: "var(--fg)" }}>
        {value}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "10rem 1fr", padding: "0.25rem 0" }}>
      <dt style={{ color: "var(--fg-dim)", fontFamily: "var(--font-mono)", fontSize: "12px" }}>
        {label}
      </dt>
      <dd style={{ margin: 0 }}>{value}</dd>
    </div>
  );
}
