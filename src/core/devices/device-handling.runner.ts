import { Logger } from "@nestjs/common";

import type { GeoIpService } from "../geoip/geoip.service.js";
import type { GeoIpLookupResult } from "../geoip/resolver.js";
import { decideDeviceHandling, type KnownSession } from "./device-handling.js";
import { fingerprintSession, type FingerprintInput, type FingerprintMode } from "./fingerprint.js";
import { parseUserAgent } from "./ua-parser.js";

/**
 * Device-handling orchestrator (runner half).
 *
 * Wires the planner trio (`fingerprintSession`, `parseUserAgent`,
 * `decideDeviceHandling`) into the live system:
 *   - reads the session's UA / IP (Better-Auth's `databaseHooks.session
 *     .create.after` payload),
 *   - hashes the fingerprint,
 *   - persists it on the session row,
 *   - looks up the user's other sessions,
 *   - emits the new-device email through the configured runner
 *     (when the decision is `new-device`),
 *   - revokes the oldest session when the per-user cap is exceeded.
 *
 * Failure semantics: NEVER throw back into the auth flow. The
 * sign-in already succeeded by the time `session.create.after` runs;
 * any DB error / GeoIP outage / mail queue failure is logged and
 * swallowed.
 */

export interface DeviceHandlingSessionStore {
  /** Persists the fingerprint hash on the just-created session row. */
  setFingerprint(sessionId: string, fingerprint: string): Promise<void>;
  /** Returns every non-expired session for the user, including the current one. */
  listForUser(userId: string): Promise<KnownSession[]>;
  /** Revokes (deletes) a session by id. Returns true if a row was removed. */
  revoke(sessionId: string): Promise<boolean>;
}

export interface DeviceHandlingUserLookup {
  findById(userId: string): Promise<{ id: string; email: string; name?: string } | null>;
}

export interface DeviceEmailDispatcher {
  sendNewDevice(input: {
    user: { id: string; email: string; name?: string };
    fingerprint: string;
    deviceLabel: string;
    location: string;
    ipAddress: string;
    signedInAt: string;
    revokeUrl: string;
  }): Promise<void>;
}

export interface DeviceHandlingConfig {
  /** Whole feature toggle — when off the orchestrator becomes a no-op. */
  enabled: boolean;
  notifyOnNewDevice: boolean;
  maxDevicesPerUser: number;
  fingerprintMode: FingerprintMode;
  /** Base URL for the /me/devices link in the new-device email. */
  appBaseUrl: string;
}

export interface DeviceHandlingRunnerOptions {
  store: DeviceHandlingSessionStore;
  email: DeviceEmailDispatcher;
  /**
   * Optional user lookup — when wired, the runner accepts a
   * \`SessionCreatedInput\` carrying only the user id and resolves
   * the email at email-send time. Required for production use
   * because Better-Auth's \`session.create.after\` payload doesn't
   * include the user's email/name.
   */
  userLookup?: DeviceHandlingUserLookup;
  /** Optional GeoIP service — when omitted, the email shows "Location unknown". */
  geoIp?: Pick<GeoIpService, "lookup">;
  config: DeviceHandlingConfig;
  /** Optional clock injection for tests (defaults to `() => new Date()`). */
  now?: () => Date;
  /** Optional logger for diagnostics. */
  logger?: Pick<Logger, "warn" | "error" | "log">;
}

export interface SessionCreatedInput {
  sessionId: string;
  /**
   * Either the full user record (test convenience) OR just the id
   * (production hook). When `user` is supplied as a string, the
   * runner resolves email/name via `userLookup` (if wired); without
   * a lookup, the email step is skipped.
   */
  user: { id: string; email: string; name?: string } | { id: string };
  userAgent: string | null | undefined;
  ipAddress: string | null | undefined;
}

export interface DeviceHandlingRunner {
  handleSessionCreated(input: SessionCreatedInput): Promise<void>;
}

