import { UAParser } from "ua-parser-js";

/**
 * Device UA-parser planner.
 *
 * Wraps `ua-parser-js` with the project's defensive defaults:
 *   - empty / undefined / malformed input → `"Unknown device"` label,
 *   - composed `label` field — `"<browser> on <os>"` — so callers
 *     don't reassemble it.
 *
 * The deviceType union mirrors what `ua-parser-js` reports
 * (`mobile`, `tablet`, `console`, `smarttv`, `tv`, `wearable`,
 * `embedded`, `xr`) plus `"desktop"` (which the lib leaves
 * undefined for laptop/desktop UAs) and `"unknown"` (our fallback
 * for unparseable input).
 *
 * The new-device email + `/me/devices` endpoint surface this
 * projection. The planner is pure (no I/O, no Date) — a thin
 * library wrapper.
 */

export type DeviceType =
  | "mobile"
  | "tablet"
  | "desktop"
  | "console"
  | "smarttv"
  | "tv"
  | "wearable"
  | "embedded"
  | "xr"
  | "unknown";

export interface ParsedUserAgent {
  browser: string;
  os: string;
  deviceType: DeviceType;
  /** Composed `<browser> on <os>` for renderers; falls back to "Unknown device". */
  label: string;
}

const KNOWN_DEVICE_TYPES: ReadonlySet<DeviceType> = new Set([
  "mobile",
  "tablet",
  "desktop",
  "console",
  "smarttv",
  "tv",
  "wearable",
  "embedded",
  "xr",
]);

export function parseUserAgent(ua: string | undefined | null): ParsedUserAgent {
  const trimmed = (ua ?? "").trim();
  if (!trimmed) {
    return { browser: "Unknown", os: "Unknown", deviceType: "unknown", label: "Unknown device" };
  }

  const parsed = new UAParser(trimmed).getResult();
  const browser = (parsed.browser?.name ?? "").trim();
  const os = (parsed.os?.name ?? "").trim();
  const rawType = (parsed.device?.type ?? "").trim().toLowerCase();

  // Desktop is the implicit default for ua-parser-js: the lib leaves
  // device.type undefined for typical laptop/desktop UAs. Map it back
  // to "desktop" so callers don't have to special-case the empty case.
  let deviceType: DeviceType;
  if (!rawType) {
    deviceType = browser ? "desktop" : "unknown";
  } else if (KNOWN_DEVICE_TYPES.has(rawType as DeviceType)) {
    deviceType = rawType as DeviceType;
  } else {
    deviceType = "unknown";
  }

  // If both browser and OS are missing, the UA was unparseable —
  // fall back to the empty-input label rather than rendering
  // "Unknown on Unknown" which adds no information.
  if (!browser && !os) {
    return { browser: "Unknown", os: "Unknown", deviceType: "unknown", label: "Unknown device" };
  }

  const safeBrowser = browser || "Unknown";
  const safeOs = os || "Unknown";
  return {
    browser: safeBrowser,
    os: safeOs,
    deviceType,
    label: `${safeBrowser} on ${safeOs}`,
  };
}
