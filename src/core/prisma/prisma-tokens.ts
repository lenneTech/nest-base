/**
 * DI token that lets project modules extend the auditable-models list
 * without editing template-owned code in `prisma.service.ts`.
 *
 * Usage (project module or AppModule):
 *
 * ```ts
 * import { EXTRA_AUDITABLE_MODELS } from "../core/prisma/prisma-tokens.js";
 *
 * @Module({
 *   providers: [
 *     { provide: EXTRA_AUDITABLE_MODELS, useValue: ["Todo", "Invoice"] },
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * Only one provider per application is supported — the token resolves
 * to a single `string[]`. If multiple feature modules each need to
 * contribute names, collect them in a single AppModule-level provider.
 * The injected list is merged with the framework-managed defaults
 * (`CORE_AUDITABLE_MODELS` inside `PrismaService`) before the audit
 * extension is built.
 *
 * When no provider is registered, `@Optional()` in `PrismaService`
 * defaults to an empty array — zero config required for projects that
 * don't opt into project-level audit tracking.
 */
export const EXTRA_AUDITABLE_MODELS = "EXTRA_AUDITABLE_MODELS";
