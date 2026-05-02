/**
 * Pure helper for serializing whatever value the EmailOutboxWorker
 * tick rejects with into a `{ message, stack, payload }` triple safe
 * for `Logger.error(message, stack)`.
 *
 * Issue #50 traced the `[Nest] EmailOutboxWorker ERROR {}` log spam
 * to two facts: NestJS' `Logger.error(rawError)` falls back to
 * `JSON.stringify(rawError)` for non-Error throws, and several common
 * error shapes (Prisma's `PrismaClientKnownRequestError`, opaque
 * driver errors, etc.) carry their useful payload in non-enumerable
 * properties — so the JSON path collapses to `"{}"` and the real
 * cause never reaches the logs.
 *
 * The helper handles every realistic shape:
 *
 * - `Error` and subclasses → `message` + `stack` (no payload)
 * - `null` / `undefined`   → sentinel message `"(no error value)"`
 * - `string` / `number` / `boolean` → stringified message
 * - Plain object           → `JSON.stringify` (best-effort, with
 *                            non-enumerable extraction for
 *                            Prisma-style payloads)
 * - Object with circular ref → falls back to `String(raw)`; never
 *                              throws
 *
 * Keep this module dependency-free — it must work both inside the
 * Nest lifecycle wrapper and inside pure unit tests.
 */
export interface OutboxTickErrorReport {
  message: string;
  stack: string | undefined;
  /**
   * Serialized payload of the raw value when it wasn't an `Error`.
   * Captured as a JSON string for log forensics — `null`/`undefined`
   * when the message already conveys everything (real Errors,
   * sentinels, primitive strings).
   */
  payload: string | undefined;
}

const NO_VALUE_MESSAGE = "(no error value)" as const;

/**
 * Properties Prisma (and similar libs) stash as non-enumerable on
 * known-request error instances. Walked via `getOwnPropertyNames` so
 * the serializer can build a useful message even when the value
 * doesn't `instanceof Error`.
 */
const EXTRACTABLE_PROPS = ["name", "code", "message", "meta", "clientVersion"] as const;

export function serializeOutboxTickError(raw: unknown): OutboxTickErrorReport {
  if (raw instanceof Error) {
    return {
      message: raw.message || raw.name || "Error",
      stack: raw.stack,
      payload: undefined,
    };
  }

  if (raw === null || raw === undefined) {
    return { message: NO_VALUE_MESSAGE, stack: undefined, payload: undefined };
  }

  if (typeof raw === "string") {
    return { message: raw, stack: undefined, payload: undefined };
  }

  if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint") {
    return { message: String(raw), stack: undefined, payload: undefined };
  }

  if (typeof raw === "object") {
    return serializeObject(raw);
  }

  // symbols, functions, etc. — best-effort String() coercion.
  return { message: safeString(raw), stack: undefined, payload: undefined };
}

function serializeObject(raw: object): OutboxTickErrorReport {
  // Pull common Prisma-style fields out via getOwnPropertyNames so
  // non-enumerable values still surface in the log.
  const extracted: Record<string, unknown> = {};
  for (const prop of EXTRACTABLE_PROPS) {
    if (Object.prototype.hasOwnProperty.call(raw, prop)) {
      const value = (raw as Record<string, unknown>)[prop];
      if (value !== undefined) extracted[prop] = value;
    }
  }

  // Best-effort full-object JSON. May fail on circular refs — handled
  // below with a String(raw) fallback so we never throw out of the
  // logging path.
  let jsonPayload: string | undefined;
  try {
    const json = JSON.stringify(raw);
    if (json && json !== "{}" && json !== "null") {
      jsonPayload = json;
    }
  } catch {
    // Circular reference or non-serializable value — fall through.
  }

  // Build a synthetic message from extracted fields (preferred) or
  // from the JSON payload, never just "{}".
  const messageBits: string[] = [];
  const extractedName = typeof extracted.name === "string" ? extracted.name : undefined;
  const extractedCode = typeof extracted.code === "string" ? extracted.code : undefined;
  const extractedMessage =
    typeof extracted.message === "string" ? extracted.message : undefined;

  if (extractedName) messageBits.push(extractedName);
  if (extractedCode) messageBits.push(extractedCode);
  if (extractedMessage) messageBits.push(extractedMessage);

  let message: string;
  if (messageBits.length > 0) {
    message = messageBits.join(": ");
  } else if (jsonPayload) {
    message = jsonPayload;
  } else {
    // Opaque object (no enumerable props, no extractable fields) —
    // never let the log read just "{}".
    message = safeString(raw);
  }

  // Payload string: prefer the extracted-fields snapshot when we have
  // any (it's the data the operator actually wants); fall back to the
  // full JSON payload for plain objects so opaque shapes still leave
  // a forensics trail in the log.
  let payload: string | undefined;
  if (Object.keys(extracted).length > 0) {
    try {
      payload = JSON.stringify(extracted);
    } catch {
      payload = undefined;
    }
  } else if (jsonPayload) {
    payload = jsonPayload;
  }

  return { message, stack: undefined, payload };
}

function safeString(raw: unknown): string {
  try {
    const s = String(raw);
    return s.length > 0 ? s : NO_VALUE_MESSAGE;
  } catch {
    return NO_VALUE_MESSAGE;
  }
}
