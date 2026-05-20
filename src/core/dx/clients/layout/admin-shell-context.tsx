/**
 * Shared shell state for hub/admin routes — keeps the sidebar mounted
 * across react-router navigations so its scroll position is preserved.
 */
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

export interface AdminShellState {
  title: string;
  subtitle?: ReactNode;
  currentNav: string;
  toolbar?: ReactNode;
}

const DEFAULT_STATE: AdminShellState = {
  title: "Hub",
  currentNav: "hub",
};

interface AdminShellContextValue {
  state: AdminShellState;
  setState: Dispatch<SetStateAction<AdminShellState>>;
}

const AdminShellContext = createContext<AdminShellContextValue | null>(null);

export function AdminShellProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, setState] = useState<AdminShellState>(DEFAULT_STATE);
  const value = useMemo(() => ({ state, setState }), [state]);
  return <AdminShellContext.Provider value={value}>{children}</AdminShellContext.Provider>;
}

export function useAdminShellContext(): AdminShellContextValue {
  const ctx = useContext(AdminShellContext);
  if (!ctx) {
    throw new Error("useAdminShellContext must be used within AdminShellProvider");
  }
  return ctx;
}

/** Pages call this (via `<AdminShell>`) to drive the persistent layout chrome. */
export function useAdminShell(props: AdminShellState): void {
  const { setState } = useAdminShellContext();
  const { title, subtitle, currentNav, toolbar } = props;
  useLayoutEffect(() => {
    setState({ title, subtitle, currentNav, toolbar });
  }, [title, subtitle, currentNav, toolbar, setState]);
}
