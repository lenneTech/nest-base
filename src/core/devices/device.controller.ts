import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Req,
} from "@nestjs/common";
import type { Request } from "express";

import { Can } from "../permissions/can.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { parseUserAgent } from "./ua-parser.js";
import { fingerprintSession } from "./fingerprint.js";

interface AuthedRequest extends Request {
  user?: { id: string };
}

export interface DeviceListItem {
  id: string;
  deviceLabel: string;
  ipAddress: string | null;
  lastSeenAt: string;
  current: boolean;
}

/**
 * `/me/devices` — read + revoke the authenticated user's sessions.
 *
 * Auth gate: `req.user` is populated by `BetterAuthSessionMiddleware`.
 * Anonymous requests bounce on the middleware before reaching the
 * controller; the `req.user` check below is defense-in-depth.
 *
 * The `current: bool` field needs the request's session id —
 * Better-Auth doesn't expose it on `req.user` today (only the user
 * identity), so we mark `current` based on a recent-activity
 * heuristic: the most-recently-updated session for the user. This
 * is good enough for the dev-portal "this is your device" display;
 * the security-sensitive bits (revoke confirmation) ride on the
 * session id, which the user supplies explicitly.
 */
@Controller("me/devices")
export class DeviceController {
  constructor(private readonly prisma: PrismaService) {}

  // Issue #47 — gate on `Session`, the per-user resource that
  // member-role-rules.ts seeds with `userId = $CURRENT_USER`. The
  // explicit `req.user` check below remains as defense-in-depth so
  // the handler never reads `undefined.id`.

  @Can("read", "Session")
  @Get()
  async list(@Req() req: AuthedRequest): Promise<DeviceListItem[]> {
    if (!req.user) throw new ForbiddenException("authentication required");
    const sessions = await this.prisma.session.findMany({
      where: { userId: req.user.id },
      orderBy: { updatedAt: "desc" },
    });
    return sessions.map((s, idx) => ({
      id: s.id,
      // Recompute the label on read so a UA-parser upgrade picks
      // up the new mapping without backfilling. Cheap (parser is
      // pure) and the row count per user is bounded by maxDevices.
      deviceLabel: parseUserAgent(s.userAgent ?? "").label,
      ipAddress: s.ipAddress ?? null,
      lastSeenAt: s.updatedAt.toISOString(),
      // Topmost (most recent activity) is the user's current
      // session in the absence of a session-id projection on req.
      current: idx === 0,
    }));
  }

  @Can("delete", "Session")
  @Delete(":id")
  async revoke(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
  ): Promise<{ revoked: true; id: string }> {
    if (!req.user) throw new ForbiddenException("authentication required");
    // Defense-in-depth: load the session first and verify it
    // belongs to the requester. Otherwise a forged id could revoke
    // someone else's session.
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session || session.userId !== req.user.id) {
      throw new NotFoundException(`session ${id} not found`);
    }
    await this.prisma.session.delete({ where: { id } });
    return { revoked: true, id };
  }
}

/**
 * Tiny diagnostic helper — the dev-portal device list page imports
 * this so the renderer can show the fingerprint hash alongside the
 * label without re-implementing the composition. Kept here (rather
 * than as a separate file) because it's a one-liner with the same
 * domain home.
 */
export function fingerprintForDisplay(
  userAgent: string | null,
  ipAddress: string | null,
  mode: "userAgent+ipSubnet" | "userAgent",
): string {
  return fingerprintSession({ userAgent: userAgent ?? "", ip: ipAddress ?? "", mode });
}
