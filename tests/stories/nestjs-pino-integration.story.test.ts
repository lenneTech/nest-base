import { describe, expect, it } from "vitest";

/**
 * Story · nestjs-pino LoggerModule integration (CF.OBS deviation closure
 * — iter-206).
 *
 * The PRD's TR.BE row pins "Pino 10 + nestjs-pino + pino-pretty (dev)"
 * as the logger stack. Iter-205's `docs/prd-deviations.md` documented
 * that `nestjs-pino` was missing because the project's
 * `RequestContextMiddleware` already provided per-request correlation
 * IDs, making the wrapper feel duplicate. Iter-206 adopts it anyway —
 * the wrapper adds an HTTP-request-level structured log surface (for
 * external integrations consuming `req.log`) that complements the
 * request-context middleware. The pinoHttp middleware is configured
 * for performance — disabled in test env so the SC.PERF.02 ≤ 50 ms
 * /health/live median budget holds.
 *
 * The story drives the wiring at the source-file level so the
 * integration is checked at the gate, not just at boot.
 */
describe("Story · nestjs-pino LoggerModule integration (CF.OBS — iter-206)", () => {
  it("package.json declares nestjs-pino as a runtime dep", async () => {
    const { readFileSync } = await import("node:fs");
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["nestjs-pino"]).toBeDefined();
  });

  it("AppModule imports LoggerModule.forRootAsync with the existing createLogger() output", async () => {
    const { readFileSync } = await import("node:fs");
    const moduleSrc = readFileSync("src/core/app/app.module.ts", "utf8");
    expect(moduleSrc).toContain('from "nestjs-pino"');
    expect(moduleSrc).toContain("LoggerModule.forRootAsync");
    // The factory must seed pino-http with the existing createLogger
    // output so dev-pretty + log-buffer + sink-stream semantics survive.
    expect(moduleSrc).toMatch(/createLogger\(\{\s*env:\s*cfg\.env/);
  });

  it("LoggerModule.forRootAsync wires test-env autoLogging:false to keep SC.PERF.02 health-latency budget", async () => {
    const { readFileSync } = await import("node:fs");
    const moduleSrc = readFileSync("src/core/app/app.module.ts", "utf8");
    // Test env must disable autoLogging entirely (isTest ? false : ...)
    expect(moduleSrc).toMatch(/autoLogging:\s*isTest\s*\?\s*false/);
    expect(moduleSrc).toMatch(/quietReqLogger:\s*isTest/);
    // Non-test env routes success logs to debug so info output stays clean
    expect(moduleSrc).toMatch(/customLogLevel/);
    expect(moduleSrc).toMatch(/return\s*"debug"/);
  });

  it("bootstrap.ts swaps app.useLogger to nestjs-pino's Logger when no test override is supplied", async () => {
    const { readFileSync } = await import("node:fs");
    const bootstrapSrc = readFileSync("src/core/app/bootstrap.ts", "utf8");
    expect(bootstrapSrc).toMatch(/import\s+\{\s*Logger\s*\}\s+from\s+"nestjs-pino"/);
    expect(bootstrapSrc).toMatch(/app\.useLogger\(app\.get\(Logger\)\)/);
    // Test override path is preserved — `options.logger` short-circuits
    // the swap so `SILENT_LOGGER` keeps controlling Nest's lifecycle
    // logger across the entire app lifetime.
    expect(bootstrapSrc).toMatch(/if\s*\(\s*!options\.logger\s*\)/);
  });

  it("LogLevel includes 'silent' so test env can quiet the injectable Pino", async () => {
    const { readFileSync } = await import("node:fs");
    const loggerSrc = readFileSync("src/core/observability/logger.ts", "utf8");
    expect(loggerSrc).toMatch(/"silent"/);
  });

  it("docs/prd-deviations.md no longer lists CF.OBS — Pino integration", async () => {
    const { readFileSync } = await import("node:fs");
    const deviationsSrc = readFileSync("docs/prd-deviations.md", "utf8");
    expect(deviationsSrc).not.toMatch(/^### CF\.OBS — Pino integration/m);
  });
});
