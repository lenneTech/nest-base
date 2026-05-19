import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildPortlessAppBaseUrl,
  buildPortlessRunCommand,
  planDevChildEnv,
  resolveDevPort,
  shouldUsePortless,
} from "../../src/core/dev/portless.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const PORTLESS_YML = resolve(ROOT, "portless.yml");
const PACKAGE_JSON = resolve(ROOT, "package.json");

/**
 * portless integration.
 *
 * Local dev routing exposes services under `<service>.<project>.localhost`
 * with automatic HTTPS (mkcert). `bun run dev` boots portless when it's
 * available; otherwise it falls back to a dynamically assigned port so
 * devs without portless are not blocked.
 */
describe("portless config", () => {
  const yaml = existsSync(PORTLESS_YML) ? readFileSync(PORTLESS_YML, "utf8") : "";
  // Read the project name from package.json so this stays correct
  // through `bun run rename`. After Option B unification, `project:` in
  // portless.yml MUST equal package.json["name"].
  const pkgName = (JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as { name: string }).name;
  const escaped = pkgName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  it('declares the project name matching package.json["name"]', () => {
    expect(yaml).toMatch(new RegExp(`^project:\\s*${escaped}\\b`, "m"));
  });

  it("routes the API service to the running server", () => {
    expect(yaml).toMatch(/^\s{2}api:/m);
    expect(yaml).toMatch(new RegExp(`api\\.${escaped}\\.localhost`));
  });

  it("routes the dev panels for Mailpit and RustFS", () => {
    expect(yaml).toMatch(new RegExp(`mail\\.${escaped}\\.localhost`));
    expect(yaml).toMatch(new RegExp(`s3\\.${escaped}\\.localhost`));
  });
});

describe("dev runner", () => {
  describe("shouldUsePortless()", () => {
    it("returns false when the portless binary is not on PATH", () => {
      expect(shouldUsePortless({ portlessPath: undefined })).toBe(false);
    });

    it("returns true when a portless binary path is provided", () => {
      expect(shouldUsePortless({ portlessPath: "/usr/local/bin/portless" })).toBe(true);
    });

    it("respects an explicit DISABLE_PORTLESS=1 override even when the binary is present", () => {
      expect(shouldUsePortless({ portlessPath: "/bin/portless", disable: true })).toBe(false);
    });
  });

  describe("resolveDevPort()", () => {
    it("returns the configured PORT when set", () => {
      expect(resolveDevPort({ env: { PORT: "4000" }, portlessAvailable: false })).toBe(4000);
    });

    it("returns 3000 (template default) when PORT is unset and portless is available", () => {
      expect(resolveDevPort({ env: {}, portlessAvailable: true })).toBe(3000);
    });

    it("returns 0 (dynamic) when PORT is unset and portless is not available", () => {
      expect(resolveDevPort({ env: {}, portlessAvailable: false })).toBe(0);
    });

    it("throws when PORT is set but not numeric", () => {
      expect(() => resolveDevPort({ env: { PORT: "abc" }, portlessAvailable: true })).toThrow();
    });
  });

  describe("buildPortlessAppBaseUrl()", () => {
    it("returns https://api.<project>.localhost when app is api", () => {
      expect(buildPortlessAppBaseUrl("nest-base")).toBe("https://api.nest-base.localhost");
    });
  });

  describe("planDevChildEnv()", () => {
    it("sets PORTLESS_ACTIVE and portless APP_BASE_URL in portless mode", () => {
      const env = planDevChildEnv({
        baseEnv: { APP_BASE_URL: "http://localhost:3000", FOO: "bar" },
        projectName: "my-app",
        mode: "portless",
        app: "api",
      });
      expect(env.PORTLESS_ACTIVE).toBe("1");
      expect(env.APP_BASE_URL).toBe("https://api.my-app.localhost");
      expect(env.FOO).toBe("bar");
    });

    it("sets PORT and loopback APP_BASE_URL in direct mode", () => {
      const env = planDevChildEnv({
        baseEnv: { APP_BASE_URL: "https://api.old.localhost" },
        projectName: "my-app",
        mode: "direct",
        port: 4266,
      });
      expect(env.PORT).toBe("4266");
      expect(env.APP_BASE_URL).toBe("http://localhost:4266");
      expect(env.PORTLESS_ACTIVE).toBeUndefined();
    });
  });

  describe("buildPortlessRunCommand()", () => {
    // Constructs the argv for `portless run` (portless 0.11+ API). The
    // service URL becomes `https://<app>.<projectName>.localhost`; the
    // `--` separator hands the rest to the spawned dev command.
    it("returns `run --name <app>.<projectName> -- <command>`", () => {
      const args = buildPortlessRunCommand({
        projectName: "my-app",
        app: "api",
        target: ["bun", "--watch", "src/main.ts"],
      });
      expect(args).toEqual(["run", "--name", "api.my-app", "--", "bun", "--watch", "src/main.ts"]);
    });

    it("omits the app prefix when `app` is undefined (URL = project.localhost)", () => {
      const args = buildPortlessRunCommand({
        projectName: "my-app",
        target: ["bun", "src/main.ts"],
      });
      expect(args).toEqual(["run", "--name", "my-app", "--", "bun", "src/main.ts"]);
    });

    it("rejects an empty target array (would spawn nothing)", () => {
      expect(() =>
        buildPortlessRunCommand({ projectName: "my-app", app: "api", target: [] }),
      ).toThrow(/target/);
    });

    it("rejects an empty projectName (URL would be malformed)", () => {
      expect(() =>
        buildPortlessRunCommand({ projectName: "", app: "api", target: ["bun"] }),
      ).toThrow(/projectName/);
    });

    it("inserts --force before the `--` separator when force is true", () => {
      const args = buildPortlessRunCommand({
        projectName: "my-app",
        app: "api",
        target: ["bun", "--watch", "src/main.ts"],
        force: true,
      });
      expect(args).toEqual([
        "run",
        "--name",
        "api.my-app",
        "--force",
        "--",
        "bun",
        "--watch",
        "src/main.ts",
      ]);
    });

    it("omits --force by default (must be opt-in to avoid evicting a live peer)", () => {
      const args = buildPortlessRunCommand({
        projectName: "my-app",
        app: "api",
        target: ["bun", "src/main.ts"],
      });
      expect(args).not.toContain("--force");
    });
  });

  describe("package.json wiring", () => {
    it("the `dev` script delegates to scripts/dev.ts (not directly bun --watch)", () => {
      const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as {
        scripts: Record<string, string>;
      };
      expect(pkg.scripts.dev).toMatch(/scripts\/dev\.ts/);
    });

    it("portless is declared as a devDependency so `bun install` provides the binary", () => {
      const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as {
        devDependencies: Record<string, string>;
      };
      expect(pkg.devDependencies.portless).toBeDefined();
      // Pin to the Vercel-Labs `portless` series — accept any 0.x.
      expect(pkg.devDependencies.portless).toMatch(/^[\^~]?0\./);
    });
  });
});
