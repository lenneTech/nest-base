/**
 * Setup-wizard runner planner (PLAN.md §19.5 + Phase 7 follow-up).
 *
 * Pure function: takes the `.env.example` text + an injectable RNG,
 * returns the rendered `.env` text with every recognised placeholder
 * replaced by a fresh secret. The thin runner in
 * `scripts/setup-wizard.ts` does the file I/O.
 *
 * Three properties locked in:
 *   - Recognised placeholders (BETTER_AUTH_SECRET, POSTGRES_PASSWORD,
 *     POWERSYNC_DB_PASSWORD, FIELD_ENCRYPTION_KEK, S3_SECRET_KEY) get
 *     freshly random values — never the example placeholder.
 *   - DATABASE_URL is rewritten to use the freshly generated
 *     POSTGRES_PASSWORD so the URL stays in sync with the DSN parts.
 *   - Unknown lines (comments, blank lines, custom vars added by the
 *     project) pass through untouched. Future contributors can add new
 *     env vars without the runner silently dropping them.
 */

export type RandomBytesFn = (size: number) => Buffer;

export interface PlanEnvFromExampleOptions {
  randomBytes: RandomBytesFn;
}

interface SecretSpec {
  /** Bytes of entropy to draw. */
  bytes: number;
  /** Output encoding for the secret value. */
  encoding: 'base64url' | 'base64' | 'hex';
}

const SECRET_VARS: Record<string, SecretSpec> = {
  BETTER_AUTH_SECRET: { bytes: 32, encoding: 'base64url' },
  POSTGRES_PASSWORD: { bytes: 24, encoding: 'base64url' },
  POWERSYNC_DB_PASSWORD: { bytes: 24, encoding: 'base64url' },
  FIELD_ENCRYPTION_KEK: { bytes: 32, encoding: 'base64' },
  S3_SECRET_KEY: { bytes: 24, encoding: 'base64url' },
};

export function planEnvFromExample(
  exampleText: string,
  options: PlanEnvFromExampleOptions,
): string {
  const generated: Record<string, string> = {};
  const lines = exampleText.split('\n');
  const out: string[] = [];

  for (const line of lines) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) {
      out.push(line);
      continue;
    }
    const [, key, value] = match;
    const spec = SECRET_VARS[key!];
    if (spec) {
      const secret = encodeBytes(options.randomBytes(spec.bytes), spec.encoding);
      generated[key!] = secret;
      out.push(`${key}=${secret}`);
      continue;
    }
    if (key === 'DATABASE_URL' && generated.POSTGRES_PASSWORD && value) {
      // Replace the example POSTGRES_PASSWORD inside the URL with the
      // freshly generated one. Other parts (user, host, port, db) are
      // left intact so the operator's own choices survive.
      const rewritten = value!.replace(/change-me-strong-pass/g, generated.POSTGRES_PASSWORD);
      out.push(`${key}=${rewritten}`);
      continue;
    }
    out.push(line);
  }

  const joined = out.join('\n');
  return joined.endsWith('\n') ? joined : joined + '\n';
}

function encodeBytes(buf: Buffer, encoding: SecretSpec['encoding']): string {
  if (encoding === 'base64') return buf.toString('base64');
  if (encoding === 'hex') return buf.toString('hex');
  // base64url — Node's Buffer accepts the encoding directly.
  return buf.toString('base64url');
}
