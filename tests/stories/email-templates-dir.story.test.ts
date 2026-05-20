import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EMAIL_MODULE_TEMPLATES_DIR_ENV,
  resolveModuleTemplateCoreImportPrefix,
  resolveModuleTemplatesDir,
} from "../../src/core/email/email-templates-dir.js";

/**
 * Story · module email-templates directory resolver.
 *
 * The reader (`ReactEmailTemplateRenderer` / `discoverReactEmailTemplates`)
 * and the writer (`/hub/email-builder/save` + its path-traversal guard)
 * must agree on ONE source of truth for the module-overlay directory.
 *
 * Default: `<root>/src/modules/email/templates`. Override via the
 * `EMAIL_MODULE_TEMPLATES_DIR` env var so parallel test forks can
 * isolate their writes to a private temp dir and stop poisoning
 * concurrent readers (the cross-fork flake fixed here).
 */
describe("Story · module email-templates dir resolver", () => {
  const projectRoot = "/repo";

  describe("resolveModuleTemplatesDir", () => {
    it("defaults to <root>/src/modules/email/templates when env is unset", () => {
      const dir = resolveModuleTemplatesDir({ projectRoot, env: {} });
      expect(dir).toBe(resolve(projectRoot, "src/modules/email/templates"));
    });

    it("defaults when the env var is set to an empty string", () => {
      const dir = resolveModuleTemplatesDir({
        projectRoot,
        env: { [EMAIL_MODULE_TEMPLATES_DIR_ENV]: "" },
      });
      expect(dir).toBe(resolve(projectRoot, "src/modules/email/templates"));
    });

    it("returns the env-override dir (resolved to absolute) when set", () => {
      const dir = resolveModuleTemplatesDir({
        projectRoot,
        env: { [EMAIL_MODULE_TEMPLATES_DIR_ENV]: "/tmp/iso-1234" },
      });
      expect(dir).toBe(resolve("/tmp/iso-1234"));
    });

    it("resolves a relative env-override against the current working dir", () => {
      const dir = resolveModuleTemplatesDir({
        projectRoot,
        env: { [EMAIL_MODULE_TEMPLATES_DIR_ENV]: "tmp/iso" },
      });
      expect(dir).toBe(resolve("tmp/iso"));
    });
  });

  describe("resolveModuleTemplateCoreImportPrefix", () => {
    it("keeps the relative prefix when the dir is the default", () => {
      const prefix = resolveModuleTemplateCoreImportPrefix({ projectRoot, env: {} });
      // Generated `.tsx` lives at src/modules/email/templates/<slug>.tsx;
      // `../../../core/email` reaches src/core/email from there.
      expect(prefix).toBe("../../../core/email");
    });

    it("returns an absolute prefix to src/core/email when the dir is overridden", () => {
      const prefix = resolveModuleTemplateCoreImportPrefix({
        projectRoot,
        env: { [EMAIL_MODULE_TEMPLATES_DIR_ENV]: "/tmp/iso-1234" },
      });
      // The overlay no longer sits at the canonical depth, so the
      // generated file must import core via an absolute path.
      expect(prefix).toBe(resolve(projectRoot, "src/core/email"));
    });
  });
});
