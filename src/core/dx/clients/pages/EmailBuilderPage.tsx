/**
 * `/hub/emails` — Layout-Designer + Children-Composer (Issue #9).
 *
 * Two top-level views:
 *   1. Gallery — lists every discovered template; "New" creates a draft.
 *   2. Composer — three-column block palette + composition + live preview.
 *
 * Issue #49: every template (core or module) gets a "Customize" action
 * that fetches its decomposed composition and opens the composer
 * pre-filled. Save always writes to src/modules/email/templates/ —
 * core files are never overwritten. Core (overridden) entries also
 * expose a "Reset to default" action that DELETEs the overlay file.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import { PageEmpty, PageError, PageLoading } from "../components/PageState.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson, needsAdminAuthHint } from "../lib/api.js";
import { cn } from "../lib/utils.js";

interface DiscoveredTemplate {
  name: string;
  locale: string | null;
  file: string;
  source: "core" | "module";
  subject?: string;
  error?: string;
  /** Gallery thumbnail vars: latest outbox send or brand appName only. */
  previewPayloadSource?: "outbox" | "brand";
  /** Module-overlay row that shadows a same-named core template. */
  overridesCore?: boolean;
  /** Core row whose name + locale also has a module overlay. */
  overrideExists?: boolean;
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

/**
 * Response of GET /hub/email-builder/templates/:name/composition.json.
 * `decomposable: false` means the source uses hand-written JSX outside
 * the composer grammar — the UI falls back to a read-only source view.
 */
