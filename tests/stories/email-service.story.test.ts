import { describe, expect, it } from 'vitest';

import {
  EmailService,
  EmailRateLimitedError,
  EmailRecipientNotAllowedError,
  TransactionalDriverMissingError,
  type EmailDriver,
  type EmailMessage,
  type EmailRateLimiter,
  type EmailSendResult,
  type EmailTemplateRenderer,
} from '../../src/core/email/email.service.js';

/**
 * Story · EmailService (PLAN.md §9 + §32 Phase 6).
 *
 * Two-driver design — Nodemailer for SMTP/EJS, Brevo for transactional
 * template-id sends. send() always goes through the primary driver
 * (Nodemailer); sendTemplate() routes to Brevo when a template-id is
 * present, otherwise it renders an EJS template via the injected
 * renderer and forwards to Nodemailer.
 *
 * Templates themselves are a separate slice — this story stubs the
 * renderer with a fake that records its inputs.
 */
describe('Story · EmailService', () => {
  function fakeDriver(name: string, mode: 'ok' | 'fail' = 'ok'): EmailDriver & {
    sent: Array<{ msg: EmailMessage; templateId?: number; vars?: object }>;
  } {
    const sent: Array<{ msg: EmailMessage; templateId?: number; vars?: object }> = [];
    return {
      name,
      sent,
      async send(msg: EmailMessage): Promise<EmailSendResult> {
        if (mode === 'fail') throw new Error(`${name}: simulated failure`);
        sent.push({ msg });
        return { messageId: `${name}-${sent.length}`, driver: name };
      },
      async sendTemplate(msg: EmailMessage, templateId: number, vars: object): Promise<EmailSendResult> {
        if (mode === 'fail') throw new Error(`${name}: simulated failure`);
        sent.push({ msg, templateId, vars });
        return { messageId: `${name}-tpl-${sent.length}`, driver: name };
      },
    };
  }

  function fakeRenderer(): EmailTemplateRenderer & { calls: Array<{ template: string; locale: string; vars: object }> } {
    const calls: Array<{ template: string; locale: string; vars: object }> = [];
    return {
      calls,
      async render(template, locale, vars) {
        calls.push({ template, locale, vars });
        return {
          subject: `[${template}] subject`,
          html: `<p>${template}</p>`,
          text: template,
        };
      },
    };
  }

  function fakeRateLimit(): EmailRateLimiter & { allow: boolean } {
    return {
      allow: true,
      check(_recipient) {
        return this.allow ? { allowed: true } : { allowed: false, resetMs: 60_000 };
      },
      record() {},
    };
  }

  describe('send()', () => {
    it('forwards to the primary driver and returns its result', async () => {
      const primary = fakeDriver('nodemailer');
      const svc = new EmailService({
        primary,
        renderer: fakeRenderer(),
        defaultFrom: 'noreply@example.com',
      });
      const result = await svc.send({ to: 'a@example.com', subject: 'hi', text: 'hello' });
      expect(result.driver).toBe('nodemailer');
      expect(primary.sent).toHaveLength(1);
      expect(primary.sent[0]?.msg).toMatchObject({
        to: 'a@example.com',
        subject: 'hi',
        text: 'hello',
        from: 'noreply@example.com',
      });
    });

    it('honours an explicit "from" over the configured default', async () => {
      const primary = fakeDriver('nodemailer');
      const svc = new EmailService({ primary, renderer: fakeRenderer(), defaultFrom: 'noreply@example.com' });
      await svc.send({ to: 'a@example.com', from: 'support@example.com', subject: 's', text: 't' });
      expect(primary.sent[0]?.msg.from).toBe('support@example.com');
    });

    it('rejects recipients that do not match the dev whitelist', async () => {
      const primary = fakeDriver('nodemailer');
      const svc = new EmailService({
        primary,
        renderer: fakeRenderer(),
        defaultFrom: 'noreply@example.com',
        devWhitelist: ['*@example.com'],
      });
      await expect(
        svc.send({ to: 'real@user.io', subject: 's', text: 't' }),
      ).rejects.toThrow(EmailRecipientNotAllowedError);
      expect(primary.sent).toHaveLength(0);
    });

    it('lets recipients through when they match the whitelist pattern', async () => {
      const primary = fakeDriver('nodemailer');
      const svc = new EmailService({
        primary,
        renderer: fakeRenderer(),
        defaultFrom: 'noreply@example.com',
        devWhitelist: ['*@example.com'],
      });
      await svc.send({ to: 'ok@example.com', subject: 's', text: 't' });
      expect(primary.sent).toHaveLength(1);
    });

    it('throws EmailRateLimitedError when the rate-limiter denies', async () => {
      const primary = fakeDriver('nodemailer');
      const limit = fakeRateLimit();
      limit.allow = false;
      const svc = new EmailService({
        primary,
        renderer: fakeRenderer(),
        defaultFrom: 'noreply@example.com',
        rateLimit: limit,
      });
      await expect(
        svc.send({ to: 'a@example.com', subject: 's', text: 't' }),
      ).rejects.toThrow(EmailRateLimitedError);
      expect(primary.sent).toHaveLength(0);
    });

    it('propagates driver failures', async () => {
      const primary = fakeDriver('nodemailer', 'fail');
      const svc = new EmailService({ primary, renderer: fakeRenderer(), defaultFrom: 'noreply@example.com' });
      await expect(svc.send({ to: 'a@example.com', subject: 's', text: 't' })).rejects.toThrow(/simulated failure/);
    });
  });

  describe('sendTemplate()', () => {
    it('renders via the renderer and sends through the primary driver', async () => {
      const primary = fakeDriver('nodemailer');
      const renderer = fakeRenderer();
      const svc = new EmailService({ primary, renderer, defaultFrom: 'noreply@example.com' });
      const result = await svc.sendTemplate({
        to: 'a@example.com',
        template: 'welcome',
        locale: 'de',
        vars: { name: 'Pascal' },
      });
      expect(result.driver).toBe('nodemailer');
      expect(renderer.calls).toEqual([{ template: 'welcome', locale: 'de', vars: { name: 'Pascal' } }]);
      expect(primary.sent[0]?.msg).toMatchObject({
        to: 'a@example.com',
        subject: '[welcome] subject',
        html: '<p>welcome</p>',
        text: 'welcome',
      });
    });

    it('routes to the transactional driver when brevoTemplateId is set', async () => {
      const primary = fakeDriver('nodemailer');
      const transactional = fakeDriver('brevo');
      const renderer = fakeRenderer();
      const svc = new EmailService({
        primary,
        transactional,
        renderer,
        defaultFrom: 'noreply@example.com',
      });
      const result = await svc.sendTemplate({
        to: 'a@example.com',
        template: 'welcome',
        brevoTemplateId: 42,
        vars: { name: 'Pascal' },
      });
      expect(result.driver).toBe('brevo');
      expect(transactional.sent).toHaveLength(1);
      expect(transactional.sent[0]?.templateId).toBe(42);
      expect(transactional.sent[0]?.vars).toEqual({ name: 'Pascal' });
      // Renderer must NOT be touched when Brevo handles the template.
      expect(renderer.calls).toHaveLength(0);
      expect(primary.sent).toHaveLength(0);
    });

    it('throws TransactionalDriverMissingError when brevoTemplateId is set but no transactional driver is configured', async () => {
      const primary = fakeDriver('nodemailer');
      const svc = new EmailService({ primary, renderer: fakeRenderer(), defaultFrom: 'noreply@example.com' });
      await expect(
        svc.sendTemplate({ to: 'a@example.com', template: 'welcome', brevoTemplateId: 42 }),
      ).rejects.toThrow(TransactionalDriverMissingError);
    });

    it('defaults locale to "en" when not provided', async () => {
      const primary = fakeDriver('nodemailer');
      const renderer = fakeRenderer();
      const svc = new EmailService({ primary, renderer, defaultFrom: 'noreply@example.com' });
      await svc.sendTemplate({ to: 'a@example.com', template: 'welcome' });
      expect(renderer.calls[0]?.locale).toBe('en');
    });

    it('records the recipient with the rate-limiter on success', async () => {
      const primary = fakeDriver('nodemailer');
      const recorded: string[] = [];
      const limit: EmailRateLimiter = {
        check() {
          return { allowed: true };
        },
        record(recipient) {
          recorded.push(recipient);
        },
      };
      const svc = new EmailService({
        primary,
        renderer: fakeRenderer(),
        defaultFrom: 'noreply@example.com',
        rateLimit: limit,
      });
      await svc.sendTemplate({ to: 'a@example.com', template: 'welcome' });
      expect(recorded).toEqual(['a@example.com']);
    });
  });
});
