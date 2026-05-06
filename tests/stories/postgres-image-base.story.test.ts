import { describe, expect, it } from "vitest";

/**
 * Story · Postgres Dockerfile uses imresamu/postgis base (TR.DB.04
 * deviation closure — iter-207).
 *
 * Iter-205's `docs/prd-deviations.md` documented TR.DB.04: the PRD
 * pinned `imresamu/postgis:18-3.5 (multi-arch)` but the project's
 * custom Dockerfile built on top of vanilla `postgres:18-bookworm`
 * because `imresamu/postgis:18-3.5` lacked an arm64 manifest at the
 * time. Iter-207 closes the gap: upstream rolled `18-3.5` forward
 * to `18-3.6` (multi-arch — amd64 + arm64), and the project's
 * Dockerfile now layers pg_uuidv7 on top of that base. The runtime
 * contract is unchanged (PostGIS 3.x + pg_uuidv7) but the image
 * source matches the PRD pin shape.
 */
describe("Story · docker/postgres/Dockerfile uses imresamu/postgis base (TR.DB.04 — iter-207)", () => {
  it("FROM line uses imresamu/postgis as the base image", async () => {
    const { readFileSync } = await import("node:fs");
    const dockerfile = readFileSync("docker/postgres/Dockerfile", "utf8");
    expect(dockerfile).toMatch(/FROM\s+imresamu\/postgis:\$\{POSTGRES_VERSION\}-3\.6/);
  });

  it("does NOT use the vanilla postgres:18-bookworm base anymore", async () => {
    const { readFileSync } = await import("node:fs");
    const dockerfile = readFileSync("docker/postgres/Dockerfile", "utf8");
    expect(dockerfile).not.toMatch(/FROM\s+postgres:\$\{POSTGRES_VERSION\}-bookworm/);
  });

  it("still bundles pg_uuidv7 (compiled from source — not in imresamu base)", async () => {
    const { readFileSync } = await import("node:fs");
    const dockerfile = readFileSync("docker/postgres/Dockerfile", "utf8");
    expect(dockerfile).toContain("git clone --depth 1 https://github.com/fboulnois/pg_uuidv7.git");
    expect(dockerfile).toContain("pg_uuidv7.control");
  });

  it("drops the apt-get install postgresql-${PV}-postgis-3 step (now in base image)", async () => {
    const { readFileSync } = await import("node:fs");
    const dockerfile = readFileSync("docker/postgres/Dockerfile", "utf8");
    expect(dockerfile).not.toMatch(/postgresql-\$\{POSTGRES_VERSION\}-postgis-3/);
  });

  it("docs/prd-deviations.md no longer lists TR.DB.04 — Postgres + PostGIS image", async () => {
    const { readFileSync } = await import("node:fs");
    const deviationsSrc = readFileSync("docs/prd-deviations.md", "utf8");
    expect(deviationsSrc).not.toMatch(/^### TR\.DB\.04/m);
  });
});
