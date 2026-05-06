import { type PowerSyncConflictOutcome, resolvePowerSyncConflict } from "./powersync-conflict.js";

/**
 * BaseRepository.
 *
 * Wraps a Prisma-shaped `ModelDelegate<T>` and centralizes:
 *   - Soft-Delete filter (`deletedAt: null` by default; opt-out via
 *     `{ includeDeleted: true }`)
 *   - Type-safe CRUD surface for resource subclasses
 *   - Hooks for tenant-scoping (later iteration plugs the active
 *     tenant from `getCurrentTenantId()` into every where-clause)
 *
 * The `ModelDelegate` interface is intentionally a subset of the
 * Prisma model delegate — that lets tests pass an in-memory fake
 * without bringing up a real database, and lets the production
 * subclasses just hand over `prisma.user` / `prisma.project` / ….
 */

export interface FindUniqueArgs {
  where: { id: string };
}
export interface FindManyArgs {
  where?: Record<string, unknown>;
  orderBy?: Record<string, "asc" | "desc">;
  take?: number;
  skip?: number;
}
export interface CreateArgs<T> {
  data: T;
}
export interface UpdateArgs<T> {
  where: { id: string };
  data: Partial<T>;
}
export interface DeleteArgs {
  where: { id: string };
}

export interface ModelDelegate<T> {
  findUnique(args: FindUniqueArgs): Promise<T | null>;
  findMany(args?: FindManyArgs): Promise<T[]>;
  create(args: CreateArgs<T>): Promise<T>;
  update(args: UpdateArgs<T>): Promise<T>;
  delete(args: DeleteArgs): Promise<T>;
}

export interface ListOptions {
  /** When true, soft-deleted rows are NOT filtered out. */
  includeDeleted?: boolean;
  orderBy?: Record<string, "asc" | "desc">;
  take?: number;
  skip?: number;
}

export interface FindByIdOptions {
  includeDeleted?: boolean;
}

export class RepositoryNotFoundError extends Error {
  constructor(id: string) {
    super(`row not found: ${id}`);
    this.name = "RepositoryNotFoundError";
  }
}

interface SoftDeletable {
  deletedAt: Date | null;
}

export interface ConflictUpdateResult<T> {
  outcome: PowerSyncConflictOutcome;
  row: T;
  rejectedFields: string[];
}

export abstract class BaseRepository<T extends { id: string } & Partial<SoftDeletable>> {
  constructor(protected readonly delegate: ModelDelegate<T>) {}

  async findById(id: string, options: FindByIdOptions = {}): Promise<T | null> {
    const row = await this.delegate.findUnique({ where: { id } });
    if (!row) return null;
    if (!options.includeDeleted && this.isDeleted(row)) return null;
    return row;
  }

  async list(options: ListOptions = {}): Promise<T[]> {
    const args: FindManyArgs = {};
    if (!options.includeDeleted) {
      args.where = { deletedAt: null };
    }
    if (options.orderBy) args.orderBy = options.orderBy;
    if (options.take !== undefined) args.take = options.take;
    if (options.skip !== undefined) args.skip = options.skip;
    return this.delegate.findMany(args);
  }

  async create(data: T): Promise<T> {
    return this.delegate.create({ data });
  }

  async update(id: string, patch: Partial<T>): Promise<T> {
    try {
      return await this.delegate.update({ where: { id }, data: patch });
    } catch {
      throw new RepositoryNotFoundError(id);
    }
  }

  /**
   * PowerSync-aware update — delegates conflict resolution to
   * `resolvePowerSyncConflict()`. Use this
   * from the `/powersync/crud` upload-controller (or any other
   * offline-first writer) so a stale client's PATCH cannot overwrite
   * fresher server state and `protectedFields` are never overwritten.
   *
   * Outcomes:
   *   - `client-wins`      → patch applied, full row written
   *   - `server-wins`      → no write, returns the server row as-is
   *   - `partial-conflict` → patch applied minus protected fields,
   *                         caller is expected to surface the
   *                         `rejectedFields` array as a 409 to the client
   *   - `no-op`            → empty patch, no-op
   */
  async updateWithConflict(
    id: string,
    patch: Partial<T>,
    options: {
      clientUpdatedAt: Date;
      protectedFields?: ReadonlyArray<keyof T & string>;
    },
  ): Promise<ConflictUpdateResult<T>> {
    const existing = await this.delegate.findUnique({ where: { id } });
    if (!existing) throw new RepositoryNotFoundError(id);
    const decision = resolvePowerSyncConflict<T & { updatedAt?: Date }>({
      clientPatch: patch as Partial<T & { updatedAt?: Date }>,
      clientUpdatedAt: options.clientUpdatedAt,
      serverRow: existing as T & { updatedAt?: Date },
      protectedFields: (options.protectedFields ?? []) as ReadonlyArray<
        keyof (T & { updatedAt?: Date }) & string
      >,
    });
    if (decision.outcome === "no-op" || decision.outcome === "server-wins") {
      return {
        outcome: decision.outcome,
        row: existing,
        rejectedFields: decision.rejectedFields,
      };
    }
    const updated = await this.delegate.update({
      where: { id },
      data: decision.merged as Partial<T>,
    });
    return {
      outcome: decision.outcome,
      row: updated,
      rejectedFields: decision.rejectedFields,
    };
  }

  async softDelete(id: string): Promise<T> {
    return this.update(id, { deletedAt: new Date() } as Partial<T>);
  }

  async hardDelete(id: string): Promise<T> {
    try {
      return await this.delegate.delete({ where: { id } });
    } catch {
      throw new RepositoryNotFoundError(id);
    }
  }

  private isDeleted(row: T): boolean {
    return row.deletedAt instanceof Date;
  }
}
