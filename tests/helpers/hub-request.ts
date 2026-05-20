import type { INestApplication } from "@nestjs/common";
import { type Agent, type Test } from "supertest";

import { PrismaService } from "../../src/core/prisma/prisma.service.js";
import { API_TEST_TENANT_ID, createApiTestSession, provisionApiTestTenant } from "./api-request.js";

/** CASL header value that seeds `manage:all` in vitest (see `test-ability.ts`). */
export const HUB_TEST_ABILITY_HEADER = "full";

/** Demo seed tenant used by hub/admin inspector e2e specs. */
export const HUB_TEST_TENANT_ID = API_TEST_TENANT_ID;

/** Call before `bootstrap()` so Better-Auth and hub/admin feature gates match e2e expectations. */
export function pinHubTestAuthEnv(): void {
  process.env.BETTER_AUTH_SECRET ??=
    "test-better-auth-secret-for-testing-purposes-only-1234567890abcd";
  process.env.APP_BASE_URL ??= "http://localhost:3000";
  process.env.FEATURE_JOBS_ENABLED ??= "true";
  process.env.FEATURE_WEBHOOKS_ENABLED ??= "true";
  process.env.FEATURE_SEARCH_ENABLED ??= "true";
  process.env.FEATURE_REALTIME_ENABLED ??= "true";
  process.env.FEATURE_FILES_ENABLED ??= "true";
}

function withHubTestAbility(test: Test): Test {
  return test.set("x-test-ability", HUB_TEST_ABILITY_HEADER);
}

/** Supertest wrapper for `/hub/*` and `/admin/*` with the vitest CASL hatch. */
export function hubAgentReq(agent: Agent) {
  return {
    get: (url: string) => withHubTestAbility(agent.get(url)),
    post: (url: string) => withHubTestAbility(agent.post(url)),
    put: (url: string) => withHubTestAbility(agent.put(url)),
    patch: (url: string) => withHubTestAbility(agent.patch(url)),
    delete: (url: string) => withHubTestAbility(agent.delete(url)),
  };
}

/**
 * Returns a request helper backed by a Better-Auth session with `set-active`
 * for the given organization (tenant-scoped hub/admin JSON).
 */
export async function hubReqScoped(
  app: INestApplication,
  tenantId: string = HUB_TEST_TENANT_ID,
  sessionOptions: Parameters<typeof createApiTestSession>[1] = {},
): Promise<ReturnType<typeof hubAgentReq>> {
  pinHubTestAuthEnv();
  const prisma = app.get(PrismaService);
  const session = await createApiTestSession(app.getHttpServer(), {
    organizationId: tenantId,
    ...sessionOptions,
  });
  await provisionApiTestTenant(prisma, app.getHttpServer(), session, tenantId);
  return hubAgentReq(session.agent);
}
