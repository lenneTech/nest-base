/**
 * Dev-Portal SPA entry point.
 *
 * Bootstraps React 19, react-router (browser router scoped to `/dev`),
 * and TanStack Query against `/dev/*.json` endpoints. The shell HTML
 * (`dev-portal-shell.ts` on the server) loads this bundle as
 * `type="module"` from `/dev/static/main.js`.
 *
 * Splitting + minify: see `scripts/build-dev-portal.ts`. Coverage for
 * this tree is excluded by `vitest.config.ts` — Bun runs the bundle in
 * a real browser context, not v8.
 */
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
