import { Module } from "@nestjs/common";

import { EmailModule } from "./email.module.js";
import { EmailOutboxModule } from "./email-outbox.module.js";
import { EmailOutboxAdminController } from "./email-outbox-admin.controller.js";

/**
 * EmailOutboxAdminModule — wires the `/admin/email-outbox/*` controller
 * (issue #91). Depends on:
 *
 *   - `EmailOutboxModule` (global, exports `EMAIL_OUTBOX_STORAGE`)
 *   - `EmailModule` (provides `EmailService` for the test-send endpoint)
 *
 * The storage binding (`EMAIL_OUTBOX_STORAGE`) is already provided by
 * `EmailOutboxModule` as a global token — no additional factory needed
 * here. The controller just injects it by token.
 */
@Module({
  imports: [EmailModule, EmailOutboxModule],
  controllers: [EmailOutboxAdminController],
})
export class EmailOutboxAdminModule {}
