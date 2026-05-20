import type { Features } from "../features/features.js";

/**
 * Resolve the active Better-Auth plugin set from the project's feature
 * flags. The list grows in tandem with what the integration layer wires
 * into the Better-Auth options bag.
 */

export type AuthPluginName =
  | "emailPassword"
  | "twoFactor"
  | "passkey"
  | "apiKeys"
  | "social"
  | "emailVerification"
  | "magicLink"
  | "admin"
  | "organization"
  | "oneTap"
  | "openAPI";

export function listAuthPluginNames(features: Features): AuthPluginName[] {
  const plugins: AuthPluginName[] = [];
  if (features.authMethods.emailPassword) plugins.push("emailPassword");
  if (features.authMethods.twoFactor) plugins.push("twoFactor");
  if (features.authMethods.passkey) plugins.push("passkey");
  if (features.authMethods.apiKeys) plugins.push("apiKeys");
  if (features.authMethods.socialProviders.length > 0) plugins.push("social");
  if (features.email.enabled) plugins.push("emailVerification");
  if (features.magicLink.enabled) plugins.push("magicLink");
  if (features.adminPlugin.enabled) plugins.push("admin");
  if (features.multiTenancy.enabled) plugins.push("organization");
  if (features.oneTap.enabled) plugins.push("oneTap");
  if (features.openAPI.enabled) plugins.push("openAPI");
  return plugins;
}
