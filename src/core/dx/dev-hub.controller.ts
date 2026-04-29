import { Controller, Get, NotFoundException } from '@nestjs/common';

import { type Features, FeaturesSchema, loadFeatures } from '../features/features.js';
import { serverConfigFromEnv } from '../server/server-config.js';
import { type DevHubLink, planDevHub } from './dev-hub.js';

/**
 * `GET /dev` — landing page for the Dev-Hub. Lists active DX tools,
 * driven by `planDevHub()`. Outside `NODE_ENV=development` the route
 * 404s — the dev hub is a developer-only affordance.
 */
@Controller('dev')
export class DevHubController {
  @Get()
  index(): string {
    const cfg = serverConfigFromEnv(process.env);
    if (cfg.env !== 'development') {
      throw new NotFoundException();
    }

    const features: Features = loadFeatures(process.env as Record<string, string | undefined>);
    void FeaturesSchema; // ensure schema import is alive for tooling
    const links = planDevHub({ env: 'development', features });
    return renderHtml(links);
  }
}

const CATEGORY_LABELS: Record<DevHubLink['category'], string> = {
  api: 'API',
  architecture: 'Architecture',
  data: 'Data',
  async: 'Async',
};

function renderHtml(links: ReadonlyArray<DevHubLink>): string {
  const grouped: Partial<Record<DevHubLink['category'], DevHubLink[]>> = {};
  for (const link of links) {
    (grouped[link.category] ??= []).push(link);
  }
  const sections = Object.entries(grouped)
    .map(([category, list]) => {
      const items = list!
        .map((l) => `      <li><a href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a></li>`)
        .join('\n');
      return `    <section>\n      <h2>${escapeHtml(CATEGORY_LABELS[category as DevHubLink['category']])}</h2>\n      <ul>\n${items}\n      </ul>\n    </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Dev Hub</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
    h1 { margin-bottom: 0.5rem; }
    section { margin-top: 1.5rem; }
    h2 { font-size: 1rem; text-transform: uppercase; letter-spacing: 0.05em; color: #666; }
    ul { list-style: none; padding: 0; }
    li { padding: 0.25rem 0; }
    a { color: #0a58ca; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Dev Hub</h1>
  <p>Local developer tools for this server. Visible only when <code>NODE_ENV=development</code>.</p>
${sections}
</body>
</html>
`;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
