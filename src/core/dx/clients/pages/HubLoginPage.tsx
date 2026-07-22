/**
 * `/` — Better-Auth sign-in for the operator Hub.
 */
import "../styles/hub-login.css";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "../components/ui/button.js";
import { Checkbox } from "../components/ui/checkbox.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { BRAND_LOGO } from "../layout/icons.js";
import { SignInError, signInWithEmail } from "../lib/api.js";
import { bootstrapHubOperatorSession } from "../lib/hub-session-bootstrap.js";
import { cn } from "../lib/utils.js";
import {
  resolveOperatorLandingPath,
  hasHubPortalAccess,
  hasTenantAdminPortalAccess,
} from "../lib/hub-portal-access.js";

interface BrandSnapshot {
  name: string;
  tagline: string;
}

declare global {
  interface Window {
    __BRAND__?: { name?: string; tagline?: string };
  }
}

const DEFAULT_BRAND: BrandSnapshot = {
  name: "nest-server",
  tagline: "Template-ready NestJS server",
};

function readBrand(): BrandSnapshot {
  if (typeof window === "undefined") return DEFAULT_BRAND;
  const raw = window.__BRAND__;
  return {
    name: raw?.name?.trim() || DEFAULT_BRAND.name,
    tagline: raw?.tagline?.trim() || DEFAULT_BRAND.tagline,
  };
}

const HIGHLIGHTS = [
  "Live diagnostics, logs, traces, and jobs",
  "Users, tenants, roles, and permissions",
  "OpenAPI, error catalog, and feature flags",
] as const;

const STORAGE_EMAIL_KEY = "hub:login:email";
const STORAGE_REMEMBER_KEY = "hub:login:remember-email";

function loadLoginPrefs(): { rememberEmail: boolean; email: string } {
  if (typeof window === "undefined") {
    return { rememberEmail: true, email: "" };
  }
  const rememberEmail = localStorage.getItem(STORAGE_REMEMBER_KEY) !== "0";
  const email = rememberEmail ? (localStorage.getItem(STORAGE_EMAIL_KEY) ?? "") : "";
  return { rememberEmail, email };
}

function persistLoginPrefs(rememberEmail: boolean, email: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_REMEMBER_KEY, rememberEmail ? "1" : "0");
  if (rememberEmail && email.trim()) {
    localStorage.setItem(STORAGE_EMAIL_KEY, email.trim());
  } else {
    localStorage.removeItem(STORAGE_EMAIL_KEY);
  }
}

const FLOATING_PARTICLES = [
  { top: "14%", left: "22%", delay: "0s", duration: "5.5s" },
  { top: "28%", left: "78%", delay: "1.2s", duration: "6.8s" },
  { top: "62%", left: "12%", delay: "0.6s", duration: "7.2s" },
  { top: "72%", left: "68%", delay: "2.1s", duration: "5.9s" },
  { top: "38%", left: "48%", delay: "1.8s", duration: "6.4s" },
  { top: "8%", left: "58%", delay: "3s", duration: "7.5s" },
  { top: "52%", left: "88%", delay: "0.9s", duration: "6.1s" },
  { top: "84%", left: "36%", delay: "2.6s", duration: "5.7s" },
] as const;

function LoginBackdrop(): ReactNode {
  return (
    <div className="hub-login-backdrop" aria-hidden="true">
      <div className="hub-login-backdrop__orb hub-login-backdrop__orb--a" />
      <div className="hub-login-backdrop__orb hub-login-backdrop__orb--b" />
      <div className="hub-login-backdrop__orb hub-login-backdrop__orb--c" />
      <div className="hub-login-backdrop__grid" />
      <div className="hub-login-backdrop__beam" />
      <div className="hub-login-backdrop__ring" />
      <div className="hub-login-backdrop__ring hub-login-backdrop__ring--delay" />
      {FLOATING_PARTICLES.map((particle, index) => (
        <span
          key={index}
          className="hub-login-backdrop__particle"
          style={{
            top: particle.top,
            left: particle.left,
            animationDelay: particle.delay,
            animationDuration: particle.duration,
          }}
        />
      ))}
      <div className="hub-login-backdrop__vignette" />
    </div>
  );
}

