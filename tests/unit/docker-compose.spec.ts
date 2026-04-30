import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");
const COMPOSE = resolve(ROOT, "docker-compose.yml");
const PACKAGE = resolve(ROOT, "package.json");

/**
 * `docker-compose.yml` provides ONLY local dev dependencies — the
 * server itself runs natively via `bun --watch`.
 *
 * The compose file must declare exactly the four backing services
 * Postgres / RustFS / Mailpit / OTel-Collector. No `api`/`server`/
 * `app`/`web` services — that would tempt consumers into baking the
 * template repo into a deployable image.
 */
describe("docker-compose.yml (dev dependencies only)", () => {
  const yaml = existsSync(COMPOSE) ? readFileSync(COMPOSE, "utf8") : "";

  it("exists at the repo root", () => {
    expect(existsSync(COMPOSE)).toBe(true);
  });

  it("declares the four required dependency services", () => {
    expect(yaml).toMatch(/^\s{2}postgres:/m);
    expect(yaml).toMatch(/^\s{2}rustfs:/m);
    expect(yaml).toMatch(/^\s{2}mailpit:/m);
    expect(yaml).toMatch(/^\s{2}otel-collector:/m);
  });

  it("does NOT declare a server / api / app / web service", () => {
    expect(yaml).not.toMatch(/^\s{2}(?:api|server|app|web|backend):/m);
  });

  it("builds a custom Postgres image (postgis + pg_uuidv7 baked in)", () => {
    // We ship docker/postgres/Dockerfile that bundles both extensions; vanilla
    // `postgres:*-alpine` lacks pg_uuidv7 and PostGIS doesn't support PG18 yet.
    expect(yaml).toMatch(/build:\s*[\s\S]*?context:\s*\.\/docker\/postgres/);
    expect(yaml).toMatch(/image:\s*nest-base-postgres:local/);
  });

  it("uses RustFS as the S3 backend", () => {
    expect(yaml).toMatch(/rustfs\/rustfs/);
    expect(yaml).not.toMatch(/minio\/minio/);
  });

  it("exposes a healthcheck for Postgres so dependent services wait correctly", () => {
    expect(yaml).toMatch(/pg_isready/);
  });

  it("package.json `dev` script runs the server natively (no docker exec on api/server)", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE, "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.dev).toBeDefined();
    expect(pkg.scripts.dev).toMatch(/bun\s+(?:--watch|run\s+scripts\/dev\.ts)/);
    expect(pkg.scripts.dev).not.toMatch(/docker(?:-compose)?\s+(?:up|run|exec)\s+(?:api|server)/);
  });

  it("Mailpit exposes its SMTP and Web-UI ports (1025 + 8025)", () => {
    expect(yaml).toMatch(/['"]?1025/);
    expect(yaml).toMatch(/['"]?8025/);
  });

  it("OTel collector exposes OTLP gRPC (4317) and HTTP (4318)", () => {
    expect(yaml).toMatch(/['"]?4317/);
    expect(yaml).toMatch(/['"]?4318/);
  });

  it("does NOT hard-code a project `name:` (each workspace inherits its parent dir)", () => {
    // Hard-coding `name: nest-base` would make every `--next` workspace share
    // the same compose project namespace and therefore the same volumes —
    // re-running `bun run setup` in a new workspace re-uses the previous
    // workspace's POSTGRES_PASSWORD and migrations fail with P1000 auth.
    expect(yaml).not.toMatch(/^name:\s*\S+/m);
  });

  it("puts dependency services on a shared private network", () => {
    expect(yaml).toMatch(/^networks:/m);
    expect(yaml).toMatch(/^\s{2}default:/m);
  });
});
