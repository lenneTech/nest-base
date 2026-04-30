import { z } from "zod";

/**
 * Error-Code conventions.
 *
 * Framework-level codes carry the `CORE_` prefix and live here. Project-level
 * apps add their own `APP_*` codes in `src/modules/`. The exception filter
 * (later slice) maps these into RFC 7807 `Problem Details` responses.
 *
 * The `type` URL is configurable via `ERROR_DOC_BASE_URL`; until the doc
 * site is live, we fall back to `/docs/errors/{code}` on the API server
 * itself (#23).
 */

export const CORE_ERROR_CODE_PREFIX = "CORE_" as const;

export const CORE_ERROR_CODES = {
  INTERNAL: "CORE_INTERNAL",
  NOT_FOUND: "CORE_NOT_FOUND",
  UNAUTHORIZED: "CORE_UNAUTHORIZED",
  FORBIDDEN: "CORE_FORBIDDEN",
  VALIDATION: "CORE_VALIDATION",
  CONFLICT: "CORE_CONFLICT",
  RATE_LIMITED: "CORE_RATE_LIMITED",
} as const;

export type CoreErrorCode = (typeof CORE_ERROR_CODES)[keyof typeof CORE_ERROR_CODES];

/**
 * RFC 7807 Problem Details schema. Required: `type`, `title`, `status`, `code`.
 * Optional: `detail`, `instance`, plus arbitrary extension fields.
 */
export const ProblemDetailsSchema = z
  .object({
    type: z.string().min(1),
    title: z.string().min(1),
    status: z.number().int().min(100).max(599),
    code: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
    detail: z.string().optional(),
    instance: z.string().optional(),
  })
  .passthrough();

export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

export interface ProblemDetailsInput {
  code: string;
  status: number;
  title: string;
  detail?: string;
  instance?: string;
  /** Override the `type` URL — defaults to `${ERROR_DOC_BASE_URL ?? '/docs/errors'}/{code}`. */
  type?: string;
}

export function problemDetails(input: ProblemDetailsInput): ProblemDetails {
  const base = process.env.ERROR_DOC_BASE_URL?.replace(/\/$/, "") ?? "/docs/errors";
  const type = input.type ?? `${base}/${input.code}`;
  return {
    type,
    title: input.title,
    status: input.status,
    code: input.code,
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
    ...(input.instance !== undefined ? { instance: input.instance } : {}),
  };
}
