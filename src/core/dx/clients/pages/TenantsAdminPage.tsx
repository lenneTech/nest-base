/**
 * `/admin/tenants` — Mandantenverwaltung (issue #87).
 *
 * Lists every tenant (BA Organization) with debounced search,
 * active/deleted filter toggle, a sheet side-panel for detail with
 * Tabs (Übersicht | Mitglieder | Einstellungen | Statistiken), and
 * dialogs for create, invite, confirm soft-delete, and confirm restore.
 *
 * All write actions go through the `/admin/tenants/:id/*` controller
 * endpoints which are gated by `@Can("manage", "TenantAdmin")`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../components/ui/sheet.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.js";
import { PageEmpty, PageError, PageLoading } from "../components/PageState.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";

// ── Types (mirrors tenant-admin.controller.ts) ────────────────────────

interface TenantListEntry {
  id: string;
  name: string;
  slug: string | null;
  logo: string | null;
  createdAt: string;
  memberCount: number;
  softDeleted: boolean;
}

interface MemberEntry {
  id: string;
  userId: string;
  role: string;
  createdAt: string;
  userEmail?: string | null;
}

interface InvitationEntry {
  id: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: string;
}

interface TenantSettingsEntry {
  logoUrl: string | null;
  primaryColor: string | null;
  storageLimitMb: number | null;
  contactEmail: string | null;
}

interface TenantStats {
  memberCount: number;
  userCount: number;
  fileSizeMb: number;
  softDeleted: boolean;
  createdAt: string;
}

interface TenantDetailResponse extends TenantListEntry {
  members: MemberEntry[];
  invitations: InvitationEntry[];
  settings: TenantSettingsEntry | null;
  stats: TenantStats;
}

interface TenantsListResponse {
  tenants: TenantListEntry[];
  total: number;
}

// ── Helpers ───────────────────────────────────────────────────────────

function buildListUrl(q: string, filter: string): string {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (filter !== "all") params.set("filter", filter);
  return `/admin/tenants/list.json?${params.toString()}`;
}

async function postAction(
  path: string,
  body?: Record<string, string | number>,
): Promise<unknown> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${path} → ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  return res.json().catch(() => null);
}

async function deleteAction(path: string): Promise<unknown> {
  const res = await fetch(path, { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${path} → ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  return res.json().catch(() => null);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function useDebounce(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(value), delayMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, delayMs]);

  return debounced;
}

// ── Confirm Dialog ────────────────────────────────────────────────────

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  dangerous?: boolean;
}

function ConfirmDialog({
  open,
  title,
  description,
  onConfirm,
  onCancel,
  confirmLabel = "Bestätigen",
  dangerous = false,
}: ConfirmDialogProps): ReactNode {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Abbrechen
          </Button>
          <Button variant={dangerous ? "destructive" : "default"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Create Tenant Dialog ──────────────────────────────────────────────

interface CreateTenantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

function CreateTenantDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateTenantDialogProps): ReactNode {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      return postAction("/admin/tenants", {
        name: name.trim(),
        ...(slug.trim() ? { slug: slug.trim() } : {}),
        ...(contactEmail.trim() ? { contactEmail: contactEmail.trim() } : {}),
      } as Record<string, string>);
    },
    onSuccess: () => {
      toast.success("Mandant erstellt");
      setName("");
      setSlug("");
      setContactEmail("");
      onOpenChange(false);
      onCreated();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Neuer Mandant</DialogTitle>
          <DialogDescription>Erstellt eine neue BA-Organisation.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor="create-name">Name *</Label>
            <Input
              id="create-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Corp"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="create-slug">Slug (optional)</Label>
            <Input
              id="create-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="acme-corp"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="create-email">Kontakt-E-Mail (optional)</Label>
            <Input
              id="create-email"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="admin@acme.com"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Erstelle…" : "Erstellen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Invite Member Dialog ──────────────────────────────────────────────

interface InviteMemberDialogProps {
  tenantId: string | null;
  onClose: () => void;
  onInvited: () => void;
}

function InviteMemberDialog({
  tenantId,
  onClose,
  onInvited,
}: InviteMemberDialogProps): ReactNode {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");

  const invite = useMutation({
    mutationFn: async () => {
      return postAction(`/admin/tenants/${encodeURIComponent(tenantId!)}/members/invite`, {
        email: email.trim(),
        role: role.trim(),
      } as Record<string, string>);
    },
    onSuccess: () => {
      toast.success("Einladung gesendet");
      setEmail("");
      setRole("member");
      onClose();
      onInvited();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={tenantId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mitglied einladen</DialogTitle>
          <DialogDescription>
            Sendet eine BA-Einladung an die angegebene E-Mail-Adresse.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor="invite-email">E-Mail *</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invite-role">Rolle</Label>
            <Input
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="member"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            disabled={!email.trim() || invite.isPending}
            onClick={() => invite.mutate()}
          >
            {invite.isPending ? "Sendet…" : "Einladen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Tenant detail sheet ───────────────────────────────────────────────

interface TenantDetailSheetProps {
  tenantId: string | null;
  onClose: () => void;
  onSoftDelete: (id: string) => void;
  onRestore: (id: string) => void;
  onInvite: (id: string) => void;
}

function TenantDetailSheet({
  tenantId,
  onClose,
  onSoftDelete,
  onRestore,
  onInvite,
}: TenantDetailSheetProps): ReactNode {
  const query = useQuery({
    queryKey: ["admin", "tenants", "detail", tenantId],
    queryFn: () =>
      fetchJson<TenantDetailResponse>(`/admin/tenants/${encodeURIComponent(tenantId!)}.json`),
    enabled: tenantId !== null,
  });

  const tenant = query.data;

  return (
    <Sheet open={tenantId !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[520px] sm:w-[600px] overflow-y-auto">
        {query.isPending && <PageLoading>Lade Mandantendetails…</PageLoading>}
        {query.isError && <PageError>Details konnten nicht geladen werden.</PageError>}
        {tenant && (
          <>
            <SheetHeader className="mb-4">
              <SheetTitle className="truncate">{tenant.name}</SheetTitle>
            </SheetHeader>
            <div className="mb-4 flex gap-2 flex-wrap">
              {!tenant.softDeleted ? (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => { onClose(); onSoftDelete(tenant.id); }}
                >
                  Archivieren
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { onClose(); onRestore(tenant.id); }}
                >
                  Wiederherstellen
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => { onClose(); onInvite(tenant.id); }}
              >
                Mitglied einladen
              </Button>
            </div>

            <Tabs defaultValue="overview">
              <TabsList className="mb-4">
                <TabsTrigger value="overview">Übersicht</TabsTrigger>
                <TabsTrigger value="members">
                  Mitglieder ({tenant.members.length})
                </TabsTrigger>
                <TabsTrigger value="settings">Einstellungen</TabsTrigger>
                <TabsTrigger value="stats">Statistiken</TabsTrigger>
              </TabsList>

              {/* Übersicht tab */}
              <TabsContent value="overview">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-fg-muted">ID</dt>
                  <dd className="font-mono text-xs break-all">{tenant.id}</dd>
                  <dt className="text-fg-muted">Name</dt>
                  <dd>{tenant.name}</dd>
                  <dt className="text-fg-muted">Slug</dt>
                  <dd className="font-mono text-xs">{tenant.slug ?? "—"}</dd>
                  <dt className="text-fg-muted">Status</dt>
                  <dd>
                    {tenant.softDeleted ? (
                      <Badge variant="destructive">Archiviert</Badge>
                    ) : (
                      <Badge variant="default">Aktiv</Badge>
                    )}
                  </dd>
                  <dt className="text-fg-muted">Mitglieder</dt>
                  <dd>{tenant.memberCount}</dd>
                  <dt className="text-fg-muted">Erstellt</dt>
                  <dd>{formatDate(tenant.createdAt)}</dd>
                </dl>

                {/* Invitations */}
                {tenant.invitations.length > 0 && (
                  <div className="mt-6">
                    <h4 className="text-sm font-medium mb-2">Ausstehende Einladungen</h4>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>E-Mail</TableHead>
                          <TableHead>Rolle</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Läuft ab</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tenant.invitations.map((inv) => (
                          <TableRow key={inv.id}>
                            <TableCell className="text-xs">{inv.email}</TableCell>
                            <TableCell className="text-xs">{inv.role ?? "—"}</TableCell>
                            <TableCell>
                              <Badge
                                variant={inv.status === "pending" ? "secondary" : "outline"}
                              >
                                {inv.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-fg-muted whitespace-nowrap">
                              {formatDate(inv.expiresAt)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>

              {/* Mitglieder tab */}
              <TabsContent value="members">
                {tenant.members.length === 0 ? (
                  <PageEmpty>Keine Mitglieder gefunden.</PageEmpty>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>E-Mail</TableHead>
                        <TableHead>Rolle</TableHead>
                        <TableHead>Seit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tenant.members.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell className="font-mono text-xs">
                            {m.userEmail ?? m.userId}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={m.role === "owner" ? "default" : "secondary"}
                            >
                              {m.role}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-fg-muted whitespace-nowrap">
                            {formatDate(m.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>

              {/* Einstellungen tab */}
              <TabsContent value="settings">
                {!tenant.settings ? (
                  <PageEmpty>Keine Einstellungen hinterlegt.</PageEmpty>
                ) : (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                    <dt className="text-fg-muted">Logo-URL</dt>
                    <dd className="break-all text-xs">{tenant.settings.logoUrl ?? "—"}</dd>
                    <dt className="text-fg-muted">Primärfarbe</dt>
                    <dd>
                      {tenant.settings.primaryColor ? (
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-block h-4 w-4 rounded border border-line"
                            style={{ background: tenant.settings.primaryColor }}
                          />
                          {tenant.settings.primaryColor}
                        </span>
                      ) : (
                        "—"
                      )}
                    </dd>
                    <dt className="text-fg-muted">Speicherlimit (MB)</dt>
                    <dd>{tenant.settings.storageLimitMb ?? "—"}</dd>
                    <dt className="text-fg-muted">Kontakt-E-Mail</dt>
                    <dd className="break-all">{tenant.settings.contactEmail ?? "—"}</dd>
                  </dl>
                )}
              </TabsContent>

              {/* Statistiken tab */}
              <TabsContent value="stats">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-fg-muted">Mitglieder</dt>
                  <dd>{tenant.stats.memberCount}</dd>
                  <dt className="text-fg-muted">Benutzer</dt>
                  <dd>{tenant.stats.userCount}</dd>
                  <dt className="text-fg-muted">Speicherverbrauch</dt>
                  <dd>{tenant.stats.fileSizeMb.toFixed(2)} MB</dd>
                  <dt className="text-fg-muted">Archiviert</dt>
                  <dd>
                    {tenant.stats.softDeleted ? (
                      <Badge variant="destructive">Ja</Badge>
                    ) : (
                      <Badge variant="outline">Nein</Badge>
                    )}
                  </dd>
                  <dt className="text-fg-muted">Erstellt</dt>
                  <dd>{formatDate(tenant.stats.createdAt)}</dd>
                </dl>
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Main page ─────────────────────────────────────────────────────────

type PendingConfirm =
  | { kind: "soft-delete"; tenantId: string; tenantName: string }
  | { kind: "restore"; tenantId: string; tenantName: string };

export function TenantsAdminPage(): ReactNode {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [filter, setFilter] = useState<"all" | "active" | "deleted">("all");
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [inviteTenantId, setInviteTenantId] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["admin", "tenants", "list", debouncedSearch, filter],
    queryFn: () => fetchJson<TenantsListResponse>(buildListUrl(debouncedSearch, filter)),
  });

  const mutate = useMutation({
    mutationFn: async (action: PendingConfirm) => {
      const base = `/admin/tenants/${encodeURIComponent(action.tenantId)}`;
      if (action.kind === "soft-delete") {
        await deleteAction(`${base}/soft-delete`);
      } else {
        await postAction(`${base}/restore`);
      }
    },
    onSuccess: (_d, action) => {
      const label = action.kind === "soft-delete" ? "Mandant archiviert" : "Mandant wiederhergestellt";
      toast.success(label);
      qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleConfirm = useCallback(() => {
    if (!pendingConfirm) return;
    mutate.mutate(pendingConfirm);
    setPendingConfirm(null);
  }, [mutate, pendingConfirm]);

  const tenants = listQuery.data?.tenants ?? [];

  return (
    <AdminShell
      title="Mandantenverwaltung"
      subtitle="Mandanten anlegen, archivieren und Mitglieder verwalten."
      currentNav="tenants"
    >
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          <Input
            className="max-w-sm"
            placeholder="Nach Name oder Slug suchen…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Suche"
          />
          {/* Filter buttons */}
          <div className="flex gap-1">
            {(["all", "active", "deleted"] as const).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "default" : "outline"}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "Alle" : f === "active" ? "Aktiv" : "Archiviert"}
              </Button>
            ))}
          </div>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            + Neu
          </Button>
          {listQuery.isFetching && <span className="text-xs text-fg-muted">Lädt…</span>}
        </div>

        {/* Table */}
        {listQuery.isPending ? (
          <PageLoading>Lade Mandanten…</PageLoading>
        ) : listQuery.isError ? (
          <PageError>Mandanten konnten nicht geladen werden.</PageError>
        ) : tenants.length === 0 ? (
          <PageEmpty>Keine Mandanten gefunden.</PageEmpty>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Mandanten ({listQuery.data?.total ?? tenants.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Mitglieder</TableHead>
                    <TableHead>Erstellt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenants.map((t) => (
                    <TableRow
                      key={t.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedTenantId(t.id)}
                    >
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="font-mono text-xs text-fg-muted">
                        {t.slug ?? "—"}
                      </TableCell>
                      <TableCell>
                        {t.softDeleted ? (
                          <Badge variant="destructive">Archiviert</Badge>
                        ) : (
                          <Badge variant="default">Aktiv</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-fg-muted">{t.memberCount}</TableCell>
                      <TableCell className="text-xs text-fg-muted whitespace-nowrap">
                        {formatDate(t.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Tenant detail sheet */}
      <TenantDetailSheet
        tenantId={selectedTenantId}
        onClose={() => setSelectedTenantId(null)}
        onSoftDelete={(id) => {
          const t = tenants.find((x) => x.id === id);
          setPendingConfirm({ kind: "soft-delete", tenantId: id, tenantName: t?.name ?? id });
        }}
        onRestore={(id) => {
          const t = tenants.find((x) => x.id === id);
          setPendingConfirm({ kind: "restore", tenantId: id, tenantName: t?.name ?? id });
        }}
        onInvite={(id) => setInviteTenantId(id)}
      />

      {/* Create dialog */}
      <CreateTenantDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={() => qc.invalidateQueries({ queryKey: ["admin", "tenants"] })}
      />

      {/* Invite dialog */}
      <InviteMemberDialog
        tenantId={inviteTenantId}
        onClose={() => setInviteTenantId(null)}
        onInvited={() => qc.invalidateQueries({ queryKey: ["admin", "tenants"] })}
      />

      {/* Confirm dialog */}
      {pendingConfirm && (
        <ConfirmDialog
          open
          dangerous={pendingConfirm.kind === "soft-delete"}
          title={
            pendingConfirm.kind === "soft-delete"
              ? "Mandant archivieren?"
              : "Mandant wiederherstellen?"
          }
          description={
            pendingConfirm.kind === "soft-delete"
              ? `„${pendingConfirm.tenantName}" wird als archiviert markiert.`
              : `„${pendingConfirm.tenantName}" wird wiederhergestellt.`
          }
          confirmLabel={pendingConfirm.kind === "soft-delete" ? "Archivieren" : "Wiederherstellen"}
          onConfirm={handleConfirm}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </AdminShell>
  );
}
