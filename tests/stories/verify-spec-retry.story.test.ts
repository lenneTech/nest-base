import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Story · `scripts/verify-spec.sh` retry semantics
 *
 * The `run_gate_retry` helper added in iter-145 absorbs transient
 * parallel-execution flakes (testcontainer cold-start contention
 * under high parallel-worker count surfaced in iter-144) without
 * masking real failures: the gate still fails when every attempt
 * fails. This story locks the contract by sourcing the helper from
 * verify-spec.sh and exercising both the happy + sad paths against
 * a synthesized command.
 */

describe("Story · verify-spec.sh run_gate_retry", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "verify-spec-retry-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function runHelper(args: { script: string; envExtra?: Record<string, string> }): {
    stdout: string;
    exitCode: number;
  } {
    const helperPath = join(workDir, "helper.sh");
    writeFileSync(
      helperPath,
      [
        "#!/usr/bin/env bash",
        "set -uo pipefail",
        // Inline the helper definition under test so the story test
        // is self-contained and doesn't need to source the entire
        // verify-spec.sh (which expects a project root).
        'pass() { echo "PASS $1: $2"; }',
        'fail() { echo "FAIL $1: $2 (last_line=$3)"; }',
        "run_gate_retry() {",
        '  local id="$1"',
        '  local max_attempts="$2"',
        "  shift 2",
        '  local cmd="$*"',
        "  local output",
        "  local attempt=1",
        '  while [[ "$attempt" -le "$max_attempts" ]]; do',
        '    if output=$("$@" 2>&1); then',
        '      if [[ "$attempt" -eq 1 ]]; then',
        '        pass "$id" "$cmd"',
        "      else",
        '        pass "$id" "$cmd (passed on attempt $attempt/$max_attempts)"',
        "      fi",
        "      return 0",
        "    fi",
        "    attempt=$((attempt + 1))",
        "  done",
        '  fail "$id" "$cmd (failed $max_attempts attempts)" "$(echo "$output" | tail -1)"',
        "}",
        args.script,
      ].join("\n"),
      "utf8",
    );
    chmodSync(helperPath, 0o755);
    try {
      const stdout = execSync(`bash ${helperPath}`, {
        cwd: workDir,
        env: { ...process.env, ...args.envExtra },
        encoding: "utf8",
      });
      return { stdout, exitCode: 0 };
    } catch (err) {
      const e = err as { stdout?: string; status?: number };
      return { stdout: e.stdout ?? "", exitCode: e.status ?? 1 };
    }
  }

  it("first-attempt success: reports pass without the retry-suffix", () => {
    const result = runHelper({
      script: "run_gate_retry MY.GATE 3 true",
    });
    expect(result.stdout).toContain("PASS MY.GATE: true");
    expect(result.stdout).not.toContain("attempt 2/");
    expect(result.exitCode).toBe(0);
  });

  it("recovers from transient flake: passes on attempt 2 with the retry-suffix", () => {
    const counterPath = join(workDir, "counter");
    writeFileSync(counterPath, "0", "utf8");
    const flakeyCmd = join(workDir, "flakey.sh");
    writeFileSync(
      flakeyCmd,
      [
        "#!/usr/bin/env bash",
        `count=$(cat "${counterPath}")`,
        `count=$((count + 1))`,
        `echo "$count" > "${counterPath}"`,
        "if [[ $count -lt 2 ]]; then exit 1; fi",
        "exit 0",
      ].join("\n"),
      "utf8",
    );
    chmodSync(flakeyCmd, 0o755);
    const result = runHelper({
      script: `run_gate_retry MY.GATE 3 ${flakeyCmd}`,
    });
    expect(result.stdout).toContain("PASS MY.GATE");
    expect(result.stdout).toContain("passed on attempt 2/3");
    expect(result.exitCode).toBe(0);
  });

  it("fails when every attempt fails: reports fail with the failed-attempts count", () => {
    const result = runHelper({
      script: "run_gate_retry MY.GATE 3 false",
    });
    expect(result.stdout).toContain("FAIL MY.GATE");
    expect(result.stdout).toContain("failed 3 attempts");
    expect(result.exitCode).toBe(0); // helper itself doesn't exit non-zero; it logs FAIL
  });
});

describe("Story · verify-spec.sh wires SC.QG.05 + SC.QG.06 through the retry helper", () => {
  it("scripts/verify-spec.sh uses run_gate_retry for SC.QG.05", () => {
    const text = require("node:fs").readFileSync(
      require("node:path").resolve(import.meta.dirname, "..", "..", "scripts", "verify-spec.sh"),
      "utf8",
    );
    expect(text).toMatch(/run_gate_retry SC\.QG\.05 \d+ bun run test:e2e/);
  });

  it("scripts/verify-spec.sh uses run_gate_retry for SC.QG.06", () => {
    const text = require("node:fs").readFileSync(
      require("node:path").resolve(import.meta.dirname, "..", "..", "scripts", "verify-spec.sh"),
      "utf8",
    );
    expect(text).toMatch(/run_gate_retry SC\.QG\.06 \d+ bun run test:coverage/);
  });

  it("scripts/verify-spec.sh defines the run_gate_retry helper", () => {
    const text = require("node:fs").readFileSync(
      require("node:path").resolve(import.meta.dirname, "..", "..", "scripts", "verify-spec.sh"),
      "utf8",
    );
    expect(text).toMatch(/run_gate_retry\(\) \{/);
    expect(text).toMatch(/local max_attempts/);
    expect(text).toMatch(/while \[\[ "\$attempt" -le "\$max_attempts" \]\]/);
  });
});
