import type { IncomingMessage, ServerResponse } from "node:http";

import { createIPX, createIPXNodeServer, type IPX } from "ipx";

import {
  AssetPresetNotFoundError,
  type AssetPresetRegistry,
} from "./asset-presets.js";
import { storageAdapterSource } from "./ipx-source.js";
import {
  buildIpxModifierString,
  resolvePresetModifiers,
} from "./ipx-url-planner.js";
import type { StorageAdapter } from "./storage-adapter.js";

/**
 * IPX asset server — Nuxt-Image-compatible `/_ipx/<modifiers>/<source>`
 * endpoint mounted on the Express adapter.
 *
 * Wraps IPX with two extras the upstream library does not provide:
 *
 *   1. Preset expansion: a leading `preset_<name>` modifier-segment
 *      is replaced with the preset's full modifier string before the
 *      request reaches IPX. IPX has no native concept of presets;
 *      we resolve the name against the project's `AssetPresetRegistry`
 *      so URLs stay short on the wire (`/_ipx/preset_thumbnail/<key>`).
 *
 *   2. `x-cache: HIT|MISS` shimming through the controller layer (the
 *      controller probes its own cache adapter before calling IPX —
 *      this server only emits the IPX response).
 *
 * Construction is intentionally pure: pass an `IPX` instance + the
 * preset registry; the resulting handler is a `(req, res) => void`
 * that the bootstrap layer mounts on Express via `app.use("/_ipx", h)`.
 */

export interface IpxAssetServerOptions {
  origin: StorageAdapter;
  presets: AssetPresetRegistry;
  /**
   * Default cache `max-age` (seconds) sent in IPX responses. Mirrors
   * the legacy AssetController contract (24 h browser cache).
   */
  defaultMaxAge?: number;
}

export interface IpxAssetServer {
  /** The underlying IPX instance — exposed for dev tooling / tests. */
  readonly ipx: IPX;
  /**
   * Node-style `(req, res) => void` request listener that handles
   * `/_ipx/<modifiers>/<source>` GETs.
   */
  readonly handle: (req: IncomingMessage, res: ServerResponse) => void;
}

export function createIpxAssetServer(
  options: IpxAssetServerOptions,
): IpxAssetServer {
  const ipx = createIPX({
    storage: storageAdapterSource(options.origin, {
      ...(options.defaultMaxAge !== undefined
        ? { defaultMaxAge: options.defaultMaxAge }
        : {}),
    }),
  });
  const ipxNode = createIPXNodeServer(ipx);

  function handle(req: IncomingMessage, res: ServerResponse): void {
    try {
      const rewritten = rewritePresetUrl(req.url ?? "/", options.presets);
      // The IPX node listener reads `req.url` to extract path + modifiers;
      // mutating in-place is the cheapest way to forward the rewrite.
      if (rewritten !== req.url) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (req as any).url = rewritten;
      }
    } catch (err) {
      if (err instanceof AssetPresetNotFoundError) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            error: "asset_preset_not_found",
            message: err.message,
          }),
        );
        return;
      }
      // Unknown rewrite errors fall through to IPX's own handling.
    }
    ipxNode(req, res);
  }

  return { ipx, handle };
}

/**
 * Expand a `/preset_<name>/<source>` URL to the preset's full IPX
 * modifier string. Returns the original URL when no preset modifier
 * appears in the first segment.
 *
 * The function is exported for testing — it's a pure path-rewriter.
 */
export function rewritePresetUrl(
  pathWithQuery: string,
  registry: AssetPresetRegistry,
): string {
  // Split the query suffix (IPX ignores it but we preserve verbatim).
  const queryStart = pathWithQuery.indexOf("?");
  const path = queryStart >= 0 ? pathWithQuery.slice(0, queryStart) : pathWithQuery;
  const query = queryStart >= 0 ? pathWithQuery.slice(queryStart) : "";

  // IPX path layout (after the `/_ipx` mount strips its prefix):
  //   /<modifierSegment>/<sourcePath>
  const trimmed = path.startsWith("/") ? path.slice(1) : path;
  const slashIdx = trimmed.indexOf("/");
  if (slashIdx < 0) return pathWithQuery;
  const modifierSegment = trimmed.slice(0, slashIdx);
  const sourcePath = trimmed.slice(slashIdx + 1);

  // Single-modifier preset reference: `preset_thumbnail`. We only
  // support a single preset modifier per URL — combining presets with
  // ad-hoc overrides would change the cache key in ways that defeat
  // the preset purpose.
  if (!modifierSegment.startsWith("preset_")) return pathWithQuery;
  const name = modifierSegment.slice("preset_".length);
  if (!name) return pathWithQuery;

  const modifiers = resolvePresetModifiers(name, registry);
  const expanded = buildIpxModifierString(modifiers);
  return `/${expanded}/${sourcePath}${query}`;
}
