/**
 * Tenant self-service DTOs — Zod schemas as the single source of truth.
 *
 * Exists to flip the SDK type generation from `unknown` to a typed
 * row shape. The `tenant-self-service.module.ts` controllers used to
 * accept raw `@Body()` and return inline-typed objects; the kubb
 * SDK generator therefore wrote `meTenantsControllerList(): unknown`
 * and forced the frontend to hand-cast to the row shape — exactly
 * the escape hatch the project's "Backend Types: Generated only"
 * rule forbids. Routing the routes through these schemas via the
 * `@ApiZod*` bridge produces a typed contract end-to-end.
 *
 * The shapes here MIRROR the runtime objects the existing
 * controller / service emits today (see `MeTenantsResponseRow` and
 * `CreateTenantResponse` in `tenant-self-service.module.ts` before
 * this migration). No field added, no field removed.
 */

import { z } from "zod";

/**
 * `TenantMemberStatus` mirrors the type union the service exposes
 * (`"ACTIVE" | "INVITED" | "SUSPENDED"`). Repeating it as a Zod enum
 * here (instead of importing the union type) is intentional: the SDK
 * emits an enum at the boundary so frontend consumers get string-
 * literal narrowing without an extra import.
 */
export const TenantMemberStatusSchema = z.enum(["ACTIVE", "INVITED", "SUSPENDED"]);
export type TenantMemberStatusDto = z.infer<typeof TenantMemberStatusSchema>;

/**
 * Body for `POST /tenants`.
 *
 * The previous handler accepted `body?.name: unknown` and coerced
 * non-strings to `""`. The schema below makes the same contract
 * explicit: `name` is a required string. Validation now runs at the
 * boundary (Zod) and surfaces field-level errors as
 * `CORE_VALIDATION` problem-details — so the SDK consumer sees a
 * typed body and a typed failure shape.
 */
export const CreateTenantRequestSchema = z.object({
  // Trim before length-check: a whitespace-only name (legacy
  // bug-class) must land as a CORE_VALIDATION 400, not bypass the
  // pipe. `.refine` keeps the failure shape consistent with all
  // other Zod-validated boundaries.
  name: z
    .string()
    .max(255)
    .refine((s) => s.trim().length > 0, {
      message: "tenant name is required",
    }),
});
export type CreateTenantRequestDto = z.infer<typeof CreateTenantRequestSchema>;

/**
 * Membership stamp returned on the freshly-created tenant. `joinedAt`
 * is optional because the runtime conditionally spreads it when set;
 * the response carrier preserves the legacy "absent === undefined"
 * semantics rather than coercing to `null` (which would change the
 * snapshot for existing consumers).
 */
export const TenantMembershipStampSchema = z.object({
  id: z.uuid(),
  role: z.string(),
  status: TenantMemberStatusSchema,
  joinedAt: z.string().optional(),
});

/**
 * Response for `POST /tenants` — the created tenant + the owner
 * membership stamp. Mirrors the legacy `CreateTenantResponse`
 * interface byte-for-byte.
 */
export const CreateTenantResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.string(),
  membership: TenantMembershipStampSchema,
});
export type CreateTenantResponseDto = z.infer<typeof CreateTenantResponseSchema>;

/**
 * One row of the `GET /me/tenants` response.
 *
 * Why optional `invitedAt` / `joinedAt`: the legacy handler spreads
 * each timestamp only when the underlying `TenantWithMembership`
 * carries one — `invitedAt` is absent for self-service-created
 * tenants (no invite step), `joinedAt` is absent for INVITED
 * memberships that haven't been accepted yet. Modelling them as
 * `.optional()` (omit when absent) instead of `.nullable()` (always
 * present, possibly `null`) keeps the on-the-wire shape unchanged.
 */
export const MeTenantsRowSchema = z.object({
  tenantId: z.uuid(),
  tenantName: z.string(),
  tenantCreatedAt: z.string(),
  memberId: z.uuid(),
  role: z.string(),
  status: TenantMemberStatusSchema,
  invitedAt: z.string().optional(),
  joinedAt: z.string().optional(),
});
export type MeTenantsRowDto = z.infer<typeof MeTenantsRowSchema>;

/** Top-level response shape for `GET /me/tenants` — array of rows. */
export const MeTenantsResponseSchema = z.array(MeTenantsRowSchema);
export type MeTenantsResponseDto = z.infer<typeof MeTenantsResponseSchema>;
