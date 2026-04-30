/**
 * Named error sentinels for the Example module.
 *
 * Why named errors instead of plain `Error` or NestJS `HttpException`:
 *
 *   - The service stays HTTP-agnostic. It throws a domain error; the
 *     controller (or `ProblemDetailsFilter`) decides the status code.
 *   - Tests can assert on the class (`rejects.toBeInstanceOf(...)`)
 *     instead of brittle string-matching the message.
 *   - The global exception filter maps known sentinels to RFC 7807
 *     responses with a stable `code` field — that's how the SDK and
 *     the `/errors` catalog learn about new error codes.
 */

export class ExampleNotFoundError extends Error {
  constructor(id: string) {
    super(`Example not found: ${id}`);
    this.name = "ExampleNotFoundError";
  }
}
