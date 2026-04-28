/**
 * Output-Pipeline Stage 4 · Safety-Net.
 *
 * Stage 3 (`removeSecrets`) strips known secret keys; this stage is
 * the regression-catcher that runs AFTER. If a secret-named key
 * survives the strip, the safety-net either masks it (`mask` mode) or
 * throws a `SafetyNetViolationError` (`throw` mode). Production keeps
 * `throw` so leaks are visible in logs and tests.
 */

export const DEFAULT_SECRET_FIELD_NAMES = [
  'password',
  'passwordHash',
  'token',
  'apiKey',
  'secret',
  'authToken',
  'refreshToken',
  'sessionToken',
  'pinHash',
  'mfaSecret',
] as const;

export class SafetyNetViolationError extends Error {
  constructor(public readonly field: string) {
    super(`output-pipeline safety-net: secret-named field "${field}" leaked`);
    this.name = 'SafetyNetViolationError';
  }
}

export type SafetyNetMode = 'mask' | 'throw';

export interface SafetyNetOptions {
  mode: SafetyNetMode;
  fields?: readonly string[];
}

export function containsSecretField(value: unknown, fields: readonly string[]): boolean {
  return walkForSecret(value, normalize(fields)) !== null;
}

export function applySafetyNet(value: unknown, options: SafetyNetOptions): unknown {
  const fields = normalize(options.fields ?? DEFAULT_SECRET_FIELD_NAMES);

  if (options.mode === 'throw') {
    const hit = walkForSecret(value, fields);
    if (hit !== null) throw new SafetyNetViolationError(hit);
    return value;
  }

  return walkAndMask(value, fields);
}

function normalize(fields: readonly string[]): Set<string> {
  return new Set(fields.map((f) => f.toLowerCase()));
}

function walkForSecret(value: unknown, fields: Set<string>): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = walkForSecret(item, fields);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (fields.has(key.toLowerCase())) return key;
      const hit = walkForSecret(child, fields);
      if (hit !== null) return hit;
    }
  }
  return null;
}

function walkAndMask(value: unknown, fields: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((v) => walkAndMask(v, fields));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = fields.has(key.toLowerCase()) ? '[redacted]' : walkAndMask(child, fields);
    }
    return out;
  }
  return value;
}
