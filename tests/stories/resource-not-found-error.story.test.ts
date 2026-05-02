/**
 * Story tests for `ResourceNotFoundError` — the canonical "throw this,
 * get a 404" base class for resource lookups.
 *
 * Why this class exists: before this slice, modules that hand-rolled
 * `class FooNotFoundError extends Error` got a 500 response from the
 * global `ProblemDetailsExceptionFilter` (which only knew about
 * `HttpException`, `ZodError`, and a few framework sentinels). The
 * filter logged "[ProblemDetailsFilter] unhandled error" and returned
 * `CORE_INTERNAL` instead of `CORE_NOT_FOUND`. That was a strict bug:
 * the docs (and the friction log) all said "extend this, get a 404."
 *
 * Fix: ship a base class that extends NestJS' `NotFoundException`
 * (an `HttpException` subclass), so the existing filter branch for
 * `HttpException` picks it up automatically. Module authors keep
 * their named-sentinel pattern (`class ExampleNotFoundError extends
 * ResourceNotFoundError`) — but now the response is correctly 404.
 */

import { HttpException, NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { CORE_ERROR_CODES } from "../../src/core/errors/error-code.js";
import { ResourceNotFoundError } from "../../src/core/errors/resource-not-found-error.js";

describe("Story · ResourceNotFoundError", () => {
  it("is a NotFoundException (so the filter maps it to 404)", () => {
    const err = new ResourceNotFoundError("Example", "abc-123");
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(404);
  });

  it("formats a default detail with the resource name and id", () => {
    const err = new ResourceNotFoundError("Example", "abc-123");
    const response = err.getResponse();
    expect(response).toMatchObject({
      code: CORE_ERROR_CODES.NOT_FOUND,
      message: 'Example with id "abc-123" not found',
    });
  });

  it("accepts an explicit detail string", () => {
    const err = new ResourceNotFoundError("Example", "abc-123", {
      detail: "Custom message here",
    });
    const response = err.getResponse() as { message?: string };
    expect(response.message).toBe("Custom message here");
  });

  it("preserves the ResourceNotFoundError name on subclasses", () => {
    class ExampleNotFoundError extends ResourceNotFoundError {
      constructor(id: string) {
        super("Example", id);
        this.name = "ExampleNotFoundError";
      }
    }
    const err = new ExampleNotFoundError("xyz");
    expect(err.name).toBe("ExampleNotFoundError");
    expect(err).toBeInstanceOf(ResourceNotFoundError);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.getStatus()).toBe(404);
  });
});
