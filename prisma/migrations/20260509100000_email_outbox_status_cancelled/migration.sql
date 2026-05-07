-- Add CANCELLED value to the EmailOutboxStatus enum (issue #91).
-- Missing from the initial email_outbox migration but present in the schema.
ALTER TYPE "EmailOutboxStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
