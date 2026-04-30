/**
 * Pulls the current authenticated user off the Express request.
 *
 * `req.user` is set by the Better-Auth middleware on every
 * authenticated request. The shape is `{ id, tenantId, ... }` —
 * we narrow to the two fields we actually need here.
 *
 * Throws when the request reached the controller without an
 * authenticated user. With `@Can()` already gating these routes
 * that should be impossible — the throw is defense-in-depth so a
 * misconfigured guard doesn't silently leak data.
 */

interface AuthedRequest {
  user?: { id?: string; tenantId?: string };
}

export interface CurrentUser {
  id: string;
  tenantId: string;
}

export function requireCurrentUser(req: AuthedRequest): CurrentUser {
  const id = req.user?.id;
  const tenantId = req.user?.tenantId;
  if (!id || !tenantId) {
    throw new Error("user-profile: no authenticated user on request");
  }
  return { id, tenantId };
}
