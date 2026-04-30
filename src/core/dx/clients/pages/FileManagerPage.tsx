/**
 * `/dev/files` — Dev-Portal File-Manager.
 *
 * Two-column layout:
 *   - left rail: collapsible folder tree (built from /dev/files/tree.json)
 *   - right pane: breadcrumb + sort/filter toolbar + file grid
 *
 * The page exposes the storage layer that issue #16 (Files persistence)
 * and issue #17 (IPX thumbnails) made possible: browse what's in
 * Postgres, see image previews via `/_ipx/preset_thumbnail/...`, sort
 * + filter without an extra round-trip below 500 entries.
 *
 * The tenant id is read from the `x-tenant-id` cookie when present
 * (debug surface only — operators can paste a value into the input
 * field). Production will gate the page behind an admin check; for
 * the dev surface the controller already 404s outside development.
 *
 * Out of scope for this slice (tracked by follow-up issues):
 *   - upload via TUS (foundation already wired in #16; UI follow-up)
 *   - drag-and-drop move, rename, multi-select bulk actions
 *   - lightbox / Monaco / PDF preview drawer
 *   - share-link creator + visibility toggle
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";

import { Button } from "../components/Button.js";
import { Select, SelectItem } from "../components/Select.js";
import { TextField } from "../components/TextField.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson, formatBytes } from "../lib/api.js";

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
      <div className="admin-card" data-file-manager>
        <div className="fm-tenant-bar">
          <TextField
            label="Tenant-UUID"
            value={tenantId}
            onChange={setTenantId}
            placeholder="00000000-0000-0000-0000-000000000000"
          />
          {!tenantValid ? (
            <span className="admin-meta">UUID muss 8-4-4-4-12 Zeichen lang sein.</span>
          ) : null}
        </div>
        {tenantValid ? (
          <div className="fm-layout">
            <aside className="fm-tree" data-fm-region="tree">
              <header className="fm-tree__header">
                <strong>Ordner</strong>
                <button
                  type="button"
                  className="fm-tree__rootlink"
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
                <div className="admin-empty">Ordnerbaum konnte nicht geladen werden.</div>
              ) : (
                <div className="admin-empty">Lade…</div>
              )}
              <form
                className="fm-tree__create"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newFolderName.trim().length > 0 && !createFolder.isPending) {
                    createFolder.mutate();
                  }
                }}
              >
                <TextField
                  label="Neuer Ordner"
                  value={newFolderName}
                  onChange={setNewFolderName}
                  placeholder="Neuer Ordner"
                />
                <Button
                  variant="ghost"
                  type="submit"
                  isDisabled={createFolder.isPending || newFolderName.trim().length === 0}
                  data-action="create-folder"
                >
                  {createFolder.isPending ? "Anlegen…" : "Anlegen"}
                </Button>
                {createFolder.isError ? (
                  <span className="admin-meta">{(createFolder.error as Error).message}</span>
                ) : null}
              </form>
            </aside>
            <section className="fm-grid" data-fm-region="grid">
              <div className="fm-breadcrumb" aria-label="Pfad">
                {breadcrumbQuery.data ? (
                  <BreadcrumbBar
                    segments={breadcrumbQuery.data.segments}
                    onSelect={setActiveFolderId}
                  />
                ) : null}
              </div>
              <div className="fm-toolbar">
                <TextField
                  label="Suche"
                  value={search}
                  onChange={setSearch}
                  placeholder="Dateiname enthält…"
                />
                <Select
                  label="Sortieren nach"
                  selectedKey={sortBy}
                  onSelectionChange={(key) => setSortBy(key as SortKey)}
                >
                  {SORT_KEYS.map((k) => (
                    <SelectItem key={k.id} id={k.id}>
                      {k.label}
                    </SelectItem>
                  ))}
                </Select>
                <Button
                  variant="ghost"
                  onPress={() => setSortDirection((d) => (d === "asc" ? "desc" : "asc"))}
                  data-action="toggle-direction"
                >
                  {sortDirection === "asc" ? "↑ aufsteigend" : "↓ absteigend"}
                </Button>
              </div>
              {listQuery.isError ? (
                <div className="admin-empty">Datei-Liste konnte nicht geladen werden.</div>
              ) : !listQuery.data ? (
                <div className="admin-empty">Lade…</div>
              ) : listQuery.data.files.length === 0 ? (
                <div className="admin-empty">Keine Dateien in diesem Ordner.</div>
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
      </div>
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
    return <div className="admin-empty">Keine Ordner.</div>;
  }
  return (
    <ul className="fm-tree__list" role="tree">
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
        className="fm-tree__node"
        data-active={isActive}
        style={{ paddingLeft: `${node.depth * 12}px` }}
        onClick={() => onSelect(node.id)}
      >
        {node.name}
      </button>
      {node.children.length > 0 ? (
        <ul className="fm-tree__list">
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
    <ol className="fm-breadcrumb__list">
      {segments.map((seg, idx) => (
        <li key={`${seg.id ?? "root"}-${idx}`} className="fm-breadcrumb__seg">
          {idx > 0 ? <span className="fm-breadcrumb__sep">/</span> : null}
          <button
            type="button"
            className="fm-breadcrumb__link"
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
    <ul className="fm-cards" role="list">
      {files.map((f) => (
        <li key={f.id} className="fm-card" data-file-id={f.id}>
          <div className="fm-card__thumb">
            {f.thumbnailUrl ? (
              <img src={f.thumbnailUrl} alt="" loading="lazy" />
            ) : (
              <span className="fm-card__icon" aria-hidden="true">
                {iconForMime(f.mimeType)}
              </span>
            )}
          </div>
          <div className="fm-card__meta">
            <strong className="fm-card__name" title={f.filename}>
              {f.filename}
            </strong>
            <span className="admin-meta">
              {formatBytes(f.sizeBytes)} · {f.mimeType}
            </span>
          </div>
          <div className="fm-card__actions">
            <Button
              variant="ghost"
              isDisabled={isDeleting}
              onPress={() => {
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

/**
 * Read a default tenant id from the `x-tenant-id` cookie if present.
 * The dev-surface lets operators paste a UUID directly when no cookie
 * is set; production gating is the controller-side `assertDev()`.
 */
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
