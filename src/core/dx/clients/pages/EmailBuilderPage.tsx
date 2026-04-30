/**
 * `/dev/email-builder` — Layout-Designer + Children-Composer (Issue #9).
 *
 * Two top-level views:
 *
 *   1. Gallery — lists every discovered template (core + module
 *      overlay) with rendered subject + an iframe thumbnail. "New
 *      template" creates an empty Barebone draft; "Edit" opens the
 *      composer for an existing one (read-only for built-ins; user
 *      drafts they've saved earlier come back via /templates.json).
 *
 *   2. Composer — three columns:
 *        Left:  block palette (drag handles + click-to-add)
 *        Mid:   ordered child blocks for the current draft
 *        Right: live preview iframe (server-rendered HTML)
 *      The properties of the selected block live above the preview;
 *      changes flow into the live preview via /preview.json.
 *
 * Everything stays in component state — the only persistence is the
 * `Save` button which POSTs to `/dev/email-builder/save`. The bundle
 * is intentionally tiny: no TipTap, no react-dnd. The composer uses
 * react-aria-components for inputs and plain up/down buttons for
 * reordering — drag-drop is a follow-up.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button, Select, SelectItem, TextField } from "../components/index.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";

interface DiscoveredTemplate {
  name: string;
  locale: string | null;
  file: string;
  source: "core" | "module";
  subject?: string;
  error?: string;
}

interface BlockPropDescriptor {
  name: string;
  kind: "text" | "url";
  required: boolean;
  supportsVariables: boolean;
}

interface BlockDescriptor {
  type: string;
  label: string;
  description: string;
  props: BlockPropDescriptor[];
}

interface LayoutDescriptor {
  name: string;
  description: string;
}

interface BlocksResponse {
  blocks: BlockDescriptor[];
  layouts: LayoutDescriptor[];
}

interface BlockSpec {
  type: string;
  props: Record<string, string>;
}

interface CompositionDraft {
  layout: string;
  subject: string;
  preheader: string;
  children: BlockSpec[];
}

interface PreviewResponse {
  subject: string;
  html: string;
  text: string;
}

const VAR_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

function emptyDraft(): CompositionDraft {
  return {
    layout: "Barebone",
    subject: "Welcome to {{appName}}",
    preheader: "",
    children: [
      { type: "greeting", props: { text: "Hello {{recipientName}}," } },
      { type: "paragraph", props: { text: "Thanks for signing up." } },
    ],
  };
}

export function EmailBuilderPage(): ReactNode {
  const [view, setView] = useState<"gallery" | "composer">("gallery");
  const [draft, setDraft] = useState<CompositionDraft>(() => emptyDraft());
  const [draftSlug, setDraftSlug] = useState("");

  const templates = useQuery({
    queryKey: ["dev", "email-builder", "templates"],
    queryFn: () =>
      fetchJson<{ templates: DiscoveredTemplate[] }>("/dev/email-builder/templates.json"),
  });

  const blocks = useQuery({
    queryKey: ["dev", "email-builder", "blocks"],
    queryFn: () => fetchJson<BlocksResponse>("/dev/email-builder/blocks.json"),
  });

  const subtitle = templates.data
    ? `${templates.data.templates.length} discovered template(s) — gallery + composer for project-owned templates.`
    : "Loading…";

  return (
    <AdminShell title="Email Builder" subtitle={subtitle} currentNav="email-builder">
      {view === "gallery" ? (
        <GalleryView
          templates={templates.data?.templates ?? []}
          isLoading={templates.isLoading}
          isError={templates.isError}
          onNew={() => {
            setDraft(emptyDraft());
            setDraftSlug("");
            setView("composer");
          }}
          onDuplicate={(tpl) => {
            // Duplicating a built-in seeds the composer with an empty
            // draft and a slug suggestion derived from the source.
            setDraft(emptyDraft());
            setDraftSlug(`${tpl.name}-copy`);
            setView("composer");
          }}
        />
      ) : (
        <ComposerView
          draft={draft}
          setDraft={setDraft}
          slug={draftSlug}
          setSlug={setDraftSlug}
          blocks={blocks.data}
          onClose={() => setView("gallery")}
        />
      )}
    </AdminShell>
  );
}

// -----------------------------------------------------------------
// Gallery
// -----------------------------------------------------------------

interface GalleryProps {
  templates: DiscoveredTemplate[];
  isLoading: boolean;
  isError: boolean;
  onNew: () => void;
  onDuplicate: (tpl: DiscoveredTemplate) => void;
}

function GalleryView({
  templates,
  isLoading,
  isError,
  onNew,
  onDuplicate,
}: GalleryProps): ReactNode {
  if (isLoading) return <div className="admin-empty">Loading email templates…</div>;
  if (isError) {
    return <div className="admin-empty">Failed to load /dev/email-builder/templates.json</div>;
  }
  return (
    <>
      <div
        className="admin-card"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "1rem",
        }}
      >
        <div>
          <h3 className="feat-section__title">Templates</h3>
          <p className="admin-page__subtitle">
            File-based React-Email templates discovered under <code>src/core/email/templates/</code>{" "}
            and <code>src/modules/email/templates/</code>.
          </p>
        </div>
        <Button onPress={onNew}>+ New template</Button>
      </div>
      <div className="ep-grid" data-eb-gallery="true">
        {templates.length === 0 ? (
          <div className="admin-empty">No templates discovered.</div>
        ) : (
          templates.map((tpl) => (
            <TemplateCard
              key={`${tpl.source}:${tpl.name}:${tpl.locale ?? "default"}`}
              tpl={tpl}
              onDuplicate={() => onDuplicate(tpl)}
            />
          ))
        )}
      </div>
    </>
  );
}

function TemplateCard({
  tpl,
  onDuplicate,
}: {
  tpl: DiscoveredTemplate;
  onDuplicate: () => void;
}): ReactNode {
  return (
    <section className="ep-card" data-eb-card={tpl.name}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 className="ep-card__title">{tpl.name}</h3>
        <span
          className={`admin-badge ${tpl.source === "core" ? "admin-badge--ok" : ""}`}
          style={{ fontSize: "10px", letterSpacing: "0.06em", textTransform: "uppercase" }}
        >
          {tpl.source}
          {tpl.locale ? ` · ${tpl.locale}` : ""}
        </span>
      </header>
      <p className="ep-card__desc" style={{ minHeight: "2em" }}>
        {tpl.error ? `⚠ ${tpl.error}` : (tpl.subject ?? "")}
      </p>
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
        <Button onPress={onDuplicate}>Duplicate</Button>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------
// Composer
// -----------------------------------------------------------------

interface ComposerProps {
  draft: CompositionDraft;
  setDraft: (d: CompositionDraft) => void;
  slug: string;
  setSlug: (s: string) => void;
  blocks: BlocksResponse | undefined;
  onClose: () => void;
}

function ComposerView({
  draft,
  setDraft,
  slug,
  setSlug,
  blocks,
  onClose,
}: ComposerProps): ReactNode {
  const queryClient = useQueryClient();
  const [selectedBlock, setSelectedBlock] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Collect every variable referenced in the draft so the vars-panel
  // can offer a single text input per name (mirrors how the codegen
  // would type them as required string fields). Recomputed cheaply on
  // each render.
  const referencedVars = useMemo(() => collectVars(draft), [draft]);
  const [vars, setVars] = useState<Record<string, string>>({});

  // Seed default values for newly-introduced vars so the preview has
  // something to render. Pre-existing keys keep their current value so
  // typing in the vars panel doesn't get clobbered when the draft
  // grows another `{{var}}`.
  useEffect(() => {
    setVars((prev) => {
      const next: Record<string, string> = { ...prev };
      let changed = false;
      for (const v of referencedVars) {
        if (next[v] === undefined) {
          next[v] = defaultVarValue(v);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [referencedVars]);

  const preview = useQuery({
    queryKey: ["dev", "email-builder", "preview", draft, vars],
    queryFn: async () => {
      const res = await fetch("/dev/email-builder/preview.json", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ composition: draft, vars }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`preview failed: ${res.status} — ${text.slice(0, 200)}`);
      }
      return (await res.json()) as PreviewResponse;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      setSaveError(null);
      const res = await fetch("/dev/email-builder/save", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ slug, composition: draft }),
      });
      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = { raw: text };
      }
      if (!res.ok) {
        const msg =
          (parsed && typeof parsed === "object" && "message" in parsed
            ? String((parsed as { message?: string }).message ?? "")
            : "") || `${res.status} ${res.statusText}`;
        throw new Error(msg);
      }
      return parsed as { relativePath: string; bytesWritten: number };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dev", "email-builder", "templates"] });
    },
    onError: (err) => setSaveError(err instanceof Error ? err.message : String(err)),
  });

  const blockLib = blocks?.blocks ?? [];
  const layoutLib = blocks?.layouts ?? [];

  return (
    <>
      <div
        className="admin-card"
        style={{
          display: "flex",
          gap: "1rem",
          alignItems: "flex-end",
          flexWrap: "wrap",
          marginBottom: "1rem",
        }}
      >
        <TextField label="Slug" value={slug} onChange={setSlug} placeholder="my-template" />
        <TextField
          label="Subject"
          value={draft.subject}
          onChange={(v) => setDraft({ ...draft, subject: v })}
        />
        <TextField
          label="Preheader"
          value={draft.preheader}
          onChange={(v) => setDraft({ ...draft, preheader: v })}
        />
        <Select
          label="Layout"
          selectedKey={draft.layout}
          onSelectionChange={(k) => setDraft({ ...draft, layout: String(k) })}
        >
          {layoutLib.map((l) => (
            <SelectItem key={l.name} id={l.name}>
              {l.name}
            </SelectItem>
          ))}
        </Select>
        <div style={{ display: "flex", gap: "0.5rem", marginLeft: "auto" }}>
          <Button onPress={onClose}>Back to gallery</Button>
          <Button onPress={() => save.mutate()} isDisabled={save.isPending || !slug}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {saveError ? (
        <div className="admin-card" role="alert" style={{ marginBottom: "1rem" }}>
          <strong>Save failed:</strong> {saveError}
        </div>
      ) : null}
      {save.isSuccess ? (
        <div className="admin-card" style={{ marginBottom: "1rem", color: "var(--ok)" }}>
          Saved to <code>{save.data?.relativePath}</code>
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(180px, 1fr) minmax(280px, 2fr) minmax(320px, 2fr)",
          gap: "1rem",
        }}
      >
        <BlockPalette
          blocks={blockLib}
          onAdd={(type) => {
            const next: BlockSpec = {
              type,
              props: defaultBlockProps(blockLib, type),
            };
            setDraft({ ...draft, children: [...draft.children, next] });
            setSelectedBlock(draft.children.length);
          }}
        />
        <BlockComposer
          draft={draft}
          setDraft={setDraft}
          selectedIndex={selectedBlock}
          setSelectedIndex={setSelectedBlock}
          blockLib={blockLib}
          vars={vars}
          setVars={setVars}
        />
        <PreviewPane preview={preview.data} isLoading={preview.isFetching} error={preview.error} />
      </div>
    </>
  );
}

function BlockPalette({
  blocks,
  onAdd,
}: {
  blocks: BlockDescriptor[];
  onAdd: (type: string) => void;
}): ReactNode {
  return (
    <div className="admin-card">
      <h3 className="feat-section__title">Block Palette</h3>
      <p className="admin-meta">Click to append.</p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {blocks.map((b) => (
          <li key={b.type} style={{ marginBottom: "0.5rem" }}>
            <Button onPress={() => onAdd(b.type)} aria-label={`Add ${b.label} block`}>
              + {b.label}
            </Button>
            <p className="admin-meta" style={{ marginTop: "0.25rem" }}>
              {b.description}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BlockComposer({
  draft,
  setDraft,
  selectedIndex,
  setSelectedIndex,
  blockLib,
  vars,
  setVars,
}: {
  draft: CompositionDraft;
  setDraft: (d: CompositionDraft) => void;
  selectedIndex: number | null;
  setSelectedIndex: (i: number | null) => void;
  blockLib: BlockDescriptor[];
  vars: Record<string, string>;
  setVars: (v: Record<string, string>) => void;
}): ReactNode {
  const selected = selectedIndex !== null ? draft.children[selectedIndex] : null;
  const selectedDescriptor = selected ? blockLib.find((b) => b.type === selected.type) : null;

  return (
    <div className="admin-card" data-eb-composer="true">
      <h3 className="feat-section__title">Composition</h3>
      <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {draft.children.map((block, i) => (
          <li
            key={`${i}-${block.type}`}
            data-eb-block-row={block.type}
            style={{
              padding: "0.5rem",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-sm)",
              marginBottom: "0.5rem",
              background: i === selectedIndex ? "var(--surface-hover)" : "var(--surface-1)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Button onPress={() => setSelectedIndex(i)} aria-label={`Edit block ${i}`}>
                {block.type}
              </Button>
              <span className="admin-meta" style={{ flex: 1 }}>
                {String(block.props.text ?? "").slice(0, 40)}
              </span>
              <Button
                onPress={() => moveBlock(draft, setDraft, i, -1, setSelectedIndex)}
                isDisabled={i === 0}
                aria-label={`Move block ${i} up`}
              >
                ↑
              </Button>
              <Button
                onPress={() => moveBlock(draft, setDraft, i, 1, setSelectedIndex)}
                isDisabled={i === draft.children.length - 1}
                aria-label={`Move block ${i} down`}
              >
                ↓
              </Button>
              <Button
                onPress={() => removeBlock(draft, setDraft, i, setSelectedIndex)}
                aria-label={`Delete block ${i}`}
              >
                ✕
              </Button>
            </div>
          </li>
        ))}
      </ol>

      {selected && selectedDescriptor ? (
        <div
          style={{
            marginTop: "1rem",
            paddingTop: "1rem",
            borderTop: "1px solid var(--line)",
          }}
        >
          <h4 className="feat-section__title">Properties — {selectedDescriptor.label}</h4>
          {selectedDescriptor.props.length === 0 ? (
            <p className="admin-meta">No editable props.</p>
          ) : (
            selectedDescriptor.props.map((prop) => (
              <TextField
                key={prop.name}
                label={prop.name}
                value={String(selected.props[prop.name] ?? "")}
                onChange={(value) =>
                  updateBlockProp(draft, setDraft, selectedIndex!, prop.name, value)
                }
              />
            ))
          )}
        </div>
      ) : null}

      <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--line)" }}>
        <h4 className="feat-section__title">Variables</h4>
        <p className="admin-meta">
          Sample values for the live preview. The saved <code>.tsx</code> declares each variable as
          a required string prop.
        </p>
        {Object.keys(vars).length === 0 ? (
          <p className="admin-meta">
            <em>
              No variables — add a <code>{"{{name}}"}</code> placeholder to a block.
            </em>
          </p>
        ) : (
          Object.keys(vars)
            .sort()
            .map((name) => (
              <TextField
                key={name}
                label={name}
                value={vars[name] ?? ""}
                onChange={(value) => setVars({ ...vars, [name]: value })}
              />
            ))
        )}
      </div>
    </div>
  );
}

function PreviewPane({
  preview,
  isLoading,
  error,
}: {
  preview: PreviewResponse | undefined;
  isLoading: boolean;
  error: unknown;
}): ReactNode {
  return (
    <div className="admin-card" data-eb-preview="true">
      <h3 className="feat-section__title">Live Preview</h3>
      {error ? (
        <div className="ep-error">⚠ {error instanceof Error ? error.message : String(error)}</div>
      ) : isLoading || !preview ? (
        <p className="admin-meta">Rendering…</p>
      ) : (
        <>
          <div className="ep-subject" style={{ marginBottom: "0.5rem" }}>
            <strong>Subject:</strong> {preview.subject}
          </div>
          <iframe
            className="ep-html"
            sandbox=""
            srcDoc={preview.html}
            style={{
              width: "100%",
              minHeight: "26rem",
              border: 0,
              background: "transparent",
              colorScheme: "dark",
            }}
            title="Live email preview"
          />
        </>
      )}
    </div>
  );
}

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

function moveBlock(
  draft: CompositionDraft,
  setDraft: (d: CompositionDraft) => void,
  index: number,
  delta: number,
  setSelectedIndex: (i: number | null) => void,
): void {
  const target = index + delta;
  if (target < 0 || target >= draft.children.length) return;
  const next = [...draft.children];
  const [moved] = next.splice(index, 1);
  if (!moved) return;
  next.splice(target, 0, moved);
  setDraft({ ...draft, children: next });
  setSelectedIndex(target);
}

function removeBlock(
  draft: CompositionDraft,
  setDraft: (d: CompositionDraft) => void,
  index: number,
  setSelectedIndex: (i: number | null) => void,
): void {
  const next = draft.children.filter((_, i) => i !== index);
  setDraft({ ...draft, children: next });
  setSelectedIndex(null);
}

function updateBlockProp(
  draft: CompositionDraft,
  setDraft: (d: CompositionDraft) => void,
  index: number,
  prop: string,
  value: string,
): void {
  const next = draft.children.map((block, i) =>
    i === index ? { ...block, props: { ...block.props, [prop]: value } } : block,
  );
  setDraft({ ...draft, children: next });
}

function defaultBlockProps(blockLib: BlockDescriptor[], type: string): Record<string, string> {
  const desc = blockLib.find((b) => b.type === type);
  if (!desc) return {};
  const out: Record<string, string> = {};
  for (const prop of desc.props) {
    if (prop.kind === "url") out[prop.name] = "https://example.test/";
    else out[prop.name] = type === "greeting" ? "Hello {{recipientName}}," : "Lorem ipsum.";
  }
  return out;
}

function collectVars(draft: CompositionDraft): string[] {
  const set = new Set<string>();
  scanForVars(draft.subject, set);
  scanForVars(draft.preheader, set);
  for (const block of draft.children) {
    for (const value of Object.values(block.props)) {
      scanForVars(String(value ?? ""), set);
    }
  }
  return [...set].sort();
}

function scanForVars(value: string, target: Set<string>): void {
  for (const match of value.matchAll(VAR_PATTERN)) {
    if (match[1]) target.add(match[1]);
  }
}

function defaultVarValue(name: string): string {
  // Tiny seed table so the preview shows plausible values for the
  // common variables. Anything else falls back to the variable name
  // itself, which still renders something visible.
  const seeds: Record<string, string> = {
    recipientName: "Alice Example",
    senderName: "Bob Example",
    appName: "nest-base",
    verificationUrl: "https://example.test/verify",
    resetUrl: "https://example.test/reset",
    acceptUrl: "https://example.test/accept",
    ctaUrl: "https://example.test/start",
  };
  return seeds[name] ?? `<${name}>`;
}
