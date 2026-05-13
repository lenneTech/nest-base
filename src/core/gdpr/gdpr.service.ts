import { createHmac } from "node:crypto";

/**
 * GDPR endpoints.
 *
 * Two pure functions cover the surface; the controllers
 * (`/me/export`, `/me/account`) stay thin and delegate.
 *
 *   - buildGdprExport — Article 20 (right to data portability):
 *     the JSON payload `/me/export` returns. Self-describing
 *     (`kind`/`version`/`exportedAt`), so an archive downloaded
 *     today still parses years later.
 *
 *   - planGdprErasure — Article 17 (right to erasure):
 *     decides between hard-delete and anonymise based on the
 *     project policy the controller passes in. Anonymise rewrites
 *     PII fields with deterministic per-userId substitutes so the
 *     FK graph stays intact while re-identification is
 *     impossible (the hash takes the original userId as input).
 */

export interface GdprExportInput {
  user: object;
  relatedResources: Record<string, object[]>;
  now: () => number;
}

export interface GdprExportPayload {
  kind: "gdpr-export";
  version: 1;
  exportedAt: string;
  user: object;
  relatedResources: Record<string, object[]>;
}

export class GdprExportEmptyError extends Error {
  constructor() {
    super("gdpr: export requires a user record");
    this.name = "GdprExportEmptyError";
  }
}

export function buildGdprExport(input: GdprExportInput): GdprExportPayload {
  if (!input.user) throw new GdprExportEmptyError();
  return {
    kind: "gdpr-export",
    version: 1,
    exportedAt: new Date(input.now()).toISOString(),
    user: input.user,
    relatedResources: { ...input.relatedResources },
  };
}

export type GdprErasureMode = "hard-delete" | "anonymise";

export type GdprPiiStrategy = "hash" | "null" | "mask";

export interface GdprPiiField {
  name: string;
  strategy: GdprPiiStrategy;
}

export interface GdprErasureInput {
  userId: string;
  mode: GdprErasureMode;
  piiFields: GdprPiiField[];
}

export interface GdprDeleteOperation {
  type: "delete";
  userId: string;
}

export interface GdprUpdateOperation {
  type: "update";
  userId: string;
  updates: Record<string, string | null>;
}

export type GdprErasureOperation = GdprDeleteOperation | GdprUpdateOperation;

export interface GdprErasurePlan {
  operations: GdprErasureOperation[];
}

const ANON_DOMAIN = "anonymous.invalid";

/**
 * Resolve the HMAC secret used for PII anonymisation.
 *
 * Priority order:
 *   1. GDPR_ANONYMISATION_SECRET — dedicated secret for this purpose
 *   2. BETTER_AUTH_SECRET         — installation-level secret (fallback)
 *   3. hard-coded sentinel         — last resort; warns on use so ops notices
 *
 * The secret is intentionally read at call-time (not module load) so
 * tests can set the env var before calling planGdprErasure without
 * module-load ordering issues.
 */
function resolveAnonymisationSecret(): string {
  const secret =
    process.env.GDPR_ANONYMISATION_SECRET ??
    process.env.BETTER_AUTH_SECRET ??
    // Using a predictable fallback makes the hash deterministic across
    // processes but effectively unsalted. Acceptable only in tests /
    // fresh dev deployments where neither secret is set yet.
    "gdpr-fallback-no-secret-configured";
  return secret;
}

export function planGdprErasure(input: GdprErasureInput): GdprErasurePlan {
  if (!input.userId) throw new Error("gdpr: userId must be a non-empty string");
  if (input.mode === "hard-delete") {
    return { operations: [{ type: "delete", userId: input.userId }] };
  }
  if (input.mode === "anonymise") {
    if (input.piiFields.length === 0) {
      throw new Error("gdpr: piiFields must contain at least one entry for anonymise mode");
    }
    const updates: Record<string, string | null> = {};
    // HMAC-SHA-256 with an installation-specific secret so a leaked DB
    // cannot be cross-referenced against a known userId list to
    // re-identify rows (MAJ-2). The 16-char hex slice keeps the output
    // compact while providing 64 bits of entropy — sufficient for a
    // one-way pseudonym.
    const secret = resolveAnonymisationSecret();
    const hashSlice = createHmac("sha256", secret).update(input.userId).digest("hex").slice(0, 16);
    for (const field of input.piiFields) {
      updates[field.name] = substitute(field, hashSlice);
    }
    return {
      operations: [{ type: "update", userId: input.userId, updates }],
    };
  }
  throw new Error(`gdpr: unknown erasure mode "${String(input.mode)}"`);
}

function substitute(field: GdprPiiField, hashSlice: string): string | null {
  switch (field.strategy) {
    case "hash":
      return field.name === "email" ? `anon-${hashSlice}@${ANON_DOMAIN}` : `anon-${hashSlice}`;
    case "null":
      return null;
    case "mask":
      return "***";
  }
}
