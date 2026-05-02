/**
 * `/dev/files` — Dev-Portal File-Manager.
 *
 * Two-column layout:
 *   - left rail: collapsible folder tree (built from /dev/files/tree.json)
 *   - right pane: breadcrumb + sort/filter toolbar + file grid
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";

import { Button } from "../components/ui/button.js";
import { Card, CardContent } from "../components/ui/card.js";
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

  const queryClient = useQueryClient();
  const tenantValid = isUuid(tenantId);

  const treeQuery = useQuery({
    queryKey: ["dev", "files", "tree", tenantId],
    queryFn: () => fetchJson<TreeResponse>(`/dev/files/tree.json?tenantId=${tenantId}`),
    enabled: tenantValid,
  });

  const listUrl = useMemo(() => {
    const p = new URLSearchParams();
    p.set("tenantId", tenantId);
    if (activeFolderId) p.set("folderId", activeFolderId);
    if (search) p.set("search", search);
    p.set("sortBy", sortBy);
    p.set("sortDirection", sortDirection);
    return `/dev/files/list.json?${p.toString()}`;
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
    return `/dev/files/breadcrumb.json?${p.toString()}`;
  }, [tenantId, activeFolderId]);

  const breadcrumbQuery = useQuery({
    queryKey: ["dev", "files", "breadcrumb", breadcrumbUrl],
    queryFn: () => fetchJson<BreadcrumbResponse>(breadcrumbUrl),
    enabled: tenantValid,
  });

  const createFolder = useMutation({
    mutationFn: async () => {
      const res = await fetch("/folders", {
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
      const res = await fetch(`/files/${id}`, {
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
                  <FileGrid
                    files={listQuery.data.files}
                    onDelete={(id) => deleteFile.mutate(id)}
                    isDeleting={deleteFile.isPending}
                  />
                )}
              </section>
            </div>
          ) : null}
        </CardContent>
      </Card>
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
}: {
  files: FileEntryDto[];
  onDelete: (id: string) => void;
  isDeleting: boolean;
}): ReactNode {
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" role="list">
      {files.map((f) => (
        <li
          key={f.id}
          className="flex flex-col overflow-hidden rounded-md border border-line bg-surface-2"
          data-file-id={f.id}
        >
          <div className="flex aspect-square items-center justify-center bg-surface-3">
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
          </div>
          <div className="flex flex-1 flex-col gap-1 p-2">
            <strong className="truncate text-xs" title={f.filename}>
              {f.filename}
            </strong>
            <span className="text-[0.65rem] text-fg-muted">
              {formatBytes(f.sizeBytes)} · {f.mimeType}
            </span>
          </div>
          <div className="border-t border-line p-2">
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
      ))}
    </ul>
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
