/**
 * Shared predicate for the FILE_SHARE_LINK_SECRET pre-flight check.
 *
 * Both `resolveShareLinkSecret()` (files.module.ts) and the bootstrap.ts
 * pre-flight block use this helper so there is one source of truth.
 * Previously the condition was inlined independently in two places, which
 * allowed them to silently diverge (Finding 6 / round-8 review).
 *
 * @param nodeEnv - The value of `process.env.NODE_ENV` (or equivalent).
 * @param secret  - The value of `process.env.FILE_SHARE_LINK_SECRET`.
 * @returns `true` when the secret is present and at least 32 characters long,
 *          OR when the environment is not "production" (so dev/test deployments
 *          can omit the secret without a hard error).
 */
export function isShareLinkSecretValid(
  nodeEnv: string | undefined,
  secret: string | undefined,
): boolean {
  if (nodeEnv !== "production") return true;
  return secret !== undefined && secret.length >= 32;
}
