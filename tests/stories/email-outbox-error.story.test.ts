import { describe, expect, it } from "vitest";

import { serializeOutboxTickError } from "../../src/core/email/email-outbox-error.js";

/**
 * Story · `serializeOutboxTickError`.
 *
 * The pure helper turns whatever `EmailOutboxWorker.runOnce()` rejects
 * with into a `{ message, stack, payload }` triple the lifecycle
 * wrapper can hand to `Logger.error(message, stack)` without ever
 * printing `{}` for non-Error values.
 *
 * Issue #50 traced the spam to NestJS' Logger printing
 * `JSON.stringify(rawError)` for non-Error throws. Plain Prisma errors
 * (and several other shapes) carry their useful payload in
 * non-enumerable properties, which is why the default JSON path
 * collapses to `"{}"`.
 *
 * The helper covers six shapes — Error, Error subclass with
 * non-enumerable message (Prisma-style), null, undefined, string,
 * plain object, and an object with a circular reference (must not
 * throw).
 */
describe("Story · serializeOutboxTickError", () => {
  it("returns message + stack for a real Error", () => {
    const err = new Error("boom");
    const report = serializeOutboxTickError(err);
    expect(report.message).toBe("boom");
    expect(report.stack).toBeDefined();
    expect(report.stack).toContain("Error: boom");
    expect(report.payload).toBeUndefined();
  });

  it("extracts non-enumerable message + code from Prisma-style errors", () => {
    // Prisma's known-request errors stash `message` / `code` / `name`
    // as non-enumerable properties on the prototype, which is why
    // `JSON.stringify` returns `"{}"`. The serializer must walk
    // `Object.getOwnPropertyNames()` to pull them out.
    const prismaLike: object = {};
    Object.defineProperty(prismaLike, "message", {
      value: "P2002: unique constraint violation",
      enumerable: false,
    });
    Object.defineProperty(prismaLike, "code", {
      value: "P2002",
      enumerable: false,
    });
    Object.defineProperty(prismaLike, "name", {
      value: "PrismaClientKnownRequestError",
      enumerable: false,
    });

    const report = serializeOutboxTickError(prismaLike);
    expect(report.message).toContain("P2002");
    expect(report.message).toContain("unique constraint violation");
    // Stack is unknown for this shape — must not fabricate one.
    expect(report.stack).toBeUndefined();
    // Payload string captures all extracted props for log forensics.
    expect(report.payload).toBeDefined();
    expect(report.payload).toContain("P2002");
  });

  it("returns a sentinel message for null", () => {
    const report = serializeOutboxTickError(null);
    expect(report.message).toBe("(no error value)");
    expect(report.stack).toBeUndefined();
    expect(report.payload).toBeUndefined();
  });

  it("returns a sentinel message for undefined", () => {
    const report = serializeOutboxTickError(undefined);
    expect(report.message).toBe("(no error value)");
    expect(report.stack).toBeUndefined();
    expect(report.payload).toBeUndefined();
  });

  it("returns the string itself when raw is a string", () => {
    const report = serializeOutboxTickError("connection refused");
    expect(report.message).toBe("connection refused");
    expect(report.stack).toBeUndefined();
    expect(report.payload).toBeUndefined();
  });

  it("serializes plain objects to JSON in the payload", () => {
    const report = serializeOutboxTickError({ foo: "bar", n: 42 });
    expect(report.message).toBeTruthy();
    expect(report.payload).toBeDefined();
    expect(report.payload).toContain("foo");
    expect(report.payload).toContain("bar");
    expect(report.payload).toContain("42");
  });

  it("does not throw on a circular reference", () => {
    interface Cyclic {
      name: string;
      self?: Cyclic;
    }
    const obj: Cyclic = { name: "loopy" };
    obj.self = obj;
    expect(() => serializeOutboxTickError(obj)).not.toThrow();
    const report = serializeOutboxTickError(obj);
    expect(report.message).toBeTruthy();
  });

  it("handles numbers and booleans by stringifying them", () => {
    expect(serializeOutboxTickError(42).message).toBe("42");
    expect(serializeOutboxTickError(true).message).toBe("true");
  });

  it("preserves stack trace from Error subclass", () => {
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "CustomError";
      }
    }
    const err = new CustomError("custom failure");
    const report = serializeOutboxTickError(err);
    expect(report.message).toBe("custom failure");
    expect(report.stack).toBeDefined();
  });

  it("returns empty-object sentinel for plain objects without enumerable props and no extractable fields", () => {
    const opaque = Object.create(null) as object;
    const report = serializeOutboxTickError(opaque);
    // Without any extractable fields, the message falls back to a
    // sentinel so logs never read just "{}".
    expect(report.message).toBeTruthy();
    expect(report.message.length).toBeGreaterThan(0);
  });
});
