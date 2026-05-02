/**
 * Canonical "throw this, get a 404" base class for resource lookups.
 *
 * Why this exists: the global `ProblemDetailsExceptionFilter` only
 * recognises `HttpException` (NestJS), `ZodError`, and a small set of
 * framework sentinels. A module that hand-rolled
 * `class FooNotFoundError extends Error` fell through to the catch-all
 * branch and produced a 500 + `CORE_INTERNAL` response — even though
 * the docs (and consumer expectation) said "extend this, get a 404".
 *
 * Fix: extend NestJS' `NotFoundException` (an `HttpException` subclass)
 * so the existing 404-status branch picks it up automatically and
 * emits `CORE_NOT_FOUND`. Module-level subclasses keep their named
 * sentinel pattern:
 *
 * ```ts
 * export class ExampleNotFoundError extends ResourceNotFoundError {
 *   constructor(id: string) {
 *     super("Example", id);
 *     this.name = "ExampleNotFoundError";
 *   }
 * }
 * ```
 *
 * The filter's `HttpException` branch then maps it to:
 *   - `status` 404
 *   - `code` `CORE_NOT_FOUND` (via `codeForStatus(404)`)
 *   - `detail` `Example with id "<id>" not found`
 *   - `title` `Not Found`
 */

import { NotFoundException } from "@nestjs/common";

import { CORE_ERROR_CODES } from "./error-code.js";

export interface ResourceNotFoundOptions {
  /** Override the default `<resource> with id "<id>" not found` detail. */
  detail?: string;
}

/**
 * Marker base class for "resource X with id Y not found" errors.
 *
 * Extends `NotFoundException` so the global `ProblemDetailsExceptionFilter`
 * maps it to RFC 7807 + 404 + `CORE_NOT_FOUND` automatically — no extra
 * filter wiring per module.
 */
export class ResourceNotFoundError extends NotFoundException {
  constructor(
    public readonly resource: string,
    public readonly resourceId: string,
    options: ResourceNotFoundOptions = {},
  ) {
    const message = options.detail ?? `${resource} with id "${resourceId}" not found`;
    // The filter reads `response.message` for the `detail` field and
    // honours `response.code` if the consumer set one explicitly. We
    // pre-fill `code: CORE_NOT_FOUND` here so subclasses inherit the
    // right code without restating it.
    super({
      code: CORE_ERROR_CODES.NOT_FOUND,
      message,
    });
    this.name = "ResourceNotFoundError";
  }
}
