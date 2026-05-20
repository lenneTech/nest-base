/**
 * `/dev/json` — paste-text-render JSON viewer (PRD line 145).
 *
 * Standalone page that lets developers paste arbitrary JSON into a
 * textarea and inspect the parsed structure through the same
 * `JsonViewer` component the rest of the dev portal uses (collapse
 * / expand / search / copy / open-in-new-tab).
 *
 * Why a standalone page despite the embedded component being used
 * across `OpenApiPage`, `PostgrestParsePage`, etc. — those embed
 * `JsonViewer` over a known endpoint's response. This page accepts
 * arbitrary text the user pastes, parses it client-side, and
 * surfaces parse errors inline. Useful for:
 *   - Inspecting external API responses copied from curl / Postman
 *   - Pretty-printing minified JSON
 *   - Searching / filtering a deeply-nested payload by key
 */
import { useMemo, useState, type ReactNode } from "react";

import { JsonViewer } from "../components/JsonViewer.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { Label } from "../components/ui/label.js";
import { Textarea } from "../components/ui/textarea.js";
import { AdminShell } from "../layout/AdminShell.js";

export function JsonViewerPage(): ReactNode {
  const [input, setInput] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);

  const parsed = useMemo<{ ok: true; value: unknown } | { ok: false; error: string } | null>(() => {
    if (submitted === null) return null;
    const trimmed = submitted.trim();
    if (trimmed.length === 0) {
      return { ok: false, error: "Empty input — paste a JSON document above." };
    }
    try {
      return { ok: true, value: JSON.parse(trimmed) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, [submitted]);

  return (
    <AdminShell
      title="JSON Viewer"
      subtitle="Paste JSON text to inspect through the dev-portal viewer (collapse / search / copy)."
      currentNav="json-viewer"
    >
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Input</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <Label htmlFor="json-input">JSON document</Label>
              <Textarea
                id="json-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                rows={12}
                className="font-mono text-xs"
                aria-label="JSON document input"
              />
              <p className="text-xs text-fg-muted">
                Paste JSON from API responses, logs, or outbox detail — nothing is pre-filled.
              </p>
              <div className="flex gap-2">
                <Button onClick={() => setSubmitted(input)}>Parse</Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setInput("");
                    setSubmitted(null);
                  }}
                >
                  Clear
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {parsed ? (
          parsed.ok ? (
            <Card>
              <CardHeader>
                <CardTitle>Parsed</CardTitle>
              </CardHeader>
              <CardContent>
                <JsonViewer value={parsed.value} />
              </CardContent>
            </Card>
          ) : (
            <Card className="border-err/40 bg-err/10">
              <CardHeader>
                <CardTitle className="text-err">Parse error</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap font-mono text-xs">{parsed.error}</pre>
              </CardContent>
            </Card>
          )
        ) : null}
      </div>
    </AdminShell>
  );
}
