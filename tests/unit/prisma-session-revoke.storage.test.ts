import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildSessionListWhere,
  mapPrismaSessionRow,
} from "../../src/core/auth/prisma-session-revoke.storage.js";

describe("PrismaSessionRevokeStorage helpers", () => {
  it("buildSessionListWhere returns undefined without a tenant scope", () => {
    expect(buildSessionListWhere(undefined)).toBeUndefined();
    expect(buildSessionListWhere(null)).toBeUndefined();
    expect(buildSessionListWhere("  ")).toBeUndefined();
  });

  it("buildSessionListWhere scopes by activeOrganizationId", () => {
    expect(buildSessionListWhere("org-1")).toEqual({ activeOrganizationId: "org-1" });
  });

  it("mapPrismaSessionRow maps planner fields and falls back tenantId", () => {
    const mapped = mapPrismaSessionRow({
      id: "s1",
      userId: "u1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      activeOrganizationId: "org-1",
    });
    expect(mapped).toEqual({
      id: "s1",
      userId: "u1",
      createdAt: Date.parse("2026-01-01T00:00:00.000Z"),
      tenantId: "org-1",
    });
  });

  it("mapPrismaSessionRow uses UNKNOWN when the session has no active org", () => {
    expect(
      mapPrismaSessionRow({
        id: "s2",
        userId: "u2",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        activeOrganizationId: null,
      }).tenantId,
    ).toBe("UNKNOWN");
  });
});

describe("SessionsAdminModule wiring", () => {
  it("uses PrismaSessionRevokeStorage instead of the empty-list noop", () => {
    const src = readFileSync(
      resolve(import.meta.dirname, "../../src/core/auth/sessions-admin.module.ts"),
      "utf8",
    );
    expect(src).toContain("PrismaSessionRevokeStorage");
    expect(src).toContain("new PrismaSessionRevokeStorage(prisma)");
    expect(src).not.toContain("listAllSessions: async (_tenantId?: string) => []");
  });
});
