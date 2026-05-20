// k6 memory load test — long-running heap-stability probe (TR.Testing — k6 + SC.PERF.05).
//
// Runs a 5-minute sustained mixed-workload pass and reports peak heap +
// growth-rate. The companion CI gate at SC.BOOT.07 asserts cold-start
// heap < 200 MB; this test asserts that a real workload doesn't push
// the resident set monotonically upward — which would indicate a leak.
//
// Usage:
//   k6 run tests/k6/memory-test.js
//
// Environment overrides:
//   BASE_URL — default http://localhost:3000
//   DURATION — default 5m
//   VUS — default 10
//
// CI policy: this test is `allow_failure` in `.gitlab-ci.yml` because
// the heap-budget gate is the canonical assertion (k6 here is the
// soak-style follow-up that surfaces regressions over many minutes,
// not a hard PR gate).

import http from "k6/http";
import { Trend } from "k6/metrics";
import { check, sleep } from "k6";

const heapDeltaMb = new Trend("heap_delta_mb", false);

export const options = {
  vus: Number(__ENV.VUS) || 10,
  duration: __ENV.DURATION || "5m",
  thresholds: {
    // No request should fail under sustained load.
    http_req_failed: ["rate<0.01"],
    // Heap-growth budget: across the full run, the difference between
    // first and last sampled heap must stay below 50 MB. A linear-
    // monotonic climb past that ceiling is the canonical leak signal.
    heap_delta_mb: ["max<50"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

let firstHeapMb = null;

export default function () {
  // Mixed workload: alternate the cheap liveness probe with the
  // dependency-aware readiness probe so the hot path traverses both
  // the no-op and the DB-touching code path.
  const live = http.get(`${BASE_URL}/health/live`);
  check(live, {
    "live status 200": (r) => r.status === 200,
  });

  const ready = http.get(`${BASE_URL}/health/ready`);
  check(ready, {
    // Readiness can flip to 503 transiently under heavy load — we
    // tolerate that; the heap-delta threshold is the actual SLO.
    "ready returned": (r) => r.status === 200 || r.status === 503,
  });

  // The diagnostics endpoint reports the live process heap. Sample
  // it once per VU iteration; the Trend metric records the
  // first-vs-current delta so the threshold can fire on monotonic
  // growth.
  const diag = http.get(`${BASE_URL}/hub/diagnostics.json`);
  if (diag.status === 200) {
    try {
      const body = JSON.parse(diag.body);
      const heapBytes = body?.process?.memory?.heapUsedBytes;
      if (typeof heapBytes === "number") {
        const heapMb = heapBytes / (1024 * 1024);
        if (firstHeapMb === null) {
          firstHeapMb = heapMb;
        }
        heapDeltaMb.add(heapMb - firstHeapMb);
      }
    } catch {
      // /hub/diagnostics.json is dev-only; in production it 404s. The
      // threshold then has zero samples and does not fire — the
      // intent is the dev-time soak run, not prod gating.
    }
  }

  sleep(0.1);
}
