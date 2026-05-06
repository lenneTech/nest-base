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
const BrandPage = lazy(() =>
  import("./pages/BrandPage.js").then((m) => ({ default: m.BrandPage })),
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
const MigrationsPage = lazy(() =>
  import("./pages/MigrationsPage.js").then((m) => ({ default: m.MigrationsPage })),
);
const JobsPage = lazy(() => import("./pages/JobsPage.js").then((m) => ({ default: m.JobsPage })));
const RoutesPage = lazy(() =>
  import("./pages/RoutesPage.js").then((m) => ({ default: m.RoutesPage })),
);
const ErdPage = lazy(() => import("./pages/ErdPage.js").then((m) => ({ default: m.ErdPage })));
const EmailPreviewPage = lazy(() =>
  import("./pages/EmailPreviewPage.js").then((m) => ({ default: m.EmailPreviewPage })),
);
const EmailBuilderPage = lazy(() =>
  import("./pages/EmailBuilderPage.js").then((m) => ({ default: m.EmailBuilderPage })),
);
const PostgrestParsePage = lazy(() =>
  import("./pages/PostgrestParsePage.js").then((m) => ({ default: m.PostgrestParsePage })),
);
const JsonViewerPage = lazy(() =>
  import("./pages/JsonViewerPage.js").then((m) => ({ default: m.JsonViewerPage })),
);
const PermissionTesterPage = lazy(() =>
  import("./pages/PermissionTesterPage.js").then((m) => ({ default: m.PermissionTesterPage })),
);
const WebhookInspectorPage = lazy(() =>
  import("./pages/WebhookInspectorPage.js").then((m) => ({ default: m.WebhookInspectorPage })),
);
const RealtimeInspectorPage = lazy(() =>
  import("./pages/RealtimeInspectorPage.js").then((m) => ({ default: m.RealtimeInspectorPage })),
);
const AuditBrowserPage = lazy(() =>
  import("./pages/AuditBrowserPage.js").then((m) => ({ default: m.AuditBrowserPage })),
);
const SearchTesterPage = lazy(() =>
  import("./pages/SearchTesterPage.js").then((m) => ({ default: m.SearchTesterPage })),
);
const ErrorsPage = lazy(() =>
  import("./pages/ErrorsPage.js").then((m) => ({ default: m.ErrorsPage })),
);
const OpenApiPage = lazy(() =>
  import("./pages/OpenApiPage.js").then((m) => ({ default: m.OpenApiPage })),
);
const FileManagerPage = lazy(() =>
  import("./pages/FileManagerPage.js").then((m) => ({ default: m.FileManagerPage })),
);
const EmailOutboxPage = lazy(() =>
  import("./pages/EmailOutboxPage.js").then((m) => ({ default: m.EmailOutboxPage })),
);
const CronPage = lazy(() => import("./pages/CronPage.js").then((m) => ({ default: m.CronPage })));
const SessionsAdminPage = lazy(() =>
  import("./pages/SessionsAdminPage.js").then((m) => ({ default: m.SessionsAdminPage })),
);
const AdminJobsPage = lazy(() =>
  import("./pages/AdminJobsPage.js").then((m) => ({ default: m.AdminJobsPage })),
);
const RolesAdminPage = lazy(() =>
  import("./pages/RolesAdminPage.js").then((m) => ({ default: m.RolesAdminPage })),
);
const PoliciesAdminPage = lazy(() =>
  import("./pages/PoliciesAdminPage.js").then((m) => ({ default: m.PoliciesAdminPage })),
);
const PermissionsAdminPage = lazy(() =>
  import("./pages/PermissionsAdminPage.js").then((m) => ({ default: m.PermissionsAdminPage })),
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
        <Route path="/hub" element={<DevHubLandingPage />} />
        <Route path="/hub/components" element={<ComponentShowcasePage />} />
        <Route path="/hub/features" element={<FeaturesPage />} />
        <Route path="/hub/brand" element={<BrandPage />} />
        <Route path="/hub/coverage" element={<CoveragePage />} />
        <Route path="/hub/tests" element={<TestsPage />} />
        <Route path="/hub/diagnostics" element={<DiagnosticsPage />} />
        <Route path="/hub/logs" element={<LogsPage />} />
        <Route path="/hub/traces" element={<TracesPage />} />
        <Route path="/hub/queries" element={<QueriesPage />} />
        <Route path="/hub/migrations" element={<MigrationsPage />} />
        <Route path="/hub/jobs" element={<JobsPage />} />
        <Route path="/hub/routes" element={<RoutesPage />} />
        <Route path="/hub/erd" element={<ErdPage />} />
        <Route path="/hub/email-preview" element={<EmailPreviewPage />} />
        <Route path="/hub/email-builder" element={<EmailBuilderPage />} />
        <Route path="/hub/postgrest-parse" element={<PostgrestParsePage />} />
        <Route path="/hub/json" element={<JsonViewerPage />} />
        <Route path="/hub/files" element={<FileManagerPage />} />
        <Route path="/hub/email-outbox" element={<EmailOutboxPage />} />
        <Route path="/hub/cron" element={<CronPage />} />
        <Route path="/admin/sessions" element={<SessionsAdminPage />} />
        <Route path="/admin/jobs" element={<AdminJobsPage />} />
        <Route path="/admin/roles" element={<RolesAdminPage />} />
        <Route path="/admin/policies" element={<PoliciesAdminPage />} />
        <Route path="/admin/permissions" element={<PermissionsAdminPage />} />
        <Route path="/admin/permissions/test" element={<PermissionTesterPage />} />
        <Route path="/admin/webhooks" element={<WebhookInspectorPage />} />
        <Route path="/admin/realtime" element={<RealtimeInspectorPage />} />
        <Route path="/admin/audit" element={<AuditBrowserPage />} />
        <Route path="/admin/search" element={<SearchTesterPage />} />
        <Route path="/errors" element={<ErrorsPage />} />
        <Route path="/api/openapi" element={<OpenApiPage />} />
      </Routes>
    </Suspense>
  );
}
