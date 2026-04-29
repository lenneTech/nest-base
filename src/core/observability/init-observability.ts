import type { AppEnv } from "../http/cookie-cors-config.js";

/**
 * Minimal OpenTelemetry SDK shape that we depend on. Kept narrow so we
 * can swap `@opentelemetry/sdk-node` for a different SDK or a stub in
 * tests without code changes.
 */
export interface OtelSdk {
  start(): Promise<void> | void;
  shutdown(): Promise<void> | void;
}

export interface InitObservabilityOptions {
  enabled: boolean;
  env: AppEnv | "test";
  serviceName: string;
  /**
   * Override the SDK construction. Defaults to a no-op factory; consumers
   * (or `bootstrap()`) plug in `@opentelemetry/sdk-node` when they want
   * real OTLP exports. Letting the factory be injectable keeps the unit
   * tests deterministic without spinning up a collector.
   */
  sdkFactory?: (ctx: { serviceName: string; env: AppEnv | "test" }) => OtelSdk;
}

export type ShutdownFn = () => Promise<void>;

/**
 * Initialize OpenTelemetry. Returns a `shutdown` function the caller is
 * expected to wire into the NestJS shutdown hook.
 *
 * Behavior:
 *   - `enabled=false` → noop shutdown, no SDK started.
 *   - `env='test'`    → noop, regardless of `enabled`. Tests do not need
 *                       real exporters and starting the SDK from inside a
 *                       test runner produces noisy connection errors.
 *   - otherwise       → SDK is constructed and `start()`-ed; the returned
 *                       shutdown calls `sdk.shutdown()` exactly once.
 */
export async function initObservability(options: InitObservabilityOptions): Promise<ShutdownFn> {
  if (!options.enabled || options.env === "test") {
    return async () => {};
  }

  const factory = options.sdkFactory ?? defaultSdkFactory;
  const sdk = factory({ serviceName: options.serviceName, env: options.env });
  await sdk.start();

  let shut = false;
  return async () => {
    if (shut) return;
    shut = true;
    await sdk.shutdown();
  };
}

function defaultSdkFactory(): OtelSdk {
  // Real `@opentelemetry/sdk-node` adoption is an enabling change in a
  // later slice (Phase 8 / observability). Until then we expose a stub
  // so consumers that flip `observability.enabled=true` get a clear
  // signal rather than a silent failure.
  throw new Error(
    "observability.enabled=true but no sdkFactory was provided. Pass an `@opentelemetry/sdk-node` factory or keep observability disabled.",
  );
}