export function createDeviceHandlingRunner(
  options: DeviceHandlingRunnerOptions,
): DeviceHandlingRunner {
  const logger = options.logger ?? new Logger("DeviceHandling");
  const now = options.now ?? ((): Date => new Date());

  return {
    async handleSessionCreated(input: SessionCreatedInput): Promise<void> {
      if (!options.config.enabled) return;
      try {
        const fpInput: FingerprintInput = {
          userAgent: input.userAgent ?? "",
          ip: input.ipAddress ?? "",
          mode: options.config.fingerprintMode,
        };
        const fingerprint = fingerprintSession(fpInput);

        // Persist the fingerprint on the just-created session BEFORE
        // the lookup — otherwise the planner's "match on fp" logic
        // would never see the current session's hash, and a sign-in
        // from an already-known device would still look new.
        await options.store.setFingerprint(input.sessionId, fingerprint);

        const known = await options.store.listForUser(input.user.id);
        const decision = decideDeviceHandling({
          currentFingerprint: fingerprint,
          currentSessionId: input.sessionId,
          knownSessions: known,
          maxDevicesPerUser: options.config.maxDevicesPerUser,
          now: now(),
        });

        if (decision.action === "first-sign-in" || decision.action === "known") {
          // Nothing else to do — the lastSeenAt refresh comes from
          // Prisma's @updatedAt on every session lookup.
          return;
        }

        // new-device path
        if (decision.revokeSessionId) {
          // Revoke BEFORE emailing; the email's "review devices"
          // link should reflect the post-revoke state, not the
          // momentary over-limit state.
          try {
            await options.store.revoke(decision.revokeSessionId);
          } catch (err) {
            logger.warn(
              `Failed to revoke oldest session ${decision.revokeSessionId} for user ${input.user.id}: ${(err as Error).message}`,
            );
          }
        }

        if (!options.config.notifyOnNewDevice) return;

        const resolvedUser = await resolveUser(input.user, options.userLookup, logger);
        if (!resolvedUser) {
          // No email available → skip silently. Better than crashing
          // (which would leak through the catch and log) or sending
          // a mail with a blank "to" field.
          return;
        }

        const ua = parseUserAgent(input.userAgent ?? "");
        const location = await resolveLocation(options.geoIp, input.ipAddress ?? "", logger);

        await options.email.sendNewDevice({
          user: resolvedUser,
          fingerprint,
          deviceLabel: ua.label,
          location,
          // Don't render the IP in the body when GeoIP succeeded;
          // surface it only as a fallback for "Location unknown"
          // sign-ins, which is when the user has the most use for
          // the raw value (e.g. matching their VPN egress).
          ipAddress: location === "Location unknown" ? (input.ipAddress ?? "") : "",
          signedInAt: now().toISOString(),
          revokeUrl: buildRevokeUrl(options.config.appBaseUrl),
        });
      } catch (err) {
        // Never let the auth flow break.
        logger.error(
          `device-handling pipeline failed for user ${input.user.id}: ${(err as Error).message}`,
        );
      }
    },
  };
}

async function resolveUser(
  user: { id: string; email?: string; name?: string },
  lookup: DeviceHandlingUserLookup | undefined,
  logger: Pick<Logger, "warn" | "error" | "log">,
): Promise<{ id: string; email: string; name?: string } | null> {
  // Test convenience: when the caller passes a fully-populated user
  // we use it directly. Production calls supply only the id and let
  // the lookup resolve the email.
  if ("email" in user && typeof user.email === "string" && user.email) {
    return { id: user.id, email: user.email, ...(user.name ? { name: user.name } : {}) };
  }
  if (!lookup) return null;
  try {
    return await lookup.findById(user.id);
  } catch (err) {
    logger.warn(`device-handling: user lookup failed for ${user.id}: ${(err as Error).message}`);
    return null;
  }
}

async function resolveLocation(
  geoIp: Pick<GeoIpService, "lookup"> | undefined,
  ip: string,
  logger: Pick<Logger, "warn" | "error" | "log">,
): Promise<string> {
  if (!geoIp || !ip) return "Location unknown";
  let lookup: GeoIpLookupResult | null = null;
  try {
    lookup = await geoIp.lookup(ip);
  } catch (err) {
    logger.warn(`GeoIP lookup failed for ${ip}: ${(err as Error).message}`);
    return "Location unknown";
  }
  return formatLocation(lookup);
}

/**
 * Pure formatter — exposed for tests. Surfaces only `City, Country`
 * (or one of them when the other is missing) to keep the email body
 * privacy-friendly.
 */
export function formatLocation(lookup: GeoIpLookupResult | null): string {
  if (!lookup) return "Location unknown";
  const city = lookup.city?.trim();
  const country = lookup.country?.trim();
  if (city && country) return `${city}, ${country}`;
  if (country) return country;
  if (city) return city;
  return "Location unknown";
}

function buildRevokeUrl(baseUrl: string): string {
  // Trim trailing slash to avoid `https://app//me/devices`.
  return `${baseUrl.replace(/\/+$/, "")}/me/devices`;
}
