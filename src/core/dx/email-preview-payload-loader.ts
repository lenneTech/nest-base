/**
 * Resolves preview payloads for Hub email surfaces from real sources:
 * latest `email_outbox` sendTemplate vars, else brand `appName` only.
 */

import type { PrismaService } from "../prisma/prisma.service.js";

export type EmailPreviewPayloadSource = "outbox" | "brand";

export interface ResolvedEmailPreviewPayload {
  payload: Record<string, string>;
  source: EmailPreviewPayloadSource;
}

/** Brand-only fallback — no fabricated recipient names or URLs. */
export function buildBrandOnlyPreviewPayload(appName: string): Record<string, string> {
  return { appName };
}

export function mergePreviewPayload(
  brand: Record<string, string>,
  outbox?: Record<string, string>,
): Record<string, string> {
  return { ...brand, ...outbox };
}

export function stringifyPreviewVars(vars: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (value === null || value === undefined) continue;
    out[key] = typeof value === "string" ? value : String(value);
  }
  return out;
}

/** Parses a persisted EmailOutbox `payload` JSON blob (sendTemplate shape). */
export function extractSendTemplateVarsFromOutboxPayload(
  payload: unknown,
): { template: string; vars: Record<string, string> } | null {
  if (payload === null || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  if (typeof row.template !== "string" || row.template.length === 0) return null;
  const varsRaw = row.vars;
  if (varsRaw === null || varsRaw === undefined) {
    return { template: row.template, vars: {} };
  }
  if (typeof varsRaw !== "object" || Array.isArray(varsRaw)) {
    return { template: row.template, vars: {} };
  }
  return {
    template: row.template,
    vars: stringifyPreviewVars(varsRaw as Record<string, unknown>),
  };
}

export async function loadLatestOutboxVarsByTemplate(
  prisma: PrismaService,
): Promise<Map<string, Record<string, string>>> {
  try {
    const rows = await prisma.emailOutbox.findMany({
      where: { kind: "SEND_TEMPLATE" },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
      take: 500,
    });
    const map = new Map<string, Record<string, string>>();
    for (const row of rows) {
      const parsed = extractSendTemplateVarsFromOutboxPayload(row.payload);
      if (!parsed || map.has(parsed.template)) continue;
      if (Object.keys(parsed.vars).length === 0) continue;
      map.set(parsed.template, parsed.vars);
    }
    return map;
  } catch {
    return new Map();
  }
}

export function resolveEmailPreviewPayload(
  template: string,
  brandAppName: string,
  outboxByTemplate: Map<string, Record<string, string>>,
): ResolvedEmailPreviewPayload {
  const brand = buildBrandOnlyPreviewPayload(brandAppName);
  const outbox = outboxByTemplate.get(template);
  if (outbox && Object.keys(outbox).length > 0) {
    return { payload: mergePreviewPayload(brand, outbox), source: "outbox" };
  }
  return { payload: brand, source: "brand" };
}
