import type { betterAuth } from "better-auth";

/**
 * DI token for the Better-Auth instance. Controllers + middleware
 * inject this to access the `auth.handler` or auth API helpers.
 */
export const BETTER_AUTH_INSTANCE = Symbol.for("lt:BetterAuthInstance");

export type BetterAuthInstance = ReturnType<typeof betterAuth>;
