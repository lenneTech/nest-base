import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";

import { getTraceBuffer } from "../dx/trace-buffer.js";
import {
  type RequestContext,
  generateRequestId,
  runWithRequestContext,
} from "./request-context.js";
import {
  formatTraceparent,
  generateSpanId,
  generateTraceId,
  parseTraceparent,
} from "./traceparent.js";

/**
 * Express middleware that initializes a `RequestContext` for every
 * inbound HTTP request and runs the rest of the request lifecycle inside
 * `runWithRequestContext()`.
 *
 * Trace-id resolution:
 *   - `traceparent` header parses cleanly → reuse upstream trace
 *   - missing / malformed → mint a new trace
 * The outbound response always carries a normalized `traceparent` and an
 * `X-Request-Id` for client-side log correlation.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const ctx = this.buildContext(req);

    res.setHeader("x-request-id", ctx.requestId);
    res.setHeader(
      "traceparent",
      formatTraceparent({ traceId: ctx.traceId, parentId: ctx.parentId, sampled: ctx.sampled }),
    );

    // Record one trace per HTTP request — surfaced via /dev/traces.
    // Capturing on `finish` (success) and `close` (early disconnect)
    // gives us the actual handler duration.
    const startedAtMs = Date.now();
    const startNs = process.hrtime.bigint();
    const buffer = getTraceBuffer();
    let recorded = false;
    const recordTrace = (): void => {
      if (recorded) return;
      recorded = true;
      const durationMs = Number((process.hrtime.bigint() - startNs) / 1_000_000n);
      buffer.record({
        requestId: ctx.requestId,
        method: (req.method ?? "GET").toUpperCase(),
        path: req.originalUrl ?? req.url ?? "/",
        startedAtMs,
        durationMs,
        status: res.statusCode,
      });
    };
    res.on("finish", recordTrace);
    res.on("close", recordTrace);

    runWithRequestContext(ctx, async () => {
      next();
    }).catch((error) => next(error as Error));
  }

  private buildContext(req: Request): RequestContext {
    const headerValue = headerToString(req.headers.traceparent);
    const parsed = headerValue ? parseTraceparent(headerValue) : null;

    if (parsed) {
      return {
        requestId: generateRequestId(),
        traceId: parsed.traceId,
        parentId: parsed.parentId,
        sampled: parsed.sampled,
      };
    }

    return {
      requestId: generateRequestId(),
      traceId: generateTraceId(),
      parentId: generateSpanId(),
      sampled: false,
    };
  }
}

function headerToString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
