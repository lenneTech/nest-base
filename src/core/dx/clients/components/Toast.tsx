/**
 * Dev-Portal Toast — minimal local toast queue.
 *
 * react-aria-components ships a `ToastQueue` API; we wrap it in a
 * provider hook so callers can simply call `useToasts().push("…")`.
 *
 * For v1 we keep the queue in-memory; persistence is not required for
 * a dev surface.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

interface ToastItem {
  id: number;
  message: string;
}

interface ToastApi {
  push: (message: string) => void;
}

const ToastContext = createContext<ToastApi | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((message: string) => {
    setItems((prev) => [...prev, { id: Date.now() + Math.random(), message }]);
  }, []);

  // Auto-dismiss: each toast fades out after 3 seconds. Long-running
  // toasts are not part of the v1 API — keep the surface tiny.
  useEffect(() => {
    if (items.length === 0) return;
    const timer = setTimeout(() => {
      setItems((prev) => prev.slice(1));
    }, 3000);
    return () => clearTimeout(timer);
  }, [items]);

  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="dp-toast-region" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className="dp-toast" role="status">
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToasts(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToasts called outside ToastProvider");
  return ctx;
}
