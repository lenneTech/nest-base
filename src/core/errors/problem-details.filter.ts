import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodError } from "zod";

import { ETagMissingError, ETagPreconditionFailedError } from "../concurrency/etag.js";
import { TenantIsolationError } from "../multi-tenancy/tenant-header.js";
import { getRequestContext } from "../request-context/request-context.js";
import { CORE_ERROR_CODES, type ProblemDetails, problemDetails } from "./error-code.js";

/**
 * Global exception filter that converts every uncaught exception into an
 * RFC 7807 Problem-Details JSON response.
 *
 * Mapping:
 *   - HttpException                → reuse status, map well-known statuses
 *                                    to `CORE_*` codes (404 → NOT_FOUND etc.)
 *   - ZodError                     → 400 + CORE_VALIDATION + per-field
 *                                    `errors` extension array
 *   - everything else              → 500 + CORE_INTERNAL, redact the
 *                                    original message in `detail` to
 *                                    avoid leaking internal state
 *
 * Trace correlation (`traceId`, `requestId`) is pulled from the
 * `RequestContext` AsyncLocalStorage when present.
 */
@Catch()
export class ProblemDetailsExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const detail = this.toProblem(exception, req);
    res.setHeader("content-type", "application/problem+json");
    res.status(detail.status).json(detail);
  }

  private toProblem(exception: unknown, req: Request): ProblemDetails & Record<string, unknown> {
    const ctx = getRequestContext();
    const correlation = ctx ? { requestId: ctx.requestId, traceId: ctx.traceId } : {};

    if (exception instanceof ETagMissingError) {
      const detail = problemDetails({
        code: "CORE_PRECONDITION_REQUIRED",
        status: 428,
        title: "Precondition Required",
        detail: exception.message,
        instance: req.originalUrl ?? req.url,
      });
      return { ...detail, ...correlation };
    }

    if (exception instanceof TenantIsolationError) {
      const detail = problemDetails({
        code: CORE_ERROR_CODES.VALIDATION,
        status: HttpStatus.BAD_REQUEST,
        title: "Tenant Header Required",
        detail: exception.message,
        instance: req.originalUrl ?? req.url,
      });
      return { ...detail, ...correlation };
    }

    if (exception instanceof ETagPreconditionFailedError) {
      const detail = problemDetails({
        code: "CORE_PRECONDITION_FAILED",
        status: 412,
        title: "Precondition Failed",
        detail: exception.message,
        instance: req.originalUrl ?? req.url,
      });
      return { ...detail, ...correlation, currentETag: exception.currentETag };
    }

    if (exception instanceof ZodError) {
      const detail = problemDetails({
        code: CORE_ERROR_CODES.VALIDATION,
        status: HttpStatus.BAD_REQUEST,
        title: "Validation failed",
        instance: req.originalUrl ?? req.url,
      });
      return {
        ...detail,
        ...correlation,
        errors: exception.issues.map((issue) => ({
          path: issue.path,
          code: issue.code,
          message: issue.message,
        })),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === "string" ? response : (response as { message?: unknown }).message;
      const detailText = Array.isArray(message)
        ? message.join(", ")
        : String(message ?? exception.message);
      const detail = problemDetails({
        code: codeForStatus(status),
        status,
        title: titleForStatus(status),
        detail: detailText,
        instance: req.originalUrl ?? req.url,
      });
      return { ...detail, ...correlation };
    }

    const detail = problemDetails({
      code: CORE_ERROR_CODES.INTERNAL,
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      title: "Internal Server Error",
      detail: "An unexpected error occurred. Check server logs for details.",
      instance: req.originalUrl ?? req.url,
    });
    if (exception instanceof Error) {
      // eslint-disable-next-line no-console
      console.error(
        `[ProblemDetailsFilter] unhandled error on ${req.method} ${req.url}:`,
        exception.stack ?? exception.message,
      );
    } else {
      // eslint-disable-next-line no-console
      console.error(
        `[ProblemDetailsFilter] unhandled non-Error on ${req.method} ${req.url}:`,
        exception,
      );
    }
    return { ...detail, ...correlation };
  }
}

function codeForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return CORE_ERROR_CODES.VALIDATION;
    case HttpStatus.UNAUTHORIZED:
      return CORE_ERROR_CODES.UNAUTHORIZED;
    case HttpStatus.FORBIDDEN:
      return CORE_ERROR_CODES.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return CORE_ERROR_CODES.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return CORE_ERROR_CODES.CONFLICT;
    case HttpStatus.TOO_MANY_REQUESTS:
      return CORE_ERROR_CODES.RATE_LIMITED;
    default:
      return status >= 500 ? CORE_ERROR_CODES.INTERNAL : CORE_ERROR_CODES.VALIDATION;
  }
}

function titleForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return "Bad Request";
    case HttpStatus.UNAUTHORIZED:
      return "Unauthorized";
    case HttpStatus.FORBIDDEN:
      return "Forbidden";
    case HttpStatus.NOT_FOUND:
      return "Not Found";
    case HttpStatus.CONFLICT:
      return "Conflict";
    case HttpStatus.TOO_MANY_REQUESTS:
      return "Too Many Requests";
    default:
      return status >= 500 ? "Internal Server Error" : "Error";
  }
}
