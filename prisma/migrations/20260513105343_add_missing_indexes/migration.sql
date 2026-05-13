-- DropForeignKey
ALTER TABLE "invitation" DROP CONSTRAINT "invitation_inviter_id_fkey";

-- DropForeignKey
ALTER TABLE "invitation" DROP CONSTRAINT "invitation_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "member" DROP CONSTRAINT "member_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "member" DROP CONSTRAINT "member_user_id_fkey";

-- DropForeignKey
ALTER TABLE "pending_erasures" DROP CONSTRAINT "pending_erasures_user_fk";

-- DropIndex
DROP INDEX "throttler_records_expires_at_idx";

-- AlterTable
ALTER TABLE "invitation" ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "member" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "organization" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "rate_limit_allowlist" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "rate_limit_configs" ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "rate_limit_decisions" ALTER COLUMN "ts" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "system_secrets" ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "throttler_records" ALTER COLUMN "count" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "invitation_email_idx" ON "invitation"("email");

-- CreateIndex
CREATE INDEX "webhook_deliveries_endpoint_id_status_next_retry_at_idx" ON "webhook_deliveries"("endpoint_id", "status", "next_retry_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_retry_at_idx" ON "webhook_deliveries"("status", "next_retry_at");

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_erasures" ADD CONSTRAINT "pending_erasures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "pending_erasures_eligible_idx" RENAME TO "pending_erasures_completed_at_cancelled_at_requested_at_idx";
