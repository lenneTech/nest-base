import { BadRequestException, Controller, Get, NotFoundException, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";

import { Can } from "../permissions/can.guard.js";
import {
  AssetService,
  type TransformOptions,
  computeCacheKey,
} from "./asset.service.js";
import { StorageObjectNotFoundError } from "./storage-adapter.js";

/**
 * `/assets/:key` HTTP surface for image-transform downloads.
 *
 * Pipes bytes from the configured `StorageAdapter` (S3 / Local /
 * Postgres-FileBlob) through `AssetService` (sharp transformer +
 * read-through cache) and back to the client. The placeholder PNG
 * synthesis the previous slice shipped is gone — see issue #16.
 *
 * Cache headers:
 *   `x-cache: HIT|MISS` — debugging probe for cache effectiveness
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
