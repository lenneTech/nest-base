/**
 * Brand configuration consumed by the React-Email layouts.
 *
 * The brand interface is the contract layouts use to interpolate
 * colors, brand text, the legal entity, and contact addresses into
 * every transactional email. A single source of truth means changing
 * `primaryColor` or `legalEntity` in one place propagates to every
 * template that renders through `Barebone` (or any other brand-aware
 * layout) — without editing four template files.
 *
 * The actual brand-loader (read JSON from disk, env-overrides, etc.)
 * lands in issue #5. Until then we ship sensible defaults that match
 * the dark + electric-lime accent of the Dev-Hub so previews look
 * coherent out of the box. Consumers swap the values via
 * `resolveBrandConfig({ primaryColor: "..." })` from their bootstrap.
 */

export interface BrandConfig {
  /** Display name of the application — appears in headers + subjects. */
  appName: string;
  /** Primary CTA / accent color (hex). Used for buttons + dot logo. */
  primaryColor: string;
  /** Foreground color drawn on top of `primaryColor` (CTA label etc.). */
  primaryColorInk: string;
  /** Outer page background — the area around the email card. */
  backgroundColor: string;
  /** Card / surface background — the email body itself. */
  surfaceColor: string;
  /** Body text color used for paragraphs + greetings. */
  textColor: string;
  /** Muted / secondary text (footer, helper labels). */
  mutedTextColor: string;
  /** Optional logo URL; if `logoSvgInline` is set it takes precedence. */
  logoUrl?: string;
  /** Optional inline SVG markup for clients that strip remote images. */
  logoSvgInline?: string;
  /** Legal entity shown in the footer disclaimer. */
  legalEntity: string;
  /** Address displayed below the legal entity in the footer. */
  legalAddress?: string;
  /** Public-facing support address for "reply to a human" affordance. */
  supportEmail: string;
  /** Default `From:` envelope when the caller doesn't override. */
  fromEmail: string;
}

/**
 * Built-in brand defaults — match the dark + electric-lime theme of
 * the Dev-Hub. Consumers override per-field via `resolveBrandConfig`.
 */
export function defaultBrandConfig(): BrandConfig {
  return {
    appName: "nest-base",
    primaryColor: "#c5fb45",
    primaryColorInk: "#0a0a0a",
    backgroundColor: "#020203",
    surfaceColor: "#06070a",
    textColor: "#e4e4e7",
    mutedTextColor: "#71717a",
    legalEntity: "nest-base",
    legalAddress: undefined,
    supportEmail: "support@example.com",
    fromEmail: "no-reply@example.com",
  };
}

/**
 * Apply a partial override on top of `defaultBrandConfig()`.
 *
 * Pure planner — no I/O, no env reads. The runtime loader (planned
 * for issue #5) parses `brand.json`/env and feeds the result here.
 */
export function resolveBrandConfig(overrides: Partial<BrandConfig> = {}): BrandConfig {
  return { ...defaultBrandConfig(), ...overrides };
}
