import type { PermissionStorage } from './permission.service.js';

/** DI token for the PermissionStorage adapter (Prisma in prod, stub in tests). */
export const PERMISSION_STORAGE = Symbol.for('lt:PermissionStorage');

export type { PermissionStorage };