function BrandAside({ brand }: { brand: BrandSnapshot }): ReactNode {
  return (
    <aside className="hidden min-h-[32rem] flex-col justify-between border-r border-line bg-surface-1/40 p-10 lg:flex lg:w-[min(26rem,42%)]">
      <div>
        <div className="mb-8 flex items-center gap-3">
          <span className="hub-login-logo-glow flex h-11 w-11 items-center justify-center rounded-lg bg-accent text-accent-foreground shadow-[0_0_32px_var(--accent-glow)]">
            {BRAND_LOGO}
          </span>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-fg-dim">
              Operator portal
            </p>
            <p className="text-lg font-semibold tracking-tight text-fg">{brand.name}</p>
          </div>
        </div>
        <h1 className="max-w-sm text-3xl font-semibold leading-tight tracking-tight text-fg">
          Your local
          <span className="block text-accent">control center</span>
        </h1>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-fg-muted">{brand.tagline}</p>
        <ul className="mt-8 flex flex-col gap-3">
          {HIGHLIGHTS.map((line) => (
            <li key={line} className="flex items-start gap-3 text-sm text-fg-muted">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_8px_var(--accent-glow)]" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function StatusBanner({
  tone,
  children,
}: {
  tone: "warn" | "err";
  children: ReactNode;
}): ReactNode {
  return (
    <div
      role={tone === "err" ? "alert" : "status"}
      className={cn(
        "rounded-lg border px-3 py-2.5 text-sm leading-snug",
        tone === "warn" && "border-warn/40 bg-warn/10 text-warn",
        tone === "err" && "border-err/40 bg-err/10 text-err",
      )}
    >
      {children}
    </div>
  );
}

function PasswordField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
}): ReactNode {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        autoComplete="current-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required
        className="h-11 pr-11"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-0.5 top-0.5 h-10 w-10 text-fg-muted hover:text-fg"
        onClick={() => setVisible((v) => !v)}
        disabled={disabled}
        aria-label={visible ? "Hide password" : "Show password"}
        tabIndex={-1}
      >
        {visible ? (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
            <path
              d="M3 3l18 18M10.5 10.7A3 3 0 0012 15a3 3 0 002.3-1M7.4 7.5A10.5 10.5 0 0112 5c5 0 9 7 9 7a11.6 11.6 0 01-2.1 2.6M5 12s2.2 4.5 7 4.5c1 0 1.9-.2 2.7-.6"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
            <path
              d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"
              stroke="currentColor"
              strokeWidth="1.75"
            />
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
          </svg>
        )}
      </Button>
    </div>
  );
}

