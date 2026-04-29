import { describe, expect, it } from "vitest";

import { planBrowserOpen } from "../../src/core/dx/browser-open.js";

describe("Story · Browser-Auto-Open", () => {
  const base = {
    url: "http://localhost:3000/dev",
    env: "development" as const,
    isTTY: true,
  };

  it("plant `open` für macOS", () => {
    const plan = planBrowserOpen({ ...base, platform: "darwin" });
    expect(plan).toEqual({ action: "open", command: "open", args: ["http://localhost:3000/dev"] });
  });

  it("plant `xdg-open` für Linux", () => {
    const plan = planBrowserOpen({ ...base, platform: "linux" });
    expect(plan).toEqual({
      action: "open",
      command: "xdg-open",
      args: ["http://localhost:3000/dev"],
    });
  });

  it("plant `cmd /c start` für Windows", () => {
    const plan = planBrowserOpen({ ...base, platform: "win32" });
    expect(plan).toEqual({
      action: "open",
      command: "cmd",
      args: ["/c", "start", "", "http://localhost:3000/dev"],
    });
  });

  it("skip außerhalb von dev", () => {
    expect(planBrowserOpen({ ...base, platform: "darwin", env: "production" })).toMatchObject({
      action: "skip",
      reason: expect.stringContaining("production"),
    });
    expect(planBrowserOpen({ ...base, platform: "darwin", env: "test" })).toMatchObject({
      action: "skip",
    });
  });

  it("skip wenn nicht TTY", () => {
    expect(planBrowserOpen({ ...base, platform: "darwin", isTTY: false })).toMatchObject({
      action: "skip",
      reason: expect.stringContaining("TTY"),
    });
  });

  it("skip unter CI", () => {
    expect(
      planBrowserOpen({ ...base, platform: "darwin", env_vars: { CI: "true" } }),
    ).toMatchObject({
      action: "skip",
      reason: expect.stringContaining("CI"),
    });
  });

  it("skip mit NO_OPEN=1", () => {
    expect(
      planBrowserOpen({ ...base, platform: "darwin", env_vars: { NO_OPEN: "1" } }),
    ).toMatchObject({ action: "skip" });
  });

  it("skip mit BROWSER=none", () => {
    expect(
      planBrowserOpen({ ...base, platform: "darwin", env_vars: { BROWSER: "none" } }),
    ).toMatchObject({ action: "skip" });
  });

  it("skip auf unbekannten Plattformen", () => {
    expect(planBrowserOpen({ ...base, platform: "other" })).toMatchObject({ action: "skip" });
  });
});
