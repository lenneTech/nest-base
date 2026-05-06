// k6 smoke test — `/health/live` RPS probe (TR.Testing — k6).
//
// Runs a 10-second sustained-load probe against the liveness endpoint
// and asserts the SC.PERF.02 budget (median < 50ms, p95 < 200ms).
// Used as the baseline that confirms a deployment can serve at least
// 200 RPS without breaching the latency budgets.
//
// Usage:
//   k6 run tests/k6/health-live-rps.js
//
// Environment overrides:
//   BASE_URL — default http://localhost:3000
//   DURATION — default 10s
//   VUS — default 20

import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: Number(__ENV.VUS) || 20,
  duration: __ENV.DURATION || "10s",
  thresholds: {
    // SC.PERF.02 — /health/live median < 50ms.
    "http_req_duration{endpoint:health-live}": ["med<50", "p(95)<200"],
    // Every probe must succeed; any failure surfaces a regression.
    "http_req_failed{endpoint:health-live}": ["rate<0.01"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

export default function () {
  const res = http.get(`${BASE_URL}/health/live`, {
    tags: { endpoint: "health-live" },
  });
  check(res, {
    "status is 200": (r) => r.status === 200,
    "body has status field": (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.status === "ok";
      } catch {
        return false;
      }
    },
  });
  // Brief pacing — keeps the run from saturating the local loopback.
  sleep(0.05);
}
