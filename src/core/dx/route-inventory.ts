/**
 * Pure planner for `/dev/routes`.
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
 * The runner side (Express stack walking, filter for /dev itself,
 * controller-name resolution) lives in the dev-hub controller.
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
}

export type RouteGuard =
  | { kind: "can"; action: string; subject: string }
  | { kind: "public" }
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
    unguarded: number;
  };
}

export interface RouteInventoryInput {
  routes: RouteInput[];
  /**
   * Path prefixes that are intentionally unguarded (health checks,
   * OpenAPI spec, dev-hub itself). Matched as `path.startsWith(...)`.
   */
  publicAllowlist?: string[];
}

export function buildRouteInventory(input: RouteInventoryInput): RouteInventory {
  const allowlist = input.publicAllowlist ?? [];

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
    unguarded: records.filter((r) => r.guards.some((g) => g.kind === "unguarded")).length,
  };

  return { routes: records, byController, summary };
}

function classifyGuards(route: RouteInput, allowlist: string[]): RouteGuard[] {
  if (route.canMetadata) {
    return [{ kind: "can", action: route.canMetadata.action, subject: route.canMetadata.subject }];
  }
  if (allowlist.some((prefix) => route.path.startsWith(prefix))) {
    return [{ kind: "public" }];
  }
  return [{ kind: "unguarded" }];
}
