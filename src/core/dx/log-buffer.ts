/**
 * In-memory Pino log ring-buffer.
 *
 * Holds the last N log records so the `/dev/logs` page can render a
 * live tail without subscribing to external log shipping. The buffer
 * is a pure planner (LogBuffer class) plus a singleton instance the
 * logger writes into. Tests use the class directly with explicit
 * sizes; bootstrap wires the singleton.
 *
 * The class deliberately exposes no I/O — `push` is sync, `recent`
 * returns a frozen snapshot.
 */
import type { LogRecord } from "../observability/logger.js";

export interface LogBufferOptions {
  maxRecords?: number;
}

const DEFAULT_MAX = 500;

export class LogBuffer {
  private readonly max: number;
  private records: LogRecord[] = [];
  private nextSeq = 1;

  constructor(options: LogBufferOptions = {}) {
    this.max = Math.max(1, options.maxRecords ?? DEFAULT_MAX);
  }

  push(record: LogRecord): void {
    const stamped: LogRecord = { ...record, seq: this.nextSeq++ };
    this.records.push(stamped);
    if (this.records.length > this.max) {
      this.records.splice(0, this.records.length - this.max);
    }
  }

  /** Latest `count` records, newest last. */
  recent(count: number = this.max): readonly LogRecord[] {
    if (count >= this.records.length) return Object.freeze([...this.records]);
    return Object.freeze(this.records.slice(-count));
  }

  /** Records with `seq > sinceSeq`, used by SSE tail polling. */
  since(sinceSeq: number): readonly LogRecord[] {
    return Object.freeze(this.records.filter((r) => Number(r.seq) > sinceSeq));
  }

  size(): number {
    return this.records.length;
  }

  capacity(): number {
    return this.max;
  }

  clear(): void {
    this.records = [];
  }
}

/**
 * Process-wide singleton. The logger factory writes every record here
 * via a pino multistream destination; the dev-hub controller reads
 * from it. In tests, prefer constructing a fresh `LogBuffer` directly.
 */
let singleton: LogBuffer | undefined;

export function getLogBuffer(): LogBuffer {
  if (!singleton) singleton = new LogBuffer();
  return singleton;
}

/** Test seam — reset the singleton so spec runs are isolated. */
export function resetLogBufferSingleton(): void {
  singleton = undefined;
}
