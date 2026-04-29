import { describe, expect, it } from "vitest";

import { parseDatabaseUrlForProbe } from "../../src/core/dx/parse-database-url.js";

/**
 * Story · DATABASE_URL parser for the onboard TCP probe.
 *
 * `bun run onboard` previously reported "Postgres reachable" purely
 * by `new URL(DATABASE_URL)` succeeding — a syntactically valid URL
 * with the wrong host/port returned `true`, so a contributor with a
 * misconfigured `.env` got false confidence and an opaque Prisma
 * error later. The runner now does an honest TCP probe; this planner
 * extracts the (host, port) the probe needs.
 */
describe("Story · parseDatabaseUrlForProbe", () => {
  it("extracts host and port from a standard postgres:// URL", () => {
    expect(parseDatabaseUrlForProbe("postgres://user:pw@localhost:5432/app")).toEqual({
      host: "localhost",
      port: 5432,
    });
  });

  it("supports the `postgresql://` scheme too", () => {
    expect(parseDatabaseUrlForProbe("postgresql://u:p@db.local:6543/app")).toEqual({
      host: "db.local",
      port: 6543,
    });
  });

  it("defaults the port to 5432 when omitted", () => {
    expect(parseDatabaseUrlForProbe("postgres://u:p@localhost/app")).toEqual({
      host: "localhost",
      port: 5432,
    });
  });

  it("decodes percent-encoded host (rare but legal — e.g. unix socket path)", () => {
    expect(parseDatabaseUrlForProbe("postgres://u:p@%2Fvar%2Frun%2Fpg/app")).toEqual({
      host: "/var/run/pg",
      port: 5432,
    });
  });

  it("returns null for a non-postgres scheme", () => {
    expect(parseDatabaseUrlForProbe("mysql://localhost:3306/app")).toBeNull();
  });

  it("returns null for malformed URLs", () => {
    expect(parseDatabaseUrlForProbe("not-a-url")).toBeNull();
    expect(parseDatabaseUrlForProbe("")).toBeNull();
    expect(parseDatabaseUrlForProbe(undefined)).toBeNull();
  });

  it("returns null for an empty hostname", () => {
    // Why: `postgres:///` parses as a URL but has no host to probe.
    expect(parseDatabaseUrlForProbe("postgres:///app")).toBeNull();
  });
});
