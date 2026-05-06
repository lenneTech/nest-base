// k6 cold-start latency probe (SC.PERF.01 — cold-start < 5s).
//
// Runs a single-request sequence to validate the first request after
// boot completes within the SC.PERF.01 cold-start budget. Designed
// to be invoked immediately after `bun run dev` boot in CI.
//
// Usage:
//   k6 run tests/k6/cold-start-latency.js
//
// Environment overrides:
//   BASE_URL — default http://localhost:3000

import http from "k6/http";
import { check } from "k6";

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    http_req_duration: ["p(95)<5000"],
    http_req_failed: ["rate==0"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

export default function () {
  const res = http.get(`${BASE_URL}/health/live`);
  check(res, {
    "cold-start under 5s": (r) => r.timings.duration < 5000,
    "status is 200": (r) => r.status === 200,
  });
}
