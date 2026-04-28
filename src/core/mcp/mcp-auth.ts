import type { McpContext, McpUser } from './mcp-server.js';

export type { McpUser };

/**
 * MCP-Auth (PLAN.md §16.3 + §32 Phase 6).
 *
 * Two layers, one contract:
 *   - `extractBearerToken` / `McpAuthGuard` normalise the
 *     Authorization header and delegate validation to an injected
 *     `McpAuthValidator`. The Better-Auth-OAuth-Provider-backed
 *     validator (Authorization-Code-Flow + PKCE bearer tokens) lives
 *     in the integration layer and plugs in behind the same interface
 *     so unit tests stay DB-free.
 *   - `StdioBootstrapMcpValidator` covers the local-dev stdio
 *     transport (auth disabled, every call runs as a provisioned
 *     bootstrap user — PLAN.md §16.3 last paragraph).
 *
 * The guard does **not** make policy decisions — those live in the
 * existing PermissionService once the resolved user reaches the
 * tool/resource handler through the context.
 */

export class McpAuthRequiredError extends Error {
  constructor() {
    super('mcp-auth: Authorization header is required');
    this.name = 'McpAuthRequiredError';
  }
}

export class McpInvalidAuthHeaderError extends Error {
  constructor() {
    super('mcp-auth: Authorization header must use the "Bearer <token>" scheme');
    this.name = 'McpInvalidAuthHeaderError';
  }
}

export class McpUnauthorizedError extends Error {
  constructor() {
    super('mcp-auth: token is not valid');
    this.name = 'McpUnauthorizedError';
  }
}

export interface McpAuthValidator {
  validate(token: string): Promise<{ user: McpUser }>;
}

export interface McpAuthGuardOptions {
  /**
   * Stdio-mode bypass. When true, an empty/undefined Authorization
   * header is allowed and the validator runs with an empty token so
   * the StdioBootstrapMcpValidator can return the configured user.
   */
  allowEmptyHeader?: boolean;
}

const BEARER_PREFIX = 'Bearer ';

export function extractBearerToken(header: string): string {
  if (!header.startsWith(BEARER_PREFIX)) throw new McpInvalidAuthHeaderError();
  const token = header.slice(BEARER_PREFIX.length).trim();
  if (!token) throw new McpInvalidAuthHeaderError();
  return token;
}

export class McpAuthGuard {
  constructor(
    private readonly validator: McpAuthValidator,
    private readonly options: McpAuthGuardOptions = {},
  ) {}

  async resolveContext(authorizationHeader: string | undefined): Promise<McpContext> {
    if (!authorizationHeader) {
      if (!this.options.allowEmptyHeader) throw new McpAuthRequiredError();
      const result = await this.validator.validate('');
      return { user: result.user };
    }
    const token = extractBearerToken(authorizationHeader);
    const result = await this.validator.validate(token);
    return { user: result.user };
  }
}

export class StdioBootstrapMcpValidator implements McpAuthValidator {
  constructor(private readonly user: McpUser) {}

  async validate(_token: string): Promise<{ user: McpUser }> {
    return { user: this.user };
  }
}
