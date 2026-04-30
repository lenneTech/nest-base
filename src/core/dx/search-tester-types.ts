/**
 * Read-model types for the `/admin/search` page.
 *
 * Shared between the JSON sidecar in `admin-spa.controller.ts` and the
 * React page. `snippet` arrives pre-wrapped in `<b>…</b>` markers from
 * postgres' `ts_headline`; the trust boundary stays on the server side
 * — the JSON sidecar must sanitise / produce that markup itself.
 */

export interface SearchHit {
  resource: string;
  id: string;
  title: string;
  /** ts_headline output — trusted, contains `<b>` markers. */
  snippet: string;
  rank: number;
}

export interface SearchTesterPageInput {
  /** What the admin typed (echoed back into the input). */
  query?: string;
  /** Postgres tsquery the FTS layer parsed (shown as a debug hint). */
  tsquery?: string;
  hits: SearchHit[];
}
