import { Controller, Get, Header, NotFoundException, Query } from "@nestjs/common";

import { type Features, loadFeatures } from "../features/features.js";
import { type PrismaWhere, parsePostgrestQuery } from "../permissions/postgrest-query.js";
import { serverConfigFromEnv } from "../server/server-config.js";
import { APP_NAME, APP_VERSION } from "../app/app.metadata.js";
import { renderAdminLayout } from "./admin-layout.js";
import { buildDiagnosticsReport, type DiagnosticsReport } from "./diagnostics.js";
import { type DevHubLink, planDevHub } from "./dev-hub.js";

/**
 * `/dev/*` — Developer-only landing + JSON inspection routes.
 *
 * - `GET /dev`             — HTML landing page (categorised tool links)
 * - `GET /dev/features`    — active Features object as JSON
 * - `GET /dev/diagnostics` — runtime + memory + features report
 *
 * Every route 404s outside `NODE_ENV=development` so the surface can
 * never leak in production.
 */
@Controller("dev")
export class DevHubController {
  @Get()
  @Header("content-type", "text/html; charset=utf-8")
  index(): string {
    this.assertDev();
    const links = planDevHub({ env: "development", features: this.featuresOnly() });
    return renderHtml(links);
  }

  @Get("features")
  features(): Features {
    this.assertDev();
    return this.featuresOnly();
  }

  @Get("postgrest-parse")
  postgrestParse(@Query() query: Record<string, string>): { where: PrismaWhere } {
    this.assertDev();
    // Strips off the controller's own NestJS-overhead query params if any
    // (none today). Returns the parsed Prisma WHERE for inspection.
    return { where: parsePostgrestQuery(query) };
  }

  @Get("diagnostics")
  diagnostics(): DiagnosticsReport {
    this.assertDev();
    const features = this.featuresOnly();
    const cfg = serverConfigFromEnv(process.env);
    return buildDiagnosticsReport({
      now: () => Date.now(),
      processStartTime: Date.now() - Math.round(process.uptime() * 1000),
      memory: () => {
        const m = process.memoryUsage();
        return {
          rss: m.rss,
          heapTotal: m.heapTotal,
          heapUsed: m.heapUsed,
          external: m.external,
          arrayBuffers: m.arrayBuffers,
        };
      },
      env: {
        nodeVersion: process.versions.node,
        bunVersion: readBunVersion(),
        platform: process.platform,
        arch: process.arch,
      },
      app: {
        env: "development",
        version: APP_VERSION,
        baseUrl: cfg.baseUrl,
      },
      features,
      dependencies: { name: APP_NAME },
    });
  }

  private assertDev(): void {
    const cfg = serverConfigFromEnv(process.env);
    if (cfg.env !== "development") {
      throw new NotFoundException();
    }
  }

  private featuresOnly(): Features {
    return loadFeatures(process.env as Record<string, string | undefined>);
  }
}

const CATEGORY_LABELS: Record<DevHubLink["category"], string> = {
  api: "API",
  architecture: "Architecture",
  data: "Data",
  async: "Async",
};

function renderHtml(links: ReadonlyArray<DevHubLink>): string {
  const grouped: Partial<Record<DevHubLink["category"], DevHubLink[]>> = {};
  for (const link of links) {
    (grouped[link.category] ??= []).push(link);
  }
  const sections = Object.entries(grouped)
    .map(([category, list]) => {
      const items = list!
        .map(
          (l) =>
            `        <li><a href="${escapeHtml(l.url)}"><span>${escapeHtml(l.label)}</span><span class="admin-meta">→</span></a></li>`,
        )
        .join("\n");
      return `<div class="admin-card">
  <h2 class="admin-card__title">${escapeHtml(CATEGORY_LABELS[category as DevHubLink["category"]])}</h2>
  <ul class="admin-link-list">
${items}
  </ul>
</div>`;
    })
    .join("\n");

  const body = `
<p class="admin-meta">Local developer tools for this server. Visible only when <code>NODE_ENV=development</code>.</p>
<div class="admin-grid admin-grid--2">
${sections}
</div>`;
  return renderAdminLayout({
    title: "Dev Hub",
    subtitle: "Central access point for every dev/admin surface this server exposes.",
    currentNav: "dev-hub",
    body,
  });
}

function readBunVersion(): string | undefined {
  const bun = (globalThis as { Bun?: { version: string } }).Bun;
  return bun?.version;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
