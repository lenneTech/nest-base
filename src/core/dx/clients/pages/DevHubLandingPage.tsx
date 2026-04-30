/**
 * Dev-Hub Landing — the React replacement for the server-rendered
 * `/dev` cockpit. v1 implements a slim landing card list that links to
 * every existing server-rendered surface; the deeper integrations
 * (live coverage / tests / logs / queries) keep their server pages for
 * now and can be migrated in follow-up issues.
 *
 * Data sources: `/dev/features.json`, `/dev/diagnostics.json`. Both
 * are admin-gated by the controller; in development they always
 * answer 200.
 */
import { useQuery } from "@tanstack/react-query";

interface FeaturesShape {
  webhooks: { enabled: boolean };
  realtime: { enabled: boolean };
  search: { enabled: boolean };
  multiTenancy: { enabled: boolean };
}

interface DiagnosticsShape {
  runtime?: { platform?: string };
  process?: { node?: string };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return (await res.json()) as T;
}

interface LinkCard {
  href: string;
  label: string;
  description: string;
  category: string;
  enabled: boolean;
}

function buildLinks(features: FeaturesShape | undefined): LinkCard[] {
  const cards: LinkCard[] = [
    {
      href: "/api/docs",
      label: "Scalar API Reference",
      description: "Interactive OpenAPI explorer.",
      category: "API",
      enabled: true,
    },
    {
      href: "/api/openapi",
      label: "OpenAPI Spec (raw)",
      description: "Download or pipe the JSON spec.",
      category: "API",
      enabled: true,
    },
    {
      href: "/dev/features",
      label: "Active Features",
      description: "Inspect and toggle every feature flag.",
      category: "Architecture",
      enabled: true,
    },
    {
      href: "/dev/diagnostics",
      label: "Diagnostics",
      description: "Runtime, memory, dependency report.",
      category: "Architecture",
      enabled: true,
    },
    {
      href: "/dev/coverage",
      label: "Coverage",
      description: "Vitest coverage summary per file.",
      category: "Quality",
      enabled: true,
    },
    {
      href: "/dev/tests",
      label: "Tests",
      description: "Latest Vitest run + per-file timings.",
      category: "Quality",
      enabled: true,
    },
    {
      href: "/dev/logs",
      label: "Logs",
      description: "Live structured log tail.",
      category: "Observability",
      enabled: true,
    },
    {
      href: "/dev/traces",
      label: "Traces",
      description: "Request-level OpenTelemetry traces.",
      category: "Observability",
      enabled: true,
    },
    {
      href: "/dev/queries",
      label: "Queries",
      description: "Slowest + most-frequent query templates.",
      category: "Observability",
      enabled: true,
    },
    {
      href: "/dev/routes",
      label: "Route Inventory",
      description: "Every controller route, gated or open.",
      category: "API",
      enabled: true,
    },
    {
      href: "/dev/erd",
      label: "ERD",
      description: "Mermaid view of the Prisma data model.",
      category: "Architecture",
      enabled: true,
    },
    {
      href: "/admin/permissions/test",
      label: "Permission Tester",
      description: "Try CASL rules with arbitrary subjects.",
      category: "Admin",
      enabled: true,
    },
    {
      href: "/admin/audit",
      label: "Audit Browser",
      description: "Search the audit log.",
      category: "Admin",
      enabled: true,
    },
    {
      href: "/admin/webhooks",
      label: "Webhook Inspector",
      description: "Inspect outbox + delivery attempts.",
      category: "Admin",
      enabled: features?.webhooks.enabled ?? false,
    },
    {
      href: "/admin/realtime",
      label: "Realtime Inspector",
      description: "Active channels + event tail.",
      category: "Admin",
      enabled: features?.realtime.enabled ?? false,
    },
    {
      href: "/admin/search",
      label: "Search Tester",
      description: "Run FTS queries against any resource.",
      category: "Admin",
      enabled: features?.search.enabled ?? false,
    },
  ];
  return cards.filter((c) => c.enabled);
}

export function DevHubLandingPage() {
  const features = useQuery({
    queryKey: ["dev", "features"],
    queryFn: () => fetchJson<FeaturesShape>("/dev/features.json"),
  });
  const diagnostics = useQuery({
    queryKey: ["dev", "diagnostics"],
    queryFn: () => fetchJson<DiagnosticsShape>("/dev/diagnostics.json"),
  });

  const cards = buildLinks(features.data);
  const grouped: Record<string, LinkCard[]> = {};
  for (const card of cards) {
    grouped[card.category] = grouped[card.category] ?? [];
    grouped[card.category]!.push(card);
  }

  return (
    <>
      <header className="dp-header">
        <div>
          <h1 className="dp-header__title">Dev Hub</h1>
          <p className="dp-header__subtitle">
            React-rendered landing for every developer-facing tool. Toggle features, inspect traces,
            replay webhooks — everything one click away.
          </p>
        </div>
      </header>

      <section className="dp-card">
        <h2 className="dp-card__title">Runtime</h2>
        {diagnostics.isLoading ? (
          <div className="dp-loading">Loading…</div>
        ) : diagnostics.isError ? (
          <p style={{ color: "var(--err)" }}>Failed to load diagnostics.</p>
        ) : (
          <pre className="dp-pre">
            {`platform : ${diagnostics.data?.runtime?.platform ?? "?"}
node     : ${diagnostics.data?.process?.node ?? "?"}`}
          </pre>
        )}
      </section>

      {Object.entries(grouped).map(([category, list]) => (
        <section key={category} className="dp-card">
          <h2 className="dp-card__title">{category}</h2>
          <ul className="dp-link-list">
            {list.map((card) => (
              <li key={card.href}>
                <a href={card.href}>
                  <span>
                    <strong style={{ display: "block" }}>{card.label}</strong>
                    <span style={{ color: "var(--fg-muted)", fontSize: "0.78rem" }}>
                      {card.description}
                    </span>
                  </span>
                  <span aria-hidden="true">→</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
