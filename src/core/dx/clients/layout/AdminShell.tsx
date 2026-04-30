/**
 * AdminShell — the React shell rendered for every dev-portal route.
 * Same DOM and classnames the legacy server-side `renderAdminLayout()`
 * produced (now deleted) so the visual diff vs. historical screenshots
 * stays zero.
 *
 * Children are rendered into the `.admin-content` slot; pages assume
 * the surrounding `.admin-card` / `.admin-grid` chrome exists and
 * just emit their content (matching the way the server `*-ui.ts`
 * renderers output their `body` strings).
 *
 * The active-nav highlight is driven by `currentNav` instead of the
 * URL because some pages override the highlight to keep the visual
 * grouping consistent with the server (e.g. `/dev/postgrest-parse`
 * highlights nothing, matching the server JSON-viewer page).
 */
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

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
  /** Optional subheading rendered as `.admin-page__subtitle`. */
  subtitle?: ReactNode;
  /** Sidebar id used for the active-state highlight. */
  currentNav: string;
  /** Page body — already styled with `.admin-card` etc. */
  children: ReactNode;
}

export function AdminShell({ title, subtitle, currentNav, children }: AdminShellProps): ReactNode {
  // Update <title> exactly the way the server shell does — keeps the
  // browser tab honest as the user navigates between SPA pages.
  // Brand sourced from window.__BRAND__ (server-injected) so the title
  // suffix matches the dev-portal shell on the same request.
  if (typeof document !== "undefined") {
    document.title = `${title} — ${getBrandName()}`;
  }

  return (
    <div className="admin-shell">
      <Sidebar currentNav={currentNav} />
      <main className="admin-main">
        <header className="admin-header">
          <div>
            <h1 className="admin-page__title">{title}</h1>
            {subtitle ? <p className="admin-page__subtitle">{subtitle}</p> : null}
          </div>
          <div className="admin-header__meta">
            <span className="admin-badge admin-badge--ok">
              <span className="admin-badge__dot" />
              online
            </span>
          </div>
        </header>
        <section className="admin-content">{children}</section>
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
    <aside className="admin-sidebar">
      <NavItemBrand />
      <nav className="admin-nav">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="admin-nav__section">
            <h3 className="admin-nav__title">{section.title}</h3>
            {section.items.map((item) => {
              // Active when explicitly addressed by the page OR when the
              // SPA URL itself matches the link (defends against pages
              // that forget to set `currentNav`).
              const active = item.id === currentNav || location.pathname === item.href;
              const className = `admin-nav__link${active ? " admin-nav__link--active" : ""}`;
              const icon = ICONS[item.icon] ?? null;
              if (isSpaRoute(item.href)) {
                return (
                  <Link key={item.id} to={item.href} className={className}>
                    <span className="admin-nav__icon">{icon}</span>
                    <span className="admin-nav__label">{item.label}</span>
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
                  <span className="admin-nav__icon">{icon}</span>
                  <span className="admin-nav__label">{item.label}</span>
                </a>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="admin-sidebar__footer">
        <a
          href="https://docs.nestjs.com"
          target="_blank"
          rel="noopener noreferrer"
          className="admin-sidebar__doclink"
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
    <Link to="/dev" className="admin-brand">
      <span className="admin-brand__logo" aria-hidden="true">
        {BRAND_LOGO}
      </span>
      <div className="admin-brand__text">
        <span className="admin-brand__name">{getBrandName()}</span>
        <span className="admin-brand__env">
          <span className="admin-brand__dot" />
          development
        </span>
      </div>
    </Link>
  );
}
