/**
 * Thrown when a tenant-scoped route is hit without a session organization.
 * Mapped to a problem-details response by `ProblemDetailsFilter`.
 */
export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantIsolationError";
  }
}
