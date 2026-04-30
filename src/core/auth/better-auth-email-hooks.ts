import { defaultBrandConfig } from "../email/brand.js";

/**
 * Pure planner: maps Better-Auth hook payloads → `EmailService.sendTemplate`
 * arguments.
 *
 * Better-Auth exposes hooks like `emailVerification.sendVerificationEmail`
 * and `emailAndPassword.sendResetPassword` that fire when the framework
 * needs an outbound mail. Each hook receives a payload shaped like
 * `{ user, url, token }` and is expected to return `Promise<void>` —
 * Better-Auth itself doesn't render mail, that's the consumer's job.
 *
 * This planner takes one such payload + the resolved `appName` and
 * produces the canonical `{ template, to, vars }` record that the
 * `EmailService` consumes. Splitting the planner out keeps the
 * decision logic test-able without booting Better-Auth, an HTTP
 * server, or the email driver layer.
 *
 * The runner half (registering the hook with Better-Auth and calling
 * `EmailService`) lives in `better-auth-email-hooks.runner.ts`.
 */

/**
 * Subset of the Better-Auth `User` shape the planner cares about.
 *
 * Better-Auth's actual `User` carries dozens of fields driven by
 * plugins; pinning the planner to a structural slice keeps it
 * decoupled from generated types.
 */
export interface BetterAuthEmailUser {
  id: string;
  email: string;
  /** May be empty when sign-up didn't supply a display name. */
  name?: string;
  /** Some plugin payloads expose `displayName` in addition to `name`. */
  displayName?: string;
}

export type EmailHookKind =
  | "email-verification"
  | "password-reset"
  | "welcome"
  | "invitation"
  | "new-device";

interface BaseHookInput {
  user: BetterAuthEmailUser;
  appName: string;
}

interface VerificationHookInput extends BaseHookInput {
  kind: "email-verification";
  url: string;
}

interface PasswordResetHookInput extends BaseHookInput {
  kind: "password-reset";
  url: string;
}

interface WelcomeHookInput extends BaseHookInput {
  kind: "welcome";
}

interface InvitationHookInput extends BaseHookInput {
  kind: "invitation";
  url: string;
  /** Display name of the inviting user. Falls back to "A teammate". */
  senderName: string;
}

interface NewDeviceHookInput extends BaseHookInput {
  kind: "new-device";
  /** Composed UA label, e.g. "Chrome on macOS". Required. */
  deviceLabel: string;
  /** "City, Country" string from GeoIP. Empty → "Location unknown". */
  location: string;
  /** Raw IP — surfaced in the email body when GeoIP returned nothing. */
  ipAddress: string;
  /** ISO timestamp of the sign-in. */
  signedInAt: string;
  /** Link to /me/devices for the revoke flow. Required. */
  revokeUrl: string;
}

export type EmailHookInput =
  | VerificationHookInput
  | PasswordResetHookInput
  | WelcomeHookInput
  | InvitationHookInput
  | NewDeviceHookInput;

export interface EmailHookPayload {
  template: string;
  to: string;
  vars: Record<string, string>;
}

const DEFAULT_RECIPIENT_NAME = "there";
const DEFAULT_SENDER_NAME = "A teammate";

/**
 * Pick a friendly recipient name from the Better-Auth user record.
 *
 * Resolution order:
 *   1. `name`              ← canonical display field
 *   2. `displayName`       ← some plugins (org / admin) expose this
 *   3. local-part of email ← always present
 *   4. literal "there"     ← defensive last resort
 */
export function resolveRecipientName(user: BetterAuthEmailUser): string {
  const name = trim(user.name);
  if (name) return name;
  const displayName = trim(user.displayName);
  if (displayName) return displayName;
  const email = trim(user.email);
  if (email && email.includes("@")) {
    const local = email.split("@")[0] ?? "";
    if (local) return local;
  }
  return DEFAULT_RECIPIENT_NAME;
}

/**
 * Resolve the application name shown in transactional mail subjects /
 * bodies. Reads `APP_NAME` from env, falling back to the brand
 * config's `appName` (issue #5 owns the loader; the default is
 * "nest-base").
 */
export function resolveAppName(env: Record<string, string | undefined>): string {
  const candidate = trim(env.APP_NAME);
  if (candidate) return candidate;
  return defaultBrandConfig().appName;
}

/**
 * Build the canonical `EmailService.sendTemplate` argument record.
 *
 * Throws on missing required fields — the planner is the right place
 * to catch operator misconfiguration (empty appName, broken URLs, …)
 * rather than letting a half-formed mail render and ship.
 */
export function buildEmailHookPayload(input: EmailHookInput): EmailHookPayload {
  const recipient = trim(input.user.email);
  if (!recipient) {
    throw new Error("better-auth-email-hooks: user.email must be a non-empty string");
  }
  const appName = trim(input.appName);
  if (!appName) {
    throw new Error("better-auth-email-hooks: appName must be a non-empty string");
  }
  const recipientName = resolveRecipientName(input.user);

  switch (input.kind) {
    case "email-verification": {
      const url = trim(input.url);
      if (!url) {
        throw new Error(
          "better-auth-email-hooks: email-verification hook requires a non-empty url",
        );
      }
      return {
        template: "email-verification",
        to: recipient,
        vars: { recipientName, appName, verificationUrl: url },
      };
    }
    case "password-reset": {
      const url = trim(input.url);
      if (!url) {
        throw new Error("better-auth-email-hooks: password-reset hook requires a non-empty url");
      }
      return {
        template: "password-reset",
        to: recipient,
        vars: { recipientName, appName, resetUrl: url },
      };
    }
    case "welcome": {
      return {
        template: "welcome",
        to: recipient,
        vars: { recipientName, appName },
      };
    }
    case "invitation": {
      const url = trim(input.url);
      if (!url) {
        throw new Error("better-auth-email-hooks: invitation hook requires a non-empty url");
      }
      const senderName = trim(input.senderName) || DEFAULT_SENDER_NAME;
      return {
        template: "invitation",
        to: recipient,
        vars: { recipientName, appName, acceptUrl: url, senderName },
      };
    }
    case "new-device": {
      const deviceLabel = trim(input.deviceLabel);
      if (!deviceLabel) {
        throw new Error(
          "better-auth-email-hooks: new-device hook requires a non-empty deviceLabel",
        );
      }
      const revokeUrl = trim(input.revokeUrl);
      if (!revokeUrl) {
        throw new Error("better-auth-email-hooks: new-device hook requires a non-empty revokeUrl");
      }
      const location = trim(input.location) || "Location unknown";
      const ipAddress = trim(input.ipAddress);
      const signedInAt = trim(input.signedInAt);
      return {
        template: "new-device",
        to: recipient,
        vars: {
          recipientName,
          appName,
          deviceLabel,
          location,
          ipAddress,
          signedInAt,
          revokeUrl,
        },
      };
    }
  }
}

function trim(value: string | undefined): string {
  return (value ?? "").trim();
}
