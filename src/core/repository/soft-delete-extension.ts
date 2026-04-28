/**
 * Soft-Delete Prisma extension helpers (PLAN.md §32 Phase 3).
 *
 * Pure functions that the Prisma client extension consumes:
 *   - `addSoftDeleteFilter(args, opts)` adds `deletedAt: null` to every
 *     read so direct `prisma.<model>.findMany()` callers don't see
 *     tombstones (BaseRepository handles the same on its surface).
 *   - `convertDeleteToSoftDelete(args, now)` rewrites a destructive
 *     delete to an update that stamps `deletedAt`.
 *   - `convertRestoreToUpdate(args)` is the inverse — clears
 *     `deletedAt` to revive a tombstoned row.
 *   - `isHardDeleteRequest(args)` distinguishes the explicit HARD_DELETE
 *     escape hatch (`{ hardDelete: true }`) from a regular delete.
 *
 * Splitting the logic into pure helpers lets the unit suite cover all
 * branches without spinning up a Prisma client; the extension binding
 * is a thin shell that calls these and forwards to the underlying
 * model delegate.
 */

export interface FindArgs {
  where?: Record<string, unknown>;
}

export interface DeleteArgs {
  where: Record<string, unknown>;
  /** Explicit escape hatch — `true` triggers a real DELETE. */
  hardDelete?: boolean;
}

export interface UpdateArgs {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
}

export interface SoftDeleteOptions {
  includeDeleted: boolean;
}

export function addSoftDeleteFilter(args: FindArgs, options: SoftDeleteOptions): FindArgs {
  if (options.includeDeleted) return { ...args };
  if (!args.where || Object.keys(args.where).length === 0) {
    return { ...args, where: { deletedAt: null } };
  }
  return { ...args, where: { AND: [args.where, { deletedAt: null }] } };
}

export function convertDeleteToSoftDelete(args: DeleteArgs, now: Date): UpdateArgs {
  return {
    where: args.where,
    data: { deletedAt: now },
  };
}

export function convertRestoreToUpdate(args: { where: Record<string, unknown> }): UpdateArgs {
  return {
    where: args.where,
    data: { deletedAt: null },
  };
}

export function isHardDeleteRequest(args: DeleteArgs): boolean {
  return args.hardDelete === true;
}
