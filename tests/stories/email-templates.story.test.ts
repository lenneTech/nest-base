import { describe, expect, it } from 'vitest';

import {
  EjsEmailTemplateRenderer,
  EmailTemplateNotFoundError,
  InMemoryEmailTemplateRegistry,
  MissingTemplateVariableError,
  buildBuiltInEmailTemplateRegistry,
} from '../../src/core/email/email-templates.js';

/**
 * Story · Email-Templates (PLAN.md §9.2 + §32 Phase 6).
 *
 * Locale-aware template registry + EJS-subset renderer that produces
 * `{ subject, html, text }` per call. The renderer covers what the
 * built-in templates actually need today:
 *   `<%= var %>` — HTML-escaped substitution
 *   `<%- var %>` — raw substitution
 *   `<%# … %>`   — comments
 *
 * Anything richer (loops, includes) lands when a real template needs
 * it; the slice stays minimal so we don't drag in `ejs` for nothing.
 */
describe('Story · Email-Templates', () => {
  describe('InMemoryEmailTemplateRegistry', () => {
    it('returns undefined for an unknown template', () => {
      const reg = new InMemoryEmailTemplateRegistry();
      expect(reg.get('does-not-exist', 'en')).toBeUndefined();
    });

    it('returns the locale variant when one is registered', () => {
      const reg = new InMemoryEmailTemplateRegistry();
      reg.register('welcome', null, { subject: 'EN', html: '<p>en</p>', text: 'en' });
      reg.register('welcome', 'de', { subject: 'DE', html: '<p>de</p>', text: 'de' });
      expect(reg.get('welcome', 'de')?.subject).toBe('DE');
    });

    it('falls back to the locale-less default when the variant is missing', () => {
      const reg = new InMemoryEmailTemplateRegistry();
      reg.register('welcome', null, { subject: 'EN', html: '<p>en</p>', text: 'en' });
      expect(reg.get('welcome', 'de')?.subject).toBe('EN');
    });
  });

  describe('EjsEmailTemplateRenderer', () => {
    function rendererWith(template: { subject: string; html: string; text: string }): EjsEmailTemplateRenderer {
      const reg = new InMemoryEmailTemplateRegistry();
      reg.register('greeting', null, template);
      return new EjsEmailTemplateRenderer(reg);
    }

    it('substitutes a variable into all three sections', async () => {
      const r = rendererWith({
        subject: 'Hello <%= name %>',
        html: '<p>Hi <%= name %></p>',
        text: 'Hi <%= name %>',
      });
      const out = await r.render('greeting', 'en', { name: 'Pascal' });
      expect(out).toEqual({
        subject: 'Hello Pascal',
        html: '<p>Hi Pascal</p>',
        text: 'Hi Pascal',
      });
    });

    it('HTML-escapes <%= %> to neutralise XSS payloads', async () => {
      const r = rendererWith({
        subject: 's',
        html: '<p><%= name %></p>',
        text: '<%= name %>',
      });
      const out = await r.render('greeting', 'en', { name: '<script>alert(1)</script>' });
      expect(out.html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
      expect(out.text).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('emits raw output for <%- %>', async () => {
      const r = rendererWith({ subject: 's', html: '<p><%- raw %></p>', text: 't' });
      const out = await r.render('greeting', 'en', { raw: '<b>bold</b>' });
      expect(out.html).toBe('<p><b>bold</b></p>');
    });

    it('drops <%# comments %>', async () => {
      const r = rendererWith({ subject: 's', html: '<p><%# hidden %>visible</p>', text: 't' });
      const out = await r.render('greeting', 'en', {});
      expect(out.html).toBe('<p>visible</p>');
    });

    it('throws MissingTemplateVariableError when a referenced variable is absent', async () => {
      const r = rendererWith({ subject: 'Hi <%= name %>', html: 'h', text: 't' });
      await expect(r.render('greeting', 'en', {})).rejects.toThrow(MissingTemplateVariableError);
    });

    it('throws EmailTemplateNotFoundError when the template is unknown', async () => {
      const r = new EjsEmailTemplateRenderer(new InMemoryEmailTemplateRegistry());
      await expect(r.render('ghost', 'en', {})).rejects.toThrow(EmailTemplateNotFoundError);
    });

    it('resolves dotted variable paths', async () => {
      const r = rendererWith({ subject: 's', html: '<p><%= user.name %></p>', text: 't' });
      const out = await r.render('greeting', 'en', { user: { name: 'Pascal' } });
      expect(out.html).toBe('<p>Pascal</p>');
    });
  });

  describe('buildBuiltInEmailTemplateRegistry()', () => {
    it('registers email-verification, password-reset, welcome and invitation', () => {
      const reg = buildBuiltInEmailTemplateRegistry();
      for (const name of ['email-verification', 'password-reset', 'welcome', 'invitation']) {
        const tpl = reg.get(name, 'en');
        expect(tpl, `template "${name}" missing`).toBeDefined();
        expect(tpl?.subject).toBeTruthy();
        expect(tpl?.html).toBeTruthy();
        expect(tpl?.text).toBeTruthy();
      }
    });

    it('renders email-verification with a verification URL', async () => {
      const r = new EjsEmailTemplateRenderer(buildBuiltInEmailTemplateRegistry());
      const out = await r.render('email-verification', 'en', {
        recipientName: 'Pascal',
        verificationUrl: 'https://app.example.com/verify?token=abc',
      });
      expect(out.subject).toMatch(/verify/i);
      expect(out.html).toContain('https://app.example.com/verify?token=abc');
      expect(out.text).toContain('https://app.example.com/verify?token=abc');
    });

    it('renders password-reset with a reset URL', async () => {
      const r = new EjsEmailTemplateRenderer(buildBuiltInEmailTemplateRegistry());
      const out = await r.render('password-reset', 'en', {
        recipientName: 'Pascal',
        resetUrl: 'https://app.example.com/reset?token=abc',
      });
      expect(out.subject).toMatch(/reset/i);
      expect(out.html).toContain('https://app.example.com/reset?token=abc');
      expect(out.text).toContain('https://app.example.com/reset?token=abc');
    });

    it('renders welcome with the recipient name', async () => {
      const r = new EjsEmailTemplateRenderer(buildBuiltInEmailTemplateRegistry());
      const out = await r.render('welcome', 'en', { recipientName: 'Pascal', appName: 'Acme' });
      expect(out.html).toContain('Pascal');
      expect(out.html).toContain('Acme');
    });

    it('renders invitation with sender, app and accept URL', async () => {
      const r = new EjsEmailTemplateRenderer(buildBuiltInEmailTemplateRegistry());
      const out = await r.render('invitation', 'en', {
        recipientName: 'Pascal',
        senderName: 'Alice',
        appName: 'Acme',
        acceptUrl: 'https://app.example.com/invite/xyz',
      });
      expect(out.html).toContain('Alice');
      expect(out.html).toContain('Acme');
      expect(out.html).toContain('https://app.example.com/invite/xyz');
    });
  });
});
