import { Logger } from "@nestjs/common";

import { buildEmailHookPayload, type BetterAuthEmailUser } from "./better-auth-email-hooks.js";

/**
 * Thin runner around the email-hook planner.
 *
 * Better-Auth expects each hook to return `Promise<void>`. The runner
 * builds the canonical send-template argument via the planner and
 * forwards it to the injected sender (which the EmailModule provides
 * as `EmailService`). Failures are logged but never propagate — the
 * sign-up / reset / invitation flow stays unblocked even if the SMTP
 * relay is momentarily unreachable.
 *
 * The outbox slice (issue #11) will replace the inline `await` with
 * an enqueue-and-return-immediately path; until then the
 * fire-and-log strategy keeps mail best-effort.
 */

/**
 * Structural slice of `EmailService` consumed by the runner.
 *
 * Restricting the contract to the single method we use lets unit
 * tests pass a fake without modelling the rate-limiter, whitelist,
 * or driver wiring.
 */
export interface EmailSenderForHooks {
  sendTemplate(args: {
    to: string;
    template: string;
    vars?: object;
    locale?: string;
    from?: string;
  }): Promise<{ messageId: string; driver: string }>;
}

export interface EmailHookErrorContext {
  template: string;
  to?: string;
  kind: "email-verification" | "password-reset" | "welcome" | "invitation";
}

export interface EmailHookRunnerOptions {
  sender: EmailSenderForHooks;
  appName: string;
  /**
   * Optional locale override. Better-Auth doesn't currently surface a
   * per-user locale in the hook payload — the i18n RFC (issue #011) will
   * make this dynamic. Until then the runner uses "en" by default.
   */
  locale?: string;
  /** Optional sink for transport failures. Defaults to a NestJS Logger. */
  onError?: (error: Error, ctx: EmailHookErrorContext) => void;
}

export interface VerificationHookData {
  user: BetterAuthEmailUser;
  url: string;
  token: string;
}

export interface ResetPasswordHookData {
  user: BetterAuthEmailUser;
  url: string;
  token: string;
}

export interface WelcomeHookData {
  user: BetterAuthEmailUser;
}

export interface InvitationHookData {
  user: BetterAuthEmailUser;
  url: string;
  /** Display name of the inviting party. */
  senderName?: string;
}

export interface BetterAuthEmailHookRunner {
  sendVerificationEmail(data: VerificationHookData): Promise<void>;
  sendResetPassword(data: ResetPasswordHookData): Promise<void>;
  sendWelcome(data: WelcomeHookData): Promise<void>;
  sendInvitation(data: InvitationHookData): Promise<void>;
}

export function createEmailHookRunner(
  options: EmailHookRunnerOptions,
): BetterAuthEmailHookRunner {
  const logger = new Logger("BetterAuthEmailHooks");
  const onError =
    options.onError ??
    ((error: Error, ctx: EmailHookErrorContext): void => {
      logger.error(
        `failed to send ${ctx.kind} email${ctx.to ? ` to ${ctx.to}` : ""}: ${error.message}`,
        error.stack,
      );
    });

  async function send(
    kind: EmailHookErrorContext["kind"],
    builder: () => { template: string; to: string; vars: Record<string, string> },
  ): Promise<void> {
    let plan: { template: string; to: string; vars: Record<string, string> };
    try {
      plan = builder();
    } catch (raw) {
      const error = toError(raw);
      // The to/template are unknown when the planner itself rejected the
      // payload — surface the kind so operators still see the trail.
      onError(error, { kind, template: kindToTemplate(kind) });
      return;
    }
    try {
      await options.sender.sendTemplate({
        to: plan.to,
        template: plan.template,
        vars: plan.vars,
        locale: options.locale ?? "en",
      });
    } catch (raw) {
      onError(toError(raw), { kind, template: plan.template, to: plan.to });
    }
  }

  return {
    async sendVerificationEmail(data) {
      await send("email-verification", () =>
        buildEmailHookPayload({
          kind: "email-verification",
          user: data.user,
          url: data.url,
          appName: options.appName,
        }),
      );
    },
    async sendResetPassword(data) {
      await send("password-reset", () =>
        buildEmailHookPayload({
          kind: "password-reset",
          user: data.user,
          url: data.url,
          appName: options.appName,
        }),
      );
    },
    async sendWelcome(data) {
      await send("welcome", () =>
        buildEmailHookPayload({
          kind: "welcome",
          user: data.user,
          appName: options.appName,
        }),
      );
    },
    async sendInvitation(data) {
      await send("invitation", () =>
        buildEmailHookPayload({
          kind: "invitation",
          user: data.user,
          url: data.url,
          appName: options.appName,
          senderName: data.senderName ?? "",
        }),
      );
    },
  };
}

function toError(raw: unknown): Error {
  if (raw instanceof Error) return raw;
  return new Error(typeof raw === "string" ? raw : JSON.stringify(raw));
}

function kindToTemplate(kind: EmailHookErrorContext["kind"]): string {
  return kind;
}
