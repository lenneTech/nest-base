/**
 * Server-identity constants surfaced via `GET /`.
 *
 * Version is read from `package.json` so a single bump in the manifest
 * propagates to the API response without a separate constant to update.
 */
import pkg from '../../../package.json' with { type: 'json' };

export const APP_NAME = pkg.name;
export const APP_VERSION = pkg.version;
