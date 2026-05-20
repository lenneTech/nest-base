/**
 * Pure path classification for the Hub operator SPA.
 *
 * Used by `jwt-middleware` (session required?) and
 * `BetterAuthSessionMiddleware` (HTML redirect to `/`).
 */

/** Bundled SPA assets — must stay public so the login page can load JS/CSS. */
export function isHubPortalStaticAsset(path: string): boolean {
  return path.startsWith("/hub/static/");
}

/** Login surface — Better-Auth sign-in, no session required. */
export function isHubPortalLoginPath(path: string): boolean {
  return path === "/";
}

/**
 * SPA gate probe — must stay reachable for any signed-in user so the
 * client can show "no Hub access" instead of a blind 403.
 */
export function isHubPortalAccessProbePath(path: string): boolean {
  return path === "/hub/portal-access.json";
}

/** Dev cockpit pages under `/hub/*` (excludes static assets and the access probe). */
export function isHubCockpitPath(path: string): boolean {
  if (isHubPortalStaticAsset(path)) return false;
  if (isHubPortalAccessProbePath(path)) return false;
  return path === "/hub" || path.startsWith("/hub/");
}

/** Tenant-admin SPA + JSON under `/admin/*`. */
export function isTenantAdminPortalPath(path: string): boolean {
  return path === "/admin" || path.startsWith("/admin/");
}

/**
 * Operator SPA HTML + JSON under `/hub/*` and `/admin/*` (except static).
 * Requires a Better-Auth session; CASL `Hub` / admin subjects gate features.
 */
export function isHubPortalProtectedPath(path: string): boolean {
  if (isHubPortalStaticAsset(path)) return false;
  if (path === "/hub" || path.startsWith("/hub/")) return true;
  if (path === "/admin" || path.startsWith("/admin/")) return true;
  return false;
}

/** Browser navigation / SPA shell requests (HTML-first Accept). */
export function prefersHubPortalHtmlResponse(input: {
  method: string | undefined;
  acceptHeader: string | undefined;
}): boolean {
  if (input.method !== undefined && input.method !== "GET" && input.method !== "HEAD") {
    return false;
  }
  const accept = input.acceptHeader ?? "";
  if (accept.includes("text/html")) return true;
  // Browser navigation often sends */* — treat SPA paths as HTML-first.
  if (accept.includes("*/*") && !accept.includes("application/json")) return true;
  return false;
}

/** True when an unauthenticated browser should be sent to `/` instead of 401 JSON. */
export function prefersHubPortalLoginRedirect(input: {
  path: string;
  method: string | undefined;
  acceptHeader: string | undefined;
}): boolean {
  if (!isHubPortalProtectedPath(input.path)) return false;
  return prefersHubPortalHtmlResponse(input);
}