export function HubLoginPage(): ReactNode {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const formId = useId();
  const rememberId = useId();
  const initialPrefs = loadLoginPrefs();
  const [brand] = useState(readBrand);
  const [email, setEmail] = useState(initialPrefs.email);
  const [password, setPassword] = useState("");
  const [rememberEmail, setRememberEmail] = useState(initialPrefs.rememberEmail);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accessParam = new URLSearchParams(location.search).get("access");
  const accessDenied = accessParam === "hub";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/hub/portal-access.json", {
          credentials: "include",
          headers: { accept: "application/json" },
        });
        if (!cancelled && res.ok) {
          const body = (await res.json()) as {
            hub?: boolean;
            tenantAdmin?: boolean;
          };
          if (!body.hub && !body.tenantAdmin) return;
          const fromState =
            typeof location.state === "object" &&
            location.state !== null &&
            "from" in location.state &&
            typeof (location.state as { from?: string }).from === "string"
              ? (location.state as { from: string }).from
              : undefined;
          navigate(resolveOperatorLandingPath(body, fromState), { replace: true });
        }
      } catch {
        /* stay on login */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location.state, navigate]);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signInWithEmail(email.trim(), password);
      await bootstrapHubOperatorSession();
      const accessRes = await fetch("/hub/portal-access.json", {
        credentials: "include",
        headers: { accept: "application/json" },
      });
      if (!accessRes.ok) {
        throw new SignInError(accessRes.status);
      }
      const access = (await accessRes.json()) as {
        hub?: boolean;
        tenantAdmin?: boolean;
      };
      persistLoginPrefs(rememberEmail, email);
      await queryClient.invalidateQueries({ queryKey: ["hub", "portal-access"] });

      const fromState =
        typeof location.state === "object" &&
        location.state !== null &&
        "from" in location.state &&
        typeof (location.state as { from?: string }).from === "string"
          ? (location.state as { from: string }).from
          : undefined;
      const target = resolveOperatorLandingPath(access, fromState);

      if (target === "/" || (!hasHubPortalAccess(access) && !hasTenantAdminPortalAccess(access))) {
        toast.error("Signed in, but this account has no Hub access.");
        navigate("/?access=hub", { replace: true });
        return;
      }

      toast.success("Signed in.");
      navigate(target, { replace: true });
    } catch (err) {
      const message = err instanceof SignInError ? err.message : "Sign-in failed.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting;

  return (
    <div className="hub-login-scene flex items-center justify-center px-4 py-10 sm:px-6">
      <LoginBackdrop />

      <div className="hub-login-card-shell w-full max-w-4xl">
        <div className="hub-login-card-inner overflow-hidden">
          <div className="flex flex-col lg:flex-row">
            <BrandAside brand={brand} />

            <main className="flex flex-1 flex-col justify-center p-8 sm:p-10">
              <div className="mb-8 flex items-center gap-3 lg:hidden">
                <span className="hub-login-logo-glow flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground shadow-[0_0_24px_var(--accent-glow)]">
                  {BRAND_LOGO}
                </span>
                <div>
                  <p className="text-sm font-semibold text-fg">{brand.name} Hub</p>
                  <p className="text-xs text-fg-muted">{brand.tagline}</p>
                </div>
              </div>

              <header className="mb-6">
                <h2 className="text-2xl font-semibold tracking-tight text-fg">Sign in</h2>
                <p className="mt-1.5 text-sm text-fg-muted">
                  Use your operator email and password to open the Hub.
                </p>
              </header>

              {accessDenied ? (
                <StatusBanner tone="warn">
                  This account is signed in but has no Hub access. Ask an administrator to grant
                  operator permissions, or sign in with a different account.
                </StatusBanner>
              ) : null}

              <form
                id={formId}
                className={cn("mt-6 flex flex-col gap-5", accessDenied && "mt-5")}
                onSubmit={(e) => void onSubmit(e)}
              >
                <div className="flex flex-col gap-2">
                  <Label htmlFor="hub-email">Email</Label>
                  <Input
                    id="hub-email"
                    type="email"
                    autoComplete="email"
                    autoFocus
                    placeholder="operator@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting}
                    required
                    className="h-11"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="hub-password">Password</Label>
                  <PasswordField
                    id="hub-password"
                    value={password}
                    onChange={setPassword}
                    disabled={submitting}
                  />
                </div>

                <div className="flex items-center gap-2.5">
                  <Checkbox
                    id={rememberId}
                    checked={rememberEmail}
                    disabled={submitting}
                    onCheckedChange={(checked) => {
                      const next = checked === true;
                      setRememberEmail(next);
                      if (!next) persistLoginPrefs(false, email);
                    }}
                  />
                  <Label
                    htmlFor={rememberId}
                    className="cursor-pointer text-sm font-normal text-fg-muted"
                  >
                    Remember email on this device
                  </Label>
                </div>

                {error ? <StatusBanner tone="err">{error}</StatusBanner> : null}

                <Button
                  type="submit"
                  size="lg"
                  className="mt-1 h-11 w-full font-semibold"
                  disabled={!canSubmit}
                >
                  {submitting ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink" />
                      Signing in…
                    </span>
                  ) : (
                    "Sign in to Hub"
                  )}
                </Button>
              </form>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
