/**
 * portless integration (PLAN.md §28.10/#30).
 *
 * Pure functions used by `scripts/dev.ts` to decide whether to boot
 * portless and which port to bind. Side-effecting binary lookup +
 * process spawning live in the script — these helpers stay pure so
 * tests can exercise them without touching the filesystem or env.
 */

export interface ShouldUsePortlessInput {
  /** Absolute path to the portless binary, or `undefined` if not on PATH. */
  portlessPath: string | undefined;
  /** Explicit override (`DISABLE_PORTLESS=1`) — wins over `portlessPath`. */
  disable?: boolean;
}

export function shouldUsePortless(input: ShouldUsePortlessInput): boolean {
  if (input.disable) return false;
  return input.portlessPath !== undefined && input.portlessPath !== '';
}

export interface ResolveDevPortInput {
  env: { PORT?: string };
  portlessAvailable: boolean;
}

const PORTLESS_DEFAULT_PORT = 3000;

/**
 * Resolve the port for the dev server.
 *
 * - explicit `PORT` env-var → use it
 * - portless available     → bind the conventional 3000 (portless routes
 *                            api.nst.localhost → :3000)
 * - portless missing       → bind 0 (dynamic) so multiple checkouts coexist
 */
export function resolveDevPort(input: ResolveDevPortInput): number {
  const raw = input.env.PORT;
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new Error(`PORT must be an integer (received: ${raw})`);
    }
    return n;
  }
  return input.portlessAvailable ? PORTLESS_DEFAULT_PORT : 0;
}
