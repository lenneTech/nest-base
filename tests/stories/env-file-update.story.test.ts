import { describe, expect, it } from "vitest";

import { planEnvFileUpdate } from "../../src/core/dx/env-file-update.js";

describe("Story · ENV-File Update Planner", () => {
  it("ersetzt eine bestehende Zeile in-place", () => {
    const r = planEnvFileUpdate({
      current: "FOO=1\nFEATURE_X_ENABLED=false\nBAR=2\n",
      key: "FEATURE_X_ENABLED",
      value: "true",
    });
    expect(r.action).toBe("replaced");
    expect(r.next).toBe("FOO=1\nFEATURE_X_ENABLED=true\nBAR=2\n");
    expect(r.lineNumber).toBe(2);
  });

  it("hängt einen neuen Key am Ende mit Marker an", () => {
    const r = planEnvFileUpdate({
      current: "FOO=1\nBAR=2\n",
      key: "FEATURE_X_ENABLED",
      value: "true",
    });
    expect(r.action).toBe("appended");
    expect(r.next).toContain("# Managed by /hub/features");
    expect(r.next).toContain("FEATURE_X_ENABLED=true");
  });

  it("nutzt den Marker beim zweiten Append nicht doppelt", () => {
    const start = "FOO=1\n\n# Managed by /hub/features\nFEATURE_A_ENABLED=true\n";
    const r = planEnvFileUpdate({
      current: start,
      key: "FEATURE_B_ENABLED",
      value: "true",
    });
    const markers = r.next.match(/# Managed by \/hub\/features/g) ?? [];
    expect(markers).toHaveLength(1);
    expect(r.next).toContain("FEATURE_B_ENABLED=true");
  });

  it("erhält trailing comments beim Replace", () => {
    const r = planEnvFileUpdate({
      current: "DATABASE_URL=postgres://x  # connection string\n",
      key: "DATABASE_URL",
      value: "postgres://y",
    });
    expect(r.next).toBe("DATABASE_URL=postgres://y # connection string\n");
  });

  it("erhält fehlenden trailing newline", () => {
    const r = planEnvFileUpdate({ current: "FOO=1", key: "FOO", value: "2" });
    expect(r.next).toBe("FOO=2");
  });

  it("akzeptiert leeren Input", () => {
    const r = planEnvFileUpdate({ current: "", key: "FEATURE_X_ENABLED", value: "true" });
    expect(r.action).toBe("appended");
    expect(r.next).toContain("FEATURE_X_ENABLED=true");
  });

  it("validiert Key-Schreibweise", () => {
    expect(() => planEnvFileUpdate({ current: "", key: "feature_x", value: "true" })).toThrow(
      /invalid key/,
    );
    expect(() => planEnvFileUpdate({ current: "", key: "FOO BAR", value: "true" })).toThrow(
      /invalid key/,
    );
  });

  it("verbietet Newlines im Wert", () => {
    expect(() => planEnvFileUpdate({ current: "", key: "FOO", value: "a\nb" })).toThrow(/newline/);
  });

  it("ignoriert Kommentar-Zeilen beim Suchen nach Key", () => {
    const start = "# FEATURE_X_ENABLED=false (commented out)\nFEATURE_X_ENABLED=false\n";
    const r = planEnvFileUpdate({
      current: start,
      key: "FEATURE_X_ENABLED",
      value: "true",
    });
    expect(r.next).toBe("# FEATURE_X_ENABLED=false (commented out)\nFEATURE_X_ENABLED=true\n");
  });
});
