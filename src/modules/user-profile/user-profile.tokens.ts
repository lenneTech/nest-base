/**
 * DI token for the UserProfile module.
 *
 * Symbol-keyed so refactor-rename only touches this one file. The
 * service depends on the `UserProfileRepository` interface — the
 * module wires either Prisma or in-memory at startup.
 */

export const USER_PROFILE_REPOSITORY = Symbol.for("lt:UserProfileRepository");
