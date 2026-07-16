/** Demo org from `bun run seed` — preferred when multiple memberships exist. */
const PREFERRED_ORG_SLUG = "lenne";

export interface HubOrganizationSummary {
  id: string;
  slug?: string;
  name?: string;
}

/**
 * Pick the seeded demo org when present, otherwise the first membership.
 */
export function pickDefaultOrganizationId(
  orgs: readonly HubOrganizationSummary[],
): string | undefined {
  const preferred = orgs.find((o) => o.slug === PREFERRED_ORG_SLUG);
  return preferred?.id ?? orgs[0]?.id;
}

/**
 * After Hub sign-in, resolve the tenant the operator's admin pages scope to.
 *
 * MULTI-TENANT: `/api/auth/organization/list` returns the operator's orgs; we
 * pick a default, `set-active` it (tenant scope then comes from the session
 * cookie), and return its id. This path is unchanged.
 *
 * SINGLE-TENANT: the org plugin is off, so `organization/list` 404s (or
 * returns an empty list). There is no `activeOrganizationId` to seed the
 * tenant-gated admin pages, which would otherwise keep their query disabled
 * and hang in "Loading …". We fall back to `/hub/operator-tenant.json`, which
 * resolves the operator's OWN membership tenant server-side, and return that
 * id so the pages render exactly as in multi-tenant mode.
 */
export async function bootstrapHubOperatorSession(): Promise<string | undefined> {
  const listRes = await fetch("/api/auth/organization/list", {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  // 404 → single-tenant (org plugin off): resolve the tenant server-side.
  if (!listRes.ok) return resolveSingleTenantOperatorTenantId();

  const orgs = (await listRes.json()) as HubOrganizationSummary[];
  const organizationId = pickDefaultOrganizationId(orgs);
  // Empty list → still single-tenant-shaped: same server-side fallback.
  if (!organizationId) return resolveSingleTenantOperatorTenantId();

  await fetch("/api/auth/organization/set-active", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ organizationId }),
  });

  return organizationId;
}

/**
 * Single-tenant tenant resolution: ask the server which tenant the operator's
 * membership maps to. No `set-active` here — the org plugin does not exist in
 * single-tenant mode; the `HubOperatorTenantInterceptor` stamps the tenant per
 * request from the same membership resolver. Returns `undefined` when the
 * probe fails or the operator has no membership (server sends `tenantId: null`).
 */
async function resolveSingleTenantOperatorTenantId(): Promise<string | undefined> {
  const res = await fetch("/hub/operator-tenant.json", {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!res.ok) return undefined;
  const body = (await res.json()) as { tenantId: string | null };
  return body.tenantId ?? undefined;
}

/** Switch the Better-Auth session to a specific organization (hub/admin JSON). */
export async function activateHubOrganization(organizationId: string): Promise<boolean> {
  const res = await fetch("/api/auth/organization/set-active", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ organizationId }),
  });
  return res.ok;
}
