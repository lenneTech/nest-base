/**
 * Dev-Portal SPA entry point.
 *
 * Bootstraps React 19, react-router (browser router scoped to `/dev`),
 * and TanStack Query against `/dev/*.json` endpoints. The shell HTML
 * (`dev-portal-shell.ts` on the server) loads this bundle as
 * `type="module"` from `/dev/static/main.js`.
 *
 * Two stylesheets are imported here so Bun emits them as siblings of
 * the bundle:
 *  1. `tokens.css` — the design-token `:root` (also served standalone
 *     so the shell HTML can preload it via `<link rel="stylesheet">`).
 *  2. `admin-layout.css` — full server-CSS port (resets, sidebar, all
 *     `*-ui.ts` page styles). The React tree re-uses every server
 *     classname so the two surfaces stay pixel-identical.
 *  3. `components.css` — the `dp-*` react-aria primitive styles only.
 *
 * Splitting + minify: see `scripts/build-dev-portal.ts`. Coverage for
 * this tree is excluded by `vitest.config.ts` — Bun runs the bundle in
 * a real browser context, not v8.
 */
import "./styles/tokens.css";
import "./styles/admin-layout.css";
import "./styles/components.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { App } from "./App.js";

const container = document.getElementById("root");
if (!container) throw new Error("dev-portal: #root mount missing");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Dev surface — refresh aggressively, but do not retry on a 404
      // (gives a sharp red signal when a `/dev/*.json` endpoint moves).
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
  },
});

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
