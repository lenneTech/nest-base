/**
 * CommandPalette — Cmd+K / Ctrl+K overlay for the Dev-Hub (Issue #90).
 *
 * Opens a full-screen modal with three tabs:
 *   Seiten          — fuzzy-searched Hub pages from /hub/palette/search.json
 *   Zuletzt besucht — last 10 pages visited (FIFO, localStorage)
 *
 * Keyboard:
 *   Cmd+K / Ctrl+K — toggle open/close
 *   Escape         — close
 *   Arrow keys     — navigate items (handled by cmdk)
 *   Enter          — navigate to selected item
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "./ui/command.js";

// ------------------------------------------------------------------
// Recent-item tracking
// ------------------------------------------------------------------

const RECENTS_KEY = "hub.palette.recents";
const RECENTS_MAX = 20;

export interface RecentItem {
  id: string;
  title: string;
  href: string;
  category: string;
}

export function pushRecentItem(item: RecentItem): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const existing: RecentItem[] = raw ? (JSON.parse(raw) as RecentItem[]) : [];
    // Remove duplicate (same id), then prepend
    const deduped = existing.filter((r) => r.id !== item.id);
    const next = [item, ...deduped].slice(0, RECENTS_MAX);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable (private mode, quota exceeded) — ignore
  }
}

function readRecentItems(): RecentItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as RecentItem[]) : [];
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// Search result shape (mirrors PaletteSearchResult from the planner)
// ------------------------------------------------------------------

interface PageResult {
  id: string;
  title: string;
  href: string;
  score: number;
  matchType: string;
  category: string;
}

interface SearchResponse {
  pages: PageResult[];
}

// ------------------------------------------------------------------
// Hook: debounced fetch
// ------------------------------------------------------------------

function usePaletteSearch(query: string, enabled: boolean) {
  const [results, setResults] = useState<PageResult[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    // For very short queries (< 2 chars) hit the endpoint with empty q
    // so the UI still shows all pages.
    const q = query.length >= 2 ? query : "";

    timerRef.current = setTimeout(() => {
      setLoading(true);
      fetch(`/hub/palette/search.json?q=${encodeURIComponent(q)}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
        .then((data: unknown) => {
          const typed = data as SearchResponse;
          setResults(typed.pages ?? []);
        })
        .catch(() => {
          // Network failure — keep showing previous results
        })
        .finally(() => setLoading(false));
    }, 150);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, enabled]);

  return { results, loading };
}

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------

type PaletteTab = "seiten" | "zuletzt";

export function CommandPalette(): ReactNode {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<PaletteTab>("seiten");
  const [recents, setRecents] = useState<RecentItem[]>([]);
  const navigate = useNavigate();

  // Cmd+K / Ctrl+K global binding
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => {
          if (!prev) {
            // Refresh recents each time the palette opens
            setRecents(readRecentItems());
            setQuery("");
            setTab("seiten");
          }
          return !prev;
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const { results } = usePaletteSearch(query, open && tab === "seiten");

  function close() {
    setOpen(false);
  }

  function navigateTo(item: { id: string; title: string; href: string; category: string }) {
    // Record the visit before navigating
    pushRecentItem({ id: item.id, title: item.title, href: item.href, category: item.category });
    close();
    // Internal SPA routes use react-router; external URLs (Prisma Studio,
    // etc.) use a real navigation.
    if (item.href.startsWith("/") && !item.href.startsWith("//")) {
      navigate(item.href);
    } else {
      window.location.href = item.href;
    }
  }

  // Group pages by category for display
  const grouped = groupByCategory(results);

  const isMac =
    typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent);

  return (
    <>
      {/* Keyboard-shortcut hint in the sidebar footer — rendered as a portal
          target via id so AdminShell can reference it without prop-drilling.
          The hint element is intentionally rendered here (not in AdminShell)
          so it's only mounted once. */}
      <div id="dp-palette-hint" className="hidden" aria-hidden="true" />

      <CommandDialog open={open} onOpenChange={setOpen}>
        {/* Tab bar */}
        <div className="flex items-center gap-0.5 border-b border-line px-3 pt-2">
          {(
            [
              { key: "seiten", label: "Seiten" },
              { key: "zuletzt", label: "Zuletzt besucht" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors ${
                tab === t.key
                  ? "bg-accent-soft text-accent border-b-2 border-accent"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "seiten" && (
          <>
            <CommandInput
              placeholder={`Seiten durchsuchen… (${isMac ? "⌘K" : "Ctrl+K"} zum Schließen)`}
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              {grouped.length === 0 ? (
                <CommandEmpty>Keine Ergebnisse für „{query}"</CommandEmpty>
              ) : (
                grouped.map(({ category, items }, idx) => (
                  <div key={category}>
                    {idx > 0 && <CommandSeparator />}
                    <CommandGroup heading={category}>
                      {items.map((page) => (
                        <CommandItem
                          key={page.id}
                          value={page.id}
                          onSelect={() => navigateTo(page)}
                        >
                          <CategoryIcon category={category} />
                          <span className="flex-1 truncate">{page.title}</span>
                          <span className="ml-2 shrink-0 text-[0.65rem] text-fg-faint">
                            {page.href}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </div>
                ))
              )}
            </CommandList>
          </>
        )}

        {tab === "zuletzt" && (
          <>
            <CommandInput
              placeholder="Zuletzt besuchte Seiten…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              {recents.length === 0 ? (
                <CommandEmpty>Noch keine besuchten Seiten.</CommandEmpty>
              ) : (
                <CommandGroup heading="Zuletzt besucht">
                  {recents
                    .filter(
                      (r) =>
                        !query ||
                        r.title.toLowerCase().includes(query.toLowerCase()) ||
                        r.href.toLowerCase().includes(query.toLowerCase()),
                    )
                    .slice(0, 10)
                    .map((item) => (
                      <CommandItem key={item.id} value={item.id} onSelect={() => navigateTo(item)}>
                        <CategoryIcon category={item.category} />
                        <span className="flex-1 truncate">{item.title}</span>
                        <span className="ml-2 shrink-0 text-[0.65rem] text-fg-faint">
                          {item.href}
                        </span>
                      </CommandItem>
                    ))}
                </CommandGroup>
              )}
            </CommandList>
          </>
        )}

        {/* Footer */}
        <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[0.65rem] text-fg-faint">
          <span>
            <kbd className="rounded border border-line bg-surface-2 px-1 py-0.5 font-mono">↑↓</kbd>{" "}
            Navigieren
          </span>
          <span>
            <kbd className="rounded border border-line bg-surface-2 px-1 py-0.5 font-mono">
              Enter
            </kbd>{" "}
            Öffnen
          </span>
          <span>
            <kbd className="rounded border border-line bg-surface-2 px-1 py-0.5 font-mono">Esc</kbd>{" "}
            Schließen
          </span>
        </div>
      </CommandDialog>
    </>
  );
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function groupByCategory(pages: PageResult[]): { category: string; items: PageResult[] }[] {
  const map = new Map<string, PageResult[]>();
  for (const page of pages) {
    const bucket = map.get(page.category) ?? [];
    bucket.push(page);
    map.set(page.category, bucket);
  }
  return [...map.entries()].map(([category, items]) => ({ category, items }));
}

function CategoryIcon({ category }: { category: string }): ReactNode {
  // Minimal icon per category — simple inline SVGs keep the bundle lean
  // (no additional lucide imports beyond what command.tsx already pulls).
  if (category === "Admin") {
    return (
      <svg
        className="h-3.5 w-3.5 shrink-0 text-fg-muted"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    );
  }
  if (category === "API & Docs") {
    return (
      <svg
        className="h-3.5 w-3.5 shrink-0 text-fg-muted"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    );
  }
  // Default: Übersicht / other
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0 text-fg-muted"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}
