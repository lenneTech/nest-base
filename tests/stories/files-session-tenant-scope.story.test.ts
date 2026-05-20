import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const FILES_MODULE = resolve(ROOT, "src/core/files/files.module.ts");

describe("Story · files API session tenant scope", () => {
  it("FileController and FolderController do not accept tenantId query params", () => {
    const src = readFileSync(FILES_MODULE, "utf8");
    expect(src).not.toContain('@Query("tenantId")');
    expect(src).toContain("requireTenantContext()");
  });

  it("single-shot upload derives tenantId from session context", () => {
    const src = readFileSync(FILES_MODULE, "utf8");
    expect(src).not.toMatch(/body\.tenantId/);
    expect(src).toContain("const tenantId = requireTenantContext()");
  });

  it("metadata create derives tenantId from session context, not request body", () => {
    const src = readFileSync(FILES_MODULE, "utf8");
    expect(src).toMatch(/async create\(@Body\(\) body: CreateFileHttpBody\)/);
    expect(src).not.toMatch(/return this\.service\.create\(body\)/);
    expect(src).toMatch(
      /const tenantId = requireTenantContext\(\)[\s\S]*?this\.service\.create\(\{ \.\.\.body, tenantId \}\)/,
    );
  });
});
