import { Controller, Delete, ForbiddenException, Get, Req } from "@nestjs/common";
import type { Request } from "express";

import { Can } from "../permissions/can.guard.js";
import { type GdprExportPayload, buildGdprExport } from "./gdpr.service.js";

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
 *
 * Permission gating: both handlers carry `@Can()` so the unified
 * CASL ability check applies (covers ability resolution + the
 * permission-tester surface). The `req.user` nullcheck is kept as
 * defense-in-depth — `CanGuard` returns 403 for an empty ability,
 * but the explicit check makes the intent obvious in the handler.
 */
@Controller("me")
export class GdprController {
  @Can("export", "GdprData")
  @Get("export")
  async export(@Req() req: AuthedRequest): Promise<GdprExportPayload> {
    if (!req.user) {
      throw new ForbiddenException("authentication required");
    }
    // Stub: empty resource map. Populates with real data once
    // domain modules register `GdprExportContributor`s.
    return buildGdprExport({
      user: { id: req.user.id, tenantId: req.user.tenantId ?? null },
      relatedResources: {},
      now: () => Date.now(),
    });
  }

  @Can("delete", "Account")
  @Delete("account")
  async deleteAccount(@Req() req: AuthedRequest): Promise<{ status: "pending"; userId: string }> {
    if (!req.user) {
      throw new ForbiddenException("authentication required");
    }
    // Stub: real erasure executes the GdprErasure plan against the
    // PII-field registry. Records the request and returns immediately.
    return { status: "pending", userId: req.user.id };
  }
}
