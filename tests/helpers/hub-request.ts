import type { INestApplication } from "@nestjs/common";
import request, { type Test } from "supertest";

/** CASL header value that seeds `manage:all` in vitest (see `test-ability.ts`). */
export const HUB_TEST_ABILITY_HEADER = "full";

/** Demo seed tenant used by admin inspector e2e specs. */
export const HUB_TEST_TENANT_ID = "11111111-1111-1111-1111-111111111111";

function withHubTestAbility(test: Test, url: string): Test {
  let chain = test.set("x-test-ability", HUB_TEST_ABILITY_HEADER);
  if (url === "/admin" || url.startsWith("/admin/")) {
    chain = chain.set("x-tenant-id", HUB_TEST_TENANT_ID);
  }
  return chain;
}

/**
 * Supertest agent for `/hub/*` and `/admin/*` with the vitest CASL hatch.
 * Headers are applied after the HTTP verb because supertest v7 only exposes
 * `.set()` on the per-request `Test` object, not on the root agent.
 */
export function hubReq(app: INestApplication) {
  const agent = request(app.getHttpServer());
  return {
    get: (url: string) => withHubTestAbility(agent.get(url), url),
    post: (url: string) => withHubTestAbility(agent.post(url), url),
    put: (url: string) => withHubTestAbility(agent.put(url), url),
    patch: (url: string) => withHubTestAbility(agent.patch(url), url),
    delete: (url: string) => withHubTestAbility(agent.delete(url), url),
  };
}
