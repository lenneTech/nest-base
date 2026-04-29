/**
 * In-memory request-trace buffer.
 *
 * Same pattern as `log-buffer.ts`: bounded ring buffer that records
 * the recent N HTTP requests with start time, duration, status, and
 * optional error. Surfaced via `/dev/traces` — a lightweight stand-in
 * for a real OTel exporter when all you want is "what just happened
 * in this dev session?".
 *
 * Singleton-friendly (`getTraceBuffer()`) so the request-context
 * middleware can record into the same buffer the dev-hub controller
 * reads from. Process-local; cleared on dev-server restart.
 */

export interface TraceRecord {
  requestId: string;
  method: string;
  path: string;
  /** Wall-clock timestamp (ms) when the request started. */
  startedAtMs: number;
  /** Total handler duration in ms. */
  durationMs: number;
  status: number;
  /** Optional captured error info. */
  error?: { name: string; message: string };
  /**
   * Monotonic sequence number assigned by the buffer at record time.
   * Used by the /dev/traces poller as a cursor: "give me everything
   * after seq=N".
   */
  seq?: number;
}

export interface TraceFilter {
  limit?: number;
  requestId?: string;
}

export interface TraceSummary {
  total: number;
  /** Status >= 500 counts as a server error. */
  errors: number;
  slowestMs: number;
}

const DEFAULT_CAPACITY = 200;

export class TraceBuffer {
  private readonly capacity: number;
  private readonly buffer: TraceRecord[] = [];
  private nextSeq = 1;

  constructor(options: { capacity?: number } = {}) {
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
  }

  record(trace: TraceRecord): void {
    this.buffer.push({ ...trace, seq: this.nextSeq++ });
    while (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }
  }

  /** Records with `seq > sinceSeq`. Used by the /dev/traces poller. */
  since(sinceSeq: number): readonly TraceRecord[] {
    return this.buffer.filter((r) => Number(r.seq ?? 0) > sinceSeq);
  }

  recent(filter: TraceFilter = {}): TraceRecord[] {
    let traces = this.buffer.slice();
    if (filter.requestId) {
      traces = traces.filter((t) => t.requestId.includes(filter.requestId!));
    }
    if (filter.limit !== undefined && filter.limit < traces.length) {
      traces = traces.slice(traces.length - filter.limit);
    }
    return traces;
  }

  summary(): TraceSummary {
    let errors = 0;
    let slowestMs = 0;
    for (const t of this.buffer) {
      if (t.status >= 500) errors++;
      if (t.durationMs > slowestMs) slowestMs = t.durationMs;
    }
    return { total: this.buffer.length, errors, slowestMs };
  }

  clear(): void {
    this.buffer.length = 0;
  }
}

let singleton: TraceBuffer | null = null;

export function getTraceBuffer(): TraceBuffer {
  if (!singleton) singleton = new TraceBuffer();
  return singleton;
}
