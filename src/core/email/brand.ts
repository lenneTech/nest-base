/**
 * Brand configuration consumed by the React-Email layouts.
 *
 * The email subsystem owns its own brand-flavored interface (because
 * email templates predate the project-wide brand-config from issue
 * #5). This file is the *bridge* between the central
 * `src/core/branding/` source-of-truth and the email shape:
 *
 *   - `BrandConfig` here uses `appName` (templates read it via
 *     `<%= appName %>` and `<Barebone>` JSX). The central
 *     `BrandConfig` uses `name` because the dev-portal and OpenAPI
 *     builder think in those terms.
 *
 *   - `defaultBrandConfig()` walks the central loader so a single
 *     edit to `src/modules/branding/brand.json` propagates to every
 *     transactional email.
 *
 *   - `resolveBrandConfig(overrides)` keeps the existing
 *     "central → defaults → overrides" merge contract. EmailModule
 *     calls it without arguments; downstream tests pass partial
 *     overrides for fixture flexibility.
 */

import {
  loadBrandSync,
  type BrandConfig as CentralBrandConfig,
} from "../branding/brand-loader.js";

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
 * Adapter — central `BrandConfig` → email-flavored `BrandConfig`.
 *
 * Pure function (no I/O), exported for callers that already hold a
 * central brand and want the email view without re-walking the disk.
 *
 * Mapping rules:
 *   - `name` → `appName` (templates expect the latter)
 *   - `legalEntity` → falls back to `name` so footers always have a
 *     non-empty value, even when the project hasn't set the field
 *   - `supportEmail` → defaults to a placeholder so the "Need help?"
 *     line in the footer renders coherently before the operator fills
 *     the real address via `/dev/brand` (the placeholder is obvious
 *     enough to flag in QA).
 */
export function brandConfigFromCentral(central: CentralBrandConfig): BrandConfig {
  const out: BrandConfig = {
    appName: central.name,
    primaryColor: central.primaryColor,
    primaryColorInk: central.primaryColorInk,
    backgroundColor: central.backgroundColor,
    surfaceColor: central.surfaceColor,
    textColor: central.textColor,
    mutedTextColor: central.mutedTextColor,
    legalEntity: central.legalEntity ?? central.name,
    supportEmail: central.supportEmail ?? "support@example.com",
    fromEmail: central.fromEmail,
  };
  if (central.logoUrl) out.logoUrl = central.logoUrl;
  if (central.logoSvgInline) out.logoSvgInline = central.logoSvgInline;
  return out;
}

/**
 * Email-flavored brand defaults — sourced from the central
 * brand-loader (which reads project + template JSON) so a single
 * edit to `brand.json` propagates everywhere.
 *
 * Why sync: the email layouts call this from React render functions
 * that don't await; the loader is sync and cached so the cost is
 * amortised to one disk read per process.
 */
export function defaultBrandConfig(): BrandConfig {
  return brandConfigFromCentral(loadBrandSync());
}

/**
 * Apply a partial override on top of `defaultBrandConfig()`.
 *
 * The classic "deep brand merge" — used by EmailModule (no overrides),
 * by the email-preview catalog (per-template tweaks), and by
 * unit tests. Backwards-compatible signature — callers from before
 * issue #5 keep working.
 */
export function resolveBrandConfig(overrides: Partial<BrandConfig> = {}): BrandConfig {
  return { ...defaultBrandConfig(), ...overrides };
}
