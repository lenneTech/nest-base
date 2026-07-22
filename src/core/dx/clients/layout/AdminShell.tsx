/**
 * AdminShell — page chrome API for the dev-portal SPA.
 *
 * The persistent sidebar + header live in `AdminPortalLayout.tsx` so
 * react-router navigations do not remount the sidebar (scroll reset).
 * Each page still wraps its body in `<AdminShell …>` to set title /
 * subtitle / active nav via context.
 */
import type { ReactNode } from "react";
import { Link, useLocation, useOutletContext } from "react-router-dom";
import { toast } from "sonner";

import type { HubPortalAccess } from "../components/HubPortalGate.js";
import { signOut } from "../lib/api.js";
import { hasWorkstationSurfaces } from "../lib/hub-portal-access.js";
import { cn } from "../lib/utils.js";

import { pushRecentItem } from "../components/CommandPalette.js";
import { useAdminShell, type AdminShellState } from "./admin-shell-context.js";
import { BRAND_LOGO, ICONS } from "./icons.js";
import { LEGACY_HUB_NAV_FEATURES_FALLBACK } from "../../hub-nav-planner.js";
import { isSpaRoute, navSectionsForPortalAccess } from "./nav.js";

/**
 * Brand snapshot inlined by the server shell into `window.__BRAND__`.
 */
interface RuntimeBrand {
  name?: string;
  shortName?: string;
}

declare global {
  interface Window {
    __BRAND__?: RuntimeBrand;
  }
}

export interface AdminShellProps extends AdminShellState {
  children: ReactNode;
}

/** Sets layout chrome for the current route; renders page body only. */
export function AdminShell({
  title,
  subtitle,
  currentNav,
  children,
  toolbar,
}: AdminShellProps): ReactNode {
  useAdminShell({ title, subtitle, currentNav, toolbar });
  return children;
}

/** Shared height for sidebar brand bar + main page header (title, subtitle, padding). */
export const PORTAL_TOP_CHROME_ROW = "flex h-[5.75rem] shrink-0 items-center border-b border-line";

export interface AdminSidebarProps {
  currentNav: string;
}

/** Sidebar — exported for `AdminPortalLayout` only. */
export function AdminSidebar({ currentNav }: AdminSidebarProps): ReactNode {
  const location = useLocation();
  const portalAccess = useOutletContext<HubPortalAccess | undefined>();
  const sections = navSectionsForPortalAccess({
    hub: portalAccess?.hub ?? false,
    tenantAdmin: portalAccess?.tenantAdmin ?? false,
    navFeatures: portalAccess?.features ?? LEGACY_HUB_NAV_FEATURES_FALLBACK,
    workstation: hasWorkstationSurfaces(portalAccess),
  });

  async function onSignOut(): Promise<void> {
    try {
      await signOut();
      window.location.assign("/");
    } catch {
      toast.error("Sign out failed.");
    }
  }

  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-line bg-surface-1">
      <NavItemBrand />
      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Hub navigation">
        {sections.map((section) => (
          <div key={section.title} className="mb-5 last:mb-0">
            <h3 className="mb-2 px-3 text-[0.65rem] font-semibold uppercase tracking-widest text-fg-faint">
              {section.title}
            </h3>
            {section.items.map((item) => {
              const active = item.id === currentNav || location.pathname === item.href;
              const className = cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-accent-soft text-accent"
                  : "text-fg-muted hover:bg-surface-hover hover:text-fg",
              );
              const icon = ICONS[item.icon] ?? null;
              const handleClick = () =>
                pushRecentItem({
                  id: item.id,
                  title: item.label,
                  href: item.href,
                  category: section.title,
                });
              if (isSpaRoute(item.href)) {
                return (
                  <Link key={item.id} to={item.href} className={className} onClick={handleClick}>
                    <span className="flex h-4 w-4 items-center justify-center text-current">
                      {icon}
                    </span>
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              }
              const external = !item.href.startsWith("/");
              return (
                <a
                  key={item.id}
                  href={item.href}
                  className={className}
                  onClick={handleClick}
                  {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                >
                  <span className="flex h-4 w-4 items-center justify-center text-current">
                    {icon}
                  </span>
                  <span className="truncate">{item.label}</span>
                </a>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="border-t border-line px-4 py-3 space-y-1">
        <button
          type="button"
          onClick={() => void onSignOut()}
          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg transition-colors"
        >
          Sign out
        </button>
        <PaletteHint />
      </div>
    </aside>
  );
}

function PaletteHint(): ReactNode {
  const isMac =
    typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent);

  function openPalette(): void {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: isMac, ctrlKey: !isMac, bubbles: true }),
    );
  }

  return (
    <button
      type="button"
      onClick={openPalette}
      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg transition-colors"
      title="Open command palette"
    >
      <span>Search</span>
      <span className="flex items-center gap-1 font-mono text-[0.6rem] text-fg-faint">
        <kbd className="rounded border border-line bg-surface-2 px-1 py-0.5">
          {isMac ? "⌘" : "Ctrl"}
        </kbd>
        <kbd className="rounded border border-line bg-surface-2 px-1 py-0.5">K</kbd>
      </span>
    </button>
  );
}

function NavItemBrand(): ReactNode {
  const brandName =
    typeof window !== "undefined" && window.__BRAND__?.name ? window.__BRAND__.name : "nest-server";

  return (
    <Link to="/hub" className={cn(PORTAL_TOP_CHROME_ROW, "gap-3 px-4 text-fg hover:text-accent")}>
      <span
        className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-accent-foreground shadow-[0_0_24px_var(--accent-glow)]"
        aria-hidden="true"
      >
        {BRAND_LOGO}
      </span>
      <div className="flex flex-col">
        <span className="text-sm font-semibold leading-tight">{brandName}</span>
        <span className="flex items-center gap-1.5 text-[0.7rem] text-fg-dim">
          <span className="h-1.5 w-1.5 rounded-full bg-ok" />
          development
        </span>
      </div>
    </Link>
  );
}
