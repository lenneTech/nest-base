import { Controller, Get, Inject, NotFoundException, Param, Query } from "@nestjs/common";

import {
  type CursorPage,
  type CursorRecord,
  buildCursorPage,
  decodeCursor,
} from "../pagination/cursor.js";
import { ERROR_CODE_REGISTRY, type ErrorCodeRegistry } from "./error-code.token.js";
import {
  type ErrorCodeDefinition,
  ErrorCodeNotFoundError,
  type ResolvedErrorMessage,
} from "./error-code-registry.js";

const DEFAULT_LOCALE = "en";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface ErrorCodeCursorRow extends CursorRecord {
  id: string;
  code: string;
  status: number;
  messages: ErrorCodeDefinition["messages"];
}

/**
 * `/errors` — public catalogue of error codes the API can emit.
 *
 * Frontends use this to map `ProblemDetails.code` to localised user
 * messages. SDK generators (kubb) embed the catalogue as a TypeScript
 * union so callers get autocomplete on `code`.
 *
 * Public route by design: error documentation is not sensitive — the
 * registry contains `code`, status, and i18n strings only.
 */
@Controller("errors")
export class ErrorCodeController {
  constructor(@Inject(ERROR_CODE_REGISTRY) private readonly registry: ErrorCodeRegistry) {}

  @Get()
  list(
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): ErrorCodeDefinition[] | CursorPage<ErrorCodeCursorRow> {
    const all = this.registry.list();
    if (!cursor && !limit) return all;
    const parsedLimit = limit ? Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT) : DEFAULT_LIMIT;
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      return all;
    }
    // Cursor format: id-only (the registry is sorted alphabetically;
    // skipping past the last-seen code is the cheapest reproducible
    // page boundary).
    const startCode = cursor ? (decodeCursor(cursor).id as string) : null;
    const sorted = [...all].sort((a, b) => a.code.localeCompare(b.code));
    const startIndex = startCode ? sorted.findIndex((d) => d.code > startCode) : 0;
    const slice = (
      startIndex < 0 ? [] : sorted.slice(startIndex, startIndex + parsedLimit + 1)
    ).map((d) => ({
      id: d.code,
      sortValue: d.code,
      code: d.code,
      status: d.status,
      messages: d.messages,
    }));
    return buildCursorPage<ErrorCodeCursorRow>(slice, parsedLimit);
  }

  @Get(":code")
  resolve(@Param("code") code: string, @Query("locale") locale?: string): ResolvedErrorMessage {
    try {
      return this.registry.resolve(code, locale ?? DEFAULT_LOCALE, {});
    } catch (err) {
      if (err instanceof ErrorCodeNotFoundError) {
        throw new NotFoundException({
          code: "CORE_NOT_FOUND",
          detail: `unknown error code: ${code}`,
        });
      }
      throw err;
    }
  }
}
