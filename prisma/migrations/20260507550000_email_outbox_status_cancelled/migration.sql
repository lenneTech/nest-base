-- Add CANCELLED to EmailOutboxStatus (issue #91).
-- An admin cancel action sets a record to CANCELLED; the worker
-- never retries CANCELLED records (planner skips them).
ALTER TYPE "EmailOutboxStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
