/**
 * `FileScanner` — antivirus / content-safety scan contract
 * (CF.FILES.06 / PRD § Core Features § Files & Storage).
 *
 * The PRD pins "ClamAV-compatible interface" so projects can drop
 * in a real scanner (clamd / VirusTotal HTTP / a Lambda-backed
 * service) without forking the upload pipeline. The interface is
 * deliberately minimal — the contract a scanner must honour is:
 *
 *   1. Accept a `Uint8Array` body + a content-type hint.
 *   2. Return a `FileScanResult` describing the verdict.
 *   3. Never throw on a normal "found a virus" outcome — that is
 *      a clean `verdict: "infected"` response, not an error.
 *      Errors are reserved for transport / config / unreachable
 *      backends.
 *
 * Default binding: `NoOpFileScanner` always returns
 * `{verdict: "clean"}`. The TUS upload-complete hook + the direct
 * `/files/upload` controller call `scan(body, contentType)` and
 * route based on the verdict — production code overrides the
 * provider with a real adapter.
 */

export type FileScanVerdict = "clean" | "infected" | "indeterminate";

export interface FileScanResult {
  /** The scanner's verdict. `indeterminate` means the scan timed out / is queued. */
  readonly verdict: FileScanVerdict;
  /**
   * Optional finding name when `verdict === "infected"`. Mirrors
   * ClamAV's `Eicar-Test-Signature` shape so the upload-complete
   * hook can log a stable identifier.
   */
  readonly threatName?: string;
  /**
   * Optional opaque metadata the scanner attaches (engine version,
   * scan duration, queue id). Routed into the audit-log row so a
   * compliance review can reproduce the verdict.
   */
  readonly metadata?: Record<string, unknown>;
}

export interface FileScanInput {
  readonly body: Uint8Array;
  readonly contentType: string;
  /** Optional logical filename — surface it in audit + threat reports. */
  readonly filename?: string;
}

export interface FileScanner {
  /**
   * Scan the supplied body. Returns the verdict envelope; throws
   * only on transport / config errors (the caller catches + treats
   * as `indeterminate`). The default `NoOpFileScanner` always
   * returns `{verdict: "clean"}`.
   */
  scan(input: FileScanInput): Promise<FileScanResult>;
}

/**
 * No-op scanner — returns `{verdict: "clean"}` for every input.
 * Default binding when no project-specific scanner is wired. Lets
 * the upload pipeline mount cleanly out of the box; production
 * deployments override the `FILE_SCANNER` provider.
 */
export class NoOpFileScanner implements FileScanner {
  async scan(_input: FileScanInput): Promise<FileScanResult> {
    return {
      verdict: "clean",
      metadata: { scanner: "noop" },
    };
  }
}

/**
 * EICAR-test scanner — returns `{verdict: "infected"}` when the
 * supplied body matches the standard EICAR antivirus test string.
 * Useful for end-to-end tests that exercise the infected-route in
 * the upload pipeline without spinning up clamd. Production
 * projects never wire this — it's the canonical synthetic check
 * the antivirus industry agrees to detect.
 */
export class EicarTestFileScanner implements FileScanner {
  /** Standard EICAR test string. Detected by every real AV engine. */
  static readonly EICAR_SIGNATURE =
    "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

  async scan(input: FileScanInput): Promise<FileScanResult> {
    const text = new TextDecoder().decode(input.body);
    if (text.includes(EicarTestFileScanner.EICAR_SIGNATURE)) {
      return {
        verdict: "infected",
        threatName: "Eicar-Test-Signature",
        metadata: {
          scanner: "eicar-test",
          ...(input.filename ? { filename: input.filename } : {}),
        },
      };
    }
    return { verdict: "clean", metadata: { scanner: "eicar-test" } };
  }
}

/**
 * DI token used by FilesModule to bind a `FileScanner` provider.
 * Projects override the binding in their bootstrap to plug in a
 * ClamAV / VirusTotal adapter.
 */
export const FILE_SCANNER = Symbol.for("lt:FileScanner");

/**
 * Pure planner — given a scan result, decide what the upload-complete
 * hook should do with the file. Three outcomes:
 *
 *   - `keep`         → verdict was clean, persist the file as normal
 *   - `quarantine`   → verdict was infected, store under a quarantine
 *                      prefix + emit an audit row
 *   - `reject`       → verdict was indeterminate AND the project's
 *                      policy treats indeterminate as a hard fail
 *
 * Projects pass `indeterminatePolicy: "reject" | "keep"` to flip the
 * default (default `keep` — most projects accept the residual risk
 * rather than block uploads when the scanner is briefly down).
 */
export interface ScanDispositionInput {
  readonly verdict: FileScanVerdict;
  readonly indeterminatePolicy?: "reject" | "keep";
}

export type ScanDisposition = "keep" | "quarantine" | "reject";

export function planScanDisposition(input: ScanDispositionInput): ScanDisposition {
  switch (input.verdict) {
    case "clean":
      return "keep";
    case "infected":
      return "quarantine";
    case "indeterminate":
      return input.indeterminatePolicy === "reject" ? "reject" : "keep";
  }
}
