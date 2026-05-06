import { describe, expect, it } from "vitest";

import {
  EicarTestFileScanner,
  FILE_SCANNER,
  NoOpFileScanner,
  planScanDisposition,
  type FileScanInput,
} from "../../src/core/files/file-scanner.js";

/**
 * Story · File scanner contract (CF.FILES.06).
 *
 * The PRD requires "ClamAV-compatible interface" so projects can
 * drop in clamd / VirusTotal / a Lambda-backed engine without
 * touching the upload pipeline.
 *
 * Three layers covered:
 *   1. The contract — `FileScanner` interface + verdict shape
 *   2. The defaults — `NoOpFileScanner` (always clean) +
 *      `EicarTestFileScanner` (canonical AV test string)
 *   3. The dispatcher — `planScanDisposition()` partitions
 *      verdicts into `keep` / `quarantine` / `reject`
 */
describe("Story · FileScanner contract", () => {
  describe("NoOpFileScanner", () => {
    it("returns {verdict: 'clean'} for any input", async () => {
      const scanner = new NoOpFileScanner();
      const result = await scanner.scan({
        body: new Uint8Array([1, 2, 3]),
        contentType: "application/octet-stream",
      });
      expect(result.verdict).toBe("clean");
      expect(result.metadata?.scanner).toBe("noop");
    });

    it("returns clean even for the EICAR signature (no-op = no detection)", async () => {
      const scanner = new NoOpFileScanner();
      const eicar = new TextEncoder().encode(EicarTestFileScanner.EICAR_SIGNATURE);
      const result = await scanner.scan({
        body: eicar,
        contentType: "text/plain",
        filename: "eicar.txt",
      });
      expect(result.verdict).toBe("clean");
    });
  });

  describe("EicarTestFileScanner", () => {
    it("flags the EICAR signature as infected with the canonical threat name", async () => {
      const scanner = new EicarTestFileScanner();
      const eicar = new TextEncoder().encode(EicarTestFileScanner.EICAR_SIGNATURE);
      const result = await scanner.scan({
        body: eicar,
        contentType: "text/plain",
        filename: "eicar.txt",
      });
      expect(result.verdict).toBe("infected");
      expect(result.threatName).toBe("Eicar-Test-Signature");
      expect(result.metadata?.scanner).toBe("eicar-test");
      expect(result.metadata?.filename).toBe("eicar.txt");
    });

    it("returns clean for normal-looking files", async () => {
      const scanner = new EicarTestFileScanner();
      const result = await scanner.scan({
        body: new TextEncoder().encode("hello world"),
        contentType: "text/plain",
      });
      expect(result.verdict).toBe("clean");
      expect(result.threatName).toBeUndefined();
    });

    it("detects the EICAR signature when buried in a larger payload", async () => {
      const scanner = new EicarTestFileScanner();
      const padded = new TextEncoder().encode(
        `padding-prefix\n${EicarTestFileScanner.EICAR_SIGNATURE}\npadding-suffix`,
      );
      const result = await scanner.scan({ body: padded, contentType: "text/plain" });
      expect(result.verdict).toBe("infected");
    });

    it("omits filename from metadata when caller doesn't supply it", async () => {
      const scanner = new EicarTestFileScanner();
      const eicar = new TextEncoder().encode(EicarTestFileScanner.EICAR_SIGNATURE);
      const result = await scanner.scan({ body: eicar, contentType: "text/plain" });
      expect(result.metadata).toBeDefined();
      expect("filename" in (result.metadata ?? {})).toBe(false);
    });
  });

  describe("planScanDisposition", () => {
    it("clean → keep", () => {
      expect(planScanDisposition({ verdict: "clean" })).toBe("keep");
    });

    it("infected → quarantine (always — no override)", () => {
      expect(planScanDisposition({ verdict: "infected" })).toBe("quarantine");
      expect(planScanDisposition({ verdict: "infected", indeterminatePolicy: "reject" })).toBe(
        "quarantine",
      );
      expect(planScanDisposition({ verdict: "infected", indeterminatePolicy: "keep" })).toBe(
        "quarantine",
      );
    });

    it("indeterminate → keep by default (residual risk acceptable)", () => {
      expect(planScanDisposition({ verdict: "indeterminate" })).toBe("keep");
    });

    it("indeterminate + indeterminatePolicy='reject' → reject (strict mode)", () => {
      expect(planScanDisposition({ verdict: "indeterminate", indeterminatePolicy: "reject" })).toBe(
        "reject",
      );
    });

    it("indeterminate + indeterminatePolicy='keep' → keep (explicit)", () => {
      expect(planScanDisposition({ verdict: "indeterminate", indeterminatePolicy: "keep" })).toBe(
        "keep",
      );
    });
  });

  describe("FILE_SCANNER DI token", () => {
    it("is a stable Symbol the FilesModule binds providers against", () => {
      expect(typeof FILE_SCANNER).toBe("symbol");
      expect(FILE_SCANNER.description).toContain("FileScanner");
    });
  });

  describe("FileScanner contract shape", () => {
    it("implementations only need `scan(FileScanInput)` returning Promise<FileScanResult>", () => {
      // Inline custom scanner: verifies the interface is duck-typed
      // small enough that a lambda-style binding satisfies it.
      const custom = {
        async scan(input: FileScanInput) {
          return {
            verdict: input.body.length > 1024 * 1024 ? ("infected" as const) : ("clean" as const),
            metadata: { scanner: "size-based-fake" },
          };
        },
      };
      expect(typeof custom.scan).toBe("function");
    });
  });
});
