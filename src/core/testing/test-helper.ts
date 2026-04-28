import { uuidV7 } from '../uuid/uuid-v7.js';

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
