import request, { type Agent, type Test } from "supertest";

import { PrismaService } from "../../src/core/prisma/prisma.service.js";
import { uuidV7 } from "../../src/core/uuid/uuid-v7.js";
import { setActiveOrganizationForAgent } from "./tenant-session.js";

/** Demo seed tenant — shared by hub and API e2e helpers (avoid circular imports). */
export const API_TEST_TENANT_ID = "11111111-1111-1111-1111-111111111111";

export const API_TEST_ABILITY_HEADER = "full";

/** CASL hatch used by most `/api/*` e2e specs. */
export function withApiTestAbility(test: Test): Test {
  return test.set("x-test-ability", API_TEST_ABILITY_HEADER);
}

export interface ApiTestSession {
  agent: Agent;
  userId: string;
  organizationId: string;
  sessionCookie: string;
  email: string;
  password: string;
}

/**
 * Sign up and sign in. Call {@link provisionApiTestTenant} before
 * hitting scoped `/api/*` routes.
 */
export async function createApiTestSession(
  httpServer: Parameters<typeof request>[0],
  options: {
    organizationId?: string;
    email?: string;
    password?: string;
    name?: string;
  } = {},
): Promise<ApiTestSession> {
  const organizationId = options.organizationId ?? API_TEST_TENANT_ID;
  const email = options.email ?? `api-test-${uuidV7()}@example.com`;
  const password = options.password ?? "password-12345";
  const name = options.name ?? "API Test User";

  const agent = request.agent(httpServer);
  const signUp = await agent
    .post("/api/auth/sign-up/email")
    .set("content-type", "application/json")
    .send({ email, password, name });
  if (signUp.status !== 200) {
    throw new Error(`sign-up failed (${signUp.status}): ${JSON.stringify(signUp.body)}`);
  }
  const userId = signUp.body.user.id as string;

  const signIn = await agent
    .post("/api/auth/sign-in/email")
    .set("content-type", "application/json")
    .send({ email, password });
  if (signIn.status !== 200) {
    throw new Error(`sign-in failed (${signIn.status}): ${JSON.stringify(signIn.body)}`);
  }

  const cookies = signIn.headers["set-cookie"] as string[] | undefined;
  const sessionCookie =
    cookies?.map((c) => c.split(";")[0]).join("; ") ??
    signUp.headers["set-cookie"]?.map((c: string) => c.split(";")[0]).join("; ") ??
    "";

  return { agent, userId, organizationId, sessionCookie, email, password };
}

/**
 * Ensure `organization` + `member` exist, then `set-active` for `/api/*`.
 */
export async function provisionApiTestTenant(
  prisma: PrismaService,
  httpServer: Parameters<typeof request>[0],
  session: ApiTestSession,
  organizationId?: string,
): Promise<void> {
  const orgId = organizationId ?? session.organizationId;
  await ensureOrganizationMember(prisma, {
    organizationId: orgId,
    userId: session.userId,
  });
  await setActiveOrganizationForAgent(session.agent, orgId);
  // Ensure the Prisma session row matches (getSession reads this field).
  const latest = await prisma.session.findFirst({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, activeOrganizationId: true },
  });
  if (latest && latest.activeOrganizationId !== orgId) {
    await prisma.session.update({
      where: { id: latest.id },
      data: { activeOrganizationId: orgId },
    });
  }
}

export async function ensureOrganizationMember(
  prisma: PrismaService,
  input: { organizationId: string; userId: string; name?: string },
): Promise<void> {
  const slug = `test-org-${input.organizationId.slice(0, 8)}`;
  const orgExists = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true },
  });
  if (!orgExists) {
    try {
      await prisma.organization.create({
        data: {
          id: input.organizationId,
          name: input.name ?? `Test Org ${input.organizationId.slice(0, 8)}`,
          slug,
          createdAt: new Date(),
        },
      });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code !== "P2002") throw err;
    }
  }
  const existing = await prisma.member.findFirst({
    where: {
      userId: input.userId,
      organizationId: input.organizationId,
    },
  });
  if (!existing) {
    await prisma.member.create({
      data: {
        id: uuidV7(),
        userId: input.userId,
        organizationId: input.organizationId,
        role: "owner",
        createdAt: new Date(),
      },
    });
  }
}
