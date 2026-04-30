import { Logger, Module } from "@nestjs/common";

import { loadBrandSync } from "../branding/brand-loader.js";
import { loadFeatures } from "../features/features.js";
import { resolveBrandConfig } from "./brand.js";
import { BrevoEmailDriver, createBrevoHttpClient } from "./drivers/brevo.driver.js";
import {
  SmtpEmailDriver,
  createSmtpTransporter,
  readSmtpConfigFromEnv,
} from "./drivers/smtp.driver.js";
import {
  type EmailDriver,
  type EmailMessage,
  type EmailSendResult,
  type EmailTemplateRenderer,
  EmailService,
} from "./email.service.js";
import { ReactEmailTemplateRenderer } from "./email-templates.react.js";

/**
 * Logs the message to stdout instead of sending. Default driver when
 * the email feature is disabled or no relay is configured — keeps
 * verify-email / reset-password flows completing in offline dev
 * without touching a real outbound mail server.
 */
class LogOnlyEmailDriver implements EmailDriver {
  readonly name = "log-only";
  private readonly logger = new Logger("EmailService");

  async send(msg: EmailMessage): Promise<EmailSendResult> {
    this.logger.log(`[email] to=${msg.to} subject="${msg.subject}" via=${this.name}`);
    return { messageId: `log-${Date.now()}`, driver: this.name };
  }

  async sendTemplate(
    msg: EmailMessage,
    templateId: number,
    vars: object,
  ): Promise<EmailSendResult> {
    this.logger.log(
      `[email] templateId=${templateId} to=${msg.to} vars=${JSON.stringify(vars)} via=${this.name}`,
    );
    return { messageId: `log-tpl-${templateId}-${Date.now()}`, driver: this.name };
  }
}

/**
 * Pure planner — picks which driver names should be wired up given the
 * active features + env. Selection rules are documented in the story
 * tests (`email-driver-selection.story.test.ts`). Splitting this out
 * lets us unit-test the decision without booting a NestJS module.
 */
export type EmailDriverName = "log-only" | "smtp" | "brevo";

export interface DriverSelectionInput {
  enabled: boolean;
  provider: "smtp" | "brevo";
  env: Record<string, string | undefined>;
}

export interface DriverSelection {
  primary: EmailDriverName;
  transactional?: EmailDriverName;
}

export function selectEmailDriver(input: DriverSelectionInput): DriverSelection {
  if (!input.enabled) return { primary: "log-only" };
  const hasBrevo = Boolean(input.env.BREVO_API_KEY?.trim());
  const hasSmtpHost = Boolean(input.env.SMTP_HOST?.trim());

  if (input.provider === "brevo") {
    // Brevo is the chosen primary, but if no key is configured we fall
    // back to the SMTP relay (Mailpit in dev, real SMTP in prod) — that
    // way an operator who fat-fingers the env still sees mail in their
    // dev inbox instead of silent log-only routing.
    if (hasBrevo) return { primary: "brevo", transactional: "brevo" };
    if (hasSmtpHost) return { primary: "smtp" };
    return { primary: "log-only" };
  }

  // provider === "smtp"
  if (!hasSmtpHost) return { primary: "log-only" };
  const sel: DriverSelection = { primary: "smtp" };
  // Brevo as a transactional add-on lets `sendTemplate({ brevoTemplateId })`
  // route to Brevo even when the bulk of mail flows through SMTP.
  if (hasBrevo) sel.transactional = "brevo";
  return sel;
}

/**
 * EmailModule — provides `EmailService` with the driver(s) selected by
 * `selectEmailDriver`.  Drivers are instantiated lazily inside
 * `useFactory` so env reads happen at provider init time, not module
 * decoration time (matters for tests that mutate `process.env` in
 * `beforeAll`).
 *
 * The template renderer is the file-based React-Email loader from
 * issue #6 — templates live as `.tsx` under
 * `src/core/email/templates/` (built-ins) and
 * `src/modules/email/templates/` (project overrides).
 */
@Module({
  providers: [
    {
      provide: EmailService,
      useFactory: (): EmailService => {
        const env = process.env as Record<string, string | undefined>;
        const features = loadFeatures(env);
        const selection = selectEmailDriver({
          enabled: features.email.enabled,
          provider: features.email.provider,
          env,
        });
        const renderer: EmailTemplateRenderer = new ReactEmailTemplateRenderer({
          brand: resolveBrandConfig(),
        });
        const primary = createDriver(selection.primary, env);
        // Default From: precedence is env (SMTP_FROM) → brand.fromEmail
        // → final placeholder. The env wins because operators rotate
        // sending domains without committing brand.json; brand.fromEmail
        // is the project-wide opinion when env is unset.
        const brand = loadBrandSync();
        const options: ConstructorParameters<typeof EmailService>[0] = {
          primary,
          renderer,
          defaultFrom: env.SMTP_FROM ?? brand.fromEmail,
        };
        if (selection.transactional) {
          options.transactional = createDriver(selection.transactional, env);
        }
        return new EmailService(options);
      },
    },
  ],
  exports: [EmailService],
})
export class EmailModule {}

function createDriver(name: EmailDriverName, env: Record<string, string | undefined>): EmailDriver {
  if (name === "log-only") return new LogOnlyEmailDriver();
  if (name === "smtp") {
    const cfg = readSmtpConfigFromEnv(env);
    if (!cfg) return new LogOnlyEmailDriver();
    return new SmtpEmailDriver({ transporter: createSmtpTransporter(cfg) });
  }
  // brevo
  const apiKey = env.BREVO_API_KEY ?? "";
  return new BrevoEmailDriver({ apiKey, http: createBrevoHttpClient({ apiKey }) });
}
