/**
 * After Hub sign-in, activate a default Better-Auth organization and
 * mirror it into the `x-tenant-id` cookie admin pages expect.
 */
export async function bootstrapHubOperatorSession(): Promise<void> {
  const listRes = await fetch("/api/auth/organization/list", {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!listRes.ok) return;

  const orgs = (await listRes.json()) as Array<{ id: string }>;
  const organizationId = orgs[0]?.id;
  if (!organizationId) return;

  await fetch("/api/auth/organization/set-active", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ organizationId }),
  });

  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `x-tenant-id=${encodeURIComponent(organizationId)}; Path=/; SameSite=Lax${secure}`;
}
