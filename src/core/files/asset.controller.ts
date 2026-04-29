import { BadRequestException, Controller, Get, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import sharp from "sharp";

import { type TransformOptions, computeCacheKey } from "./asset.service.js";

/**
 * `/assets/:key` HTTP surface for image-transform downloads
 * (PLAN.md §32 Phase 4 — Asset-Endpoint mit Transformations + Cache).
 *
 * Today: synthesizes a tiny placeholder PNG via sharp + applies the
 * requested transforms. Real implementation: fetch the original from
 * the configured `StorageAdapter` (s3/local/postgres-FileBlob), pipe
 * it through `sharp`, cache the transformed buffer keyed by
 * `computeCacheKey()`. The pipeline is in place; storage retrieval
 * is the swap-out.
 */
@Controller("assets")
export class AssetController {
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

    // Placeholder image: 32x32 colored square. Real impl reads
    // `key` from the StorageAdapter and pipes those bytes here.
    const baseImage = sharp({
      create: { width: 32, height: 32, channels: 3, background: "#0a58ca" },
    });
    let pipeline = baseImage;
    if (transforms.width || transforms.height) {
      pipeline = pipeline.resize(transforms.width, transforms.height);
    }
    const format = transforms.format ?? "png";
    const buffer = await pipeline.toFormat(format).toBuffer();

    const cacheKey = computeCacheKey(key, transforms);
    res.setHeader("content-type", `image/${format}`);
    res.setHeader("cache-control", "public, max-age=86400");
    res.setHeader("etag", `"${cacheKey}"`);
    res.send(buffer);
  }
}
