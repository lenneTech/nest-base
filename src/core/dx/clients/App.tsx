/**
 * Top-level layout + route table for the Dev-Portal SPA.
 *
 * The route shape mirrors the existing server-rendered map: only the
 * landing (`/dev`) and the components showcase (`/dev/components`) are
 * implemented in React for v1. Every other `/dev/*` path is still
 * handled server-side; the controller's catch-all is what wires the
 * SPA shell up — for those routes the SPA is never reached.
 *
 * `<RouterProvider/>` would be lighter weight but `BrowserRouter` keeps
 * the bundle and ergonomics simpler for v1.
 */
import { NavLink, Route, Routes } from "react-router-dom";

import { ComponentShowcasePage } from "./pages/ComponentShowcasePage.js";
import { DevHubLandingPage } from "./pages/DevHubLandingPage.js";

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: "/dev", label: "Dev Hub", end: true },
  { to: "/dev/components", label: "Components" },
];

export function App() {
  return (
    <div className="dp-shell">
      <aside className="dp-sidebar">
        <div className="dp-brand">
          <span className="dp-brand__logo" aria-hidden="true">
            n
          </span>
          <div className="dp-brand__text">
            <span className="dp-brand__name">nest-server</span>
            <span className="dp-brand__env">development</span>
          </div>
        </div>
        <nav className="dp-nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                isActive ? "dp-nav__link dp-nav__link--active" : "dp-nav__link"
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="dp-main">
        <Routes>
          <Route path="/dev" element={<DevHubLandingPage />} />
          <Route path="/dev/components" element={<ComponentShowcasePage />} />
        </Routes>
      </main>
    </div>
  );
}
