/**
 * `/admin/users` — Benutzerverwaltung (issue #86).
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
import { adminFetch, fetchJson, needsAdminAuthHint } from "../lib/api.js";

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

interface UserDetailResponse extends UserListEntry {
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

async function postAction(path: string, body?: Record<string, string>): Promise<void> {
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

// ── User detail sheet ─────────────────────────────────────────────

interface UserDetailSheetProps {
  userId: string | null;
  onClose: () => void;
  onBan: (id: string) => void;
  onUnban: (id: string) => void;
  onRevokeSessions: (id: string) => void;
  pendingAction: string | null;
}

function UserDetailSheet({
  userId,
  onClose,
  onBan,
  onUnban,
  onRevokeSessions,
  pendingAction,
}: UserDetailSheetProps): ReactNode {
  const query = useQuery({
    queryKey: ["admin", "users", "detail", userId],
    queryFn: () =>
      fetchJson<UserDetailResponse>(`/admin/users/${encodeURIComponent(userId!)}.json`),
    enabled: userId !== null,
  });

  const user = query.data;

  return (
    <Sheet open={userId !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[480px] sm:w-[560px] overflow-y-auto">
        {query.isPending && <PageLoading>Lade Benutzerdetails…</PageLoading>}
        {query.isError && (
          <PageError showAuthHint={needsAdminAuthHint(query.error)}>
            Details konnten nicht geladen werden.
          </PageError>
        )}
        {user && (
          <>
            <SheetHeader className="mb-4">
              <SheetTitle className="truncate">{user.email}</SheetTitle>
            </SheetHeader>
            <div className="mb-4 flex gap-2 flex-wrap">
              {!user.banned ? (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={pendingAction !== null}
                  onClick={() => onBan(user.id)}
                >
                  Sperren
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pendingAction !== null}
                  onClick={() => onUnban(user.id)}
                >
                  Entsperren
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={pendingAction !== null}
                onClick={() => onRevokeSessions(user.id)}
              >
                Sitzungen widerrufen
              </Button>
            </div>
            <Tabs defaultValue="overview">
              <TabsList className="mb-4">
                <TabsTrigger value="overview">Übersicht</TabsTrigger>
                <TabsTrigger value="sessions">Sitzungen ({user.sessions.length})</TabsTrigger>
                <TabsTrigger value="accounts">Konten ({user.accounts.length})</TabsTrigger>
              </TabsList>

              {/* Übersicht tab */}
              <TabsContent value="overview">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-fg-muted">ID</dt>
                  <dd className="font-mono text-xs break-all">{user.id}</dd>
                  <dt className="text-fg-muted">Name</dt>
                  <dd>{user.name ?? "—"}</dd>
                  <dt className="text-fg-muted">E-Mail</dt>
                  <dd className="break-all">{user.email}</dd>
                  <dt className="text-fg-muted">Verifiziert</dt>
                  <dd>
                    {user.emailVerified ? (
                      <Badge variant="default">Ja</Badge>
                    ) : (
                      <Badge variant="secondary">Nein</Badge>
                    )}
                  </dd>
                  <dt className="text-fg-muted">Gesperrt</dt>
                  <dd>
                    {user.banned ? (
                      <Badge variant="destructive">Ja</Badge>
                    ) : (
                      <Badge variant="outline">Nein</Badge>
                    )}
                  </dd>
                  <dt className="text-fg-muted">Erstellt</dt>
                  <dd>{formatDate(user.createdAt)}</dd>
                  <dt className="text-fg-muted">Aktualisiert</dt>
                  <dd>{formatDate(user.updatedAt)}</dd>
                </dl>
              </TabsContent>

              {/* Sitzungen tab */}
              <TabsContent value="sessions">
                {user.sessions.length === 0 ? (
                  <PageEmpty>Keine aktiven Sitzungen.</PageEmpty>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Erstellt</TableHead>
                        <TableHead>IP</TableHead>
                        <TableHead>Browser</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {user.sessions.map((s) => (
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

              {/* Konten tab */}
              <TabsContent value="accounts">
                {user.accounts.length === 0 ? (
                  <PageEmpty>Keine verknüpften OAuth-Konten.</PageEmpty>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Anbieter</TableHead>
                        <TableHead>Konto-ID</TableHead>
                        <TableHead>Erstellt</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {user.accounts.map((a) => (
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
        <Button variant="ghost" size="sm" disabled={disabled} aria-label="Aktionen">
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
            Sperren
          </DropdownMenuItem>
        )}
        {user.banned && <DropdownMenuItem onClick={onUnban}>Entsperren</DropdownMenuItem>}
        <DropdownMenuItem onClick={onRevokeSessions}>Sitzungen widerrufen</DropdownMenuItem>
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
          ? "Benutzer gesperrt"
          : action.kind === "unban"
            ? "Benutzer entsperrt"
            : "Sitzungen widerrufen";
      toast.success(label);
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

  return (
    <AdminShell
      title="Benutzerverwaltung"
      subtitle="Benutzer suchen, sperren, entsperren und Sitzungen widerrufen."
      currentNav="users"
    >
      <div className="space-y-4">
        {/* Search bar */}
        <div className="flex items-center gap-3">
          <Input
            className="max-w-sm"
            placeholder="Nach E-Mail oder Name suchen…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Suche"
          />
          {listQuery.isFetching && <span className="text-xs text-fg-muted">Lädt…</span>}
        </div>

        {/* Table */}
        {listQuery.isPending ? (
          <PageLoading>Lade Benutzer…</PageLoading>
        ) : listQuery.isError ? (
          <PageError showAuthHint={needsAdminAuthHint(query.error)}>
            Benutzer konnten nicht geladen werden.
          </PageError>
        ) : users.length === 0 ? (
          <PageEmpty>Keine Benutzer gefunden.</PageEmpty>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Benutzer ({listQuery.data?.total ?? users.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>E-Mail</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Verifiziert</TableHead>
                    <TableHead>Gesperrt</TableHead>
                    <TableHead>Erstellt</TableHead>
                    <TableHead>Sitzungen</TableHead>
                    <TableHead className="text-right">Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow
                      key={u.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedUserId(u.id)}
                    >
                      <TableCell className="font-mono text-xs">{u.email}</TableCell>
                      <TableCell className="text-sm">{u.name ?? "—"}</TableCell>
                      <TableCell>
                        {u.emailVerified ? (
                          <Badge variant="default">Ja</Badge>
                        ) : (
                          <Badge variant="secondary">Nein</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {u.banned ? (
                          <Badge variant="destructive">Ja</Badge>
                        ) : (
                          <Badge variant="outline">Nein</Badge>
                        )}
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
        pendingAction={mutate.isPending ? "pending" : null}
      />

      {/* Confirm dialog */}
      {pendingConfirm && (
        <ConfirmDialog
          open
          dangerous={pendingConfirm.kind === "ban"}
          title={
            pendingConfirm.kind === "ban"
              ? "Benutzer sperren?"
              : pendingConfirm.kind === "unban"
                ? "Benutzer entsperren?"
                : "Sitzungen widerrufen?"
          }
          description={
            pendingConfirm.kind === "ban"
              ? "Der Benutzer kann sich nicht mehr anmelden."
              : pendingConfirm.kind === "unban"
                ? "Der Benutzer kann sich wieder anmelden."
                : "Alle aktiven Sitzungen dieses Benutzers werden beendet."
          }
          confirmLabel={
            pendingConfirm.kind === "ban"
              ? "Sperren"
              : pendingConfirm.kind === "unban"
                ? "Entsperren"
                : "Widerrufen"
          }
          onConfirm={handleConfirm}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </AdminShell>
  );
}
