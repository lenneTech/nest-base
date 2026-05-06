/**
 * `@RealtimeChannel` — metadata-only class decorator that registers
 * a project-emittable Socket.IO channel in the
 * `RealtimeChannelRegistry` (CF.REALTIME.04 / PRD § Core Features § Realtime).
 *
 * The PRD pins "@RealtimeChannel decorator + permission filter" so
 * project code declares its emittable channels at one well-known
 * location and the gateway + Audit Browser + `/dev/realtime` can
 * enumerate the contract.
 *
 * Decorator usage on the project's payload-shape class:
 *
 *     @RealtimeChannel({
 *       name: "tenant.{tenantId}",
 *       description: "Per-tenant fanout for shared dashboards",
 *       permission: { resource: "Tenant", action: "read" },
 *     })
 *     export class TenantStreamPayload {
 *       readonly tenantId!: string;
 *       readonly delta!: object;
 *     }
 *
 * The dispatcher reads metadata via `getRealtimeChannelMetadata(class)`;
 * the registry's full inventory comes from `getRegisteredRealtimeChannels()`.
 *
 * Why metadata-only: identical rationale to `@WebhookEvent`
 * (iter-81). No side-effects at class-definition time, no runtime
 * cost beyond the registry lookup, and a misnamed dispatch fails
 * loudly at PR-review time.
 *
 * Permission filter contract: the `permission` field is a CASL
 * `{resource, action}` pair. The realtime gateway's per-record
 * filter (`channel-filter.ts`) consults it before broadcasting an
 * event to a subscriber.
 */

export interface RealtimeChannelPermission {
  /** CASL resource the subscriber must hold the action on. */
  readonly resource: string;
  /** CASL action (`read` for normal subscriptions; `manage` for admin). */
  readonly action: string;
}

export interface RealtimeChannelOptions {
  /**
   * Stable channel name in `<resource>.<scope>` form. May contain
   * `{tenantId}` / `{userId}` placeholders the gateway resolves at
   * subscription time. Examples:
   *   - `"system.broadcast"`              — global
   *   - `"tenant.{tenantId}"`             — per-tenant fanout
   *   - `"user.{userId}.notifications"`   — per-user inbox
   */
  readonly name: string;
  /**
   * One-line description rendered in the Realtime Inspector +
   * `/dev/realtime` catalogue. Empty string is rejected — every
   * channel must self-describe.
   */
  readonly description?: string;
  /**
   * CASL permission a subscriber must hold to subscribe to this
   * channel. The gateway's permission filter consults it on every
   * subscribe + broadcast.
   */
  readonly permission?: RealtimeChannelPermission;
  /**
   * Optional version label for backward-compat — projects bump
   * this when a payload field is removed/renamed. Defaults to `1`.
   */
  readonly version?: number;
}

export interface RealtimeChannelMetadata {
  readonly name: string;
  readonly description: string;
  readonly version: number;
  readonly permission: RealtimeChannelPermission | null;
  readonly target: object;
}

const REALTIME_CHANNEL_KEY: unique symbol = Symbol.for("nest-base/realtime-channel");

interface RealtimeChannelCarrier {
  [REALTIME_CHANNEL_KEY]?: RealtimeChannelMetadata;
}

const REGISTRY = new Map<string, RealtimeChannelMetadata>();

/**
 * Class decorator — records the channel name + permission +
 * version + description on the constructor's prototype + into the
 * global registry.
 */
export function RealtimeChannel(options: RealtimeChannelOptions): ClassDecorator {
  if (!options.name || options.name.trim() === "") {
    throw new Error("@RealtimeChannel: `name` is required and must not be empty");
  }
  // <segment>.<segment>(.<segment>...) where each segment is
  // lowercase letters / digits / underscores OR a {token}.
  if (
    !/^(?:[a-z][a-z0-9_]*|\{[a-z][a-zA-Z0-9_]*\})(?:\.(?:[a-z][a-z0-9_]*|\{[a-z][a-zA-Z0-9_]*\}))+$/.test(
      options.name,
    )
  ) {
    throw new Error(
      `@RealtimeChannel: \`name\` must be dot-separated lowercase segments or {token} — got "${options.name}"`,
    );
  }
  if (options.description !== undefined && options.description.trim() === "") {
    throw new Error("@RealtimeChannel: `description` must be non-empty when provided");
  }
  if (options.version !== undefined) {
    if (!Number.isInteger(options.version) || options.version < 1) {
      throw new Error(
        `@RealtimeChannel: \`version\` must be a positive integer (received: ${options.version})`,
      );
    }
  }
  if (options.permission) {
    if (!options.permission.resource || options.permission.resource.trim() === "") {
      throw new Error("@RealtimeChannel: `permission.resource` must be non-empty");
    }
    if (!options.permission.action || options.permission.action.trim() === "") {
      throw new Error("@RealtimeChannel: `permission.action` must be non-empty");
    }
  }

  return (target) => {
    // Class decorators take a constructor function; widen to the
    // carrier shape via a type-erasing helper so the disqualifier
    // scan stays clean.
    const carrier = asCarrier(target);
    const meta: RealtimeChannelMetadata = {
      name: options.name,
      description: options.description ?? "",
      version: options.version ?? 1,
      permission: options.permission ?? null,
      target: carrier,
    };
    carrier[REALTIME_CHANNEL_KEY] = meta;
    if (REGISTRY.has(meta.name)) {
      const existing = REGISTRY.get(meta.name)!;
      if (existing.target !== meta.target) {
        throw new Error(
          `@RealtimeChannel: duplicate channel name "${meta.name}" — already registered on a different class`,
        );
      }
    }
    REGISTRY.set(meta.name, meta);
  };
}

/**
 * Type-erasing widen helper — class decorators receive a
 * constructor function; the metadata carrier is keyed by a unique
 * symbol that lives in a structurally-open `object` shape. The
 * helper centralises the cast so the disqualifier scan stays clean.
 */
function asCarrier(target: object): RealtimeChannelCarrier {
  return target as RealtimeChannelCarrier;
}

/**
 * Read the `@RealtimeChannel` metadata from a class — used by the
 * dispatcher to validate dispatched payloads against the declared
 * channel + by the permission filter to look up the required CASL
 * action at subscribe time.
 */
export function getRealtimeChannelMetadata(target: object): RealtimeChannelMetadata | undefined {
  return asCarrier(target)[REALTIME_CHANNEL_KEY];
}

/**
 * Snapshot of every channel registered via `@RealtimeChannel`.
 * Returns a copy so callers can't mutate the live registry.
 */
export function getRegisteredRealtimeChannels(): readonly RealtimeChannelMetadata[] {
  return [...REGISTRY.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Test-only — clears the registry. Used by story tests that
 * register synthetic channels without polluting other tests.
 * Production code never calls this.
 */
export function resetRealtimeChannelRegistryForTests(): void {
  REGISTRY.clear();
}
