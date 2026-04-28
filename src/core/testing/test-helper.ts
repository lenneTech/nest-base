import { randomFillSync } from 'node:crypto';

/**
 * Generate a UUID v7 (RFC 9562) — time-ordered, monotonic-ish.
 *
 * Fills 16 bytes with CSPRNG randomness, then overwrites the first 6 bytes
 * with the current millisecond timestamp and the version/variant nibbles.
 * No external dependency until `pg_uuidv7` is wired up server-side.
 */
function uuidV7(): string {
  const bytes = new Uint8Array(16);
  randomFillSync(bytes);

  const ms = BigInt(Date.now());
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);

  // version = 7 in high nibble of byte 6
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  // variant = RFC4122 (10xx) in high bits of byte 8
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex: string[] = [];
  for (const b of bytes) hex.push(b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

export type CleanupFn = () => void | Promise<void>;
export type IdDeleter = (id: string) => void | Promise<void>;

interface TrackedId {
  resource: string;
  id: string;
  deleter: IdDeleter;
}

/**
 * TestHelper — parallel-safe primitives for E2E/Story tests.
 *
 * Why a per-test helper instance: parallel test files share the same DB.
 * The helper owns a unique suffix (`uniqueId()`) used in emails / handles
 * to keep records disjoint, and an LIFO cleanup registry so created
 * entities are removed in reverse-creation order regardless of failures.
 */
export class TestHelper {
  readonly id: string = uuidV7();
  private cleanups: CleanupFn[] = [];
  private trackedById = new Map<string, TrackedId[]>();

  uniqueId(): string {
    return uuidV7();
  }

  uniqueEmail(localPart = 'user'): string {
    return `${localPart}+${this.id}@test.com`;
  }

  registerForCleanup(fn: CleanupFn): void {
    this.cleanups.push(fn);
  }

  trackId(resource: string, id: string, deleter: IdDeleter): void {
    let list = this.trackedById.get(resource);
    if (!list) {
      list = [];
      this.trackedById.set(resource, list);
    }
    list.push({ resource, id, deleter });

    this.cleanups.push(async () => deleter(id));
  }

  trackedIds(resource: string): string[] {
    const list = this.trackedById.get(resource);
    return list ? list.map((entry) => entry.id) : [];
  }

  /**
   * Run all registered cleanups in reverse order. Failures are swallowed
   * so a single bad teardown does not leak other resources. Drains the
   * registry — a second `cleanup()` is a noop.
   */
  async cleanup(): Promise<void> {
    const queue = this.cleanups.slice().reverse();
    this.cleanups = [];
    this.trackedById.clear();

    for (const fn of queue) {
      try {
        await fn();
      } catch {
        // intentionally swallow — leaking a single resource beats aborting cleanup
      }
    }
  }
}
