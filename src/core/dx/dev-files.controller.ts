/**
 * `/dev/files*` — JSON sidecars for the Dev-Portal File-Manager (issue #18).
 *
 * The React page at `/dev/files` reads three sidecar endpoints to
 * populate its two-column layout:
 *   - `/dev/files/tree.json`        — recursive folder hierarchy (left rail)
 *   - `/dev/files/list.json`        — files in the active folder (grid)
 *   - `/dev/files/breadcrumb.json`  — root-to-active path (header)
 *
 * Every endpoint 404s outside `NODE_ENV=development`, identical to
 * the rest of the dev-hub. The controller is mounted unconditionally
 * by `DevHubModule` so route discovery (`/dev/routes`) sees it on the
 * inventory. The `assertDev()` short-circuit keeps the surface from
 * leaking in a production build.
 *
 * Tenant scoping: every endpoint requires the `x-tenant-id` header
 * (the `TenantInterceptor` validates it). RLS is the last-resort
 * backstop, but we explicitly scope all reads by tenant id so a
 * misconfigured RLS policy can never cross-leak.
 *
 * The page itself (`GET /dev/files`) is served by the existing
 * splat-catchall on `DevHubController` — react-router takes over from
 * the SPA shell.
 */
import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Headers,
  NotFoundException,
  Query,
} from "@nestjs/common";

import { buildDevPortalShellInput, renderDevPortalShell } from "./dev-portal-shell.js";
import {
  buildFolderBreadcrumb,
  type BreadcrumbInput,
  type BreadcrumbSegment,
} from "../files/file-manager-breadcrumb.js";
import { applyFileSearch, type FileSearchSortKey } from "../files/file-manager-search.js";
import { buildFolderTree, type FolderTreeNode } from "../files/file-manager-tree.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { serverConfigFromEnv } from "../server/server-config.js";

interface FileListEntry {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  folderId: string | null;
  storageKey: string;
  /** IPX thumbnail URL — populated only for `image/*` MIME types. */
  thumbnailUrl?: string;
}

interface FileTreeResponse {
  tree: FolderTreeNode[];
}

interface FileListResponse {
  files: FileListEntry[];
  totalCount: number;
}

interface BreadcrumbResponse {
  segments: BreadcrumbSegment[];
}

