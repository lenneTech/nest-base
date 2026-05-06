/**
 * `/admin/jobs` — Admin-namespaced Jobs dashboard. Re-uses the
 * `/dev/jobs/*` JSON contract so the admin and dev surfaces stay
 * aligned. Iter-108 ships the page so site operators (Better-Auth
 * admin role) can see queue + job state without dropping into the
 * developer portal.
 */
import type { ReactNode } from "react";

import { JobsPage } from "./JobsPage.js";

export function AdminJobsPage(): ReactNode {
  return <JobsPage />;
}
