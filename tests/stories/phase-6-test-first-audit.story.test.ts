import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..');

/**
 * Story · Phase 6 Test-First audit (PLAN.md §32 Phase 6).
 *
 * The Phase 6 Test-First entry promises four story files cover the
 * phase's load-bearing surfaces — Email-Service, 2FA-TOTP, Passkey-
 * WebAuthn, MCP-OAuth. This audit tracks the contract so a future
 * doc rewrite can't silently drop a story (or rename one out from
 * under PLAN.md without updating the spec).
 *
 * Each entry pins the file path AND a describe-block fragment so a
 * "rename-only" change still wakes the audit — the test name is part
 * of the contract, not just the file presence.
 */
describe('Story · Phase 6 Test-First audit', () => {
  const REQUIRED: Array<{ surface: string; file: string; describeFragment: string }> = [
    {
      surface: 'Email-Service (Nodemailer + Brevo, Mailpit-Trap parity)',
      file: 'tests/stories/email-service.story.test.ts',
      describeFragment: 'EmailService',
    },
    {
      surface: '2FA TOTP (Setup + Verify)',
      file: 'tests/stories/better-auth-two-factor.story.test.ts',
      describeFragment: 'Two-Factor',
    },
    {
      surface: 'Passkey WebAuthn (Register + Login)',
      file: 'tests/stories/better-auth-passkey.story.test.ts',
      describeFragment: 'Passkey',
    },
    {
      surface: 'MCP-OAuth (Authorization-Code + PKCE, Tool-Call w/ Permission-Filter)',
      file: 'tests/stories/mcp-auth.story.test.ts',
      describeFragment: 'MCP-Auth',
    },
  ];

  for (const entry of REQUIRED) {
    it(`covers "${entry.surface}" via ${entry.file}`, () => {
      const full = resolve(ROOT, entry.file);
      expect(existsSync(full), `${entry.file} must exist`).toBe(true);
      const content = readFileSync(full, 'utf8');
      expect(content).toMatch(new RegExp(`describe\\([\\s\\S]*?${entry.describeFragment}`));
    });
  }

  it('all four required stories are present (no count drift)', () => {
    expect(REQUIRED).toHaveLength(4);
  });
});
