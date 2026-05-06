/**
 * `/dev/email-preview` — gallery of registered email templates. Each
 * card shows the rendered subject, an HTML iframe (sandboxed), the
 * plain-text rendering, and the sample payload.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { PageError, PageLoading } from "../components/PageState.js";
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
    queryFn: () => fetchJson<EmailPreviewResponse>("/api/dev/email-preview.json"),
  });

  const subtitle = data.data ? (
    <>
      {data.data.catalog.entries.length} template(s) registered. Sample payloads are rendered below
      — Mailpit at <code className="font-mono text-accent">localhost:8025</code> shows actually-sent
      emails.
    </>
  ) : (
    "Loading…"
  );

  return (
    <AdminShell title="Email Preview" subtitle={subtitle} currentNav="email-preview">
      {data.data ? (
        <EmailPreviewBody payload={data.data} />
      ) : data.isError ? (
        <PageError>Failed to load email-preview catalog.</PageError>
      ) : (
        <PageLoading>Loading email previews…</PageLoading>
      )}
    </AdminShell>
  );
}

function EmailPreviewBody({ payload }: { payload: EmailPreviewResponse }): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      {payload.catalog.entries.map((entry) => {
        const result = payload.rendered[entry.template] ?? { error: "not rendered" };
        return <PreviewCard key={entry.template} entry={entry} result={result} />;
      })}
    </div>
  );
}

function PreviewCard({ entry, result }: { entry: CatalogEntry; result: RenderResult }): ReactNode {
  if (result.error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{entry.template}</CardTitle>
          <p className="text-xs text-fg-muted">{entry.description}</p>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-err/40 bg-err/10 p-3 text-sm text-err">
            ⚠ {result.error}
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{entry.template}</CardTitle>
        <p className="text-xs text-fg-muted">{entry.description}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="text-sm">
          <strong className="text-fg-dim">Subject:</strong>{" "}
          <span className="font-mono">{result.subject ?? ""}</span>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Pane title="HTML">
            <iframe
              sandbox=""
              srcDoc={result.html ?? ""}
              className="h-[22rem] w-full rounded border-0 bg-transparent"
              style={{ colorScheme: "dark" }}
              title={`HTML preview of ${entry.template}`}
            />
          </Pane>
          <Pane title="Text">
            <pre className="m-0 max-h-[22rem] overflow-auto whitespace-pre-wrap rounded-md border border-line bg-surface-2 p-3 font-mono text-xs">
              {result.text ?? ""}
            </pre>
          </Pane>
        </div>
        <Pane title="Sample payload">
          <pre className="m-0 max-h-64 overflow-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-xs">
            {JSON.stringify(entry.samplePayload, null, 2)}
          </pre>
        </Pane>
      </CardContent>
    </Card>
  );
}

function Pane({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[0.65rem] font-semibold uppercase tracking-widest text-fg-dim">
        {title}
      </div>
      {children}
    </div>
  );
}
