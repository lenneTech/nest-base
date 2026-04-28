import { randomFillSync } from 'node:crypto';

/**
 * W3C Trace-Context parser/builder for the `traceparent` header.
 *
 * Format (v00): `00-<trace-id 32 hex>-<parent-id 16 hex>-<flags 2 hex>`
 * Spec: https://www.w3.org/TR/trace-context/
 */

export interface ParsedTraceparent {
  version: '00';
  traceId: string;
  parentId: string;
  flags: string;
  sampled: boolean;
}

const TRACE_ID_HEX = /^[0-9a-f]{32}$/;
const PARENT_ID_HEX = /^[0-9a-f]{16}$/;
const FLAGS_HEX = /^[0-9a-f]{2}$/;
const TRACE_ID_ZERO = '00000000000000000000000000000000';
const PARENT_ID_ZERO = '0000000000000000';

export function parseTraceparent(raw: string): ParsedTraceparent | null {
  if (!raw) return null;
  const parts = raw.split('-');
  if (parts.length !== 4) return null;
  const [version, traceId, parentId, flags] = parts as [string, string, string, string];

  if (version !== '00') return null;
  if (!TRACE_ID_HEX.test(traceId) || traceId === TRACE_ID_ZERO) return null;
  if (!PARENT_ID_HEX.test(parentId) || parentId === PARENT_ID_ZERO) return null;
  if (!FLAGS_HEX.test(flags)) return null;

  const flagByte = parseInt(flags, 16);
  return {
    version,
    traceId,
    parentId,
    flags,
    sampled: (flagByte & 0x01) === 0x01,
  };
}

export function formatTraceparent(parsed: { traceId: string; parentId: string; sampled: boolean }): string {
  const flags = parsed.sampled ? '01' : '00';
  return `00-${parsed.traceId}-${parsed.parentId}-${flags}`;
}

export function generateTraceId(): string {
  return randomHex(16);
}

export function generateSpanId(): string {
  return randomHex(8);
}

function randomHex(byteLen: number): string {
  const buf = new Uint8Array(byteLen);
  randomFillSync(buf);
  // Avoid the all-zero edge case (W3C-invalid).
  if (buf.every((b) => b === 0)) buf[0] = 1;
  let out = '';
  for (const b of buf) out += b.toString(16).padStart(2, '0');
  return out;
}
