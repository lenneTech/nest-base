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
import { PrismaSessionRevokeStorage } from "./prisma-session-revoke.storage.js";
import {
  SESSION_REVOKE_AUDIT_SINK,
  SESSION_REVOKE_STORAGE,
  SessionsAdminController,
} from "./sessions-admin.controller.js";
import { BetterAuthModule } from "./better-auth.module.js";

const noopImpersonationTeardown: ImpersonationSessionTeardown = {
  endImpersonation: async () => {
    // Projects tear down the impersonation session via Better-Auth
    // admin plugin's revokeSession helper here.
  },
};

/**
 * SessionsAdminModule — wires the `/admin/sessions/*` and
 * `/admin/impersonation/*` controllers (CF.AUTH.SESSIONS +
 * CF.AUTH.IMPERSONATION). Session inventory + revoke use Prisma by
 * default (same source as `/admin/users` session counts). Projects
 * may override `SESSION_REVOKE_STORAGE` when they bind a remote store.
 */

@Module({
  // BetterAuthModule exports BETTER_AUTH_INSTANCE so SessionsAdminController
  // can look up the verified session id for the revokeOthers endpoint (MAJ-4).
  imports: [BetterAuthModule],
  controllers: [SessionsAdminController, ImpersonationController],
  providers: [
    {
      provide: SESSION_REVOKE_STORAGE,
      useFactory: (prisma: PrismaService) => new PrismaSessionRevokeStorage(prisma),
      inject: [PrismaService],
    },
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
