import { describe, expect, it, vi } from "vitest";

import {
  createDeviceHandlingRunner,
  formatLocation,
  type DeviceEmailDispatcher,
  type DeviceHandlingSessionStore,
} from "../../src/core/devices/device-handling.runner.js";
import type { KnownSession } from "../../src/core/devices/device-handling.js";

/**
 * Story · Device-handling runner.
 *
 * The runner glues the planner trio (fingerprint + ua-parser +
 * decideDeviceHandling) onto a session store, an email dispatcher,
 * and an optional GeoIP service. Failure semantics are the headline
 * — every error here MUST be swallowed; the auth flow already
 * succeeded by the time this hook runs.
 */
describe("Story · device-handling runner", () => {
  function fakeStore(initial: KnownSession[] = []): DeviceHandlingSessionStore & {
    fingerprintWrites: Array<{ id: string; fp: string }>;
    revokes: string[];
    sessions: KnownSession[];
  } {
    const sessions: KnownSession[] = [...initial];
    const fingerprintWrites: Array<{ id: string; fp: string }> = [];
    const revokes: string[] = [];
    return {
      sessions,
      fingerprintWrites,
      revokes,
      async setFingerprint(sessionId, fp) {
        fingerprintWrites.push({ id: sessionId, fp });
        const existing = sessions.find((s) => s.id === sessionId);
        if (existing) existing.fingerprintHash = fp;
        else
          sessions.push({
            id: sessionId,
            fingerprintHash: fp,
            lastSeenAt: new Date("2026-04-30T10:00:00Z"),
            createdAt: new Date("2026-04-30T10:00:00Z"),
          });
      },
      async listForUser() {
        return sessions;
      },
      async revoke(id) {
        revokes.push(id);
        const idx = sessions.findIndex((s) => s.id === id);
        if (idx >= 0) sessions.splice(idx, 1);
        return idx >= 0;
      },
    };
  }

  function fakeEmail(): DeviceEmailDispatcher & {
    sends: Array<{
      userId: string;
      fingerprint: string;
      deviceLabel: string;
      location: string;
      ipAddress: string;
      revokeUrl: string;
    }>;
  } {
    const sends: Array<{
      userId: string;
      fingerprint: string;
      deviceLabel: string;
      location: string;
      ipAddress: string;
      revokeUrl: string;
    }> = [];
    return {
      sends,
      async sendNewDevice(input) {
        sends.push({
          userId: input.user.id,
          fingerprint: input.fingerprint,
          deviceLabel: input.deviceLabel,
          location: input.location,
          ipAddress: input.ipAddress,
          revokeUrl: input.revokeUrl,
        });
      },
    };
  }

  const baseConfig = {
    enabled: true,
    notifyOnNewDevice: true,
    maxDevicesPerUser: 5,
    fingerprintMode: "userAgent+ipSubnet" as const,
    appBaseUrl: "https://app.example.com",
  };
  const user = { id: "u1", email: "alice@example.com", name: "Alice" };
  const silentLogger = { warn: vi.fn(), error: vi.fn(), log: vi.fn() };

  it("becomes a no-op when the feature is disabled", async () => {
    const store = fakeStore();
    const email = fakeEmail();
    const runner = createDeviceHandlingRunner({
      store,
      email,
      config: { ...baseConfig, enabled: false },
      logger: silentLogger,
    });
    await runner.handleSessionCreated({
      sessionId: "current",
      user,
      userAgent: "Mozilla/5.0 Chrome/127.0",
      ipAddress: "203.0.113.10",
    });
    expect(store.fingerprintWrites).toHaveLength(0);
    expect(email.sends).toHaveLength(0);
  });

  it("persists the fingerprint and skips email on first sign-in", async () => {
    const store = fakeStore();
    const email = fakeEmail();
    const runner = createDeviceHandlingRunner({
      store,
      email,
      config: baseConfig,
      logger: silentLogger,
    });
    await runner.handleSessionCreated({
      sessionId: "current",
      user,
      userAgent: "Mozilla/5.0 Chrome/127.0",
      ipAddress: "203.0.113.10",
    });
    expect(store.fingerprintWrites).toHaveLength(1);
    expect(email.sends).toHaveLength(0);
  });

  it("emits a new-device email when the fingerprint is new", async () => {
    // Seed the user with one PRIOR session that has a different fp;
    // then the current sign-in is "new device".
    const store = fakeStore([
      {
        id: "old",
        fingerprintHash: "prior-fp",
        lastSeenAt: new Date("2026-04-29T09:00:00Z"),
        createdAt: new Date("2026-04-29T09:00:00Z"),
      },
    ]);
    const email = fakeEmail();
    const runner = createDeviceHandlingRunner({
      store,
      email,
      config: baseConfig,
      logger: silentLogger,
    });
    await runner.handleSessionCreated({
      sessionId: "current",
      user,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/127.0",
      ipAddress: "203.0.113.10",
    });
    expect(email.sends).toHaveLength(1);
    expect(email.sends[0]?.deviceLabel).toMatch(/Chrome/);
    expect(email.sends[0]?.revokeUrl).toBe("https://app.example.com/me/devices");
    // No GeoIP wired → location falls back to "Location unknown".
    expect(email.sends[0]?.location).toBe("Location unknown");
    // When location is unknown we DO surface the IP so the user
    // has SOMETHING to cross-check.
    expect(email.sends[0]?.ipAddress).toBe("203.0.113.10");
  });

  it("revokes the oldest session when the cap is exceeded", async () => {
    // Cap=2. One prior session; current sign-in is the 2nd. Total
    // after = 2 → no revoke. Bump cap to 1 to exceed.
    const store = fakeStore([
      {
        id: "old",
        fingerprintHash: "prior-fp",
        lastSeenAt: new Date("2026-04-29T09:00:00Z"),
        createdAt: new Date("2026-04-29T09:00:00Z"),
      },
    ]);
    const email = fakeEmail();
    const runner = createDeviceHandlingRunner({
      store,
      email,
      config: { ...baseConfig, maxDevicesPerUser: 1 },
      logger: silentLogger,
    });
    await runner.handleSessionCreated({
      sessionId: "current",
      user,
      userAgent: "Mozilla/5.0 Chrome/127.0",
      ipAddress: "203.0.113.10",
    });
    expect(store.revokes).toEqual(["old"]);
    expect(email.sends).toHaveLength(1);
  });

  it("renders city + country from a GeoIP lookup", async () => {
    const store = fakeStore([
      {
        id: "old",
        fingerprintHash: "prior-fp",
        lastSeenAt: new Date("2026-04-29T09:00:00Z"),
        createdAt: new Date("2026-04-29T09:00:00Z"),
      },
    ]);
    const email = fakeEmail();
    const runner = createDeviceHandlingRunner({
      store,
      email,
      geoIp: {
        async lookup() {
          // Even when lat/lng are present, the runner must drop
          // them — only city + country reach the email body.
          return {
            country: "Germany",
            city: "Berlin",
            latitude: 52.52,
            longitude: 13.405,
          };
        },
      },
      config: baseConfig,
      logger: silentLogger,
    });
    await runner.handleSessionCreated({
      sessionId: "current",
      user,
      userAgent: "Mozilla/5.0 Chrome/127.0",
      ipAddress: "203.0.113.10",
    });
    expect(email.sends).toHaveLength(1);
    expect(email.sends[0]?.location).toBe("Berlin, Germany");
    // Location resolved → IP NOT surfaced in body (privacy).
    expect(email.sends[0]?.ipAddress).toBe("");
  });

  it("swallows errors so the auth flow stays unblocked", async () => {
    const store: DeviceHandlingSessionStore = {
      async setFingerprint() {
        throw new Error("DB exploded");
      },
      async listForUser() {
        return [];
      },
      async revoke() {
        return false;
      },
    };
    const email = fakeEmail();
    const runner = createDeviceHandlingRunner({
      store,
      email,
      config: baseConfig,
      logger: silentLogger,
    });
    // Should NOT throw.
    await expect(
      runner.handleSessionCreated({
        sessionId: "current",
        user,
        userAgent: "Mozilla/5.0 Chrome/127.0",
        ipAddress: "203.0.113.10",
      }),
    ).resolves.toBeUndefined();
    expect(silentLogger.error).toHaveBeenCalled();
  });

  describe("formatLocation()", () => {
    it("composes 'City, Country' when both are present", () => {
      expect(formatLocation({ city: "Berlin", country: "Germany" })).toBe("Berlin, Germany");
    });
    it("falls back to country alone", () => {
      expect(formatLocation({ country: "Germany" })).toBe("Germany");
    });
    it("falls back to city alone", () => {
      expect(formatLocation({ city: "Berlin" })).toBe("Berlin");
    });
    it("returns 'Location unknown' for null / empty input", () => {
      expect(formatLocation(null)).toBe("Location unknown");
      expect(formatLocation({})).toBe("Location unknown");
    });
    it("ignores lat/lng even when present (privacy contract)", () => {
      expect(formatLocation({ latitude: 52.52, longitude: 13.405 })).toBe("Location unknown");
    });
  });
});
