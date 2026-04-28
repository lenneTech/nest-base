/**
 * In-process slot-reservation registry.
 *
 * Two concurrent sign-ups for the same email must not both create
 * users. The DB unique-index is the ultimate guarantor; this registry
 * is the cheap first-line defense that fails fast inside one process,
 * before the second request hits Postgres.
 */

export type ReserveResult = 'reserved' | 'busy';

export class ParallelSignupRegistry {
  private readonly reserved = new Set<string>();

  async tryReserve(key: string): Promise<ReserveResult> {
    if (this.reserved.has(key)) return 'busy';
    this.reserved.add(key);
    return 'reserved';
  }

  release(key: string): void {
    this.reserved.delete(key);
  }
}
