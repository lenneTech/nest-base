import request, { type Agent } from "supertest";

/**
 * Better-Auth org activation for e2e/app clients. After this call,
 * `/api/*` routes resolve tenant scope from `session.activeOrganizationId`
 * (production ignores `x-tenant-id` on app paths).
 */
export async function setActiveOrganization(
  httpServer: Parameters<typeof request>[0],
  sessionCookie: string,
  organizationId: string,
): Promise<void> {
  const res = await request(httpServer)
    .post("/api/auth/organization/set-active")
    .set("cookie", sessionCookie)
    .set("content-type", "application/json")
    .send({ organizationId });
  if (res.status !== 200) {
    throw new Error(`set-active failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
}

/** Same as {@link setActiveOrganization} but keeps supertest cookie jar in sync. */
export async function setActiveOrganizationForAgent(
  agent: Agent,
  organizationId: string,
): Promise<void> {
  const res = await agent
    .post("/api/auth/organization/set-active")
    .set("content-type", "application/json")
    .send({ organizationId });
  if (res.status !== 200) {
    throw new Error(`set-active failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
}
