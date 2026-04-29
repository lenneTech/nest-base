import { describe, expect, it } from "vitest";

import { resolveEffectiveBaseUrl } from "../../src/core/dx/effective-base-url.js";

const baseUrl = "https://api.proj.localhost";
const port = 3000;

describe("Story · Effective Base URL", () => {
  it("nutzt portless-URL nur wenn PORTLESS_ACTIVE=1 und nicht disabled", () => {
    const r = resolveEffectiveBaseUrl({
      baseUrl,
      port,
      env_vars: { PORTLESS_ACTIVE: "1" },
    });
    expect(r.publicUrl).toBe("https://api.proj.localhost");
    expect(r.viaPortless).toBe(true);
  });

  it("fällt auf localhost zurück, wenn DISABLE_PORTLESS=1 gesetzt ist", () => {
    const r = resolveEffectiveBaseUrl({
      baseUrl,
      port,
      env_vars: { PORTLESS_ACTIVE: "1", DISABLE_PORTLESS: "1" },
    });
    expect(r.publicUrl).toBe("http://localhost:3000");
    expect(r.viaPortless).toBe(false);
  });

  it("fällt auf localhost zurück, wenn PORTLESS_ACTIVE nicht gesetzt", () => {
    const r = resolveEffectiveBaseUrl({ baseUrl, port, env_vars: {} });
    expect(r.publicUrl).toBe("http://localhost:3000");
    expect(r.viaPortless).toBe(false);
  });

  it("loopbackUrl ist immer http://localhost:port", () => {
    expect(
      resolveEffectiveBaseUrl({ baseUrl, port: 4444, env_vars: { PORTLESS_ACTIVE: "1" } })
        .loopbackUrl,
    ).toBe("http://localhost:4444");
  });

  it("strippt trailing slash der baseUrl", () => {
    const r = resolveEffectiveBaseUrl({
      baseUrl: "https://api.proj.localhost/",
      port,
      env_vars: { PORTLESS_ACTIVE: "1" },
    });
    expect(r.publicUrl).toBe("https://api.proj.localhost");
  });
});
