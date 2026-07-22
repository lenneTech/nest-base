/**
 * Catches lazy-route / render failures (e.g. stale chunk after dev rebuild)
 * so the operator sees a recovery hint instead of a blank page.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

import { PageError } from "./PageState.js";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class DevPortalRouteError extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[dev-portal] route render failed", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      const staleChunk =
        this.state.error.message.includes("Failed to fetch dynamically imported module") ||
        this.state.error.message.includes("Importing a module script failed");
      return (
        <div className="flex min-h-[40vh] items-center justify-center p-8">
          <PageError>
            {staleChunk
              ? "Hub bundle is stale (after rebuild). Reload the start page once (Cmd+Shift+R)."
              : "Page could not be loaded."}
          </PageError>
        </div>
      );
    }
    return this.props.children;
  }
}
