/**
 * Persistent hub/admin chrome — sidebar + header survive route changes.
 */
import { useEffect, useLayoutEffect, type ReactNode } from "react";
import { Outlet, useOutletContext } from "react-router-dom";

import { CommandPalette } from "../components/CommandPalette.js";
import type { HubPortalAccess } from "../components/HubPortalGate.js";
import { bootstrapHubOperatorSession } from "../lib/hub-session-bootstrap.js";
import { AdminShellProvider, useAdminShellContext } from "./admin-shell-context.js";
import { AdminSidebar, PORTAL_TOP_CHROME_ROW } from "./AdminShell.js";

function getBrandName(): string {
  if (typeof window !== "undefined" && window.__BRAND__?.name) {
    return window.__BRAND__.name;
  }
  return "nest-server";
}

function AdminPortalLayoutInner(): ReactNode {
  const { state } = useAdminShellContext();
  const { title, subtitle, currentNav, toolbar } = state;
  // Re-provide the HubPortalGate outlet context through this layout's
  // own <Outlet> — otherwise pages below would read `undefined` and
  // could not see the portal-access snapshot (workstation flag etc.).
  const portalAccess = useOutletContext<HubPortalAccess | undefined>();

  useLayoutEffect(() => {
    if (typeof document !== "undefined") {
      document.title = `${title} — ${getBrandName()}`;
    }
  }, [title]);

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <CommandPalette />
      <AdminSidebar currentNav={currentNav} />
      <main className="flex min-h-screen flex-1 flex-col">
        <header
          className={`${PORTAL_TOP_CHROME_ROW} flex-wrap justify-between gap-4 bg-surface-1/60 px-8`}
        >
          <div className="min-w-0">
            <h1 className="m-0 text-xl font-semibold tracking-tight text-fg">{title}</h1>
            {subtitle ? <p className="mt-1 max-w-3xl text-sm text-fg-muted">{subtitle}</p> : null}
          </div>
          <div className="flex items-center gap-3">
            {toolbar}
            <span className="inline-flex items-center gap-2 rounded-full border border-ok/40 bg-ok/10 px-3 py-1 text-xs font-medium text-ok">
              <span className="h-1.5 w-1.5 rounded-full bg-ok shadow-[0_0_8px_var(--ok)]" />
              online
            </span>
          </div>
        </header>
        <section className="flex-1 px-8 py-6">
          <Outlet context={portalAccess} />
        </section>
      </main>
    </div>
  );
}

/** Wraps all `/hub/*` and `/admin/*` routes under `HubPortalGate`. */
export function AdminPortalLayout(): ReactNode {
  useEffect(() => {
    void bootstrapHubOperatorSession();
  }, []);

  return (
    <AdminShellProvider>
      <AdminPortalLayoutInner />
    </AdminShellProvider>
  );
}
