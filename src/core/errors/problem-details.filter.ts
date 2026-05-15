import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodError } from "zod";

import { ETagMissingError, ETagPreconditionFailedError } from "../concurrency/etag.js";
import { IdempotencyConflictError } from "../idempotency/idempotency.service.js";
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
  // Class-field Logger so the filter can be used with new ProblemDetailsExceptionFilter()
  // (no DI required) while still routing through the Pino/OTel pipeline.
  private readonly logger = new Logger("ProblemDetailsFilter");

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
      // MIN-1: Do NOT echo `exception.message` in the response body — it
      // may contain internal details about the header format or UUID
      // validation. Log server-side for ops debugging; return a static
      // message to the client.
      this.logger.warn(`TenantIsolationError: ${exception.message}`);
      const detail = problemDetails({
        code: CORE_ERROR_CODES.VALIDATION,
        status: HttpStatus.BAD_REQUEST,
        title: "Tenant Header Required",
        detail: "Tenant header could not be resolved for this request",
        instance: req.originalUrl ?? req.url,
      });
      return { ...detail, ...correlation };
    }

    if (exception instanceof IdempotencyConflictError) {
      // Stripe-style: same Idempotency-Key with a different request
      // body collides → 409 Conflict + CORE_CONFLICT. The handler
      // is intentionally NOT re-invoked, so the caller can either
      // pick a fresh key or align the body with the original request.
      const detail = problemDetails({
        code: CORE_ERROR_CODES.CONFLICT,
        status: HttpStatus.CONFLICT,
        title: "Idempotency-Key Conflict",
        detail: exception.message,
        instance: req.originalUrl ?? req.url,
      });
      // NIT-2: Truncate the idempotency key to 128 chars max so a caller
      // cannot inject arbitrarily long values into the JSON response body.
      return { ...detail, ...correlation, idempotencyKey: exception.key?.slice(0, 128) };
    }

    if (exception instanceof ETagPreconditionFailedError) {
      // MIN-3: Do NOT include currentETag in the 412 response body.
      // Leaking the current ETag in the error response would allow a
      // client that cannot read the resource (blocked by CASL) to brute-
      // force or infer ETag values without a legitimate read session.
      // The client MUST re-fetch the resource to obtain the fresh ETag,
      // which is itself protected by CASL field-level access control.
      const detail = problemDetails({
        code: "CORE_PRECONDITION_FAILED",
        status: 412,
        title: "Precondition Failed",
        detail: "If-Match header did not match the current resource version",
        instance: req.originalUrl ?? req.url,
      });
      return { ...detail, ...correlation };
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
      this.logger.error(
        `unhandled error on ${req.method} ${req.url}: ${exception.stack ?? exception.message}`,
      );
    } else {
      this.logger.error(`unhandled non-Error on ${req.method} ${req.url}: ${String(exception)}`);
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
