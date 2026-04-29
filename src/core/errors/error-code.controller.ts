import {
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";

import { renderJsonViewerPage } from "../dx/json-viewer-ui.js";
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
    @Headers("accept") accept: string | undefined,
    @Query("format") format: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @Res() res: Response,
  ): void {
    const data = this.listData(cursor, limit);
    if (wantsJson(accept, format)) {
      res.type("application/json").send(JSON.stringify(data));
      return;
    }
    res.type("text/html; charset=utf-8").send(
      renderJsonViewerPage({
        title: "Error Catalog",
        subtitle: `Public catalogue of every CORE_* error code this API can emit.${
          Array.isArray(data) ? ` ${data.length} entries.` : ""
        }`,
        currentNav: "errors",
        value: data,
        rawJsonHref: "/errors?format=json",
      }),
    );
  }

  private listData(
    cursor?: string,
    limit?: string,
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

/**
 * Returns true when the caller prefers JSON over HTML — either explicit
 * `?format=json` or an Accept header that ranks `application/json`
 * higher than `text/html`. Browsers default to text/html so they get the
 * pretty viewer; curl with `-H "Accept: application/json"` and SDKs get
 * raw JSON.
 */
function wantsJson(accept: string | undefined, format: string | undefined): boolean {
  if (format === "json") return true;
  if (format === "html") return false;
  if (!accept) return false;
  const lower = accept.toLowerCase();
  if (lower.includes("text/html")) return false;
  if (lower.includes("application/json")) return true;
  return false;
}
