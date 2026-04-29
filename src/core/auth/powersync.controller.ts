import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";

import { applyPowerSyncCrudBatch } from "./powersync-demo-client.js";
import { parsePowerSyncCrudBatch } from "./powersync-upload.js";

interface StoreRow {
  id: string;
  updatedAt: Date;
  [key: string]: unknown;
}

/**
 * `POST /powersync/crud` — receives the offline-queued mutation
 * batch from the PowerSync mobile client and applies it.
 *
 * Storage: an in-memory Map for now (matches Better-Auth's in-memory
 * adapter). A Prisma-backed Repository upgrade is a separate slice
 * that ties into the conflict-resolution hook on `BaseRepository`.
 */
@Controller("powersync")
export class PowerSyncController {
  private readonly store = new Map<string, StoreRow>();

  @Post("crud")
  @HttpCode(HttpStatus.NO_CONTENT)
  async crud(@Body() body: unknown): Promise<{ rejected?: unknown[] }> {
    let batch;
    try {
      batch = parsePowerSyncCrudBatch(body);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    const result = applyPowerSyncCrudBatch(batch, {
      store: this.store,
      now: () => new Date(),
    });
    if (result.status === 409) {
      // 409 status is returned by the framework throwing — the controller
      // surfaces the rejected fields so the client knows what to retry.
      const conflictBody = { rejected: result.rejected };
      throw new BadRequestException(conflictBody);
    }
    return {};
  }
}
