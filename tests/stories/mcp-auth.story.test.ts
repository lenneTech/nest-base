import { describe, expect, it, vi } from 'vitest';

import {
  McpAuthGuard,
  McpAuthRequiredError,
  McpInvalidAuthHeaderError,
  McpUnauthorizedError,
  StdioBootstrapMcpValidator,
  extractBearerToken,
  type McpAuthValidator,
  type McpUser,
} from '../../src/core/mcp/mcp-auth.js';

/**
 * Story · MCP-Auth via Better-Auth-OAuth-Provider (PLAN.md §16.3 +
 * §32 Phase 6).
 *
 * Two layers, one contract:
 *   - extractBearerToken / McpAuthGuard normalise the Authorization
 *     header and delegate validation to an injected `McpAuthValidator`.
 *   - StdioBootstrapMcpValidator covers the local-dev stdio transport
 *     where auth is bypassed and every call runs as a provisioned
 *     bootstrap user (PLAN.md §16.3 last paragraph).
 *
 * The Better-Auth-backed validator that hits the OIDC-provider plugin
 * for OAuth 2.1 / PKCE bearer tokens lives behind the same interface;
 * tests stay DB-free by using a fake validator.
 */
describe('Story · MCP-Auth', () => {
  const bootstrapUser: McpUser = { id: 'u-bootstrap', tenantId: 't-bootstrap' };

  describe('extractBearerToken', () => {
    it('returns the token portion of a well-formed Bearer header', () => {
      expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    });

    it('strips trailing whitespace from the token', () => {
      expect(extractBearerToken('Bearer abc   ')).toBe('abc');
    });

    it('throws McpInvalidAuthHeaderError when the prefix is missing', () => {
      expect(() => extractBearerToken('abc.def.ghi')).toThrow(McpInvalidAuthHeaderError);
    });

    it('throws McpInvalidAuthHeaderError on a different scheme (Basic, Token, …)', () => {
      expect(() => extractBearerToken('Basic abc')).toThrow(McpInvalidAuthHeaderError);
    });

    it('throws McpInvalidAuthHeaderError when the token portion is empty', () => {
      expect(() => extractBearerToken('Bearer ')).toThrow(McpInvalidAuthHeaderError);
    });
  });

  describe('McpAuthGuard.resolveContext', () => {
    function fakeValidator(result: McpUser | null): McpAuthValidator & { calls: string[] } {
      const calls: string[] = [];
      return {
        calls,
        async validate(token: string) {
          calls.push(token);
          if (!result) throw new McpUnauthorizedError();
          return { user: result };
        },
      };
    }

    it('rejects when the header is missing', async () => {
      const guard = new McpAuthGuard(fakeValidator({ id: 'u1', tenantId: 't1' }));
      await expect(guard.resolveContext(undefined)).rejects.toThrow(McpAuthRequiredError);
    });

    it('rejects an empty header', async () => {
      const guard = new McpAuthGuard(fakeValidator({ id: 'u1', tenantId: 't1' }));
      await expect(guard.resolveContext('')).rejects.toThrow(McpAuthRequiredError);
    });

    it('passes the extracted token to the validator', async () => {
      const v = fakeValidator({ id: 'u1', tenantId: 't1' });
      const guard = new McpAuthGuard(v);
      await guard.resolveContext('Bearer my-token');
      expect(v.calls).toEqual(['my-token']);
    });

    it('returns an MCP context with the user resolved by the validator', async () => {
      const guard = new McpAuthGuard(fakeValidator({ id: 'u1', tenantId: 't1' }));
      const ctx = await guard.resolveContext('Bearer ok');
      expect(ctx.user).toEqual({ id: 'u1', tenantId: 't1' });
    });

    it('propagates McpUnauthorizedError from the validator', async () => {
      const guard = new McpAuthGuard(fakeValidator(null));
      await expect(guard.resolveContext('Bearer bad')).rejects.toThrow(McpUnauthorizedError);
    });

    it('propagates McpInvalidAuthHeaderError when the prefix is wrong', async () => {
      const guard = new McpAuthGuard(fakeValidator({ id: 'u1', tenantId: 't1' }));
      await expect(guard.resolveContext('Token abc')).rejects.toThrow(McpInvalidAuthHeaderError);
    });
  });

  describe('StdioBootstrapMcpValidator', () => {
    it('returns the configured bootstrap user regardless of token', async () => {
      const validator = new StdioBootstrapMcpValidator(bootstrapUser);
      const result = await validator.validate('whatever');
      expect(result.user).toEqual(bootstrapUser);
    });

    it('lets a stdio-mode guard resolve a context without an Authorization header', async () => {
      const validator = new StdioBootstrapMcpValidator(bootstrapUser);
      const guard = new McpAuthGuard(validator, { allowEmptyHeader: true });
      const ctx = await guard.resolveContext(undefined);
      expect(ctx.user).toEqual(bootstrapUser);
    });

    it('does not call the validator a second time within the same resolveContext call', async () => {
      const validate = vi.fn(async () => ({ user: bootstrapUser }));
      const guard = new McpAuthGuard({ validate }, { allowEmptyHeader: true });
      await guard.resolveContext('Bearer x');
      expect(validate).toHaveBeenCalledTimes(1);
    });
  });
});
