import type { PermissionStorage } from "./permission.service.js";

/** DI token for the PermissionStorage adapter (Prisma in prod, fake in tests). */
export const PERMISSION_STORAGE = Symbol.for("lt:PermissionStorage");

export type { PermissionStorage };
