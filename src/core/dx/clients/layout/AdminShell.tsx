/**
 * AdminShell — shadcn / Tailwind shell rendered for every dev-portal route.
 *
 * Replaces the legacy `admin-layout.css` chrome with Tailwind utility
 * classes that resolve to the dev-portal design tokens (see
 * `styles/globals.css#@theme`). The visual identity (dark near-black
 * surface, electric-lime accent, dense sidebar) is preserved; the
 * underlying layer is now Tailwind utilities + shadcn primitives.
 *
 * The `currentNav` prop drives the active-nav highlight independent
 * of the URL because some pages override the highlight to keep the
 * visual grouping consistent (e.g. `/dev/postgrest-parse` highlights
 * nothing).
 */
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

import { cn } from "../lib/utils.js";

import { BRAND_LOGO, ICONS } from "./icons.js";
import { isSpaRoute, NAV_SECTIONS } from "./nav.js";

/**
 * Brand snapshot inlined by the server shell into `window.__BRAND__`.
 * The shape mirrors the central `BrandConfig` (only the fields the SPA
 * actually reads). Falling back to "nest-server" keeps the SPA usable
 * in test fixtures that hydrate the bundle without the shell.
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

function getBrandName(): string {
  if (typeof window !== "undefined" && window.__BRAND__?.name) {
    return window.__BRAND__.name;
  }
  return "nest-server";
}

export interface AdminShellProps {
  /** Page heading and `<title>`. */
  title: string;
  /** Optional subheading rendered under the title. */
  subtitle?: ReactNode;
  /** Sidebar id used for the active-state highlight. */
  currentNav: string;
  /** Page body. */
  children: ReactNode;
  /** Optional toolbar rendered next to the title (e.g. action buttons). */
  toolbar?: ReactNode;
}

export function AdminShell({
  title,
  subtitle,
  currentNav,
  children,
  toolbar,
}: AdminShellProps): ReactNode {
  // Update <title> exactly the way the server shell does — keeps the
  // browser tab honest as the user navigates between SPA pages.
  // Brand sourced from window.__BRAND__ (server-injected) so the title
  // suffix matches the dev-portal shell on the same request.
  if (typeof document !== "undefined") {
    document.title = `${title} — ${getBrandName()}`;
  }

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <Sidebar currentNav={currentNav} />
      <main className="flex min-h-screen flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-surface-1/60 px-8 py-5">
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
        <section className="flex-1 px-8 py-6">{children}</section>
      </main>
    </div>
  );
}

interface SidebarProps {
  currentNav: string;
}

function Sidebar({ currentNav }: SidebarProps): ReactNode {
  const location = useLocation();
  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-line bg-surface-1">
      <NavItemBrand />
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="mb-5 last:mb-0">
            <h3 className="mb-2 px-3 text-[0.65rem] font-semibold uppercase tracking-widest text-fg-faint">
              {section.title}
            </h3>
            {section.items.map((item) => {
              // Active when explicitly addressed by the page OR when the
              // SPA URL itself matches the link (defends against pages
              // that forget to set `currentNav`).
              const active = item.id === currentNav || location.pathname === item.href;
              const className = cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-accent-soft text-accent"
                  : "text-fg-muted hover:bg-surface-hover hover:text-fg",
              );
              const icon = ICONS[item.icon] ?? null;
              if (isSpaRoute(item.href)) {
                return (
                  <Link key={item.id} to={item.href} className={className}>
                    <span className="flex h-4 w-4 items-center justify-center text-current">
                      {icon}
                    </span>
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              }
              // Server / external — full reload (matches the server-HTML
              // sidebar exactly).
              const external = !item.href.startsWith("/");
              return (
                <a
                  key={item.id}
                  href={item.href}
                  className={className}
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
      <div className="border-t border-line px-4 py-3">
        <a
          href="https://docs.nestjs.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs text-fg-muted hover:text-accent"
        >
          <span>NestJS Docs</span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M7 17L17 7M17 7H8M17 7v9" />
          </svg>
        </a>
      </div>
    </aside>
  );
}

function NavItemBrand(): ReactNode {
  return (
    <Link
      to="/dev"
      className="flex items-center gap-3 border-b border-line px-4 py-4 text-fg hover:text-accent"
    >
      <span
        className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-accent-foreground shadow-[0_0_24px_var(--accent-glow)]"
        aria-hidden="true"
      >
        {BRAND_LOGO}
      </span>
      <div className="flex flex-col">
        <span className="text-sm font-semibold leading-tight">{getBrandName()}</span>
        <span className="flex items-center gap-1.5 text-[0.7rem] text-fg-dim">
          <span className="h-1.5 w-1.5 rounded-full bg-ok" />
          development
        </span>
      </div>
    </Link>
  );
}
