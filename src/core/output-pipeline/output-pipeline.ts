import type { Ability } from "../permissions/casl-ability.js";
import { removeSecrets } from "./remove-secrets.js";
import { applySafetyNet, type SafetyNetMode } from "./safety-net.js";
import { SECRET_FIELD_NAMES } from "./secret-field-names.js";

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

  /**
   * Run the output pipeline over `value` for the given `subject`.
   *
   * Stage 1 (record-level access): caller's responsibility — use
   * `prisma.model.findMany({ where: accessibleBy(ability) })` before
   * calling run(). This method does NOT perform record-level filtering.
   *
   * Stages 2–4 are applied here in order.
   */
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
    let union: Set<string> | null = null;
    let sawWithoutFields = false;
    for (const rule of raw) {
      // MAJ-2: Deny-rules (inverted) must NOT contribute to the allow-union.
      // `cannot("read", "User", ["ssn"])` sets `rule.inverted = true`.
      // Including its fields here would mistakenly expose them as allowed.
      if (rule.inverted) continue;
      if (!rule.fields || rule.fields.length === 0) {
        sawWithoutFields = true;
        continue;
      }
      if (!union) {
        union = new Set(rule.fields);
      } else {
        for (const f of rule.fields) union.add(f);
      }
    }
    // If any allow-rule grants the subject without a field constraint, no
    // allowlist applies — the subject is fully readable.
    if (sawWithoutFields) return null;
    return union ? Array.from(union) : null;
  }
}

// NIT-1: Use the shared constant — single source of truth for all three
// output-pipeline stages.
const DEFAULTS_FOR_SAFETY_NET = SECRET_FIELD_NAMES;

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
