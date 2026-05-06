import { connect } from "node:net";

import {
  buildClamavInstreamFrames,
  parseClamavReply,
  type ClamavScanResult,
} from "./clamav-protocol.js";
import type { FileScanInput, FileScanResult, FileScanner } from "./file-scanner.js";

/**
 * Real ClamAV `clamd` scanner (CF.FILES.06 — iter-120). Talks the
 * INSTREAM protocol over TCP. Falls back to indeterminate on any
 * transport error so the upload pipeline can apply its configured
 * indeterminate-policy (keep | reject) instead of hard-failing on a
 * transient clamd outage.
 *
 * Configuration (env-driven, read at construction time):
 *
 *   CLAMAV_HOST        — clamd hostname or IP (required)
 *   CLAMAV_PORT        — clamd port (default 3310)
 *   CLAMAV_TIMEOUT_MS  — socket timeout per scan (default 30000)
 *
 * Tests use the planner's pure helpers + an in-process fake socket
 * — see `tests/stories/clamav-protocol.story.test.ts`. The runner
 * itself is not unit-tested without a live clamd; the ClamavScanner
 * is wired only when CLAMAV_HOST is set.
 */

export interface ClamavScannerOptions {
  readonly host: string;
  readonly port?: number;
  readonly timeoutMs?: number;
  /**
   * Test seam: replaces the live clamd TCP roundtrip with a
   * fake. Production code never sets this; story tests inject a
   * function that returns the canned `IDSession`/`PONG`/`OK`/`FOUND`
   * reply text to exercise the verdict-mapping branches without a
   * live clamd. (iter-157)
   */
  readonly sendInstream?: (body: Uint8Array) => Promise<string>;
}

const DEFAULT_PORT = 3310;
const DEFAULT_TIMEOUT_MS = 30_000;

export class ClamavScanner implements FileScanner {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly sendInstreamImpl: (body: Uint8Array) => Promise<string>;

  constructor(options: ClamavScannerOptions) {
    if (!options.host) throw new Error("ClamavScanner: host is required");
    this.host = options.host;
    this.port = options.port ?? DEFAULT_PORT;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.sendInstreamImpl = options.sendInstream ?? ((body) => this.sendInstreamOverTcp(body));
  }

  async scan(input: FileScanInput): Promise<FileScanResult> {
    let result: ClamavScanResult;
    try {
      const reply = await this.sendInstreamImpl(input.body);
      result = parseClamavReply(reply);
    } catch (err) {
      return {
        verdict: "indeterminate",
        metadata: {
          scanner: "clamav",
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
    if (result.verdict === "infected") {
      return {
        verdict: "infected",
        ...(result.threatName ? { threatName: result.threatName } : {}),
        metadata: { scanner: "clamav", raw: result.raw },
      };
    }
    if (result.verdict === "indeterminate") {
      return { verdict: "indeterminate", metadata: { scanner: "clamav", raw: result.raw } };
    }
    return { verdict: "clean", metadata: { scanner: "clamav" } };
  }

  private sendInstreamOverTcp(body: Uint8Array): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port });
      let replyBuffer = "";
      let settled = false;
      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        action();
      };
      socket.setTimeout(this.timeoutMs);
      socket.on("timeout", () => finish(() => reject(new Error("clamav: socket timeout"))));
      socket.on("error", (err) => finish(() => reject(err)));
      socket.on("data", (chunk: Buffer) => {
        replyBuffer += chunk.toString("utf8");
      });
      socket.on("end", () => finish(() => resolve(replyBuffer)));
      socket.on("connect", () => {
        const frames = buildClamavInstreamFrames(body);
        socket.write(frames.command);
        for (const c of frames.chunks) socket.write(c);
        socket.write(frames.terminator);
      });
    });
  }
}

/** Factory — returns a ClamavScanner when `CLAMAV_HOST` is set; otherwise null. */
export function createClamavScannerFromEnv(env: NodeJS.ProcessEnv): ClamavScanner | null {
  const host = env.CLAMAV_HOST;
  if (!host) return null;
  const portRaw = env.CLAMAV_PORT;
  const timeoutRaw = env.CLAMAV_TIMEOUT_MS;
  const port = portRaw ? Number.parseInt(portRaw, 10) : undefined;
  const timeoutMs = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : undefined;
  return new ClamavScanner({
    host,
    ...(Number.isFinite(port) ? { port } : {}),
    ...(Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
  });
}
