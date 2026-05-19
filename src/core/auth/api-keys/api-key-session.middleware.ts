import { Injectable, type NestMiddleware, Optional } from "@nestjs/common";
import type { NextFunction, Response } from "express";

import { PrismaService } from "../../prisma/prisma.service.js";
import type { AuthenticatedRequest } from "../session-middleware.js";
import { getRequestContext } from "../../request-context/request-context.js";
import { ApiKeyInvalidError, ApiKeyService } from "./api-key.service.js";

const API_KEY_PREFIX = "nst_pk_";

/**
 * Authenticates `Authorization: Bearer nst_pk_…` when no Better-Auth
 * session is present. Sets `req.user.scopes` for downstream CASL
 * intersection in `AbilityMiddleware`.
 */
@Injectable()
export class ApiKeySessionMiddleware implements NestMiddleware {
  constructor(
    @Optional() private readonly apiKeys: ApiKeyService | null,
    @Optional() private readonly prisma: PrismaService | null,
  ) {}

  async use(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
    if (req.user || !this.apiKeys) {
      next();
      return;
    }

    const token = extractBearerToken(req.headers.authorization);
    if (!token?.startsWith(API_KEY_PREFIX)) {
      next();
      return;
    }

    try {
      const verified = await this.apiKeys.verifyKey(token);
      const tenantId = await this.resolveTenantId(verified.userId, req);
      req.user = {
        id: verified.userId,
        tenantId,
        scopes: [...verified.scopes],
      };
      const ctx = getRequestContext();
      if (ctx) {
        ctx.userId = verified.userId;
      }
    } catch (err) {
      if (!(err instanceof ApiKeyInvalidError)) {
        throw err;
      }
    }
    next();
  }

  private async resolveTenantId(
    userId: string,
    req: AuthenticatedRequest,
  ): Promise<string | null> {
    const header = req.headers["x-tenant-id"];
    if (typeof header === "string" && header.length > 0) {
      return header;
    }
    if (!this.prisma) return null;
    const member = await this.prisma.member.findFirst({
      where: { userId },
      select: { organizationId: true },
      orderBy: { createdAt: "asc" },
    });
    return member?.organizationId ?? null;
  }
}

function extractBearerToken(header: unknown): string | null {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}
