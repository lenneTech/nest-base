/**
 * `/dev/files` — Dev-Portal File-Manager.
 *
 * Two-column layout:
 *   - left rail: collapsible folder tree (built from /dev/files/tree.json)
 *   - right pane: breadcrumb + sort/filter toolbar + file grid
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "../components/ui/button.js";
import { Card, CardContent } from "../components/ui/card.js";
import { Checkbox } from "../components/ui/checkbox.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Progress } from "../components/ui/progress.js";
import { buildIpxUrl, isPreviewableImage } from "../lib/asset-url.js";
import { tusUpload } from "../lib/tus-upload.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import { PageEmpty, PageError, PageLoading } from "../components/PageState.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson, formatBytes } from "../lib/api.js";
import { cn } from "../lib/utils.js";

interface FolderTreeNodeDto {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  path: { id: string; name: string }[];
  children: FolderTreeNodeDto[];
}

interface FileEntryDto {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  folderId: string | null;
  storageKey: string;
  thumbnailUrl?: string;
  visibility?: "PRIVATE" | "PUBLIC";
}

interface BreadcrumbSegment {
  id: string | null;
  name: string;
}

interface TreeResponse {
  tree: FolderTreeNodeDto[];
}

interface ListResponse {
  files: FileEntryDto[];
  totalCount: number;
}

interface BreadcrumbResponse {
  segments: BreadcrumbSegment[];
}

type SortKey = "name" | "size" | "createdAt" | "updatedAt" | "mimeType";
type SortDirection = "asc" | "desc";

const SORT_KEYS: { id: SortKey; label: string }[] = [
  { id: "name", label: "Name" },
  { id: "size", label: "Größe" },
  { id: "createdAt", label: "Erstellt" },
  { id: "updatedAt", label: "Aktualisiert" },
  { id: "mimeType", label: "Typ" },
];

export function FileManagerPage(): ReactNode {
  const [tenantId, setTenantId] = useState<string>(readDefaultTenantId());
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [newFolderName, setNewFolderName] = useState("");
  const [lightboxFile, setLightboxFile] = useState<FileEntryDto | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [shareFile, setShareFile] = useState<FileEntryDto | null>(null);

  const queryClient = useQueryClient();
  const tenantValid = isUuid(tenantId);

  const treeQuery = useQuery({
    queryKey: ["dev", "files", "tree", tenantId],
    queryFn: () => fetchJson<TreeResponse>(`/api/dev/files/tree.json?tenantId=${tenantId}`),
    enabled: tenantValid,
  });

  const listUrl = useMemo(() => {
    const p = new URLSearchParams();
    p.set("tenantId", tenantId);
    if (activeFolderId) p.set("folderId", activeFolderId);
    if (search) p.set("search", search);
    p.set("sortBy", sortBy);
    p.set("sortDirection", sortDirection);
    return `/api/dev/files/list.json?${p.toString()}`;
  }, [tenantId, activeFolderId, search, sortBy, sortDirection]);

  const listQuery = useQuery({
    queryKey: ["dev", "files", "list", listUrl],
    queryFn: () => fetchJson<ListResponse>(listUrl),
    enabled: tenantValid,
  });

  const breadcrumbUrl = useMemo(() => {
    const p = new URLSearchParams();
    p.set("tenantId", tenantId);
    if (activeFolderId) p.set("folderId", activeFolderId);
    return `/api/dev/files/breadcrumb.json?${p.toString()}`;
  }, [tenantId, activeFolderId]);

  const breadcrumbQuery = useQuery({
    queryKey: ["dev", "files", "breadcrumb", breadcrumbUrl],
    queryFn: () => fetchJson<BreadcrumbResponse>(breadcrumbUrl),
    enabled: tenantValid,
  });

  const createFolder = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "content-type": "application/json", "x-tenant-id": tenantId },
        body: JSON.stringify({
          tenantId,
          parentId: activeFolderId,
          name: newFolderName,
        }),
      });
      if (!res.ok) throw new Error(`folder create failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      setNewFolderName("");
      void queryClient.invalidateQueries({ queryKey: ["dev", "files", "tree"] });
      void queryClient.invalidateQueries({ queryKey: ["dev", "files", "list"] });
    },
  });

  const deleteFile = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/files/${id}`, {
        method: "DELETE",
        headers: { "x-tenant-id": tenantId },
      });
      if (!res.ok) throw new Error(`file delete failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["dev", "files", "list"] });
    },
  });

  const toggleVisibility = useMutation({
    mutationFn: async (input: { id: string; next: "PRIVATE" | "PUBLIC" }) => {
      const res = await fetch(`/api/files/${input.id}/visibility`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-tenant-id": tenantId },
        body: JSON.stringify({ visibility: input.next }),
      });
      if (!res.ok) throw new Error(`visibility update failed (${res.status})`);
      return res.json();
    },
    onSuccess: (_d, vars) => {
      toast.success(`Sichtbarkeit: ${vars.next}`);
      void queryClient.invalidateQueries({ queryKey: ["dev", "files", "list"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const bulkZip = useMutation({
    mutationFn: async (ids: readonly string[]) => {
      const res = await fetch("/api/files/zip", {
        method: "POST",
        headers: { "content-type": "application/json", "x-tenant-id": tenantId },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error(`zip failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "files.zip";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      return ids.length;
    },
    onSuccess: (count) => toast.success(`${count} Datei(en) als ZIP heruntergeladen.`),
    onError: (err: Error) => toast.error(err.message),
  });

  const bulkDelete = useMutation({
    mutationFn: async (ids: readonly string[]) => {
      const results = await Promise.all(
        ids.map(async (id) => {
          const res = await fetch(`/api/files/${id}`, {
            method: "DELETE",
            headers: { "x-tenant-id": tenantId },
          });
          return { id, ok: res.ok, status: res.status };
        }),
      );
      const succeeded = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      return { succeeded, failed };
    },
    onSuccess: ({ succeeded, failed }) => {
      setSelectedIds(new Set());
      void queryClient.invalidateQueries({ queryKey: ["dev", "files", "list"] });
      if (failed.length === 0) {
        toast.success(`${succeeded} Datei(en) gelöscht.`);
      } else {
        toast.error(`${succeeded} gelöscht · ${failed.length} fehlgeschlagen.`);
      }
    },
  });

  const subtitle = tenantValid
    ? `Tenant: ${tenantId} · ${listQuery.data?.totalCount ?? 0} Dateien im aktiven Ordner`
    : "Bitte eine gültige Tenant-UUID eingeben oder als Cookie x-tenant-id setzen.";

  return (
    <AdminShell title="File Manager" subtitle={subtitle} currentNav="files">
      <Card data-file-manager>
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-1 min-w-72 flex-col gap-1.5">
              <Label htmlFor="tenant-id">Tenant-UUID</Label>
              <Input
                id="tenant-id"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            </div>
            {!tenantValid ? (
              <span className="text-xs text-fg-muted">UUID muss 8-4-4-4-12 Zeichen lang sein.</span>
            ) : null}
          </div>
          {tenantValid ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
              <aside
                className="rounded-md border border-line bg-surface-2 p-3"
                data-fm-region="tree"
              >
                <header className="mb-3 flex items-center justify-between">
                  <strong className="text-xs uppercase tracking-wider text-fg-dim">Ordner</strong>
                  <button
                    type="button"
                    className={cn(
                      "rounded px-2 py-1 text-xs",
                      activeFolderId === null
                        ? "bg-accent-soft text-accent"
                        : "text-fg-muted hover:text-fg",
                    )}
                    onClick={() => setActiveFolderId(null)}
                    data-action="select-root"
                    data-active={activeFolderId === null}
                  >
                    Root
                  </button>
                </header>
                {treeQuery.data ? (
                  <FolderTree
                    nodes={treeQuery.data.tree}
                    activeId={activeFolderId}
                    onSelect={setActiveFolderId}
                  />
                ) : treeQuery.isError ? (
                  <PageError>Ordnerbaum konnte nicht geladen werden.</PageError>
                ) : (
                  <PageLoading>Lade…</PageLoading>
                )}
                <form
                  className="mt-4 flex flex-col gap-2 border-t border-line pt-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newFolderName.trim().length > 0 && !createFolder.isPending) {
                      createFolder.mutate();
                    }
                  }}
                >
                  <Label htmlFor="new-folder">Neuer Ordner</Label>
                  <Input
                    id="new-folder"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="Neuer Ordner"
                  />
                  <Button
                    variant="outline"
                    type="submit"
                    size="sm"
                    disabled={createFolder.isPending || newFolderName.trim().length === 0}
                    data-action="create-folder"
                  >
                    {createFolder.isPending ? "Anlegen…" : "Anlegen"}
                  </Button>
                  {createFolder.isError ? (
                    <span className="text-xs text-err">
                      {(createFolder.error as Error).message}
                    </span>
                  ) : null}
                </form>
              </aside>
              <section className="flex flex-col gap-3" data-fm-region="grid">
                <div aria-label="Pfad">
                  {breadcrumbQuery.data ? (
                    <BreadcrumbBar
                      segments={breadcrumbQuery.data.segments}
                      onSelect={setActiveFolderId}
                    />
                  ) : null}
                </div>
                <UploadDropZone
                  tenantId={tenantId}
                  folderId={activeFolderId}
                  onUploaded={() => {
                    void queryClient.invalidateQueries({ queryKey: ["dev", "files", "list"] });
                  }}
                />
                <div className="flex flex-wrap items-end gap-3 rounded-md border border-line bg-surface-2 p-3">
                  <div className="flex flex-1 min-w-48 flex-col gap-1.5">
                    <Label htmlFor="fm-search">Suche</Label>
                    <Input
                      id="fm-search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Dateiname enthält…"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="fm-sort">Sortieren nach</Label>
                    <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
                      <SelectTrigger id="fm-sort" className="w-44">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SORT_KEYS.map((k) => (
                          <SelectItem key={k.id} value={k.id}>
                            {k.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSortDirection((d) => (d === "asc" ? "desc" : "asc"))}
                    data-action="toggle-direction"
                  >
                    {sortDirection === "asc" ? "↑ aufsteigend" : "↓ absteigend"}
                  </Button>
                </div>
                {listQuery.isError ? (
                  <PageError>Datei-Liste konnte nicht geladen werden.</PageError>
                ) : !listQuery.data ? (
                  <PageLoading>Lade…</PageLoading>
                ) : listQuery.data.files.length === 0 ? (
                  <PageEmpty>Keine Dateien in diesem Ordner.</PageEmpty>
                ) : (
                  <>
                    <BulkActionBar
                      visibleIds={listQuery.data.files.map((f) => f.id)}
                      selectedIds={selectedIds}
                      onSelectAll={() =>
                        setSelectedIds(new Set(listQuery.data!.files.map((f) => f.id)))
                      }
                      onClear={() => setSelectedIds(new Set())}
                      onBulkDelete={() => {
                        const ids = [...selectedIds];
                        if (ids.length === 0) return;
                        if (
                          typeof window !== "undefined" &&
                          !window.confirm(`${ids.length} Datei(en) löschen?`)
                        )
                          return;
                        bulkDelete.mutate(ids);
                      }}
                      isBulkDeleting={bulkDelete.isPending}
                      onBulkZip={() => {
                        const ids = [...selectedIds];
                        if (ids.length === 0) return;
                        bulkZip.mutate(ids);
                      }}
                      isBulkZipping={bulkZip.isPending}
                    />
                    <FileGrid
                      files={listQuery.data.files}
                      onDelete={(id) => deleteFile.mutate(id)}
                      isDeleting={deleteFile.isPending}
                      onPreview={(f) => setLightboxFile(f)}
                      onShare={(f) => setShareFile(f)}
                      onToggleVisibility={(f) =>
                        toggleVisibility.mutate({
                          id: f.id,
                          next: f.visibility === "PUBLIC" ? "PRIVATE" : "PUBLIC",
                        })
                      }
                      selectedIds={selectedIds}
                      onToggleSelect={(id) =>
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          return next;
                        })
                      }
                    />
                  </>
                )}
              </section>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <FilePreviewLightbox file={lightboxFile} onClose={() => setLightboxFile(null)} />
      <ShareLinkDialog file={shareFile} tenantId={tenantId} onClose={() => setShareFile(null)} />
    </AdminShell>
  );
}

function FolderTree({
  nodes,
  activeId,
  onSelect,
}: {
  nodes: FolderTreeNodeDto[];
  activeId: string | null;
  onSelect: (id: string) => void;
}): ReactNode {
  if (nodes.length === 0) {
    return <PageEmpty>Keine Ordner.</PageEmpty>;
  }
  return (
    <ul className="flex flex-col gap-0.5" role="tree">
      {nodes.map((n) => (
        <FolderTreeNode key={n.id} node={n} activeId={activeId} onSelect={onSelect} />
      ))}
    </ul>
  );
}

function FolderTreeNode({
  node,
  activeId,
  onSelect,
}: {
  node: FolderTreeNodeDto;
  activeId: string | null;
  onSelect: (id: string) => void;
}): ReactNode {
  const isActive = activeId === node.id;
  return (
    <li role="treeitem" aria-selected={isActive} data-folder-id={node.id}>
      <button
        type="button"
        className={cn(
          "block w-full rounded px-2 py-1 text-left text-xs",
          isActive
            ? "bg-accent-soft text-accent"
            : "text-fg-muted hover:bg-surface-hover hover:text-fg",
        )}
        data-active={isActive}
        style={{ paddingLeft: `${0.5 + node.depth * 0.75}rem` }}
        onClick={() => onSelect(node.id)}
      >
        {node.name}
      </button>
      {node.children.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {node.children.map((c) => (
            <FolderTreeNode key={c.id} node={c} activeId={activeId} onSelect={onSelect} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function BreadcrumbBar({
  segments,
  onSelect,
}: {
  segments: BreadcrumbSegment[];
  onSelect: (id: string | null) => void;
}): ReactNode {
  return (
    <ol className="flex flex-wrap items-center gap-1 text-sm">
      {segments.map((seg, idx) => (
        <li key={`${seg.id ?? "root"}-${idx}`} className="flex items-center gap-1">
          {idx > 0 ? <span className="text-fg-faint">/</span> : null}
          <button
            type="button"
            className={cn(
              "rounded px-2 py-1 text-xs hover:bg-surface-hover",
              idx === segments.length - 1 ? "text-accent" : "text-fg-muted",
            )}
            onClick={() => onSelect(seg.id)}
            data-active={idx === segments.length - 1}
          >
            {seg.name}
          </button>
        </li>
      ))}
    </ol>
  );
}

function FileGrid({
  files,
  onDelete,
  isDeleting,
  onPreview,
  onShare,
  onToggleVisibility,
  selectedIds,
  onToggleSelect,
}: {
  files: FileEntryDto[];
  onDelete: (id: string) => void;
  isDeleting: boolean;
  onPreview: (file: FileEntryDto) => void;
  onShare: (file: FileEntryDto) => void;
  onToggleVisibility: (file: FileEntryDto) => void;
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (id: string) => void;
}): ReactNode {
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" role="list">
      {files.map((f) => {
        const previewable = isPreviewableImage(f.mimeType);
        const isSelected = selectedIds.has(f.id);
        return (
          <li
            key={f.id}
            className={cn(
              "flex flex-col overflow-hidden rounded-md border bg-surface-2",
              isSelected ? "border-accent ring-1 ring-accent" : "border-line",
            )}
            data-file-id={f.id}
            data-selected={isSelected}
          >
            <div className="flex items-center gap-2 px-2 pt-2">
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => onToggleSelect(f.id)}
                aria-label={`Auswählen: ${f.filename}`}
                data-action="select-file"
              />
              <span className="truncate text-[0.65rem] text-fg-faint">{f.id.slice(0, 8)}…</span>
            </div>
            <button
              type="button"
              disabled={!previewable}
              onClick={() => previewable && onPreview(f)}
              className={cn(
                "flex aspect-square items-center justify-center bg-surface-3",
                previewable ? "cursor-zoom-in hover:bg-surface-hover" : "cursor-default",
              )}
              data-action="preview-file"
              aria-label={previewable ? `Vorschau: ${f.filename}` : f.filename}
            >
              {f.thumbnailUrl ? (
                <img
                  src={f.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="font-mono text-xs text-fg-faint" aria-hidden="true">
                  {iconForMime(f.mimeType)}
                </span>
              )}
            </button>
            <div className="flex flex-1 flex-col gap-1 p-2">
              <strong className="truncate text-xs" title={f.filename}>
                {f.filename}
              </strong>
              <span className="text-[0.65rem] text-fg-muted">
                {formatBytes(f.sizeBytes)} · {f.mimeType}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1 border-t border-line p-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onToggleVisibility(f)}
                data-action="toggle-visibility"
                title={`Sichtbarkeit: ${f.visibility ?? "PRIVATE"}`}
              >
                {f.visibility === "PUBLIC" ? "Öffentlich" : "Privat"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onShare(f)} data-action="share-file">
                Teilen
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={isDeleting}
                onClick={() => {
                  if (typeof window !== "undefined" && !window.confirm(`Löschen: ${f.filename}?`))
                    return;
                  onDelete(f.id);
                }}
                data-action="delete-file"
              >
                Löschen
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function FilePreviewLightbox({
  file,
  onClose,
}: {
  file: FileEntryDto | null;
  onClose: () => void;
}): ReactNode {
  const open = file !== null;
  const previewable = file ? isPreviewableImage(file.mimeType) : false;
  const fullUrl = file ? buildIpxUrl({ storageKey: file.storageKey, width: 1600 }) : "";
  const rawUrl = file ? `/_ipx/_/${file.storageKey.replace(/^\//, "")}` : "";
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="truncate text-sm">{file?.filename ?? ""}</DialogTitle>
        </DialogHeader>
        {file ? (
          <div className="flex flex-col items-center gap-3">
            {previewable ? (
              <img
                src={fullUrl}
                alt={file.filename}
                className="max-h-[70vh] w-auto rounded border border-line bg-surface-3 object-contain"
                data-action="lightbox-image"
              />
            ) : (
              <div className="flex h-48 w-full items-center justify-center rounded border border-dashed border-line bg-surface-2 text-xs text-fg-muted">
                Vorschau nicht verfügbar — {file.mimeType}
              </div>
            )}
            <div className="flex w-full items-center justify-between text-xs text-fg-muted">
              <span>
                {formatBytes(file.sizeBytes)} · {file.mimeType}
              </span>
              <a
                className="text-accent underline"
                href={rawUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-action="lightbox-download"
              >
                Original öffnen ↗
              </a>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function BulkActionBar({
  visibleIds,
  selectedIds,
  onSelectAll,
  onClear,
  onBulkDelete,
  isBulkDeleting,
  onBulkZip,
  isBulkZipping,
}: {
  visibleIds: readonly string[];
  selectedIds: ReadonlySet<string>;
  onSelectAll: () => void;
  onClear: () => void;
  onBulkDelete: () => void;
  isBulkDeleting: boolean;
  onBulkZip: () => void;
  isBulkZipping: boolean;
}): ReactNode {
  const selectedVisible = visibleIds.filter((id) => selectedIds.has(id));
  const allVisibleSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface-2 px-3 py-2"
      data-fm-region="bulk-bar"
    >
      <div className="flex items-center gap-3 text-xs">
        <Checkbox
          checked={allVisibleSelected}
          onCheckedChange={() => (allVisibleSelected ? onClear() : onSelectAll())}
          aria-label="Alle sichtbaren auswählen"
          data-action="select-all"
        />
        <span className="text-fg-muted">
          {selectedIds.size === 0
            ? `Keine ausgewählt · ${visibleIds.length} sichtbar`
            : `${selectedIds.size} ausgewählt`}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={selectedIds.size === 0}
          onClick={onClear}
          data-action="clear-selection"
        >
          Auswahl leeren
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={selectedIds.size === 0 || isBulkZipping}
          onClick={onBulkZip}
          data-action="bulk-zip"
        >
          {isBulkZipping ? "Erzeuge…" : `Als ZIP (${selectedIds.size})`}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={selectedIds.size === 0 || isBulkDeleting}
          onClick={onBulkDelete}
          data-action="bulk-delete"
        >
          {isBulkDeleting ? "Lösche…" : `Auswahl löschen (${selectedIds.size})`}
        </Button>
      </div>
    </div>
  );
}

interface ShareLinkResponse {
  shareToken: string;
  url: string;
  expiresAt: string;
}

function ShareLinkDialog({
  file,
  tenantId,
  onClose,
}: {
  file: FileEntryDto | null;
  tenantId: string;
  onClose: () => void;
}): ReactNode {
  const open = file !== null;
  const [ttlHours, setTtlHours] = useState(24);
  const [link, setLink] = useState<ShareLinkResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when the dialog re-opens for a different file.
  const lastFileId = useRef<string | null>(null);
  if (file && lastFileId.current !== file.id) {
    lastFileId.current = file.id;
    setLink(null);
    setError(null);
  }

  const issue = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/files/${file.id}/share-link`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-tenant-id": tenantId },
        body: JSON.stringify({ ttlSeconds: ttlHours * 3600 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ShareLinkResponse;
      setLink(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Link in die Zwischenablage kopiert.");
    } catch (err) {
      toast.error(`Kopieren fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const absoluteUrl = link
    ? `${typeof window !== "undefined" ? window.location.origin : ""}${link.url}`
    : "";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="truncate text-sm">Teilen: {file?.filename ?? ""}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="share-ttl">Gültigkeit (Stunden)</Label>
              <Input
                id="share-ttl"
                type="number"
                min={1}
                max={168}
                value={ttlHours}
                onChange={(e) => setTtlHours(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
                className="w-32"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => void issue()}
              data-action="issue-share-link"
            >
              {loading ? "Erzeuge…" : "Link erzeugen"}
            </Button>
          </div>
          {error ? (
            <p className="text-xs text-err" data-share-error>
              {error}
            </p>
          ) : null}
          {link ? (
            <div className="flex flex-col gap-2 rounded border border-line bg-surface-2 p-3">
              <Label htmlFor="share-link-input">Share-URL</Label>
              <div className="flex gap-2">
                <Input id="share-link-input" readOnly value={absoluteUrl} data-share-link-url />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void copy(absoluteUrl)}
                  data-action="copy-share-link"
                >
                  Kopieren
                </Button>
              </div>
              <p className="text-xs text-fg-muted">
                Gültig bis <code className="font-mono">{link.expiresAt}</code>
              </p>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function iconForMime(mime: string): string {
  if (mime.startsWith("image/")) return "IMG";
  if (mime.startsWith("video/")) return "VID";
  if (mime.startsWith("audio/")) return "AUD";
  if (mime.startsWith("text/")) return "TXT";
  if (mime === "application/pdf") return "PDF";
  return "FILE";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

interface UploadProgressEntry {
  id: string;
  filename: string;
  sentBytes: number;
  totalBytes: number;
  status: "uploading" | "done" | "error";
  errorMessage?: string;
}

function UploadDropZone({
  tenantId,
  folderId,
  onUploaded,
}: {
  tenantId: string;
  folderId: string | null;
  onUploaded: () => void;
}): ReactNode {
  const [hover, setHover] = useState(false);
  const [progress, setProgress] = useState<UploadProgressEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const startUpload = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    for (const file of list) {
      const id = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setProgress((prev) => [
        ...prev,
        {
          id,
          filename: file.name,
          sentBytes: 0,
          totalBytes: file.size,
          status: "uploading",
        },
      ]);
      try {
        await tusUpload({
          endpoint: "/api/files/upload",
          file,
          headers: { "x-tenant-id": tenantId },
          metadata: folderId ? { folderId } : {},
          onProgress: (sent) => {
            setProgress((prev) => prev.map((p) => (p.id === id ? { ...p, sentBytes: sent } : p)));
          },
        });
        setProgress((prev) =>
          prev.map((p) => (p.id === id ? { ...p, status: "done", sentBytes: file.size } : p)),
        );
        toast.success(`Hochgeladen: ${file.name}`);
        onUploaded();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setProgress((prev) =>
          prev.map((p) => (p.id === id ? { ...p, status: "error", errorMessage: message } : p)),
        );
        toast.error(`Upload-Fehler: ${file.name} — ${message}`);
      }
    }
  };

  const onDragOver = (ev: DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    setHover(true);
  };
  const onDragLeave = () => setHover(false);
  const onDrop = (ev: DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    setHover(false);
    if (ev.dataTransfer.files && ev.dataTransfer.files.length > 0) {
      void startUpload(ev.dataTransfer.files);
    }
  };
  const onPick = (ev: ChangeEvent<HTMLInputElement>) => {
    if (ev.target.files && ev.target.files.length > 0) {
      void startUpload(ev.target.files);
      // Reset so re-picking the same file re-fires the change event.
      ev.target.value = "";
    }
  };

  return (
    <div
      data-fm-region="upload"
      className={cn(
        "rounded-md border border-dashed p-4 transition-colors",
        hover ? "border-accent bg-accent-soft" : "border-line bg-surface-2",
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <strong className="text-fg">Dateien hochladen</strong>
          <p className="text-xs text-fg-muted">
            Hier reinziehen oder unten auswählen — TUS resumable, Standard-Limit 50 MB pro Datei.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            data-action="upload-input"
            onChange={onPick}
          />
          <Button
            variant="outline"
            size="sm"
            data-action="upload-pick"
            onClick={() => inputRef.current?.click()}
          >
            Datei wählen
          </Button>
        </div>
      </div>
      {progress.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {progress.map((p) => {
            const pct =
              p.totalBytes > 0 ? Math.min(100, Math.round((p.sentBytes / p.totalBytes) * 100)) : 0;
            return (
              <li key={p.id} className="rounded border border-line bg-surface-1 p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{p.filename}</span>
                  <span
                    className={cn(
                      "font-mono",
                      p.status === "done"
                        ? "text-ok"
                        : p.status === "error"
                          ? "text-err"
                          : "text-fg-muted",
                    )}
                  >
                    {p.status === "done" ? "100% ✓" : p.status === "error" ? "Fehler" : `${pct}%`}
                  </span>
                </div>
                <Progress value={p.status === "done" ? 100 : pct} className="mt-1.5 h-1" />
                {p.errorMessage ? <p className="mt-1 text-err">{p.errorMessage}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function readDefaultTenantId(): string {
  if (typeof document === "undefined") return "";
  const match = /(?:^|; )x-tenant-id=([^;]+)/.exec(document.cookie);
  if (!match || !match[1]) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}
