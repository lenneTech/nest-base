/**
 * Tiny `fetch` wrapper used by every page's react-query loader.
 *
 * Centralises the Accept header (forces server-side `*.json`
 * branches when a controller checks for it), session cookies
 * (`credentials: 'include'` for Better-Auth), and the error message
 * shape so an offline endpoint surfaces the same way across pages.
 */

/** True when the server rejected the call for missing/insufficient auth. */
export function isAdminAuthStatus(status: number): boolean {
  return status === 401 || status === 403;
}

const ADMIN_FETCH_INIT: RequestInit = {
  credentials: "include",
  cache: "no-store",
};

/** Shared fetch for admin SPA mutations (POST/PUT/DELETE). */
export async function adminFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...ADMIN_FETCH_INIT,
    ...init,
    headers: {
      accept: "application/json",
      ...init?.headers,
    },
  });
}

export class AdminFetchError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    detail = "",
  ) {
    super(`${url} → ${status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    this.name = "AdminFetchError";
  }

  get needsSignIn(): boolean {
    return isAdminAuthStatus(this.status);
  }
}

/** Use with `<PageError showAuthHint={needsAdminAuthHint(query.error)} />`. */
export function needsAdminAuthHint(error: unknown): boolean {
  return error instanceof AdminFetchError && error.needsSignIn;
}

async function readAdminFetchError(url: string, res: Response): Promise<AdminFetchError> {
  let detail = "";
  try {
    detail = await res.text();
  } catch {
    /* swallow — the status alone is sufficient signal */
  }
  return new AdminFetchError(url, res.status, detail);
}

export class SignInError extends Error {
  constructor(readonly status: number) {
    super(
      status === 401 || status === 403
        ? "Invalid email or password."
        : `Sign-in failed (${status}).`,
    );
    this.name = "SignInError";
  }
}

/** Better-Auth sign-out — clears the session cookie for Hub + admin. */
export async function signOut(): Promise<void> {
  const res = await fetch("/api/auth/sign-out", {
    method: "POST",
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new SignInError(res.status);
  }
}

/** Better-Auth email/password sign-in for Hub + admin operator surfaces. */
export async function signInWithEmail(email: string, password: string): Promise<void> {
  const res = await fetch("/api/auth/sign-in/email", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new SignInError(res.status);
  }
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    ...ADMIN_FETCH_INIT,
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw await readAdminFetchError(url, res);
  }
  return (await res.json()) as T;
}

export function levelName(level: number): string {
  if (level >= 60) return "fatal";
  if (level >= 50) return "error";
  if (level >= 40) return "warn";
  if (level >= 30) return "info";
  if (level >= 20) return "debug";
  return "trace";
}

/** Format a millisecond duration for the dashboard hero / stats. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/** Format a test duration — sub-second gets ms, otherwise seconds with 2 decimals. */
export function formatTestDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Format bytes the way `diagnostics-ui.ts` does. */
export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Format a Prisma-event millisecond duration for the queries page. */
export function formatMs(ms: number): string {
  if (ms < 1) return `${ms.toFixed(1)} ms`;
  return `${Math.round(ms)} ms`;
}

/** Strip `http://` / `https://` for the dashboard hero "base URL" tile. */
export function stripProto(url: string): string {
  return url.replace(/^https?:\/\//, "");
}
