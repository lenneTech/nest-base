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
 * After Hub sign-in, activate a default Better-Auth organization via set-active.
 * Tenant scope for hub/admin JSON comes from the session cookie only.
 */
export async function bootstrapHubOperatorSession(): Promise<string | undefined> {
  const listRes = await fetch("/api/auth/organization/list", {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!listRes.ok) return undefined;

  const orgs = (await listRes.json()) as HubOrganizationSummary[];
  const organizationId = pickDefaultOrganizationId(orgs);
  if (!organizationId) return undefined;

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
