/**
 * Type-test that the test infrastructure exposes a typed entrypoint.
 * Imports the global-setup and asserts its return type matches Vitest's
 * expected `() => Promise<unknown>` teardown contract.
 */
import type globalSetup from '../global-setup';

type GlobalSetupFn = typeof globalSetup;
type GlobalSetupReturn = Awaited<ReturnType<GlobalSetupFn>>;

declare const teardown: GlobalSetupReturn;
const _check: () => Promise<void> = teardown;
void _check;
