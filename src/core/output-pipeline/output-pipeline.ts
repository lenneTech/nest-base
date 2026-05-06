import type { Ability } from "../permissions/casl-ability.js";
import { removeSecrets } from "./remove-secrets.js";
import { applySafetyNet, type SafetyNetMode } from "./safety-net.js";

/**
 * Output-Pipeline.
 *
 * Four stages, run in order over the response body:
 *   1. Permission filter   — record-level access (caller-side; the
 *                             accessibleBy() filter ran at the DB layer)
 *   2. Field allowlist     — drop fields the ability doesn't permit
 *                             for the given (read, subject)
 *   3. Strip secrets       — known secret-named keys (DEFAULT_SECRET_FIELDS)
 *   4. Safety net          — regression catch in throw|mask mode
 */

export type SubjectType = string;

export interface OutputPipelineOptions {
  ability: Ability;
  /** Default 'throw' for production-grade fail-loud, 'mask' for dev. */
  safetyNetMode?: SafetyNetMode;
  /** Extra field names the safety-net should treat as secret-shaped. */
  safetyNetExtraFields?: readonly string[];
}

export interface RunOptions {
  subject: SubjectType;
}

export class OutputPipeline {
  private readonly ability: Ability;
  private readonly safetyNetMode: SafetyNetMode;
  private readonly safetyNetExtraFields: readonly string[];

  constructor(options: OutputPipelineOptions) {
    this.ability = options.ability;
    this.safetyNetMode = options.safetyNetMode ?? "throw";
    this.safetyNetExtraFields = options.safetyNetExtraFields ?? [];
  }

  run(value: unknown, runOptions: RunOptions): unknown {
    // Stage 2 — field allowlist
    const stage2 = this.applyFieldAllowlist(value, runOptions.subject);
    // Stage 3 — strip secrets
    const stage3 = removeSecrets(stage2);
    // Stage 4 — safety net (extra-fields are merged with the default list)
    return applySafetyNet(stage3, {
      mode: this.safetyNetMode,
      ...(this.safetyNetExtraFields.length > 0 ? { fields: this.mergedSafetyFields() } : {}),
    });
  }

  private mergedSafetyFields(): string[] {
    // Lazy import the default list so consumers passing only `extra` get a
    // union of (default ∪ extra), not a replacement.
    return [...DEFAULTS_FOR_SAFETY_NET, ...this.safetyNetExtraFields];
  }

  private applyFieldAllowlist(value: unknown, subject: SubjectType): unknown {
    const fields = this.allowedFields(subject);
    if (fields === null) return value; // no field rule for this subject
    return walk(value, (obj) => pickFields(obj, fields));
  }

  private allowedFields(subject: SubjectType): string[] | null {
    // CASL's rule index is internal; we read the raw rules off the ability
    // for this subject and union the field arrays. Empty/undefined means
    // "no field-level constraint".
    type RulesForArgs = Parameters<typeof this.ability.rulesFor>;
    const raw = this.ability.rulesFor("read", subject as RulesForArgs[1]);
    let union: string[] | null = null;
    let sawWithoutFields = false;
    for (const rule of raw) {
      if (!rule.fields || rule.fields.length === 0) {
        sawWithoutFields = true;
        continue;
      }
      union = union ? Array.from(new Set([...union, ...rule.fields])) : [...rule.fields];
    }
    // If any rule grants the subject without a field constraint, no
    // allowlist applies.
    if (sawWithoutFields) return null;
    return union;
  }
}

const DEFAULTS_FOR_SAFETY_NET = [
  "password",
  "passwordHash",
  "token",
  "apiKey",
  "secret",
  "authToken",
  "refreshToken",
  "sessionToken",
  "pinHash",
  "mfaSecret",
];

function walk(
  value: unknown,
  transform: (obj: Record<string, unknown>) => Record<string, unknown>,
): unknown {
  if (Array.isArray(value)) return value.map((item) => walk(item, transform));
  if (value !== null && typeof value === "object")
    return transform(value as Record<string, unknown>);
  return value;
}

function pickFields(obj: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const allowed = new Set(fields);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (allowed.has(key)) out[key] = value;
  }
  return out;
}
