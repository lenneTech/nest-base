import { Module } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";
import { DefaultImpersonationAuditSink } from "./impersonation.audit-sink.js";
import {
  IMPERSONATION_AUDIT_SINK,
  IMPERSONATION_TEARDOWN,
  type ImpersonationSessionTeardown,
  ImpersonationController,
} from "./impersonation.controller.js";
import { DefaultSessionRevokeAuditSink } from "./session-revoke.audit-sink.js";
import {
  SESSION_REVOKE_AUDIT_SINK,
  SESSION_REVOKE_STORAGE,
  type SessionRevokeStorage,
  SessionsAdminController,
} from "./sessions-admin.controller.js";
import { BetterAuthModule } from "./better-auth.module.js";

/**
 * SessionsAdminModule — wires the `/admin/sessions/*` and
 * `/admin/impersonation/*` controllers (CF.AUTH.SESSIONS +
 * CF.AUTH.IMPERSONATION). The session-revoke storage and
 * impersonation teardown are abstracted behind tokens; the default
 * factories return no-op sentinels so the module mounts cleanly
 * out-of-the-box. Production code overrides the providers in its
 * bootstrap to wire Better-Auth's Prisma-backed session storage +
 * the audit-log writer.
 */

const noopRevokeStorage: SessionRevokeStorage = {
  listAllSessions: async (_tenantId?: string) => [],
  revokeSession: async (_sessionId: string) => {
    // Fail loudly rather than silently swallowing the revoke request.
    // A project that calls revokeSession without wiring a real storage
    // adapter would otherwise appear to succeed while doing nothing —
    // a silent security-critical no-op (M3 fix).
    throw new Error(
      "revokeSession: no SessionRevokeStorage bound — wire SESSION_REVOKE_STORAGE " +
        "in your AppModule to a Better-Auth Prisma adapter or equivalent implementation.",
    );
  },
};

const noopImpersonationTeardown: ImpersonationSessionTeardown = {
  endImpersonation: async () => {
    // Projects tear down the impersonation session via Better-Auth
    // admin plugin's revokeSession helper here.
  },
};

@Module({
  // BetterAuthModule exports BETTER_AUTH_INSTANCE so SessionsAdminController
  // can look up the verified session id for the revokeOthers endpoint (MAJ-4).
  imports: [BetterAuthModule],
  controllers: [SessionsAdminController, ImpersonationController],
  providers: [
    { provide: SESSION_REVOKE_STORAGE, useValue: noopRevokeStorage },
    // SessionRevokeAuditSink default writes REVOKE rows to the
    // `audit_log` table (CF.AUTH.SESSIONS, iter-90). Parallel to
    // the impersonation sink — projects override the binding to
    // route to a custom audit sink.
    {
      provide: SESSION_REVOKE_AUDIT_SINK,
      useFactory: (prisma: PrismaService) => new DefaultSessionRevokeAuditSink(prisma),
      inject: [PrismaService],
    },
    // ImpersonationAuditSink default writes IMPERSONATION_START / STOP
    // rows to the `audit_log` table out-of-the-box (SC.SUB.16). Projects
    // override the binding via standard Nest provider replacement when
    // they want to route to a custom sink.
    {
      provide: IMPERSONATION_AUDIT_SINK,
      useFactory: (prisma: PrismaService) => new DefaultImpersonationAuditSink(prisma),
      inject: [PrismaService],
    },
    { provide: IMPERSONATION_TEARDOWN, useValue: noopImpersonationTeardown },
  ],
  exports: [
    SESSION_REVOKE_STORAGE,
    SESSION_REVOKE_AUDIT_SINK,
    IMPERSONATION_AUDIT_SINK,
    IMPERSONATION_TEARDOWN,
  ],
})
export class SessionsAdminModule {}
