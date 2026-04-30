/**
 * Brand-Config Zod schema — single source of truth for the Brand
 * type the entire codebase shares.
 *
 * The schema describes the shape of `brand.json` files (project-owned
 * `src/modules/branding/brand.json` + template-default
 * `src/core/branding/brand.default.json`) and gates every loader /
 * editor that wants to materialise a `BrandConfig`.
 *
 * Why a hard 6-digit hex regex: brand colors flow into CSS and inline
 * email styles. CSS-injection through these fields would bypass the
 * standard escape table for HTML — keeping the input shape narrow at
 * the schema layer is the cheapest defense-in-depth we can buy.
 *
 * Why email + URL validators: `fromEmail` lands as the SMTP
 * `From:` header, `supportEmail` becomes a `mailto:` link in the
 * footer, `logoUrl` ends up in `<img src=…>`. A bad value here breaks
 * deliverability or renders an undecorated link — surface the error at
 * load time, not on the next mail send.
 */
import { z } from "zod";

/** Strict 6-digit hex (lower or upper case, leading `#`). */
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const hexColor = z.string().regex(HEX_COLOR_RE, {
  message: "expected a 6-digit hex color (e.g. #c5fb45)",
});

export const BrandConfigSchema = z.object({
  /** Display name — appears in headers, subjects, OpenAPI title. */
  name: z.string().min(1, { message: "brand.name must not be empty" }),
  /** Optional short alias used in compact UI (sidebar badge etc.). */
  shortName: z.string().min(1).optional(),
  /** Optional one-liner description. */
  tagline: z.string().optional(),
  /** Primary CTA / accent color. */
  primaryColor: hexColor.default("#c5fb45"),
  /** Foreground color drawn on top of `primaryColor`. */
  primaryColorInk: hexColor.default("#0a0a0a"),
  /** Outer page background — area around the email card / dev-portal. */
  backgroundColor: hexColor.default("#020203"),
  /** Card / surface background. */
  surfaceColor: hexColor.default("#06070a"),
  /** Body text color used for paragraphs + greetings. */
  textColor: hexColor.default("#e4e4e7"),
  /** Muted / secondary text (footer, helper labels). */
  mutedTextColor: hexColor.default("#71717a"),
  /** Public URL or `data:` URI of the logo image (PNG/SVG). */
  logoUrl: z.string().url().optional(),
  /** Inline SVG markup — wins over `logoUrl` when both are set. */
  logoSvgInline: z.string().optional(),
  /** Default `From:` envelope when the caller doesn't override. */
  fromEmail: z.string().email().default("no-reply@example.com"),
  /** Legal entity shown in email footer + admin imprint. */
  legalEntity: z.string().optional(),
  /** Public-facing support page URL. */
  supportUrl: z.string().url().optional(),
  /** Public-facing support address — becomes a `mailto:` link. */
  supportEmail: z.string().email().optional(),
});

/**
 * Materialised Brand-Config — the shape every consumer (loader,
 * dev-portal, email layouts, OpenAPI builder) reads from.
 *
 * Note: this type intentionally keeps Zod's `.default(...)` semantics
 * — each color field is required at the type level even when the
 * input JSON omits it, because the schema fills the default.
 */
export type BrandConfig = z.infer<typeof BrandConfigSchema>;

/** Raw (pre-parse) input shape — useful for `decodeBrand` callers. */
export type BrandConfigInput = z.input<typeof BrandConfigSchema>;

/**
 * Pure decoder — JSON-shaped `unknown` → typed BrandConfig.
 *
 * Splitting the schema parse into a named function keeps the loader
 * (which does I/O) free of `zod.parse(...)` calls and gives unit
 * tests a single seam for invalid-input fixtures.
 */
export function decodeBrand(input: unknown): BrandConfig {
  return BrandConfigSchema.parse(input);
}
