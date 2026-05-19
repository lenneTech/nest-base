/**
 * Guards `/hub/*` and `/admin/*` client routes after Better-Auth sign-in.
 */
import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

import { PageError, PageLoading } from "./PageState.js";
import { AdminFetchError, fetchJson } from "../lib/api.js";

export interface HubPortalAccess {
  devHub: boolean;
  tenantAdmin: boolean;
}

export function HubPortalGate(): ReactNode {
  const location = useLocation();
  const accessQuery = useQuery({
    queryKey: ["hub", "portal-access"],
    queryFn: () => fetchJson<HubPortalAccess>("/hub/portal-access.json"),
    retry: false,
  });

  if (accessQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-8">
        <PageLoading>Session prüfen…</PageLoading>
      </div>
    );
  }

  if (accessQuery.isError) {
    if (accessQuery.error instanceof AdminFetchError && accessQuery.error.needsSignIn) {
      return <Navigate to="/" replace state={{ from: location.pathname }} />;
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-8">
        <PageError>Hub-Zugriff konnte nicht geprüft werden.</PageError>
      </div>
    );
  }

  if (!accessQuery.data?.devHub) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-8">
        <PageError>
          Kein Zugriff auf den Dev-Hub. Deine Rolle hat kein{" "}
          <code className="font-mono">read DevHub</code> — nutze einen Operator-Account (z. B.{" "}
          <code className="font-mono">admin@lenne.tech</code>).
        </PageError>
      </div>
    );
  }

  return <Outlet context={accessQuery.data} />;
}
