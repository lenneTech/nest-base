/**
 * `/hub/admin/tenants` — Tenant management (issue #87).
 *
 * Lists every tenant (BA Organization) with debounced search,
 * active/deleted filter toggle, a sheet side-panel for detail with
 * Tabs (Overview | Members | Settings | Statistics), and
 * dialogs for create, invite, confirm soft-delete, and confirm restore.
 *
 * All write actions go through the `/hub/admin/tenants/:id/*` controller
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
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
import { SortableTableHead } from "../components/SortableTableHead.js";
import { AdminShell } from "../layout/AdminShell.js";
import { adminFetch, fetchJson, needsAdminAuthHint } from "../lib/api.js";
import { activateHubOrganization } from "../lib/hub-session-bootstrap.js";
import { useTableSort } from "../lib/use-table-sort.js";

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

interface RoleRecord {
  id: string;
  name: string;
}

// ── Helpers ───────────────────────────────────────────────────────────

function buildListUrl(q: string, filter: string): string {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (filter !== "all") params.set("filter", filter);
  return `/hub/admin/tenants/list.json?${params.toString()}`;
}

async function postAction(path: string, body?: Record<string, string | number>): Promise<unknown> {
  const res = await adminFetch(path, {
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
  const res = await adminFetch(path, { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${path} → ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  return res.json().catch(() => null);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
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

function useTenantRoleNames(tenantId: string | null): {
  roleNames: string[];
  isPending: boolean;
  isError: boolean;
} {
  const query = useQuery({
    queryKey: ["admin", "roles", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      await activateHubOrganization(tenantId);
      return fetchJson<RoleRecord[]>("/hub/admin/roles");
    },
    enabled: tenantId !== null && tenantId.length > 0,
  });
  const roleNames = (query.data ?? []).map((r) => r.name).sort((a, b) => a.localeCompare(b));
  return { roleNames, isPending: query.isPending, isError: query.isError };
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
  confirmLabel = "Confirm",
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
            Cancel
          </Button>
          <Button variant={dangerous ? "danger" : "default"} onClick={onConfirm}>
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

function CreateTenantDialog({ open, onOpenChange, onCreated }: CreateTenantDialogProps): ReactNode {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      return postAction("/hub/admin/tenants", {
        name: name.trim(),
        ...(slug.trim() ? { slug: slug.trim() } : {}),
        ...(contactEmail.trim() ? { contactEmail: contactEmail.trim() } : {}),
      } as Record<string, string>);
    },
    onSuccess: () => {
      toast.success("Tenant created");
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
          <DialogTitle>New tenant</DialogTitle>
          <DialogDescription>Creates a new Better Auth organization.</DialogDescription>
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
            <Label htmlFor="create-email">Contact email (optional)</Label>
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
            Cancel
          </Button>
          <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "Creating…" : "Create"}
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

function InviteMemberDialog({ tenantId, onClose, onInvited }: InviteMemberDialogProps): ReactNode {
  const [email, setEmail] = useState("");
  const { roleNames, isPending: rolesPending } = useTenantRoleNames(tenantId);
  const defaultRole = roleNames.includes("User") ? "User" : (roleNames[0] ?? "member");
  const [role, setRole] = useState(defaultRole);

  useEffect(() => {
    if (tenantId !== null) setRole(defaultRole);
  }, [tenantId, defaultRole]);

  const invite = useMutation({
    mutationFn: async () => {
      return postAction(`/hub/admin/tenants/${encodeURIComponent(tenantId!)}/members/invite`, {
        email: email.trim(),
        role: role.trim(),
      } as Record<string, string>);
    },
    onSuccess: () => {
      toast.success("Invitation sent");
      setEmail("");
      setRole(defaultRole);
      onClose();
      onInvited();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={tenantId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite member</DialogTitle>
          <DialogDescription>
            Sends a Better Auth invitation to the given email address.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor="invite-email">Email *</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invite-role">Role</Label>
            {rolesPending ? (
              <Input id="invite-role" disabled placeholder="Loading roles…" />
            ) : roleNames.length > 0 ? (
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="invite-role" className="w-full">
                  <SelectValue placeholder="Choose role…" />
                </SelectTrigger>
                <SelectContent>
                  {roleNames.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="invite-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="member"
              />
            )}
            <p className="text-xs text-fg-muted">
              Must match a role name from Roles (e.g. User, Admin).
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!email.trim() || invite.isPending} onClick={() => invite.mutate()}>
            {invite.isPending ? "Sending…" : "Invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Member role editor ────────────────────────────────────────────────

interface MemberRoleEditorProps {
  tenantId: string;
  memberId: string;
  role: string;
  onUpdated: () => void;
}

function MemberRoleEditor({
  tenantId,
  memberId,
  role,
  onUpdated,
}: MemberRoleEditorProps): ReactNode {
  const { roleNames, isPending: rolesPending, isError: rolesError } = useTenantRoleNames(tenantId);
  const options = [...new Set([...roleNames, role])].sort((a, b) => a.localeCompare(b));

  const update = useMutation({
    mutationFn: async (nextRole: string) => {
      const path = `/hub/admin/tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(memberId)}/role`;
      const res = await adminFetch(path, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${path} → ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
      }
      return res.json().catch(() => null);
    },
    onSuccess: (_data, nextRole) => {
      toast.success(`Role updated to "${nextRole}".`);
      onUpdated();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (rolesPending) {
    return <span className="text-xs text-fg-muted">Loading roles…</span>;
  }

  if (rolesError || options.length === 0) {
    return <Badge variant="secondary">{role}</Badge>;
  }

  return (
    <Select
      value={role}
      disabled={update.isPending}
      onValueChange={(next) => {
        if (next !== role) update.mutate(next);
      }}
    >
      <SelectTrigger
        className="h-8 w-[11rem] text-xs"
        data-action="change-member-role"
        aria-label={`Change role (currently ${role})`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((name) => (
          <SelectItem key={name} value={name}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["admin", "tenants", "detail", tenantId],
    queryFn: () =>
      fetchJson<TenantDetailResponse>(`/hub/admin/tenants/${encodeURIComponent(tenantId!)}.json`),
    enabled: tenantId !== null,
  });

  const tenant = query.data;

  return (
    <Sheet open={tenantId !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[520px] sm:w-[600px] overflow-y-auto">
        {query.isPending && <PageLoading>Loading tenant details…</PageLoading>}
        {query.isError && (
          <PageError showAuthHint={needsAdminAuthHint(query.error)}>
            Could not load details.
          </PageError>
        )}
        {tenant && (
          <>
            <SheetHeader className="mb-4">
              <SheetTitle className="truncate">{tenant.name}</SheetTitle>
            </SheetHeader>
            <div className="mb-4 flex gap-2 flex-wrap">
              {!tenant.softDeleted ? (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    onClose();
                    onSoftDelete(tenant.id);
                  }}
                >
                  Archive
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onClose();
                    onRestore(tenant.id);
                  }}
                >
                  Restore
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  onClose();
                  onInvite(tenant.id);
                }}
              >
                Invite member
              </Button>
            </div>

            <Tabs defaultValue="overview">
              <TabsList className="mb-4">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="members">Members ({tenant.members.length})</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
                <TabsTrigger value="stats">Statistics</TabsTrigger>
              </TabsList>

              {/* Overview tab */}
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
                      <Badge variant="destructive">Archived</Badge>
                    ) : (
                      <Badge variant="default">Active</Badge>
                    )}
                  </dd>
                  <dt className="text-fg-muted">Members</dt>
                  <dd>{tenant.memberCount}</dd>
                  <dt className="text-fg-muted">Created</dt>
                  <dd>{formatDate(tenant.createdAt)}</dd>
                </dl>

                {/* Invitations */}
                {tenant.invitations.length > 0 && (
                  <div className="mt-6">
                    <h4 className="text-sm font-medium mb-2">Pending invitations</h4>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Email</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Expires</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tenant.invitations.map((inv) => (
                          <TableRow key={inv.id}>
                            <TableCell className="text-xs">{inv.email}</TableCell>
                            <TableCell className="text-xs">{inv.role ?? "—"}</TableCell>
                            <TableCell>
                              <Badge variant={inv.status === "pending" ? "secondary" : "outline"}>
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

              {/* Members tab */}
              <TabsContent value="members">
                {tenant.members.length === 0 ? (
                  <PageEmpty>No members found.</PageEmpty>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Since</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tenant.members.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell className="font-mono text-xs">
                            {m.userEmail ?? m.userId}
                          </TableCell>
                          <TableCell>
                            <MemberRoleEditor
                              tenantId={tenant.id}
                              memberId={m.id}
                              role={m.role}
                              onUpdated={() => {
                                void qc.invalidateQueries({
                                  queryKey: ["admin", "tenants", "detail", tenant.id],
                                });
                              }}
                            />
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

              {/* Settings tab */}
              <TabsContent value="settings">
                {!tenant.settings ? (
                  <PageEmpty>No settings configured.</PageEmpty>
                ) : (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                    <dt className="text-fg-muted">Logo-URL</dt>
                    <dd className="break-all text-xs">{tenant.settings.logoUrl ?? "—"}</dd>
                    <dt className="text-fg-muted">Primary color</dt>
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
                    <dt className="text-fg-muted">Storage limit (MB)</dt>
                    <dd>{tenant.settings.storageLimitMb ?? "—"}</dd>
                    <dt className="text-fg-muted">Contact email</dt>
                    <dd className="break-all">{tenant.settings.contactEmail ?? "—"}</dd>
                  </dl>
                )}
              </TabsContent>

              {/* Statistics tab */}
              <TabsContent value="stats">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-fg-muted">Members</dt>
                  <dd>{tenant.stats.memberCount}</dd>
                  <dt className="text-fg-muted">Users</dt>
                  <dd>{tenant.stats.userCount}</dd>
                  <dt className="text-fg-muted">Storage used</dt>
                  <dd>{tenant.stats.fileSizeMb.toFixed(2)} MB</dd>
                  <dt className="text-fg-muted">Archived</dt>
                  <dd>
                    {tenant.stats.softDeleted ? (
                      <Badge variant="destructive">Yes</Badge>
                    ) : (
                      <Badge variant="outline">No</Badge>
                    )}
                  </dd>
                  <dt className="text-fg-muted">Created</dt>
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
      const base = `/hub/admin/tenants/${encodeURIComponent(action.tenantId)}`;
      if (action.kind === "soft-delete") {
        await deleteAction(`${base}/soft-delete`);
      } else {
        await postAction(`${base}/restore`);
      }
    },
    onSuccess: (_d, action) => {
      const label = action.kind === "soft-delete" ? "Tenant archived" : "Tenant restored";
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
  const { sortedRows: sortedTenants, sortKey, sortDirection, toggleSort } = useTableSort(tenants);

  return (
    <AdminShell
      title="Tenant management"
      subtitle="Create tenants, archive them, and manage members."
      currentNav="tenants"
    >
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          <Input
            className="max-w-sm"
            placeholder="Search by name or slug…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search"
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
                {f === "all" ? "All" : f === "active" ? "Active" : "Archived"}
              </Button>
            ))}
          </div>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            + New
          </Button>
          {listQuery.isFetching && <span className="text-xs text-fg-muted">Loading…</span>}
        </div>

        {/* Table */}
        {listQuery.isPending ? (
          <PageLoading>Loading tenants…</PageLoading>
        ) : listQuery.isError ? (
          <PageError showAuthHint={needsAdminAuthHint(query.error)}>
            Could not load tenants.
          </PageError>
        ) : tenants.length === 0 ? (
          <PageEmpty>No tenants found.</PageEmpty>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Tenants ({listQuery.data?.total ?? tenants.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead
                      label="Name"
                      sortKey="name"
                      activeSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={toggleSort}
                    />
                    <SortableTableHead
                      label="Slug"
                      sortKey="slug"
                      activeSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={toggleSort}
                    />
                    <SortableTableHead
                      label="Status"
                      sortKey="softDeleted"
                      activeSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={toggleSort}
                    />
                    <SortableTableHead
                      label="Members"
                      sortKey="memberCount"
                      activeSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={toggleSort}
                    />
                    <SortableTableHead
                      label="Created"
                      sortKey="createdAt"
                      activeSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={toggleSort}
                    />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedTenants.map((t) => (
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
                          <Badge variant="destructive">Archived</Badge>
                        ) : (
                          <Badge variant="default">Active</Badge>
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
          title={pendingConfirm.kind === "soft-delete" ? "Archive tenant?" : "Restore tenant?"}
          description={
            pendingConfirm.kind === "soft-delete"
              ? `„${pendingConfirm.tenantName}" will be marked as archived.`
              : `„${pendingConfirm.tenantName}" will be restored.`
          }
          confirmLabel={pendingConfirm.kind === "soft-delete" ? "Archive" : "Restore"}
          onConfirm={handleConfirm}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </AdminShell>
  );
}
