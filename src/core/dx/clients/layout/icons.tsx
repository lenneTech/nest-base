/**
 * Inline SVG icon set — verbatim port of the icons declared at the
 * now-deleted `src/core/dx/admin-layout.ts` (`ICON_HOME`, `ICON_HEART`,
 * etc). The server emits raw SVG strings into a `<span>`; the React
 * tree returns identical SVG nodes so the rendered DOM matches.
 *
 * If you add a new sidebar entry, add the matching icon here and
 * document the source attribution at the call-site.
 */
import type { ReactElement } from "react";

const COMMON = {
  fill: "none" as const,
  // The viewBox + classnames reproduce the markup the server emits.
  viewBox: "0 0 24 24",
};

export const ICONS: Record<string, ReactElement> = {
  home: (
    <svg {...COMMON}>
      <path d="M3 12l9-9 9 9" />
      <path d="M5 10v10a1 1 0 001 1h3v-6h6v6h3a1 1 0 001-1V10" />
    </svg>
  ),
  heart: (
    <svg {...COMMON}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
  toggle: (
    <svg {...COMMON}>
      <rect x="1" y="6" width="22" height="12" rx="6" />
      <circle cx="16" cy="12" r="3" />
    </svg>
  ),
  book: (
    <svg {...COMMON}>
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
    </svg>
  ),
  file: (
    <svg {...COMMON}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  ),
  bug: (
    <svg {...COMMON}>
      <rect x="8" y="6" width="8" height="14" rx="4" />
      <path d="M12 6V3M9 8L7 6M15 8l2-2M5 12H3M21 12h-2M5 18l-2 1M21 18l-2 1" />
    </svg>
  ),
  shield: (
    <svg {...COMMON}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  webhook: (
    <svg {...COMMON}>
      <path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 117.5 12.5" />
      <path d="M16.5 17l-3.4-6.34a4 4 0 00-7.1.84" />
      <path d="M14.5 8a4 4 0 016.84-2.41" />
    </svg>
  ),
  radio: (
    <svg {...COMMON}>
      <circle cx="12" cy="12" r="2" />
      <path d="M16.24 7.76a6 6 0 010 8.49M7.76 16.24a6 6 0 010-8.49M20.49 3.51a12 12 0 010 16.97M3.51 20.49a12 12 0 010-16.97" />
    </svg>
  ),
  list: (
    <svg {...COMMON}>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </svg>
  ),
  search: (
    <svg {...COMMON}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  database: (
    <svg {...COMMON}>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
      <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6" />
    </svg>
  ),
  chart: (
    <svg {...COMMON}>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  terminal: (
    <svg {...COMMON}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
  check: (
    <svg {...COMMON}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  pulse: (
    <svg {...COMMON}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  route: (
    <svg {...COMMON}>
      <circle cx="6" cy="19" r="3" />
      <path d="M9 19h8.5a3.5 3.5 0 000-7h-11a3.5 3.5 0 010-7H15" />
      <circle cx="18" cy="5" r="3" />
    </svg>
  ),
  network: (
    <svg {...COMMON}>
      <circle cx="12" cy="5" r="2" />
      <circle cx="5" cy="19" r="2" />
      <circle cx="19" cy="19" r="2" />
      <path d="M12 7v4M12 11l-7 6M12 11l7 6" />
    </svg>
  ),
  mail: (
    <svg {...COMMON}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <polyline points="22 6 12 13 2 6" />
    </svg>
  ),
};

/**
 * Brand logo — the small shield that sits next to "nest-server" in
 * the sidebar. Verbatim port of the inline SVG in
 * the legacy server `<a class="admin-brand">`.
 */
export const BRAND_LOGO: ReactElement = (
  <svg viewBox="0 0 32 32" width="22" height="22" fill="none">
    <path
      d="M16 3l11 6.5v13L16 29 5 22.5v-13L16 3z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <path
      d="M16 3v26M5 9.5l22 13M27 9.5l-22 13"
      stroke="currentColor"
      strokeWidth="1"
      opacity="0.4"
    />
  </svg>
);
