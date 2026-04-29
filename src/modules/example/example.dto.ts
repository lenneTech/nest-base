/**
 * Example DTO — Zod schemas as the single source of truth.
 *
 * Zod schemas drive: runtime validation (via the global ZodValidationPipe),
 * OpenAPI schema generation (Swagger reads the inferred shape), and
 * compile-time TypeScript types (`z.infer<typeof X>`).
 *
 * When you copy this module:
 *   - Replace `Example` with your resource name
 *   - Tighten the validation rules (min/max, regex, refinements)
 *   - Keep the schema near the consumer — DTOs colocate with the module
 */

import { z } from "zod";

export const ExampleStatusSchema = z.enum(["draft", "published", "archived"]);
export type ExampleStatus = z.infer<typeof ExampleStatusSchema>;

/** Body for POST /examples — server fills id + tenantId + timestamps. */
export const CreateExampleSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  status: ExampleStatusSchema.default("draft"),
});
export type CreateExampleDto = z.infer<typeof CreateExampleSchema>;

/** Body for PATCH /examples/:id — every field optional. */
export const UpdateExampleSchema = CreateExampleSchema.partial();
export type UpdateExampleDto = z.infer<typeof UpdateExampleSchema>;

/** Query params for GET /examples — basic cursor pagination + filter. */
export const ListExampleQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: ExampleStatusSchema.optional(),
});
export type ListExampleQuery = z.infer<typeof ListExampleQuerySchema>;

/** Public response shape — no internal fields leak. */
export const ExampleResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: ExampleStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ExampleResponse = z.infer<typeof ExampleResponseSchema>;
