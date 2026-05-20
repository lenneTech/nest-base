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
  /** 0..1 over the last 24 h; `null` = no deliveries or webhooks disabled */
  webhookSuccessRate: number | null;
  emailEnabled: boolean;
  storageDriverName: string;
  /** Age of the GeoIP `.mmdb` in days; `null` = feature off or file missing */
  geoIpAgeDays: number | null;
  geoIpEnabled: boolean;
  geoIpInstalled: boolean;
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
      label: "Migrations",
      value: input.allMigrationsApplied ? "up to date" : "pending",
      status: migrationsStatus,
    },
    {
      label: "Row-Level Security",
      value: input.rlsActive ? "active" : "inactive",
      status: rlsStatus,
    },
  ];

  return { id: "database", label: "Database", status: worstOf(items), items };
}

function buildAsyncGroup(input: DashboardHealthInput): DashboardStatusGroup {
  // Dead letters always → error regardless of success rate
  const deadLetterStatus: StatusLevel = input.deadLetterCount > 0 ? "error" : "ok";

  const webhookItem: DashboardStatusItem =
    input.webhookSuccessRate === null
      ? {
          label: "Webhook success rate",
          value: "no deliveries (24 h)",
          status: "unknown",
        }
      : (() => {
          const rate = input.webhookSuccessRate;
          const webhookStatus: StatusLevel = rate >= 0.95 ? "ok" : rate >= 0.8 ? "warn" : "error";
          return {
            label: "Webhook success rate",
            value: `${(rate * 100).toFixed(0)} %`,
            status: webhookStatus,
          };
        })();

  const items: DashboardStatusItem[] = [
    {
      label: "Dead-Letter-Queue",
      value: input.deadLetterCount === 0 ? "empty" : `${input.deadLetterCount} entries`,
      status: deadLetterStatus,
    },
    webhookItem,
    {
      label: "Pending jobs",
      value: input.pendingJobCount === 0 ? "none" : String(input.pendingJobCount),
      status: input.pendingJobCount === 0 ? "ok" : input.pendingJobCount > 100 ? "error" : "warn",
    },
  ];

  return { id: "async", label: "Async services", status: worstOf(items), items };
}

function buildExternalGroup(input: DashboardHealthInput): DashboardStatusGroup {
  const geoIpItem: DashboardStatusItem = !input.geoIpEnabled
    ? { label: "GeoIP database", value: "disabled", status: "unknown" }
    : !input.geoIpInstalled || input.geoIpAgeDays === null
      ? {
          label: "GeoIP database",
          value: "not installed",
          status: "warn",
        }
      : {
          label: "GeoIP database",
          value:
            input.geoIpAgeDays > 30
              ? `${input.geoIpAgeDays} days old`
              : `${input.geoIpAgeDays} days`,
          status: input.geoIpAgeDays > 30 ? "warn" : "ok",
        };

  const items: DashboardStatusItem[] = [
    {
      label: "Email service",
      value: input.emailEnabled ? "active" : "disabled",
      status: input.emailEnabled ? "ok" : "warn",
    },
    {
      label: "Storage driver",
      value: input.storageDriverName,
      status: "ok",
    },
    geoIpItem,
  ];

  return { id: "external", label: "External services", status: worstOf(items), items };
}

function buildRuntimeGroup(input: DashboardHealthInput): DashboardStatusGroup {
  // Heap thresholds: ≤500 MB ok, 501–800 warn, >800 error
  const heapStatus: StatusLevel =
    input.heapUsedMb > 800 ? "error" : input.heapUsedMb > 500 ? "warn" : "ok";

  // RSS same scale — typically higher than heap, so thresholds shifted
  const rssStatus: StatusLevel = input.rssMb > 1200 ? "error" : input.rssMb > 700 ? "warn" : "ok";

  const items: DashboardStatusItem[] = [
    {
      label: "Heap memory",
      value: `${input.heapUsedMb.toFixed(0)} MB`,
      status: heapStatus,
    },
    {
      label: "RSS memory",
      value: `${input.rssMb.toFixed(0)} MB`,
      status: rssStatus,
    },
    {
      label: "Uptime",
      value: `${Math.floor(input.uptime / 3600)} h ${Math.floor((input.uptime % 3600) / 60)} min`,
      status: "ok",
    },
    {
      label: "Bun version",
      value: input.bunVersion || "unknown",
      status: "ok",
    },
  ];

  return { id: "runtime", label: "Runtime", status: worstOf(items), items };
}

/**
 * Build the four operator-dashboard status groups from a runtime
 * snapshot. Pure — no side-effects, no async.
 */
export function buildDashboardStatusGroups(input: DashboardHealthInput): DashboardStatusGroup[] {
  // Order: data integrity → queues/webhooks → process health → integrations.
  return [
    buildDatabaseGroup(input),
    buildAsyncGroup(input),
    buildRuntimeGroup(input),
    buildExternalGroup(input),
  ];
}
