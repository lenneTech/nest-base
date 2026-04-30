import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";

import { Can } from "../permissions/can.guard.js";
import { AssetService, type TransformOptions, computeCacheKey } from "./asset.service.js";
import { StorageObjectNotFoundError } from "./storage-adapter.js";

/**
 * `/assets/:key` HTTP surface for image-transform downloads.
 *
 * Backwards-compatible legacy URL (`?width=…&format=…`). The bytes
 * still go through `AssetService` → `IpxAssetTransformer` → cache so
 * the same engine drives both the legacy controller and the
 * Nuxt-Image-shaped `/_ipx/<modifiers>/<source>` mount in
 * `bootstrap.ts`. New integrations should target `/_ipx/*` directly;
 * the legacy URL stays for older clients (and the BYPASS / HIT / MISS
 * `x-cache` probe header that #16 introduced).
 *
 * Cache headers:
 *   `x-cache: HIT|MISS|BYPASS` — debugging probe for cache effectiveness
 *   `etag` — deterministic per (key, options); enables 304 by clients
 *   `cache-control: public, max-age=86400` — 24h browser cache
 */
@Controller("assets")
export class AssetController {
  constructor(private readonly asset: AssetService) {}

  @Can("read", "Asset")
  @Get(":key")
  async get(
    @Param("key") key: string,
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ): Promise<void> {
    if (!key) throw new BadRequestException("key required");
    const transforms: TransformOptions = {};
    if (query.width) transforms.width = Number(query.width);
    if (query.height) transforms.height = Number(query.height);
    if (query.format && ["webp", "avif", "jpeg", "png"].includes(query.format)) {
      transforms.format = query.format as TransformOptions["format"];
    }
    if (query.quality) transforms.quality = Number(query.quality);
    if (query.fit && ["cover", "contain", "inside", "outside"].includes(query.fit)) {
      transforms.fit = query.fit as TransformOptions["fit"];
    }

    // Probe the cache before delivery so the response can advertise
    // whether the transform was already cached. Only meaningful when
    // a transform was requested — passthrough always reads from origin.
    let cacheStatus: "HIT" | "MISS" | "BYPASS" = "BYPASS";
    if (Object.values(transforms).some((v) => v !== undefined)) {
      const cacheKey = computeCacheKey(key, transforms);
      cacheStatus = (await this.asset.cache.exists(cacheKey)) ? "HIT" : "MISS";
    }

    let result;
    try {
      result = await this.asset.deliver(key, transforms);
    } catch (err) {
      if (err instanceof StorageObjectNotFoundError) {
        throw new NotFoundException(`asset not found: ${key}`);
      }
      throw err;
    }

    const cacheKey = computeCacheKey(key, transforms);
    res.setHeader("content-type", result.mimeType);
    res.setHeader("cache-control", "public, max-age=86400");
    res.setHeader("etag", `"${cacheKey}"`);
    res.setHeader("x-cache", cacheStatus);
    res.send(Buffer.from(result.bytes));
  }
}

/**
 * `/_ipx/cache/:sourcePath` admin-only cache invalidation.
 *
 * Drops every cached transform whose key prefix matches `sourcePath`.
 * IPX itself doesn't expose a cache-busting hook (it uses the source
 * mtime / etag and lets clients revalidate); the asset-service cache
 * sits one layer below and keys per (sourceKey, options). Removing the
 * cached entries forces the next request to re-render through Sharp.
 *
 * GET requests on `/_ipx/*` are intercepted by the IPX node listener
 * mounted in `bootstrap.ts`; non-GET verbs fall through to NestJS so
 * this controller can claim the DELETE.
 */
@Controller("_ipx/cache")
export class IpxCacheController {
  constructor(private readonly asset: AssetService) {}

  @Can("delete", "Asset")
  @Delete(":sourcePath")
  async invalidate(@Param("sourcePath") sourcePath: string): Promise<{ removed: number }> {
    if (!sourcePath) throw new BadRequestException("sourcePath required");
    // List every cached transform whose stable hash includes this
    // source key. We don't track the (key → cache-keys) mapping, so
    // we drop all `assets/` entries — the next request re-renders.
    // Future iteration: stash the mapping in the metadata tier so
    // invalidation targets only the touched keys.
    void sourcePath;
    const cached = await this.asset.cache.list("assets/");
    let removed = 0;
    for (const key of cached) {
      const ok = await this.asset.cache.delete(key);
      if (ok) removed += 1;
    }
    return { removed };
  }
}
