import type { IPXStorage, IPXStorageMeta } from "ipx";

import type { StorageAdapter } from "./storage-adapter.js";
import { StorageObjectNotFoundError } from "./storage-adapter.js";

/**
 * Adapt a `StorageAdapter` to IPX's `IPXStorage` interface.
 *
 * IPX's source layer asks for `getMeta(id)` and `getData(id)`; both
 * may return `undefined` to signal a 404. Our `StorageAdapter.get()`
 * throws `StorageObjectNotFoundError` instead, so the bridge converts.
 *
 * IPX prefixes ids with a leading `/` (e.g. `/files/abc`). Our keys
 * never start with `/`, so the bridge strips it before delegating.
 *
 * `getMeta` returns a `maxAge` so IPX emits a sensible
 * `cache-control: max-age=…, public` header even when the underlying
 * adapter doesn't track lifetimes.
 */

export interface StorageAdapterSourceOptions {
  /**
   * Default `max-age` (seconds) IPX sends in the `cache-control`
   * response header. Defaults to one day — same as the legacy
   * AssetController contract.
   */
  defaultMaxAge?: number;
}

const DEFAULT_MAX_AGE_SECONDS = 86_400;

export function storageAdapterSource(
  adapter: StorageAdapter,
  options: StorageAdapterSourceOptions = {},
): IPXStorage {
  const maxAge = options.defaultMaxAge ?? DEFAULT_MAX_AGE_SECONDS;

  return {
    name: "storage-adapter",
    async getMeta(id: string): Promise<IPXStorageMeta | undefined> {
      const key = stripLeadingSlash(id);
      const exists = await adapter.exists(key);
      if (!exists) return undefined;
      return { maxAge };
    },
    async getData(id: string): Promise<ArrayBuffer | undefined> {
      const key = stripLeadingSlash(id);
      try {
        const bytes = await adapter.get(key);
        // IPX expects an ArrayBuffer; copy out of the Uint8Array's
        // backing store so a sliced view doesn't hand IPX more than
        // the caller stored.
        return bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
      } catch (err) {
        if (err instanceof StorageObjectNotFoundError) return undefined;
        throw err;
      }
    },
  };
}

function stripLeadingSlash(id: string): string {
  return id.startsWith("/") ? id.slice(1) : id;
}
