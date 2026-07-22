/**
 * Guards `/hub/*` and `/admin/*` client routes after Better-Auth sign-in.
 */
import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

import { PageError, PageLoading } from "./PageState.js";
import { AdminFetchError, fetchJson, signOut } from "../lib/api.js";
import {
  isSpaPathAllowedByNavSnapshot,
  isSpaPathWorkstationOnly,
  LEGACY_HUB_NAV_FEATURES_FALLBACK,
} from "../../hub-nav-planner.js";
import {
  hasHubPortalAccess,
  hasTenantAdminPortalAccess,
  hasWorkstationSurfaces,
  type HubPortalAccessPayload,
  type HubPortalNavFeatures,
} from "../lib/hub-portal-access.js";

export type HubPortalAccess = HubPortalAccessPayload & {
  hub: boolean;
  tenantAdmin: boolean;
  features: HubPortalNavFeatures;
};

function isHubCockpitRoute(pathname: string): boolean {
  return pathname === "/hub" || pathname.startsWith("/hub/");
}

function isTenantAdminRoute(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function HubPortalGate(): ReactNode {
  const location = useLocation();
  const accessQuery = useQuery({
    queryKey: ["hub", "portal-access"],
    queryFn: () => fetchJson<HubPortalAccess>("/hub/portal-access.json"),
    retry: false,
    refetchOnMount: "always",
  });

  if (accessQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-8">
        <PageLoading>Checking session…</PageLoading>
      </div>
    );
  }

  if (accessQuery.isError) {
    if (accessQuery.error instanceof AdminFetchError && accessQuery.error.needsSignIn) {
      return <Navigate to="/" replace state={{ from: location.pathname }} />;
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-8">
        <PageError>Could not verify Hub access.</PageError>
      </div>
    );
  }

  const data = accessQuery.data;
  const onHub = isHubCockpitRoute(location.pathname);
  const onAdmin = isTenantAdminRoute(location.pathname);

  if (onHub && !hasHubPortalAccess(data)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-8">
        <PageError>No Hub access for this account.</PageError>
        {hasTenantAdminPortalAccess(data) ? (
          <a href="/admin/users" className="text-sm text-accent underline-offset-2 hover:underline">
            Go to admin area
          </a>
        ) : null}
        <button
          type="button"
          className="text-sm text-accent underline-offset-2 hover:underline"
          onClick={() => {
            void signOut().finally(() => {
              window.location.href = "/";
            });
          }}
        >
          Sign out and sign in again
        </button>
      </div>
    );
  }

  if (onAdmin && !hasTenantAdminPortalAccess(data)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-8">
        <PageError>No admin area access for this account.</PageError>
        <button
          type="button"
          className="text-sm text-accent underline-offset-2 hover:underline"
          onClick={() => {
            void signOut().finally(() => {
              window.location.href = "/";
            });
          }}
        >
          Sign out and sign in again
        </button>
      </div>
    );
  }

  // Deep links to workstation-tier pages on a deployed server: the nav
  // hides them, but a bookmarked URL would render a page whose data
  // endpoints all 404 — show the honest explanation instead.
  if (
    (onHub || onAdmin) &&
    !hasWorkstationSurfaces(data) &&
    isSpaPathWorkstationOnly(location.pathname)
  ) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-8">
        <PageError>
          This page is development-workstation tooling and is not available on a deployed server.
        </PageError>
        {hasHubPortalAccess(data) ? (
          <a href="/hub" className="text-sm text-accent underline-offset-2 hover:underline">
            Back to the Hub
          </a>
        ) : hasTenantAdminPortalAccess(data) ? (
          <a href="/admin/users" className="text-sm text-accent underline-offset-2 hover:underline">
            Go to admin area
          </a>
        ) : null}
      </div>
    );
  }

  const navFeatures = data.features ?? LEGACY_HUB_NAV_FEATURES_FALLBACK;

  if ((onHub || onAdmin) && !isSpaPathAllowedByNavSnapshot(location.pathname, navFeatures)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-8">
        <PageError>This page is disabled — the related feature flag is off.</PageError>
        {hasHubPortalAccess(data) ? (
          <a
            href="/hub/features"
            className="text-sm text-accent underline-offset-2 hover:underline"
          >
            Open feature flags
          </a>
        ) : hasTenantAdminPortalAccess(data) ? (
          <a href="/admin/users" className="text-sm text-accent underline-offset-2 hover:underline">
            Go to admin area
          </a>
        ) : null}
      </div>
    );
  }

  return <Outlet context={data} />;
}
