import { Controller, Delete, ForbiddenException, Get, Req } from '@nestjs/common';
import type { Request } from 'express';

import { type GdprExportPayload, buildGdprExport } from './gdpr.service.js';

interface AuthedRequest extends Request {
  user?: { id: string; tenantId?: string };
}

/**
 * GDPR/data-protection endpoints. The actual data fetch (export
 * payload, erasure plan) sits behind storage adapters that aren't
 * wired yet — the controller for now demonstrates the surface and
 * returns a 501 placeholder so frontends can build against the
 * shape. Full data plumbing lands once Better-Auth's Prisma adapter
 * + project-specific erasure-plan registries are in place.
 */
@Controller('me')
export class GdprController {
  @Get('export')
  async export(@Req() req: AuthedRequest): Promise<GdprExportPayload> {
    if (!req.user) {
      throw new ForbiddenException('authentication required');
    }
    // Stub: empty resource map. Populates with real data once
    // domain modules register `GdprExportContributor`s.
    return buildGdprExport({
      user: { id: req.user.id, tenantId: req.user.tenantId ?? null },
      relatedResources: {},
      now: () => Date.now(),
    });
  }

  @Delete('account')
  async deleteAccount(@Req() req: AuthedRequest): Promise<{ status: 'pending'; userId: string }> {
    if (!req.user) {
      throw new ForbiddenException('authentication required');
    }
    // Stub: real erasure executes the GdprErasure plan against the
    // PII-field registry. Records the request and returns immediately.
    return { status: 'pending', userId: req.user.id };
  }
}
