/**
 * Dependency-injection tokens for the Example module.
 *
 * Symbols (not strings) are the convention here because they're
 * unique by reference: there's no risk of two unrelated providers
 * collising on the same string key, and refactor-rename works
 * because the token only exists in one place.
 *
 * The token decouples `ExampleService` from any specific repository
 * implementation. The module wires either the Prisma-backed one
 * (production) or the in-memory one (tests / cold-boot dev) — the
 * service never knows which.
 */

export const EXAMPLE_REPOSITORY = Symbol.for("lt:ExampleRepository");
