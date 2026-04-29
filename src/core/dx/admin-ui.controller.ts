import { Controller, Get, Header, NotFoundException } from '@nestjs/common';

import { serverConfigFromEnv } from '../server/server-config.js';
import { renderAuditBrowserPage } from './audit-browser-ui.js';
import { renderPermissionTesterPage } from './permission-tester-ui.js';
import { renderRealtimeInspectorPage } from './realtime-inspector-ui.js';
import { renderSearchTesterPage } from './search-tester-ui.js';
import { renderWebhookInspectorPage } from './webhook-inspector-ui.js';

/**
 * `/admin/*` developer UIs (PLAN.md §27 + §32 Phase 8). All routes
 * 404 outside `NODE_ENV=development` — same gating as the Dev-Hub.
 *
 * Data sources are stub-empty for now (the underlying registries —
 * webhook deliveries, audit log, active sockets, permission storage —
 * are not yet wired up). The pages render with empty results and a
 * "no data yet" hint, which is enough for the dev-hub deep-links to
 * resolve and for the controllers to be e2e-testable.
 */
@Controller('admin')
export class AdminUiController {
  @Get('permissions/test')
  @Header('content-type', 'text/html; charset=utf-8')
  permissionsTest(): string {
    this.assertDev();
    return renderPermissionTesterPage({});
  }

  @Get('webhooks')
  @Header('content-type', 'text/html; charset=utf-8')
  webhookInspector(): string {
    this.assertDev();
    return renderWebhookInspectorPage({ deliveries: [], filter: { status: 'ALL' } });
  }

  @Get('realtime')
  @Header('content-type', 'text/html; charset=utf-8')
  realtimeInspector(): string {
    this.assertDev();
    return renderRealtimeInspectorPage({ sockets: [], events: [] });
  }

  @Get('audit')
  @Header('content-type', 'text/html; charset=utf-8')
  auditBrowser(): string {
    this.assertDev();
    return renderAuditBrowserPage({ entries: [], filter: {} });
  }

  @Get('search')
  @Header('content-type', 'text/html; charset=utf-8')
  searchTester(): string {
    this.assertDev();
    return renderSearchTesterPage({ hits: [] });
  }

  private assertDev(): void {
    const cfg = serverConfigFromEnv(process.env);
    if (cfg.env !== 'development') {
      throw new NotFoundException();
    }
  }
}
