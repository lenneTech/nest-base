/**
 * Injection token for the EmailOutboxRecorder.
 *
 * Lives in its own file (rather than email-outbox.module.ts) so
 * EmailModule can import it without pulling the whole outbox module
 * graph — that prevents a circular import between EmailModule
 * (provides EmailService) and EmailOutboxModule (consumes
 * EmailService's drivers via the adapter).
 */
export const EMAIL_OUTBOX_RECORDER = Symbol.for("lt:EmailOutboxRecorder");
