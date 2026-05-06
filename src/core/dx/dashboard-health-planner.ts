/**
 * Pure planner for the operator dashboard status-group cards.
 *
 * No I/O — given a snapshot of runtime metrics, returns four coloured
 * status groups the frontend can render without any further work.
 * Keeping it pure makes the logic trivially testable in unit / story
 * tests without spinning up NestJS or Prisma.
 */

export type StatusLevel = "ok" | "warn" | "error" | "unknown";

export interface DashboardStatusItem {
  label: string;
  value: string;
  status: StatusLevel;
}

export interface DashboardStatusGroup {
  id: "database" | "async" | "external" | "runtime";
  label: string;
  status: StatusLevel;
  items: DashboardStatusItem[];
}

export interface DashboardHealthInput {
  /** process.uptime() in seconds */
  uptime: number;
  /** process.memoryUsage().heapUsed / 1e6 */
  heapUsedMb: number;
  /** process.memoryUsage().rss / 1e6 */
  rssMb: number;
  bunVersion: string;
  pendingJobCount: number;
  deadLetterCount: number;
  /** 0..1, last hour; 1 = 100 % success */
  webhookSuccessRate: number;
  emailEnabled: boolean;
  storageDriverName: string;
  /** Age of the GeoIP database file in days (0 = freshly downloaded) */
  geoIpAgeDays: number;
  allMigrationsApplied: boolean;
  /** Whether row-level security is active on the DB */
  rlsActive: boolean;
}

/** Escalate group status to the worst item status. */
function worstOf(items: DashboardStatusItem[]): StatusLevel {
  if (items.some((i) => i.status === "error")) return "error";
  if (items.some((i) => i.status === "warn")) return "warn";
  if (items.every((i) => i.status === "ok")) return "ok";
  return "unknown";
}

function buildDatabaseGroup(input: DashboardHealthInput): DashboardStatusGroup {
  const migrationsStatus: StatusLevel = input.allMigrationsApplied ? "ok" : "error";
  const rlsStatus: StatusLevel = input.rlsActive ? "ok" : "warn";

  const items: DashboardStatusItem[] = [
    {
      label: "Migrationen",
      value: input.allMigrationsApplied ? "aktuell" : "ausstehend",
      status: migrationsStatus,
    },
    {
      label: "Row-Level Security",
      value: input.rlsActive ? "aktiv" : "inaktiv",
      status: rlsStatus,
    },
  ];

  return { id: "database", label: "Datenbankstatus", status: worstOf(items), items };
}

function buildAsyncGroup(input: DashboardHealthInput): DashboardStatusGroup {
  // Dead letters always → error regardless of success rate
  const deadLetterStatus: StatusLevel = input.deadLetterCount > 0 ? "error" : "ok";

  // Webhook success-rate thresholds: ≥0.95 ok, 0.8–0.95 warn, <0.8 error
  const webhookStatus: StatusLevel =
    input.webhookSuccessRate >= 0.95 ? "ok" : input.webhookSuccessRate >= 0.8 ? "warn" : "error";

  const items: DashboardStatusItem[] = [
    {
      label: "Dead-Letter-Queue",
      value: input.deadLetterCount === 0 ? "leer" : `${input.deadLetterCount} Einträge`,
      status: deadLetterStatus,
    },
    {
      label: "Webhook-Erfolgsrate",
      value: `${(input.webhookSuccessRate * 100).toFixed(0)} %`,
      status: webhookStatus,
    },
    {
      label: "Offene Jobs",
      value: input.pendingJobCount === 0 ? "keine" : String(input.pendingJobCount),
      status: "ok",
    },
  ];

  return { id: "async", label: "Async-Dienste", status: worstOf(items), items };
}

function buildExternalGroup(input: DashboardHealthInput): DashboardStatusGroup {
  // GeoIP database is "stale" after 30 days — the free MaxMind DB
  // updates weekly; warn if the operator forgot to refresh it.
  const geoIpStatus: StatusLevel = input.geoIpAgeDays > 30 ? "warn" : "ok";

  const items: DashboardStatusItem[] = [
    {
      label: "E-Mail-Dienst",
      value: input.emailEnabled ? "aktiv" : "deaktiviert",
      status: input.emailEnabled ? "ok" : "warn",
    },
    {
      label: "Speicher-Driver",
      value: input.storageDriverName,
      status: "ok",
    },
    {
      label: "GeoIP-Datenbank",
      value: input.geoIpAgeDays > 30 ? `${input.geoIpAgeDays} Tage alt` : "aktuell",
      status: geoIpStatus,
    },
  ];

  return { id: "external", label: "Externe Dienste", status: worstOf(items), items };
}

function buildRuntimeGroup(input: DashboardHealthInput): DashboardStatusGroup {
  // Heap thresholds: ≤500 MB ok, 501–800 warn, >800 error
  const heapStatus: StatusLevel =
    input.heapUsedMb > 800 ? "error" : input.heapUsedMb > 500 ? "warn" : "ok";

  // RSS same scale — typically higher than heap, so thresholds shifted
  const rssStatus: StatusLevel = input.rssMb > 1200 ? "error" : input.rssMb > 700 ? "warn" : "ok";

  const items: DashboardStatusItem[] = [
    {
      label: "Heap-Speicher",
      value: `${input.heapUsedMb.toFixed(0)} MB`,
      status: heapStatus,
    },
    {
      label: "RSS-Speicher",
      value: `${input.rssMb.toFixed(0)} MB`,
      status: rssStatus,
    },
    {
      label: "Laufzeit",
      value: `${Math.floor(input.uptime / 3600)} h ${Math.floor((input.uptime % 3600) / 60)} min`,
      status: "ok",
    },
    {
      label: "Bun-Version",
      value: input.bunVersion || "unbekannt",
      status: "ok",
    },
  ];

  return { id: "runtime", label: "Laufzeit", status: worstOf(items), items };
}

/**
 * Build the four operator-dashboard status groups from a runtime
 * snapshot. Pure — no side-effects, no async.
 */
export function buildDashboardStatusGroups(input: DashboardHealthInput): DashboardStatusGroup[] {
  return [
    buildDatabaseGroup(input),
    buildAsyncGroup(input),
    buildExternalGroup(input),
    buildRuntimeGroup(input),
  ];
}
