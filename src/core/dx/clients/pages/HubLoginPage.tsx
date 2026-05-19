/**
 * `/` — Better-Auth sign-in for the operator Hub.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { SignInError, signInWithEmail } from "../lib/api.js";

declare global {
  interface Window {
    __BRAND__?: { name?: string };
  }
}

function brandTitle(): string {
  if (typeof window !== "undefined" && window.__BRAND__?.name) {
    return window.__BRAND__.name;
  }
  return "nest-server";
}

export function HubLoginPage(): ReactNode {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accessDenied = new URLSearchParams(location.search).get("access") === "devhub";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/hub/portal-access.json", {
          credentials: "include",
          headers: { accept: "application/json" },
        });
        if (!cancelled && res.ok) {
          const from =
            typeof location.state === "object" &&
            location.state !== null &&
            "from" in location.state &&
            typeof (location.state as { from?: string }).from === "string"
              ? (location.state as { from: string }).from
              : "/hub";
          navigate(from, { replace: true });
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
      toast.success("Angemeldet.");
      const from =
        typeof location.state === "object" &&
        location.state !== null &&
        "from" in location.state &&
        typeof (location.state as { from?: string }).from === "string"
          ? (location.state as { from: string }).from
          : "/hub";
      navigate(from, { replace: true });
    } catch (err) {
      const message = err instanceof SignInError ? err.message : "Anmeldung fehlgeschlagen.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4 py-12">
      <Card className="w-full max-w-md border-line bg-surface-1">
        <CardHeader className="text-center">
          <CardTitle className="text-xl text-fg">{brandTitle()} Hub</CardTitle>
          <CardDescription className="text-fg-muted">
            Melde dich mit Better-Auth an. Nach{" "}
            <code className="font-mono text-xs">bun run seed</code> z. B.{" "}
            <span className="font-mono text-fg">system-admin@lenne.tech</span> /{" "}
            <span className="font-mono text-fg">system-admin</span> (DevHub + Admin) oder{" "}
            <span className="font-mono text-fg">admin@lenne.tech</span> /{" "}
            <span className="font-mono text-fg">admin</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {accessDenied ? (
            <p className="mb-4 rounded-md border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
              Dein Account hat kein <code className="font-mono">read DevHub</code>. Nutze einen
              Operator-Account.
            </p>
          ) : null}
          <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="hub-email">E-Mail</Label>
              <Input
                id="hub-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="hub-password">Passwort</Label>
              <Input
                id="hub-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                required
              />
            </div>
            {error ? (
              <p className="text-sm text-err" role="alert">
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              disabled={submitting || email.trim().length === 0 || password.length === 0}
            >
              {submitting ? "Anmelden…" : "Anmelden"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
