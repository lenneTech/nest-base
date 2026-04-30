import { describe, expect, it } from "vitest";

import { selectEmailDriver, type DriverSelectionInput } from "../../src/core/email/email.module.js";

/**
 * Story · Email driver selection.
 *
 * Pure planner used by EmailModule's useFactory to pick a primary +
 * (optional) transactional driver from the active feature flags +
 * env.  Splitting the decision out of the NestJS factory makes it
 * testable without the IoC container.
 *
 * Selection rules:
 *   email.enabled === false           → log-only (always)
 *   provider="smtp"                   → smtp primary, brevo
 *                                       transactional iff BREVO_API_KEY set
 *   provider="brevo" + key present    → brevo for both
 *   provider="brevo" + key missing    → fall back to smtp primary,
 *                                       no transactional (matches the
 *                                       fail-safe convention so dev
 *                                       containers still send to
 *                                       Mailpit when Brevo is misconfigured)
 *   no SMTP_HOST                      → log-only (offline dev)
 */
describe("Story · Email driver selection", () => {
  function input(overrides: Partial<DriverSelectionInput> = {}): DriverSelectionInput {
    return {
      enabled: true,
      provider: "smtp",
      env: {
        SMTP_HOST: "localhost",
        SMTP_PORT: "1025",
      },
      ...overrides,
    };
  }

  it("returns log-only when email feature is disabled", () => {
    const sel = selectEmailDriver(input({ enabled: false }));
    expect(sel.primary).toBe("log-only");
    expect(sel.transactional).toBeUndefined();
  });

  it("returns log-only when SMTP_HOST is missing in dev (no relay reachable)", () => {
    const sel = selectEmailDriver(input({ env: {} }));
    expect(sel.primary).toBe("log-only");
  });

  it("picks SMTP for provider=smtp when SMTP_HOST is set", () => {
    const sel = selectEmailDriver(input());
    expect(sel.primary).toBe("smtp");
  });

  it("attaches Brevo as transactional driver when BREVO_API_KEY is set, even with provider=smtp", () => {
    const sel = selectEmailDriver(
      input({
        env: { SMTP_HOST: "localhost", SMTP_PORT: "1025", BREVO_API_KEY: "xkeysib-..." },
      }),
    );
    expect(sel.primary).toBe("smtp");
    expect(sel.transactional).toBe("brevo");
  });

  it("picks Brevo for provider=brevo when BREVO_API_KEY is set (primary + transactional)", () => {
    const sel = selectEmailDriver(
      input({
        provider: "brevo",
        env: { BREVO_API_KEY: "xkeysib-..." },
      }),
    );
    expect(sel.primary).toBe("brevo");
    expect(sel.transactional).toBe("brevo");
  });

  it("falls back to SMTP when provider=brevo but no BREVO_API_KEY (visible misconfig instead of silent log-only)", () => {
    const sel = selectEmailDriver(
      input({ provider: "brevo", env: { SMTP_HOST: "localhost", SMTP_PORT: "1025" } }),
    );
    expect(sel.primary).toBe("smtp");
    expect(sel.transactional).toBeUndefined();
  });

  it("returns log-only when provider=brevo and neither BREVO_API_KEY nor SMTP_HOST are configured", () => {
    const sel = selectEmailDriver(input({ provider: "brevo", env: {} }));
    expect(sel.primary).toBe("log-only");
    expect(sel.transactional).toBeUndefined();
  });
});
