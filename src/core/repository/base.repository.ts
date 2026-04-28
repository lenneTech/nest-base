/**
 * BaseRepository (PLAN.md §19.13).
 *
 * Wraps a Prisma-shaped `ModelDelegate<T>` and centralizes:
 *   - Soft-Delete filter (`deletedAt: null` by default; opt-out via
 *     `{ includeDeleted: true }`)
 *   - Type-safe CRUD surface for resource subclasses
 *   - Hooks for tenant-scoping (later iteration plugs the active
 *     tenant from `getCurrentTenantId()` into every where-clause)
 *
 * The `ModelDelegate` interface is intentionally a subset of the
 * Prisma model delegate — that lets tests pass an in-memory stub
 * without bringing up a real database, and lets the production
 * subclasses just hand over `prisma.user` / `prisma.project` / ….
 */

export interface FindUniqueArgs {
  where: { id: string };
}
export interface FindManyArgs {
  where?: Record<string, unknown>;
  orderBy?: Record<string, 'asc' | 'desc'>;
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
  orderBy?: Record<string, 'asc' | 'desc'>;
  take?: number;
  skip?: number;
}

export interface FindByIdOptions {
  includeDeleted?: boolean;
}

export class RepositoryNotFoundError extends Error {
  constructor(id: string) {
    super(`row not found: ${id}`);
    this.name = 'RepositoryNotFoundError';
  }
}

interface SoftDeletable {
  deletedAt: Date | null;
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