interface CompositionResponse {
  name: string;
  locale: string | null;
  source: "core" | "module";
  file: string;
  rawSource: string;
  decomposable: boolean;
  composition?: CompositionDraft & { children: BlockSpec[] };
  reason?: string;
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

type View =
  | { kind: "gallery" }
  | { kind: "composer" }
  | { kind: "source"; template: DiscoveredTemplate; rawSource: string; reason: string };

export function EmailBuilderPage(): ReactNode {
  const [view, setView] = useState<View>({ kind: "gallery" });
  const [draft, setDraft] = useState<CompositionDraft>(() => emptyDraft());
  const [draftSlug, setDraftSlug] = useState("");
  const [editLoadError, setEditLoadError] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<DiscoveredTemplate | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const templates = useQuery({
    queryKey: ["hub", "email-builder", "templates"],
    queryFn: () => fetchJson<{ templates: DiscoveredTemplate[] }>("/hub/emails/templates.json"),
  });

  const blocks = useQuery({
    queryKey: ["hub", "email-builder", "blocks"],
    queryFn: () => fetchJson<BlocksResponse>("/hub/emails/blocks.json"),
  });

  const queryClient = useQueryClient();

  // The "Customize" action: fetch composition.json for the picked
  // template and either pre-fill the composer or fall back to the
  // source-view when the source is outside the composer grammar.
  const customize = useMutation({
    mutationFn: async (tpl: DiscoveredTemplate) => {
      setEditLoadError(null);
      const url = buildCompositionUrl(tpl);
      const data = await fetchJson<CompositionResponse>(url);
      return { tpl, data };
    },
    onSuccess: ({ tpl, data }) => {
      if (data.decomposable && data.composition) {
        setDraft({
          layout: data.composition.layout,
          subject: data.composition.subject,
          preheader: data.composition.preheader ?? "",
          children: data.composition.children,
        });
        setDraftSlug(tpl.name);
        setView({ kind: "composer" });
        return;
      }
      setView({
        kind: "source",
        template: tpl,
        rawSource: data.rawSource,
        reason: data.reason ?? "Source contains JSX outside the composer grammar.",
      });
    },
    onError: (err) => setEditLoadError(err instanceof Error ? err.message : String(err)),
  });

  // The "Reset to default" action: DELETE the module-overlay file. The
  // dialog confirms first; this hook only fires on the confirmed click.
  const resetOverride = useMutation({
    mutationFn: async (tpl: DiscoveredTemplate) => {
      setResetError(null);
      const params = new URLSearchParams();
      if (tpl.locale) params.set("locale", tpl.locale);
      const qs = params.toString();
      const url = `/hub/emails/templates/${encodeURIComponent(tpl.name)}/override${qs ? `?${qs}` : ""}`;
      const res = await fetch(url, {
        method: "DELETE",
        credentials: "include",
        headers: { accept: "application/json" },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`reset failed: ${res.status} — ${text.slice(0, 200)}`);
      }
      return (await res.json()) as { ok: true; acted: true; relativePath: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hub", "email-builder", "templates"] });
      setResetTarget(null);
    },
    onError: (err) => setResetError(err instanceof Error ? err.message : String(err)),
  });

  const subtitle = templates.data
    ? `${templates.data.templates.length} discovered template(s) — gallery + composer for project-owned templates.`
    : "Loading…";

  return (
    <AdminShell title="Emails" subtitle={subtitle} currentNav="emails">
      {editLoadError ? (
        <Card className="mb-4 border-err/40 bg-err/10" role="alert">
          <CardContent className="p-3 text-sm">
            <strong className="text-err">Could not load template:</strong> {editLoadError}
          </CardContent>
        </Card>
      ) : null}
      {view.kind === "gallery" ? (
        <GalleryView
          templates={templates.data?.templates ?? []}
          isLoading={templates.isLoading}
          isError={templates.isError}
          loadError={templates.error}
          isCustomizing={customize.isPending}
          onNew={() => {
            setDraft(emptyDraft());
            setDraftSlug("");
            setView({ kind: "composer" });
          }}
          onDuplicate={(tpl) => {
            setDraft(emptyDraft());
            setDraftSlug(`${tpl.name}-copy`);
            setView({ kind: "composer" });
          }}
          onCustomize={(tpl) => customize.mutate(tpl)}
          onReset={(tpl) => {
            setResetError(null);
            setResetTarget(tpl);
          }}
        />
      ) : view.kind === "composer" ? (
        <ComposerView
          draft={draft}
          setDraft={setDraft}
          slug={draftSlug}
          setSlug={setDraftSlug}
          blocks={blocks.data}
          onClose={() => setView({ kind: "gallery" })}
        />
      ) : (
        <SourceView
          template={view.template}
          rawSource={view.rawSource}
          reason={view.reason}
          onClose={() => setView({ kind: "gallery" })}
        />
      )}
      <ResetConfirmDialog
        target={resetTarget}
        isPending={resetOverride.isPending}
        error={resetError}
        onCancel={() => setResetTarget(null)}
        onConfirm={(tpl) => resetOverride.mutate(tpl)}
      />
    </AdminShell>
  );
}

function buildCompositionUrl(tpl: DiscoveredTemplate): string {
  const params = new URLSearchParams();
  if (tpl.locale) params.set("locale", tpl.locale);
  const qs = params.toString();
  return `/hub/emails/templates/${encodeURIComponent(tpl.name)}/composition.json${qs ? `?${qs}` : ""}`;
}

interface GalleryProps {
  templates: DiscoveredTemplate[];
  isLoading: boolean;
  isError: boolean;
  loadError: unknown;
  isCustomizing: boolean;
  onNew: () => void;
  onDuplicate: (tpl: DiscoveredTemplate) => void;
  onCustomize: (tpl: DiscoveredTemplate) => void;
  onReset: (tpl: DiscoveredTemplate) => void;
}

function GalleryView({
  templates,
  isLoading,
  isError,
  loadError,
  isCustomizing,
  onNew,
  onDuplicate,
  onCustomize,
  onReset,
}: GalleryProps): ReactNode {
  if (isLoading) return <PageLoading>Loading email templates…</PageLoading>;
  if (isError) {
    const detail = loadError instanceof Error ? loadError.message : "";
    return (
      <PageError showAuthHint={needsAdminAuthHint(loadError)}>
        Failed to load /hub/emails/templates.json{detail ? ` — ${detail}` : ""}
      </PageError>
    );
  }
  // Hide redundant rows: a module overlay shadows the same-named core
  // template at runtime, so we only render the "Core (overridden)"
  // row in the gallery and surface the customise / reset buttons there.
  const visible = templates.filter((tpl) => !tpl.overridesCore);
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Templates</CardTitle>
            <p className="mt-1 text-xs text-fg-muted">
              File-based React-Email templates discovered under{" "}
              <code className="font-mono text-accent">src/core/email/templates/</code> and{" "}
              <code className="font-mono text-accent">src/modules/email/templates/</code>. Core
              templates are editable via copy-on-edit — saving writes a module overlay; the core
              file is never touched.
            </p>
          </div>
          <Button onClick={onNew}>+ New template</Button>
        </CardHeader>
      </Card>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-eb-gallery="true">
        {visible.length === 0 ? (
          <PageEmpty>No templates discovered.</PageEmpty>
        ) : (
          visible.map((tpl) => (
            <TemplateCard
              key={`${tpl.source}:${tpl.name}:${tpl.locale ?? "default"}`}
              tpl={tpl}
              isCustomizing={isCustomizing}
              onDuplicate={() => onDuplicate(tpl)}
              onCustomize={() => onCustomize(tpl)}
              onReset={() => onReset(tpl)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function templateBadge(tpl: DiscoveredTemplate): {
  label: string;
  variant: "ok" | "info" | "warn";
} {
  if (tpl.source === "core" && tpl.overrideExists) {
    return { label: "Core (overridden)", variant: "warn" };
  }
  if (tpl.source === "core") {
    return { label: "Core (default)", variant: "ok" };
  }
  return { label: "Module", variant: "info" };
}

function TemplateCard({
  tpl,
  isCustomizing,
  onDuplicate,
  onCustomize,
  onReset,
}: {
  tpl: DiscoveredTemplate;
  isCustomizing: boolean;
  onDuplicate: () => void;
  onCustomize: () => void;
  onReset: () => void;
}): ReactNode {
  const badge = templateBadge(tpl);
  const isCoreOverridden = tpl.source === "core" && tpl.overrideExists === true;
  return (
    <Card data-eb-card={tpl.name}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle>{tpl.name}</CardTitle>
          <Badge variant={badge.variant} data-eb-badge={tpl.source}>
            {badge.label}
            {tpl.locale ? ` · ${tpl.locale}` : ""}
          </Badge>
        </div>
        <p className="min-h-[2em] text-xs text-fg-muted">
          {tpl.error ? `⚠ ${tpl.error}` : (tpl.subject ?? "")}
          {!tpl.error && tpl.previewPayloadSource === "brand" ? (
            <span className="mt-1 block text-fg-muted">
              Preview uses brand name only — send via outbox for real vars.
            </span>
          ) : null}
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="default"
          onClick={onCustomize}
          disabled={isCustomizing}
          data-eb-action="customize"
          aria-label={`Customize ${tpl.name}`}
        >
          Customize
        </Button>
        <Button size="sm" variant="outline" onClick={onDuplicate} data-eb-action="duplicate">
          Duplicate
        </Button>
        {isCoreOverridden ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onReset}
            data-eb-action="reset"
            aria-label={`Reset ${tpl.name} to core default`}
          >
            Reset to default
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * SourceView — fallback for templates the planner can't decompose
 * (custom JSX, conditionals, computed expressions). The operator can
 * read the .tsx but not edit it structurally; saving from the
 * composer requires a hand-rewrite into composer-grammar shape.
 */
function SourceView({
  template,
  rawSource,
  reason,
  onClose,
}: {
  template: DiscoveredTemplate;
  rawSource: string;
  reason: string;
  onClose: () => void;
}): ReactNode {
  return (
    <Card data-eb-source-view={template.name}>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>{template.name} — read-only source</CardTitle>
          <p className="mt-1 text-xs text-fg-muted">
            This template uses JSX outside the composer grammar — opening it in the structured
            editor would silently drop content. Reason:{" "}
            <code className="font-mono text-accent">{reason}</code>
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            To customize it, copy <code className="font-mono">{template.file}</code> to{" "}
            <code className="font-mono">src/modules/email/templates/{template.name}.tsx</code> by
            hand, edit it, and the module overlay will take precedence on the next render.
          </p>
        </div>
        <Button variant="outline" onClick={onClose}>
          Back to gallery
        </Button>
      </CardHeader>
      <CardContent>
        <pre className="max-h-[60vh] overflow-auto rounded-md border border-line bg-surface-2 p-3 text-xs leading-relaxed">
          <code>{rawSource}</code>
        </pre>
      </CardContent>
    </Card>
  );
}

/**
 * ResetConfirmDialog — guards the destructive DELETE-override action.
 * Removing the module overlay returns the template to the upstream
 * core default, which the operator may want to keep around as a
 * baseline before re-customizing.
 */
function ResetConfirmDialog({
  target,
  isPending,
  error,
  onCancel,
  onConfirm,
}: {
  target: DiscoveredTemplate | null;
  isPending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (tpl: DiscoveredTemplate) => void;
}): ReactNode {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => (open ? null : onCancel())}>
      <DialogContent data-eb-reset-dialog="true">
        <DialogHeader>
          <DialogTitle>Reset {target?.name ?? ""} to core default?</DialogTitle>
          <DialogDescription>
            This deletes the project-owned overlay file under{" "}
            <code className="font-mono">src/modules/email/templates/</code> so the upstream core
            template becomes authoritative again. Your customisations are removed from the file
            system — keep a copy elsewhere if you need to roll back.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p
            className="rounded-md border border-err/40 bg-err/10 p-2 text-xs text-err"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={() => target && onConfirm(target)}
            disabled={isPending || target === null}
            data-eb-action="confirm-reset"
          >
            {isPending ? "Resetting…" : "Reset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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

  const brand = useQuery({
    queryKey: ["hub", "brand"],
    queryFn: () => fetchJson<{ name: string }>("/hub/brand.json"),
  });

  const referencedVars = useMemo(() => collectVars(draft), [draft]);
  const [vars, setVars] = useState<Record<string, string>>({});

  useEffect(() => {
    setVars((prev) => {
      const next: Record<string, string> = { ...prev };
      let changed = false;
      for (const v of referencedVars) {
        if (next[v] === undefined) {
          next[v] = defaultVarValue(v, brand.data?.name);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [referencedVars, brand.data?.name]);

  const preview = useQuery({
    queryKey: ["hub", "email-builder", "preview", draft, vars],
    queryFn: async () => {
      const res = await fetch("/hub/emails/preview.json", {
        method: "POST",
        credentials: "include",
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
      const res = await fetch("/hub/emails/save", {
        method: "POST",
        credentials: "include",
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
      queryClient.invalidateQueries({ queryKey: ["hub", "email-builder", "templates"] });
    },
    onError: (err) => setSaveError(err instanceof Error ? err.message : String(err)),
  });

  const blockLib = blocks?.blocks ?? [];
  const layoutLib = blocks?.layouts ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <FormField label="Slug" id="eb-slug" value={slug} onChange={setSlug} hint="my-template" />
          <FormField
            label="Subject"
            id="eb-subject"
            value={draft.subject}
            onChange={(v) => setDraft({ ...draft, subject: v })}
          />
          <FormField
            label="Preheader"
            id="eb-preheader"
            value={draft.preheader}
            onChange={(v) => setDraft({ ...draft, preheader: v })}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="eb-layout">Layout</Label>
            <Select value={draft.layout} onValueChange={(v) => setDraft({ ...draft, layout: v })}>
              <SelectTrigger id="eb-layout" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {layoutLib.map((l) => (
                  <SelectItem key={l.name} value={l.name}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" onClick={onClose}>
              Back to gallery
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !slug}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {saveError ? (
        <Card className="border-err/40 bg-err/10" role="alert">
          <CardContent className="p-3 text-sm">
            <strong className="text-err">Save failed:</strong> {saveError}
          </CardContent>
        </Card>
      ) : null}
      {save.isSuccess ? (
        <Card className="border-ok/40 bg-ok/10">
          <CardContent className="p-3 text-sm text-ok">
            Saved to <code className="font-mono">{save.data?.relativePath}</code>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(180px,1fr)_minmax(280px,2fr)_minmax(320px,2fr)]">
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
    </div>
  );
}

function FormField({
  label,
  id,
  value,
  onChange,
  hint,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}): ReactNode {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hint}
        className="w-44"
      />
    </div>
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
    <Card>
      <CardHeader>
        <CardTitle>Block Palette</CardTitle>
        <p className="text-xs text-fg-muted">Click to append.</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {blocks.map((b) => (
          <div key={b.type} className="flex flex-col gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAdd(b.type)}
              aria-label={`Add ${b.label} block`}
            >
              + {b.label}
            </Button>
            <p className="text-[0.7rem] text-fg-muted">{b.description}</p>
          </div>
        ))}
      </CardContent>
    </Card>
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
    <Card data-eb-composer="true">
      <CardHeader>
        <CardTitle>Composition</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ol className="flex flex-col gap-2">
          {draft.children.map((block, i) => (
            <li
              key={`${i}-${block.type}`}
              data-eb-block-row={block.type}
              className={cn(
                "rounded-md border border-line bg-surface-1 p-2",
                i === selectedIndex && "bg-surface-hover",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={i === selectedIndex ? "default" : "outline"}
                  onClick={() => setSelectedIndex(i)}
                  aria-label={`Edit block ${i}`}
                >
                  {block.type}
                </Button>
                <span className="flex-1 truncate text-xs text-fg-muted">
                  {String(block.props.text ?? "").slice(0, 40)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => moveBlock(draft, setDraft, i, -1, setSelectedIndex)}
                  disabled={i === 0}
                  aria-label={`Move block ${i} up`}
                >
                  ↑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => moveBlock(draft, setDraft, i, 1, setSelectedIndex)}
                  disabled={i === draft.children.length - 1}
                  aria-label={`Move block ${i} down`}
                >
                  ↓
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removeBlock(draft, setDraft, i, setSelectedIndex)}
                  aria-label={`Delete block ${i}`}
                >
                  ✕
                </Button>
              </div>
            </li>
          ))}
        </ol>

        {selected && selectedDescriptor ? (
          <div className="border-t border-line pt-4">
            <h4 className="mb-2 text-sm font-semibold">Properties — {selectedDescriptor.label}</h4>
            {selectedDescriptor.props.length === 0 ? (
              <p className="text-xs text-fg-muted">No editable props.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {selectedDescriptor.props.map((prop) => (
                  <FormField
                    key={prop.name}
                    label={prop.name}
                    id={`prop-${selectedIndex}-${prop.name}`}
                    value={String(selected.props[prop.name] ?? "")}
                    onChange={(value) =>
                      updateBlockProp(draft, setDraft, selectedIndex!, prop.name, value)
                    }
                  />
                ))}
              </div>
            )}
          </div>
        ) : null}

        <div className="border-t border-line pt-4">
          <h4 className="mb-2 text-sm font-semibold">Variables</h4>
          <p className="text-xs text-fg-muted">
            Sample values for the live preview. The saved{" "}
            <code className="font-mono text-accent">.tsx</code> declares each variable as a required
            string prop.
          </p>
          {Object.keys(vars).length === 0 ? (
            <p className="text-xs text-fg-muted">
              <em>
                No variables — add a <code className="font-mono">{"{{name}}"}</code> token to a
                block.
              </em>
            </p>
          ) : (
            <div className="mt-2 flex flex-col gap-3">
              {Object.keys(vars)
                .sort()
                .map((name) => (
                  <FormField
                    key={name}
                    id={`var-${name}`}
                    label={name}
                    value={vars[name] ?? ""}
                    onChange={(value) => setVars({ ...vars, [name]: value })}
                  />
                ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
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
    <Card data-eb-preview="true">
      <CardHeader>
        <CardTitle>Live Preview</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="rounded-md border border-err/40 bg-err/10 p-3 text-sm text-err">
            ⚠ {error instanceof Error ? error.message : String(error)}
          </div>
        ) : isLoading || !preview ? (
          <p className="text-xs text-fg-muted">Rendering…</p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="text-sm">
              <strong className="text-fg-dim">Subject:</strong>{" "}
              <span className="font-mono">{preview.subject}</span>
            </div>
            <iframe
              sandbox=""
              srcDoc={preview.html}
              className="h-[26rem] w-full rounded border-0 bg-transparent"
              style={{ colorScheme: "dark" }}
              title="Live email preview"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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

function defaultVarValue(name: string, brandName?: string): string {
  if (name === "appName" && brandName) return brandName;
  return `<${name}>`;
}
