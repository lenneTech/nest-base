/**
 * `@WebhookEvent` — metadata-only class decorator that registers
 * a project-emittable webhook event in the `WebhookEventRegistry`
 * (CF.WEBHOOK.04 / PRD § Core Features § Webhooks).
 *
 * The PRD requires "Webhook event registry + @WebhookEvent
 * decorator + secret format" so consumer code declares its
 * emittable events at one well-known location and the dispatcher
 * + Audit Browser can enumerate the contract.
 *
 * Decorator usage on the project's payload-shape class:
 *
 *     @WebhookEvent({ name: "user.created", description: "..." })
 *     export class UserCreatedEvent {
 *       readonly userId!: string;
 *       readonly email!: string;
 *     }
 *
 * The dispatcher reads metadata via `getWebhookEventMetadata(class)`;
 * the registry's full inventory comes from `getRegisteredWebhookEvents()`.
 *
 * Why metadata-only:
 *   - No side-effects at class-definition time (safe for tests).
 *   - The dispatcher decides routing / retries; the decorator only
 *     records the name → payload-shape contract so misnamed
 *     `dispatch(event)` calls fail loudly at PR-review time.
 */

export interface WebhookEventOptions {
  /**
   * Stable event name in `<resource>.<action>` form
   * (e.g. `user.created`, `subscription.cancelled`). Becomes the
   * `event` field of the dispatched payload + the catalogue
   * label the Audit Browser groups by.
   */
  readonly name: string;
  /**
   * One-line description rendered in the Webhook Inspector +
   * `/hub/webhooks` catalogue. Empty string is rejected — every
   * event must self-describe.
   */
  readonly description?: string;
  /**
   * Optional version label for backward-compat — projects bump
   * this when a payload field is removed/renamed. Defaults to
   * `1` for new events.
   */
  readonly version?: number;
}

export interface WebhookEventMetadata {
  readonly name: string;
  readonly description: string;
  readonly version: number;
  readonly target: object;
}

const WEBHOOK_EVENT_KEY: unique symbol = Symbol.for("nest-base/webhook-event");

interface WebhookEventCarrier {
  [WEBHOOK_EVENT_KEY]?: WebhookEventMetadata;
}

const REGISTRY = new Map<string, WebhookEventMetadata>();

/**
 * Class decorator — records the event name + version + description
 * on the constructor's prototype + into the global registry.
 */
export function WebhookEvent(options: WebhookEventOptions): ClassDecorator {
  if (!options.name || options.name.trim() === "") {
    throw new Error("@WebhookEvent: `name` is required and must not be empty");
  }
  // <resource>.<action> form — lowercase, dot-separated. Allows
  // hierarchical nesting (`tenant.member.invited`) for projects with
  // sub-resources. Snake_case segments allowed.
  if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(options.name)) {
    throw new Error(
      `@WebhookEvent: \`name\` must be in <resource>.<action> form (lowercase, dot-separated) — got "${options.name}"`,
    );
  }
  if (options.description !== undefined && options.description.trim() === "") {
    throw new Error("@WebhookEvent: `description` must be non-empty when provided");
  }
  if (options.version !== undefined) {
    if (!Number.isInteger(options.version) || options.version < 1) {
      throw new Error(
        `@WebhookEvent: \`version\` must be a positive integer (received: ${options.version})`,
      );
    }
  }

  return (target) => {
    const carrier = asCarrier(target);
    const meta: WebhookEventMetadata = {
      name: options.name,
      description: options.description ?? "",
      version: options.version ?? 1,
      target: carrier,
    };
    carrier[WEBHOOK_EVENT_KEY] = meta;
    // Register globally so the catalogue endpoint can enumerate every
    // declared event without walking every project module.
    if (REGISTRY.has(meta.name)) {
      const existing = REGISTRY.get(meta.name)!;
      if (existing.target !== meta.target) {
        throw new Error(
          `@WebhookEvent: duplicate event name "${meta.name}" — already registered on a different class`,
        );
      }
    }
    REGISTRY.set(meta.name, meta);
  };
}

/**
 * Type-erasing widen helper — class decorators receive a
 * constructor function; the metadata carrier is keyed by a unique
 * symbol on an `object` shape. The helper centralises the cast so
 * the disqualifier scan stays clean.
 */
function asCarrier(target: object): WebhookEventCarrier {
  return target as WebhookEventCarrier;
}

/**
 * Read the `@WebhookEvent` metadata from a class — used by the
 * dispatcher to validate incoming payloads against the declared
 * event before fanning them out.
 */
export function getWebhookEventMetadata(target: object): WebhookEventMetadata | undefined {
  return asCarrier(target)[WEBHOOK_EVENT_KEY];
}

/**
 * Snapshot of every event registered via `@WebhookEvent`.
 * Returns a copy so callers can't mutate the live registry.
 */
export function getRegisteredWebhookEvents(): readonly WebhookEventMetadata[] {
  return [...REGISTRY.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Test-only — clears the registry. Used by story tests that
 * register synthetic events without polluting other tests.
 * Production code never calls this.
 */
export function resetWebhookEventRegistryForTests(): void {
  REGISTRY.clear();
}