@Controller("dev/files")
export class DevFilesController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `GET /dev/files` — SPA shell HTML.
   *
   * Mirrors the other dev-portal pages: emits the same shell that
   * `DevHubController.spaCatchAll` would have produced. Listing it
   * explicitly here means route inventory shows `/dev/files` as a
   * first-class route instead of "covered by splat".
   */
  @Get()
  @Header("content-type", "text/html; charset=utf-8")
  page(): string {
    this.assertDev();
    return renderDevPortalShell(
      buildDevPortalShellInput({ title: "File Manager", brand: "central" }),
    );
  }

  @Get("tree.json")
  async tree(
    @Query("tenantId") tenantQuery: string | undefined,
    @Headers("x-tenant-id") tenantHeader: string | undefined,
  ): Promise<FileTreeResponse> {
    this.assertDev();
    const tenantId = this.resolveTenantId(tenantQuery, tenantHeader);
    const folders = await this.prisma.folder.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, parentId: true, tenantId: true },
    });
    const tree = buildFolderTree(folders);
    return { tree };
  }

  @Get("list.json")
  async list(
    @Query("tenantId") tenantQuery: string | undefined,
    @Query("folderId") folderId: string | undefined,
    @Query("search") search: string | undefined,
    @Query("mimeTypePrefix") mimeTypePrefix: string | undefined,
    @Query("sortBy") sortBy: string | undefined,
    @Query("sortDirection") sortDirection: string | undefined,
    @Query("limit") limitRaw: string | undefined,
    @Headers("x-tenant-id") tenantHeader: string | undefined,
  ): Promise<FileListResponse> {
    this.assertDev();
    const tenantId = this.resolveTenantId(tenantQuery, tenantHeader);
    const effectiveFolderId =
      folderId === "" || folderId === undefined || folderId === "null" ? null : folderId;

    // Defense in depth: explicit tenant filter on top of RLS so a
    // misconfigured policy can never cross-leak. Soft-deleted rows
    // are skipped by the `deletedAt: null` predicate.
    const rows = await this.prisma.file.findMany({
      where: {
        tenantId,
        folderId: effectiveFolderId,
        deletedAt: null,
      },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
        updatedAt: true,
        folderId: true,
        storageKey: true,
      },
    });

    const search$1 = search ?? undefined;
    const mime$1 = mimeTypePrefix ?? undefined;
    const sortKey = parseSortKey(sortBy);
    const direction = sortDirection === "desc" ? "desc" : "asc";
    const limit = parsePositiveInt(limitRaw);

    const filtered = applyFileSearch(
      rows.map((r) => ({
        id: r.id,
        filename: r.filename,
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        folderId: r.folderId,
        storageKey: r.storageKey,
      })),
      {
        ...(search$1 !== undefined ? { search: search$1 } : {}),
        ...(mime$1 !== undefined ? { mimeTypePrefix: mime$1 } : {}),
        ...(sortKey !== undefined ? { sortBy: sortKey } : {}),
        sortDirection: direction,
        ...(limit !== undefined ? { limit } : {}),
      },
    );

    const files: FileListEntry[] = filtered.map((f) => {
      const entry: FileListEntry = {
        id: f.id,
        filename: f.filename,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
        folderId: f.folderId,
        storageKey: f.storageKey,
      };
      const thumb = thumbnailUrlFor(f.mimeType, f.storageKey);
      if (thumb !== undefined) entry.thumbnailUrl = thumb;
      return entry;
    });

    return { files, totalCount: rows.length };
  }

  @Get("breadcrumb.json")
  async breadcrumb(
    @Query("tenantId") tenantQuery: string | undefined,
    @Query("folderId") folderId: string | undefined,
    @Headers("x-tenant-id") tenantHeader: string | undefined,
  ): Promise<BreadcrumbResponse> {
    this.assertDev();
    const tenantId = this.resolveTenantId(tenantQuery, tenantHeader);
    const activeId = folderId === "" || folderId === undefined ? null : folderId;
    if (activeId === null) {
      return { segments: buildFolderBreadcrumb({ activeId: null, folders: [] }) };
    }
    const folders = (await this.prisma.folder.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, parentId: true, tenantId: true },
    })) as BreadcrumbInput[];
    return { segments: buildFolderBreadcrumb({ activeId, folders }) };
  }

  private assertDev(): void {
    const cfg = serverConfigFromEnv(process.env);
    if (cfg.env !== "development") {
      throw new NotFoundException();
    }
  }

  /**
   * `/dev/*` paths are exempt from the TenantInterceptor (see
   * `tenant-guard.ts`'s `EXEMPT_PREFIXES`), so the AsyncLocalStorage
   * is empty for these handlers. We read the header directly and let
   * the caller override via `?tenantId=` for ease of debugging from
   * the React page.
   *
   * Defense in depth: explicit UUID check on the resolved value so a
   * misbehaving operator cannot smuggle a non-UUID into Prisma queries.
   */
  private resolveTenantId(queryParam: string | undefined, headerValue: string | undefined): string {
    const candidate = (queryParam ?? headerValue ?? "").trim();
    if (!candidate) {
      throw new BadRequestException("tenantId required (header or ?tenantId=)");
    }
    if (!isUuid(candidate)) {
      throw new BadRequestException("tenantId must be a UUID");
    }
    return candidate;
  }
}

function parseSortKey(value: string | undefined): FileSearchSortKey | undefined {
  if (value === undefined) return undefined;
  const allowed: ReadonlySet<FileSearchSortKey> = new Set([
    "name",
    "size",
    "createdAt",
    "updatedAt",
    "mimeType",
  ]);
  return allowed.has(value as FileSearchSortKey) ? (value as FileSearchSortKey) : undefined;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return undefined;
  return n;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Build the IPX thumbnail URL for an image file. Non-image MIME types
 * yield `undefined` so the React grid falls back to the icon-by-mime
 * placeholder instead of a broken `<img>`.
 *
 * Path shape: `/_ipx/<modifiers>/files/<storageKey>` per issue #17 +
 * #18 spec. The `preset_thumbnail` modifier resolves to the `thumbnail`
 * preset (200×200 cover WebP) registered in `asset-presets.ts`.
 */
export function thumbnailUrlFor(mimeType: string, storageKey: string): string | undefined {
  if (!mimeType.toLowerCase().startsWith("image/")) return undefined;
  // Each segment of the storage key may contain `/`; we encode the
  // whole thing as a single URI component so the IPX router treats it
  // as the source identifier.
  const encoded = storageKey
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  return `/_ipx/preset_thumbnail/files/${encoded}`;
}
