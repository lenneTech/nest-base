import { Logger, Module } from "@nestjs/common";

import { resolveBrandConfig } from "./brand.js";
import {
  type EmailDriver,
  type EmailMessage,
  type EmailSendResult,
  type EmailTemplateRenderer,
  EmailService,
} from "./email.service.js";
import { ReactEmailTemplateRenderer } from "./email-templates.react.js";

/**
 * Logs the message to stdout instead of sending.  Default driver
 * until SMTP (`nodemailer`) or Brevo are installed and configured —
 * keeps the EmailService end-to-end testable in DI without external
 * deps.
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
 * EmailModule — provides `EmailService` + a default `LogOnlyEmailDriver`.
 *
 * Real drivers (`@nestjs/mailer` w/ Nodemailer for SMTP, custom Brevo
 * adapter for the Brevo API) plug in via `features.email.provider` once
 * those dependencies are installed. Until then the log-only driver
 * lets verify-email / reset-password flows complete in dev without
 * a real outbound mail server.
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
        const renderer: EmailTemplateRenderer = new ReactEmailTemplateRenderer({
          brand: resolveBrandConfig(),
        });
        return new EmailService({
          primary: new LogOnlyEmailDriver(),
          renderer,
          defaultFrom: process.env.SMTP_FROM ?? "no-reply@example.com",
        });
      },
    },
  ],
  exports: [EmailService],
})
export class EmailModule {}
