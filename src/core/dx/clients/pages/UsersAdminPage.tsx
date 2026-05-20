/**
 * `/admin/users` — User management (issue #86).
 *
 * Lists every user known to the Prisma-backed user store with
 * debounced search, a sheet side-panel for detail + session/account
 * tabs, and action buttons for ban / unban / revoke-sessions.
 *
 * All write actions go through the `/admin/users/:id/*` controller
 * endpoints (`@Can(manage, User)`) and proxy to the
 * Better-Auth admin API.
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet.js";
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
import { useTableSort } from "../lib/use-table-sort.js";

// ── Types (mirrors user-admin.controller.ts) ──────────────────────

interface UserListEntry {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  banned: boolean;
  createdAt: string;
  updatedAt: string;
  sessionCount: number;
  roles: string[];
}

interface SessionEntry {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface AccountEntry {
  id: string;
  providerId: string;
  accountId: string;
  createdAt: string;
}

interface UserMembershipEntry {
  id: string;
  organizationId: string;
  organizationName: string;
  role: string;
  createdAt: string;
}

interface RoleRecord {
  id: string;
  name: string;
}

interface AssignableRolesResponse {
  organizationId: string;
  organizationName: string;
  roles: RoleRecord[];
}

interface UserDetailResponse extends UserListEntry {
  memberships: UserMembershipEntry[];
  sessions: SessionEntry[];
  accounts: AccountEntry[];
}

interface UsersListResponse {
  users: UserListEntry[];
  total: number;
}

// ── Helpers ───────────────────────────────────────────────────────

function buildListUrl(q: string): string {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  return `/admin/users/list.json?${params.toString()}`;
}

async function postAction(path: string, body?: Record<string, string | boolean>): Promise<void> {
  const res = await adminFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${path} → ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
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

// ── Confirm Dialog ────────────────────────────────────────────────

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
          <Button variant={dangerous ? "destructive" : "default"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Organization role (CASL) ─────────────────────────────────────

function useAssignableRoles() {
  return useQuery({
    queryKey: ["admin", "users", "assignable-roles"],
    queryFn: () => fetchJson<AssignableRolesResponse>("/admin/users/roles.json"),
  });
}

function UserRolesBadges({ roles }: { roles: readonly string[] }): ReactNode {
  if (roles.length === 0) {
    return <span className="text-xs text-fg-muted">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((role) => (
        <Badge key={role} variant="secondary" className="text-xs">
          {role}
        </Badge>
      ))}
    </div>
  );
}

function UserMembershipRoleEditor({
  userId,
  membership,
  roleNames,
  onUpdated,
}: {
  userId: string;
  membership: UserMembershipEntry;
  roleNames: readonly string[];
  onUpdated: () => void;
}): ReactNode {
  const options = [...new Set([...roleNames, membership.role])].sort((a, b) => a.localeCompare(b));

  const update = useMutation({
    mutationFn: async (nextRole: string) => {
      const path = `/admin/users/${encodeURIComponent(userId)}/members/${encodeURIComponent(membership.id)}/role`;
      const res = await adminFetch(path, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${path} → ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
      }
      await res.json().catch(() => null);
    },
    onSuccess: (_data, nextRole) => {
      toast.success(`Role updated to "${nextRole}".`);
      onUpdated();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (options.length === 0) {
    return <Badge variant="secondary">{membership.role}</Badge>;
  }

  return (
    <Select
      value={membership.role}
      disabled={update.isPending}
      onValueChange={(next) => {
        if (next !== membership.role) update.mutate(next);
      }}
    >
      <SelectTrigger
        className="h-8 w-[11rem] text-xs"
        data-action="change-user-member-role"
        aria-label={`Change role (currently ${membership.role})`}
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

function UserRoleAssignEditor({
  userId,
  roleNames,
  organizationName,
  onUpdated,
}: {
  userId: string;
  roleNames: readonly string[];
  organizationName: string;
  onUpdated: () => void;
}): ReactNode {
  const defaultRole = roleNames.includes("User") ? "User" : (roleNames[0] ?? "");
  const [role, setRole] = useState(defaultRole);

  useEffect(() => {
    setRole(defaultRole);
  }, [defaultRole, userId]);

  const assign = useMutation({
    mutationFn: async (nextRole: string) => {
      const path = `/admin/users/${encodeURIComponent(userId)}/role`;
      const res = await adminFetch(path, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${path} → ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
      }
      await res.json().catch(() => null);
    },
    onSuccess: (_data, nextRole) => {
      toast.success(`Role "${nextRole}" assigned.`);
      onUpdated();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (roleNames.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        No roles defined for {organizationName}. Create roles under Roles first.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <Select value={role} disabled={assign.isPending} onValueChange={setRole}>
        <SelectTrigger
          className="h-8 w-[11rem] text-xs"
          data-action="assign-user-role"
          aria-label="Choose role to assign"
        >
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
      <Button
        size="sm"
        disabled={assign.isPending || !role.trim()}
        onClick={() => assign.mutate(role)}
      >
        {assign.isPending ? "Assigning…" : "Assign role"}
      </Button>
    </div>
  );
}

function UserMembershipRolesSection({
  userId,
  memberships,
  assignableRoles,
  onUpdated,
}: {
  userId: string;
  memberships: UserMembershipEntry[];
  assignableRoles: AssignableRolesResponse | undefined;
  onUpdated: () => void;
}): ReactNode {
  const roleNames = (assignableRoles?.roles ?? [])
    .map((r) => r.name)
    .sort((a, b) => a.localeCompare(b));

  if (memberships.length === 0) {
    return (
      <section className="mt-4 border-t border-line pt-4">
        <h3 className="text-sm font-semibold">Organization role</h3>
        <p className="mt-2 text-sm text-fg-muted">
          No organization membership yet. Assign a CASL role for{" "}
          {assignableRoles?.organizationName ?? "the default organization"}.
        </p>
        <div className="mt-3">
          <UserRoleAssignEditor
            userId={userId}
            roleNames={roleNames}
            organizationName={assignableRoles?.organizationName ?? "this organization"}
            onUpdated={onUpdated}
          />
        </div>
      </section>
    );
  }

  return (
    <section className="mt-4 border-t border-line pt-4">
      <h3 className="text-sm font-semibold">Organization role</h3>
      <div className="mt-3 flex flex-col gap-3">
        {memberships.map((m) => (
          <div key={m.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            {memberships.length > 1 ? (
              <span
                className="min-w-0 truncate text-sm text-fg-muted sm:w-40"
                title={m.organizationName}
              >
                {m.organizationName}
              </span>
            ) : null}
            <UserMembershipRoleEditor
              userId={userId}
              membership={m}
              roleNames={roleNames}
              onUpdated={onUpdated}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

// ── User detail sheet ─────────────────────────────────────────────

interface UserDetailSheetProps {
  userId: string | null;
  onClose: () => void;
  onBan: (id: string) => void;
  onUnban: (id: string) => void;
  onRevokeSessions: (id: string) => void;
  onUserUpdated: () => void;
  pendingAction: string | null;
}

function UserEditSection({
  user,
  onSaved,
}: {
  user: UserDetailResponse;
  onSaved: () => void;
}): ReactNode {
  const [name, setName] = useState(user.name ?? "");
  const [email, setEmail] = useState(user.email);

  const save = useMutation({
    mutationFn: async () => {
      await postAction(`/admin/users/${encodeURIComponent(user.id)}/update`, {
        name: name.trim(),
        email: email.trim(),
      });
    },
    onSuccess: () => {
      toast.success("User saved.");
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 className="text-sm font-semibold">Edit</h3>
      <div className="flex flex-col gap-1">
        <Label htmlFor="edit-user-name">Name</Label>
        <Input
          id="edit-user-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="edit-user-email">Email</Label>
        <Input
          id="edit-user-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </div>
      <Button
        size="sm"
        disabled={save.isPending || !name.trim() || !email.trim()}
        onClick={() => save.mutate()}
      >
        {save.isPending ? "Saving…" : "Save"}
      </Button>
    </section>
  );
}

function UserDetailSheet({
  userId,
  onClose,
  onBan,
  onUnban,
  onRevokeSessions,
  onUserUpdated,
  pendingAction,
}: UserDetailSheetProps): ReactNode {
  const setEmailVerified = useMutation({
    mutationFn: async ({ id, verified }: { id: string; verified: boolean }) => {
      await postAction(`/admin/users/${encodeURIComponent(id)}/set-email-verified`, {
        verified,
      });
    },
    onSuccess: (_data, { verified }) => {
      toast.success(verified ? "Email marked as verified." : "Email marked as unverified.");
      onUserUpdated();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const query = useQuery({
    queryKey: ["admin", "users", "detail", userId],
    queryFn: () =>
      fetchJson<UserDetailResponse>(`/admin/users/${encodeURIComponent(userId!)}.json`),
    enabled: userId !== null,
  });
  const assignableRolesQuery = useAssignableRoles();

  const user = query.data;
  const {
    sortedRows: sortedSessions,
    sortKey,
    sortDirection,
    toggleSort,
  } = useTableSort(user?.sessions ?? []);
  const {
    sortedRows: sortedAccounts,
    sortKey: accountSortKey,
    sortDirection: accountSortDirection,
    toggleSort: toggleAccountSort,
  } = useTableSort(user?.accounts ?? []);

  return (
    <Sheet open={userId !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[480px] sm:w-[560px] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="truncate">{user?.email ?? "User details"}</SheetTitle>
          {user ? (
            <SheetDescription className="font-mono text-xs">{user.id}</SheetDescription>
          ) : null}
        </SheetHeader>
        {query.isPending && <PageLoading>Loading user details…</PageLoading>}
        {query.isError && (
          <PageError showAuthHint={needsAdminAuthHint(query.error)}>
            Could not load details.
          </PageError>
        )}
        {user && (
          <>
            <div className="mb-4 flex gap-2 flex-wrap">
              {!user.banned ? (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={pendingAction !== null}
                  onClick={() => onBan(user.id)}
                >
                  Ban
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pendingAction !== null}
                  onClick={() => onUnban(user.id)}
                >
                  Unban
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={pendingAction !== null}
                onClick={() => onRevokeSessions(user.id)}
              >
                Revoke sessions
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pendingAction !== null || setEmailVerified.isPending}
                data-action="set-email-verified"
                onClick={() =>
                  setEmailVerified.mutate({
                    id: user.id,
                    verified: !user.emailVerified,
                  })
                }
              >
                {setEmailVerified.isPending
                  ? "Saving…"
                  : user.emailVerified
                    ? "Mark unverified"
                    : "Mark verified"}
              </Button>
            </div>
            <Tabs defaultValue="overview">
              <TabsList className="mb-4">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="sessions">Sessions ({user.sessions.length})</TabsTrigger>
                <TabsTrigger value="accounts">Accounts ({user.accounts.length})</TabsTrigger>
              </TabsList>

              {/* Overview tab */}
              <TabsContent value="overview">
                <UserEditSection user={user} onSaved={onUserUpdated} />
                <UserMembershipRolesSection
                  userId={user.id}
                  memberships={user.memberships}
                  assignableRoles={assignableRolesQuery.data}
                  onUpdated={onUserUpdated}
                />
                <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-fg-muted">ID</dt>
                  <dd className="font-mono text-xs break-all">{user.id}</dd>
                  <dt className="text-fg-muted">Name</dt>
                  <dd>{user.name ?? "—"}</dd>
                  <dt className="text-fg-muted">Email</dt>
                  <dd className="break-all">{user.email}</dd>
                  <dt className="text-fg-muted">Verified</dt>
                  <dd>
                    {user.emailVerified ? (
                      <Badge variant="default">Yes</Badge>
                    ) : (
                      <Badge variant="secondary">No</Badge>
                    )}
                  </dd>
                  <dt className="text-fg-muted">Banned</dt>
                  <dd>
                    {user.banned ? (
                      <Badge variant="destructive">Yes</Badge>
                    ) : (
                      <Badge variant="outline">No</Badge>
                    )}
                  </dd>
                  <dt className="text-fg-muted">Created</dt>
                  <dd>{formatDate(user.createdAt)}</dd>
                  <dt className="text-fg-muted">Updated</dt>
                  <dd>{formatDate(user.updatedAt)}</dd>
                </dl>
              </TabsContent>

              {/* Sessions tab */}
              <TabsContent value="sessions">
                {user.sessions.length === 0 ? (
                  <PageEmpty>No active sessions.</PageEmpty>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortableTableHead
                          label="Created"
                          sortKey="createdAt"
                          activeSortKey={sortKey}
                          sortDirection={sortDirection}
                          onSort={toggleSort}
                        />
                        <SortableTableHead
                          label="IP"
                          sortKey="ipAddress"
                          activeSortKey={sortKey}
                          sortDirection={sortDirection}
                          onSort={toggleSort}
                        />
                        <SortableTableHead
                          label="Browser"
                          sortKey="userAgent"
                          activeSortKey={sortKey}
                          sortDirection={sortDirection}
                          onSort={toggleSort}
                        />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedSessions.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="text-xs text-fg-muted whitespace-nowrap">
                            {formatDate(s.createdAt)}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{s.ipAddress ?? "—"}</TableCell>
                          <TableCell className="text-xs max-w-[180px] truncate">
                            {s.userAgent ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>

              {/* Accounts tab */}
              <TabsContent value="accounts">
                {user.accounts.length === 0 ? (
                  <PageEmpty>No linked OAuth accounts.</PageEmpty>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortableTableHead
                          label="Provider"
                          sortKey="providerId"
                          activeSortKey={accountSortKey}
                          sortDirection={accountSortDirection}
                          onSort={toggleAccountSort}
                        />
                        <SortableTableHead
                          label="Account ID"
                          sortKey="accountId"
                          activeSortKey={accountSortKey}
                          sortDirection={accountSortDirection}
                          onSort={toggleAccountSort}
                        />
                        <SortableTableHead
                          label="Created"
                          sortKey="createdAt"
                          activeSortKey={accountSortKey}
                          sortDirection={accountSortDirection}
                          onSort={toggleAccountSort}
                        />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedAccounts.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="text-xs font-medium">{a.providerId}</TableCell>
                          <TableCell className="font-mono text-xs">{a.accountId}</TableCell>
                          <TableCell className="text-xs text-fg-muted whitespace-nowrap">
                            {formatDate(a.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Row actions ───────────────────────────────────────────────────

interface RowActionsProps {
  user: UserListEntry;
  onBan: () => void;
  onUnban: () => void;
  onRevokeSessions: () => void;
  disabled: boolean;
}

function RowActions({
  user,
  onBan,
  onUnban,
  onRevokeSessions,
  disabled,
}: RowActionsProps): ReactNode {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled} aria-label="Actions">
          {/* 3-dot icon */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {!user.banned && (
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onBan}>
            Ban
          </DropdownMenuItem>
        )}
        {user.banned && <DropdownMenuItem onClick={onUnban}>Unban</DropdownMenuItem>}
        <DropdownMenuItem onClick={onRevokeSessions}>Revoke sessions</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Main page ─────────────────────────────────────────────────────

type PendingConfirm =
  | { kind: "ban"; userId: string }
  | { kind: "unban"; userId: string }
  | { kind: "revoke"; userId: string };

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

export function UsersAdminPage(): ReactNode {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createEmail, setCreateEmail] = useState("");
  const [createName, setCreateName] = useState("");
  const [createPassword, setCreatePassword] = useState("");

  const listQuery = useQuery({
    queryKey: ["admin", "users", "list", debouncedSearch],
    queryFn: () => fetchJson<UsersListResponse>(buildListUrl(debouncedSearch)),
  });

  const mutate = useMutation({
    mutationFn: async (action: PendingConfirm) => {
      const base = `/admin/users/${encodeURIComponent(action.userId)}`;
      if (action.kind === "ban") await postAction(`${base}/ban`);
      else if (action.kind === "unban") await postAction(`${base}/unban`);
      else await postAction(`${base}/revoke-sessions`);
    },
    onSuccess: (_d, action) => {
      const label =
        action.kind === "ban"
          ? "User banned"
          : action.kind === "unban"
            ? "User unbanned"
            : "Revoke sessions";
      toast.success(label);
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createUser = useMutation({
    mutationFn: async () => {
      await postAction("/admin/users/create", {
        email: createEmail.trim(),
        name: createName.trim(),
        password: createPassword,
      });
    },
    onSuccess: () => {
      toast.success("User created.");
      setCreateOpen(false);
      setCreateEmail("");
      setCreateName("");
      setCreatePassword("");
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleConfirm = useCallback(() => {
    if (!pendingConfirm) return;
    mutate.mutate(pendingConfirm);
    setPendingConfirm(null);
  }, [mutate, pendingConfirm]);

  const users = listQuery.data?.users ?? [];
  const { sortedRows: sortedUsers, sortKey, sortDirection, toggleSort } = useTableSort(users);

  return (
    <AdminShell
      title="User management"
      subtitle="Create, edit, ban users, and revoke sessions."
      currentNav="users"
    >
      <div className="space-y-4">
        {/* Search bar */}
        <div className="flex items-center gap-3">
          <Input
            className="max-w-sm"
            placeholder="Search by email or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search"
          />
          <Button type="button" onClick={() => setCreateOpen(true)}>
            Create user
          </Button>
          {listQuery.isFetching && <span className="text-xs text-fg-muted">Loading…</span>}
        </div>

        {/* Table */}
        {listQuery.isPending ? (
          <PageLoading>Loading users…</PageLoading>
        ) : listQuery.isError ? (
          <PageError showAuthHint={needsAdminAuthHint(query.error)}>
            Could not load users.
          </PageError>
        ) : users.length === 0 ? (
          <PageEmpty>No users found.</PageEmpty>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Users ({listQuery.data?.total ?? users.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead
                      label="Email"
                      sortKey="email"
                      activeSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={toggleSort}
                    />
                    <SortableTableHead
                      label="Name"
                      sortKey="name"
                      activeSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={toggleSort}
                    />
                    <SortableTableHead
                      label="Verified"
                      sortKey="emailVerified"
                      activeSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={toggleSort}
                    />
                    <SortableTableHead
                      label="Banned"
                      sortKey="banned"
                      activeSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={toggleSort}
                    />
                    <SortableTableHead
                      label="Roles"
                      sortKey="roles"
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
                    <SortableTableHead
                      label="Sessions"
                      sortKey="sessionCount"
                      activeSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={toggleSort}
                    />
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedUsers.map((u) => (
                    <TableRow
                      key={u.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedUserId(u.id)}
                    >
                      <TableCell className="font-mono text-xs">{u.email}</TableCell>
                      <TableCell className="text-sm">{u.name ?? "—"}</TableCell>
                      <TableCell>
                        {u.emailVerified ? (
                          <Badge variant="default">Yes</Badge>
                        ) : (
                          <Badge variant="secondary">No</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {u.banned ? (
                          <Badge variant="destructive">Yes</Badge>
                        ) : (
                          <Badge variant="outline">No</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <UserRolesBadges roles={u.roles ?? []} />
                      </TableCell>
                      <TableCell className="text-xs text-fg-muted whitespace-nowrap">
                        {formatDate(u.createdAt)}
                      </TableCell>
                      <TableCell className="text-xs text-fg-muted">{u.sessionCount}</TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <RowActions
                          user={u}
                          disabled={mutate.isPending}
                          onBan={() => setPendingConfirm({ kind: "ban", userId: u.id })}
                          onUnban={() => setPendingConfirm({ kind: "unban", userId: u.id })}
                          onRevokeSessions={() =>
                            setPendingConfirm({ kind: "revoke", userId: u.id })
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* User detail sheet */}
      <UserDetailSheet
        userId={selectedUserId}
        onClose={() => setSelectedUserId(null)}
        onBan={(id) => {
          setSelectedUserId(null);
          setPendingConfirm({ kind: "ban", userId: id });
        }}
        onUnban={(id) => {
          setSelectedUserId(null);
          setPendingConfirm({ kind: "unban", userId: id });
        }}
        onRevokeSessions={(id) => {
          setSelectedUserId(null);
          setPendingConfirm({ kind: "revoke", userId: id });
        }}
        onUserUpdated={() => {
          void qc.invalidateQueries({ queryKey: ["admin", "users"] });
          if (selectedUserId) {
            void qc.invalidateQueries({ queryKey: ["admin", "users", "detail", selectedUserId] });
          }
        }}
        pendingAction={mutate.isPending ? "pending" : null}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>Creates a new user with email/password sign-in.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="create-user-email">Email</Label>
              <Input
                id="create-user-email"
                type="email"
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="create-user-name">Name</Label>
              <Input
                id="create-user-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="create-user-password">Password</Label>
              <Input
                id="create-user-password"
                type="password"
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                createUser.isPending ||
                !createEmail.trim() ||
                !createName.trim() ||
                !createPassword.trim()
              }
              onClick={() => createUser.mutate()}
            >
              {createUser.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm dialog */}
      {pendingConfirm && (
        <ConfirmDialog
          open
          dangerous={pendingConfirm.kind === "ban"}
          title={
            pendingConfirm.kind === "ban"
              ? "Ban user?"
              : pendingConfirm.kind === "unban"
                ? "Unban user?"
                : "Revoke sessions?"
          }
          description={
            pendingConfirm.kind === "ban"
              ? "The user can no longer sign in."
              : pendingConfirm.kind === "unban"
                ? "The user can sign in again."
                : "All active sessions for this user will be ended."
          }
          confirmLabel={
            pendingConfirm.kind === "ban"
              ? "Ban"
              : pendingConfirm.kind === "unban"
                ? "Unban"
                : "Revoke"
          }
          onConfirm={handleConfirm}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </AdminShell>
  );
}
