import type { AppEnv } from "../http/cookie-cors-config.js";

/**
 * Pure planner for the dev-only startup banner.
 *
 * Composes a colorized banner that lists the most useful URLs after
 * `app.listen()` succeeds — admin pages, dev tools, OpenAPI spec, Scalar
 * UI, mailpit, etc. The runner in `bootstrap.ts` prints the result via
 * `process.stdout.write`. ANSI colors are emitted unconditionally; in
 * non-TTY environments most modern terminals strip them transparently.
 */

export interface BannerEntry {
  /** Short label shown in the banner (left column). */
  label: string;
  /** Full URL or note (right column). */
  url: string;
  /** Optional secondary note (greyed out). */
  note?: string;
}

export interface BannerSection {
  title: string;
  entries: BannerEntry[];
}

export type BannerVariant = "hero" | "restart-watch" | "restart-env" | "restart-brand";

export interface BannerInput {
  env: AppEnv | "test";
  baseUrl: string;
  port: number;
  /**
   * Which banner to render. Defaults to `'hero'` for the first start
   * of a dev session; subsequent re-inits (bun --watch reload, .env
   * respawn) pick a compact restart variant.
   */
  variant?: BannerVariant;
  /**
   * Wall-clock timestamp shown in the compact restart banner. Defaults
   * to the current locale time. Tests pass an explicit value.
   */
  timestamp?: string;
  /** Toggles for sections that depend on feature flags. */
  features: {
    scalarEnabled: boolean;
    mailpitUrl?: string;
    powerSyncUrl?: string;
    prismaStudioUrl?: string;
    /**
     * Active Cloudflare-Tunnel URL discovered by `bun run dev --tunnel`.
     * Surfaced as a separate banner section so webhook setups (Stripe,
     * GitHub, Slack, …) have a visible public endpoint to copy-paste.
     */
    tunnelUrl?: string;
  };
}

export interface BannerPlan {
  /** Multi-line ANSI string ready for stdout. */
  text: string;
  /** Structured sections (used by tests). */
  sections: BannerSection[];
  /** The variant the banner was rendered with. */
  variant: BannerVariant;
}

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";

export function planStartupBanner(input: BannerInput): BannerPlan {
  const base = stripTrailingSlash(input.baseUrl);
  const variant: BannerVariant = input.variant ?? "hero";

  if (variant !== "hero") {
    return planRestartBanner(input, variant, base);
  }

  const sections: BannerSection[] = [
    {
      title: "API",
      entries: [
        { label: "Health", url: `${base}/health/live` },
        { label: "Ready", url: `${base}/health/ready` },
      ],
    },
    {
      title: "Docs",
      entries: [
        { label: "OpenAPI Spec", url: `${base}/api/openapi.json` },
        ...(input.features.scalarEnabled ? [{ label: "Scalar UI", url: `${base}/api/docs` }] : []),
        { label: "Error Codes", url: `${base}/errors` },
      ],
    },
    {
      title: "Hub",
      entries: [
        { label: "Landing", url: `${base}/` },
        { label: "Features", url: `${base}/api/dev/features` },
        { label: "Diagnostics", url: `${base}/api/dev/diagnostics` },
        { label: "PostgREST Parser", url: `${base}/api/dev/postgrest-parse?status=eq.draft` },
      ],
    },
    {
      title: "Admin",
      entries: [
        { label: "Permission Tester", url: `${base}/api/admin/permissions/test` },
        { label: "Webhook Inspector", url: `${base}/api/admin/webhooks` },
        { label: "Realtime Inspector", url: `${base}/api/admin/realtime` },
        { label: "Audit Browser", url: `${base}/api/admin/audit` },
        { label: "Search Tester", url: `${base}/api/admin/search` },
      ],
    },
  ];

  const services: BannerEntry[] = [];
  if (input.features.prismaStudioUrl) {
    services.push({ label: "Prisma Studio", url: input.features.prismaStudioUrl });
  }
  if (input.features.mailpitUrl) {
    services.push({ label: "Mailpit", url: input.features.mailpitUrl });
  }
  if (input.features.powerSyncUrl) {
    services.push({ label: "PowerSync", url: input.features.powerSyncUrl });
  }
  if (services.length > 0) {
    sections.push({ title: "Services", entries: services });
  }

  if (input.features.tunnelUrl) {
    sections.push({
      title: "Tunnel",
      entries: [
        {
          label: "Public URL",
          url: input.features.tunnelUrl,
          note: "wire this into Stripe / GitHub / Slack webhook configs",
        },
      ],
    });
  }

  const lines: string[] = [];
  const HR = `${DIM}${"─".repeat(72)}${RESET}`;
  lines.push("");
  lines.push(HR);
  lines.push(
    `${BOLD}${GREEN}🚀 Server erfolgreich gestartet${RESET}  ${DIM}(${input.env}, port ${input.port})${RESET}`,
  );
  lines.push(`${DIM}Base URL:${RESET} ${CYAN}${base}${RESET}`);
  lines.push(HR);

  for (const section of sections) {
    lines.push(`${BOLD}${YELLOW}${section.title}${RESET}`);
    for (const entry of section.entries) {
      const noteText = entry.note ? ` ${DIM}${entry.note}${RESET}` : "";
      lines.push(
        `  ${MAGENTA}${entry.label.padEnd(20)}${RESET} ${CYAN}${entry.url}${RESET}${noteText}`,
      );
    }
    lines.push("");
  }

  lines.push(HR);
  lines.push(`${DIM}Drücke ${RESET}${BOLD}CTRL+C${RESET}${DIM} zum Beenden${RESET}`);
  lines.push("");

  return { text: lines.join("\n"), sections, variant };
}

function planRestartBanner(input: BannerInput, variant: BannerVariant, base: string): BannerPlan {
  const reason =
    variant === "restart-env"
      ? ".env change"
      : variant === "restart-brand"
        ? "brand.json change"
        : "code change";
  const ts = input.timestamp ?? new Date().toLocaleTimeString();
  const lines = [
    "",
    `${DIM}─────${RESET} ${BOLD}${CYAN}♻ Server neu gestartet${RESET} ${DIM}(${reason}, ${ts})${RESET} ${DIM}${"─".repeat(20)}${RESET}`,
    `${DIM}Base URL:${RESET} ${CYAN}${base}${RESET}   ${DIM}Hub:${RESET} ${CYAN}${base}/${RESET}`,
  ];
  if (input.features.tunnelUrl) {
    lines.push(`${DIM}Tunnel:${RESET}   ${CYAN}${input.features.tunnelUrl}${RESET}`);
  }
  lines.push("");
  return { text: lines.join("\n"), sections: [], variant };
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
