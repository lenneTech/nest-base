/**
 * Pure planner for `/hub/routes`.
 *
 * Takes a flat list of (method, path, controller, handler [, canMetadata])
 * — usually walked out of NestJS' Express adapter — and returns:
 *
 *   - the same routes, sorted (path → method) and tagged with their
 *     guard kind (`can` from @Can() metadata, `public` for explicit
 *     allowlist matches, or `unguarded` when nothing protects them);
 *   - a summary count for at-a-glance audit;
 *   - a `byController` grouping for the controller-centric view.
 *
 * The runner side (Express stack walking, filter for /hub itself,
 * controller-name resolution) lives in the Hub controller.
 */

export interface RouteCanMetadata {
  action: string;
  subject: string;
}

export interface RouteInput {
  method: string;
  path: string;
  controller: string;
  handler: string;
  /** Set when the handler carries a @Can() decorator. */
  canMetadata?: RouteCanMetadata;
  /**
   * Set when the handler (or its controller class) carries a @Public()
   * decorator — explicit consent that the route serves anonymous traffic
   * by design. Lower precedence than @Can() and the dev-only allowlist,
   * higher than the `unguarded` fallback (see classifyGuards).
   */
  isPublic?: boolean;
}

export type RouteGuard =
  | { kind: "can"; action: string; subject: string }
  | { kind: "public" }
  | { kind: "dev-only" }
  | { kind: "unguarded" };

export interface RouteRecord {
  method: string;
  path: string;
  controller: string;
  handler: string;
  guards: RouteGuard[];
}

export interface RouteInventory {
  routes: RouteRecord[];
  byController: Record<string, RouteRecord[]>;
  summary: {
    total: number;
    guarded: number;
    public: number;
    devOnly: number;
    unguarded: number;
  };
}

export interface AllowlistEntry {
  prefix: string;
  kind: "public" | "dev-only";
}

export interface RouteInventoryInput {
  routes: RouteInput[];
  /**
   * Path prefixes that are intentionally not guarded by `@Can()`.
   * Two kinds:
   *
   *   - `public`   — endpoint serves anonymous traffic by design
   *                  (health checks, OpenAPI spec, error catalog)
   *   - `dev-only` — endpoint exists only in development (assertDev
   *                  throws 404 in production); not the same as
   *                  "public" from an audit perspective
   *
   * Legacy callers that still pass a `string[]` are treated as if
   * every entry were `kind: "public"`.
   */
  publicAllowlist?: ReadonlyArray<AllowlistEntry | string>;
}

export function buildRouteInventory(input: RouteInventoryInput): RouteInventory {
  const allowlist = normaliseAllowlist(input.publicAllowlist);

  const records: RouteRecord[] = input.routes.map((r) => ({
    method: r.method.toUpperCase(),
    path: r.path,
    controller: r.controller,
    handler: r.handler,
    guards: classifyGuards(r, allowlist),
  }));

  records.sort((a, b) => {
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    return a.method.localeCompare(b.method);
  });

  const byController: Record<string, RouteRecord[]> = {};
  for (const record of records) {
    if (!byController[record.controller]) byController[record.controller] = [];
    byController[record.controller]!.push(record);
  }

  const summary = {
    total: records.length,
    guarded: records.filter((r) => r.guards.some((g) => g.kind === "can")).length,
    public: records.filter((r) => r.guards.some((g) => g.kind === "public")).length,
    devOnly: records.filter((r) => r.guards.some((g) => g.kind === "dev-only")).length,
    unguarded: records.filter((r) => r.guards.some((g) => g.kind === "unguarded")).length,
  };

  return { routes: records, byController, summary };
}

function normaliseAllowlist(
  raw: ReadonlyArray<AllowlistEntry | string> | undefined,
): AllowlistEntry[] {
  if (!raw) return [];
  return raw.map((entry) =>
    typeof entry === "string" ? { prefix: entry, kind: "public" as const } : entry,
  );
}

function classifyGuards(route: RouteInput, allowlist: AllowlistEntry[]): RouteGuard[] {
  // Precedence (most specific signal wins):
  //   1. @Can() metadata          → an explicit permission gate.
  //   2. allowlist prefix match   → subsystem-wide intent; keeps /admin and
  //      /hub routes classified `dev-only` even when they carry a class-level
  //      @Public() (the SPA-shell controllers do) — the allowlist must win so
  //      those stay honestly labelled dev-only, not public.
  //   3. @Public() decorator      → per-route consent for anonymous traffic.
  //   4. nothing                  → `unguarded` (a genuine audit finding).
  if (route.canMetadata) {
    return [{ kind: "can", action: route.canMetadata.action, subject: route.canMetadata.subject }];
  }
  const match = allowlist.find((entry) => route.path.startsWith(entry.prefix));
  if (match) {
    return [{ kind: match.kind }];
  }
  if (route.isPublic) {
    return [{ kind: "public" }];
  }
  return [{ kind: "unguarded" }];
}
