/**
 * Service-Status checker (Pure-Planner + Runner-friendly probe).
 *
 * Composes the list of dev-only sibling services this project starts
 * alongside the API (Postgres, Prisma Studio, NestJS DevTools, Mailpit,
 * PowerSync, RustFS, OTel collector) and reports each as up/down/unknown.
 *
 * The planner step picks the candidate set from env-vars + features —
 * no I/O. The runner step (`probeServices`) does TCP/HTTP probes with a
 * tight timeout so the dashboard never blocks on a hanging service.
 */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import type { Features } from "../features/features.js";

export type ServiceStatus = "up" | "down" | "unknown";

export interface ServiceCandidate {
  /** Stable ID for the dashboard (used as DOM id and in tests). */
  id: string;
  /** Display label. */
  label: string;
  /** Optional category — drives the dashboard grouping. */
  category: "core" | "tooling" | "feature";
  /**
   * URL the runner pings. `http://` URLs are HEAD/GET probed; absent
   * URL means the planner has no concrete probe (returns "unknown").
   */
  probeUrl?: string;
  /** Outbound URL the user can click — falls back to probeUrl. */
  href?: string;
}

export interface ServiceProbeResult extends ServiceCandidate {
  status: ServiceStatus;
  latencyMs?: number;
  detail?: string;
}

export interface ServiceStatusInput {
  baseUrl: string;
  /**
   * Loopback URL the probes hit (typically http://localhost:<port>).
   * Falls back to baseUrl when omitted. The displayed `href` always
   * uses baseUrl so the user-visible link matches the configured host.
   */
  loopbackUrl?: string;
  features: Pick<Features, "webhooks" | "realtime" | "search" | "powerSync" | "files">;
  env_vars?: {
    DATABASE_URL?: string;
    PRISMA_STUDIO?: string;
    NESTJS_DEVTOOLS?: string;
    MAILPIT_WEB_URL?: string;
    POWERSYNC_URL?: string;
  };
}

/** Pure: figures out which services are *candidates* for probing. */
export function planServiceCandidates(input: ServiceStatusInput): ServiceCandidate[] {
  const base = input.baseUrl.replace(/\/$/, "");
  const loopback = (input.loopbackUrl ?? input.baseUrl).replace(/\/$/, "");
  const v = input.env_vars ?? {};
  const candidates: ServiceCandidate[] = [
    {
      id: "api",
      label: "API",
      category: "core",
      probeUrl: `${loopback}/health/live`,
      href: `${base}/health/ready`,
    },
    {
      id: "database",
      label: "Postgres",
      category: "core",
      probeUrl: `${loopback}/health/ready`,
      href: `${base}/health/ready`,
    },
  ];
  if (v.PRISMA_STUDIO !== "0" && v.DATABASE_URL) {
    candidates.push({
      id: "prisma-studio",
      label: "Prisma Studio",
      category: "tooling",
      probeUrl: "http://localhost:5555",
      href: "http://localhost:5555",
    });
  }
  if (v.NESTJS_DEVTOOLS !== "0") {
    candidates.push({
      id: "nest-devtools",
      label: "NestJS DevTools",
      category: "tooling",
      probeUrl: "http://localhost:8000",
      href: "https://devtools.nestjs.com",
    });
  }
  if (v.MAILPIT_WEB_URL) {
    candidates.push({
      id: "mailpit",
      label: "Mailpit",
      category: "tooling",
      probeUrl: v.MAILPIT_WEB_URL,
      href: v.MAILPIT_WEB_URL,
    });
  }
  if (v.POWERSYNC_URL) {
    candidates.push({
      id: "powersync",
      label: "PowerSync",
      category: "feature",
      probeUrl: v.POWERSYNC_URL,
      href: v.POWERSYNC_URL,
    });
  }
  return candidates;
}

/** Runner: probes each candidate concurrently. Pure-IO at the edges. */
export async function probeServices(
  candidates: ServiceCandidate[],
  options: { timeoutMs?: number; now?: () => number } = {},
): Promise<ServiceProbeResult[]> {
  const timeoutMs = options.timeoutMs ?? 800;
  const now = options.now ?? (() => Date.now());
  return Promise.all(
    candidates.map(async (c) => {
      if (!c.probeUrl) return { ...c, status: "unknown" as const };
      const start = now();
      try {
        const ok = await probeOnce(c.probeUrl, timeoutMs);
        return { ...c, status: ok ? "up" : "down", latencyMs: now() - start };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return { ...c, status: "down" as const, latencyMs: now() - start, detail };
      }
    }),
  );
}

function probeOnce(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const isHttps = url.startsWith("https:");
    const fn = isHttps ? httpsRequest : httpRequest;
    const req = fn(
      url,
      {
        method: "GET",
        timeout: timeoutMs,
        // Self-signed certs at api.<project>.localhost should still
        // count as "up" — the probe only verifies port connectivity.
        rejectUnauthorized: false,
      },
      (res) => {
        // Any HTTP response — even 404/405 — proves the port answers.
        res.resume();
        resolve(true);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}
