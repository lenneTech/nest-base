/**
 * `/dev/email-preview` — verbatim React port of `email-preview-ui.ts`.
 * Same gallery of registered templates; each card shows the rendered
 * subject, an HTML iframe (with `sandbox=""` like the server) and
 * plain-text rendering side-by-side, plus the sample payload.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";

interface CatalogEntry {
  template: string;
  description: string;
  samplePayload: Record<string, string>;
}

interface RenderResult {
  subject?: string;
  html?: string;
  text?: string;
  error?: string;
}

interface EmailPreviewResponse {
  catalog: { entries: CatalogEntry[] };
  rendered: Record<string, RenderResult>;
}

export function EmailPreviewPage(): ReactNode {
  const data = useQuery({
    queryKey: ["dev", "email-preview"],
    queryFn: () => fetchJson<EmailPreviewResponse>("/dev/email-preview.json"),
  });

  const subtitle = data.data ? (
    <>
      {data.data.catalog.entries.length} template(s) registered. Sample payloads are rendered below
      — Mailpit at <code>localhost:8025</code> shows actually-sent emails.
    </>
  ) : (
    "Loading…"
  );

  return (
    <AdminShell title="Email Preview" subtitle={subtitle} currentNav="email-preview">
      {data.data ? (
        <EmailPreviewBody payload={data.data} />
      ) : data.isError ? (
        <div className="admin-empty">Failed to load email-preview catalog.</div>
      ) : (
        <div className="admin-empty">Loading email previews…</div>
      )}
    </AdminShell>
  );
}

function EmailPreviewBody({ payload }: { payload: EmailPreviewResponse }): ReactNode {
  return (
    <>
      {payload.catalog.entries.map((entry) => {
        const result = payload.rendered[entry.template] ?? { error: "not rendered" };
        return <Card key={entry.template} entry={entry} result={result} />;
      })}
    </>
  );
}

function Card({ entry, result }: { entry: CatalogEntry; result: RenderResult }): ReactNode {
  if (result.error) {
    return (
      <section className="ep-card">
        <h3 className="ep-card__title">{entry.template}</h3>
        <p className="ep-card__desc">{entry.description}</p>
        <div className="ep-error">⚠ {result.error}</div>
      </section>
    );
  }
  return (
    <section className="ep-card">
      <h3 className="ep-card__title">{entry.template}</h3>
      <p className="ep-card__desc">{entry.description}</p>
      <div className="ep-subject">
        <strong>Subject:</strong> {result.subject ?? ""}
      </div>
      <div className="ep-grid">
        <div className="ep-pane">
          <div className="ep-pane__title">HTML</div>
          <iframe
            className="ep-html"
            sandbox=""
            srcDoc={result.html ?? ""}
            style={{
              width: "100%",
              minHeight: "22rem",
              border: 0,
              background: "transparent",
              colorScheme: "dark",
            }}
            title={`HTML preview of ${entry.template}`}
          />
        </div>
        <div className="ep-pane">
          <div className="ep-pane__title">Text</div>
          <div className="ep-text">{result.text ?? ""}</div>
        </div>
      </div>
      <div className="ep-pane" style={{ marginTop: "1rem" }}>
        <div className="ep-pane__title">Sample payload</div>
        <div className="ep-payload">{JSON.stringify(entry.samplePayload, null, 2)}</div>
      </div>
    </section>
  );
}
