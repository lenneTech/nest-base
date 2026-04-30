/**
 * Top-level layout + route table for the Dev-Portal SPA.
 *
 * Every server-rendered `/dev/*` HTML page is now a React route that
 * fetches its sibling `*.json` endpoint and renders the same DOM the
 * legacy `*-ui.ts` renderer produced. The active route owns its own
 * `AdminShell` (so each page can set its own title / subtitle / nav
 * highlight, exactly like the server).
 *
 * Pages are loaded with `React.lazy` so the initial bundle stays
 * small (only the landing page + chrome + react-aria primitives the
 * landing actually uses ship in `main.js`; the rest of the pages
 * land as on-demand chunks).
 */
import { lazy, Suspense, type ReactNode } from "react";
import { Route, Routes } from "react-router-dom";

const DevHubLandingPage = lazy(() =>
  import("./pages/DevHubLandingPage.js").then((m) => ({ default: m.DevHubLandingPage })),
);
const ComponentShowcasePage = lazy(() =>
  import("./pages/ComponentShowcasePage.js").then((m) => ({ default: m.ComponentShowcasePage })),
);
const FeaturesPage = lazy(() =>
  import("./pages/FeaturesPage.js").then((m) => ({ default: m.FeaturesPage })),
);
const CoveragePage = lazy(() =>
  import("./pages/CoveragePage.js").then((m) => ({ default: m.CoveragePage })),
);
const TestsPage = lazy(() =>
  import("./pages/TestsPage.js").then((m) => ({ default: m.TestsPage })),
);
const DiagnosticsPage = lazy(() =>
  import("./pages/DiagnosticsPage.js").then((m) => ({ default: m.DiagnosticsPage })),
);
const LogsPage = lazy(() => import("./pages/LogsPage.js").then((m) => ({ default: m.LogsPage })));
const TracesPage = lazy(() =>
  import("./pages/TracesPage.js").then((m) => ({ default: m.TracesPage })),
);
const QueriesPage = lazy(() =>
  import("./pages/QueriesPage.js").then((m) => ({ default: m.QueriesPage })),
);
const RoutesPage = lazy(() =>
  import("./pages/RoutesPage.js").then((m) => ({ default: m.RoutesPage })),
);
const ErdPage = lazy(() => import("./pages/ErdPage.js").then((m) => ({ default: m.ErdPage })));
const EmailPreviewPage = lazy(() =>
  import("./pages/EmailPreviewPage.js").then((m) => ({ default: m.EmailPreviewPage })),
);
const PostgrestParsePage = lazy(() =>
  import("./pages/PostgrestParsePage.js").then((m) => ({ default: m.PostgrestParsePage })),
);

function PageFallback(): ReactNode {
  return (
    <div className="dp-page-suspense">
      <span className="log-pulse" /> Loading page chunk…
    </div>
  );
}

export function App(): ReactNode {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/dev" element={<DevHubLandingPage />} />
        <Route path="/dev/components" element={<ComponentShowcasePage />} />
        <Route path="/dev/features" element={<FeaturesPage />} />
        <Route path="/dev/coverage" element={<CoveragePage />} />
        <Route path="/dev/tests" element={<TestsPage />} />
        <Route path="/dev/diagnostics" element={<DiagnosticsPage />} />
        <Route path="/dev/logs" element={<LogsPage />} />
        <Route path="/dev/traces" element={<TracesPage />} />
        <Route path="/dev/queries" element={<QueriesPage />} />
        <Route path="/dev/routes" element={<RoutesPage />} />
        <Route path="/dev/erd" element={<ErdPage />} />
        <Route path="/dev/email-preview" element={<EmailPreviewPage />} />
        <Route path="/dev/postgrest-parse" element={<PostgrestParsePage />} />
      </Routes>
    </Suspense>
  );
}
