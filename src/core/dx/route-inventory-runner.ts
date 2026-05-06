import { Inject, Injectable } from "@nestjs/common";
import { DiscoveryService, MetadataScanner } from "@nestjs/core";
import { PATH_METADATA, METHOD_METADATA } from "@nestjs/common/constants.js";
import { RequestMethod } from "@nestjs/common";

import { CAN_METADATA_KEY, type CanMetadata } from "../permissions/can.guard.js";
import { buildRouteInventory, type RouteInput, type RouteInventory } from "./route-inventory.js";

/**
 * Runtime introspection of every route currently registered in the
 * NestJS app. Walks DiscoveryService's controller wrappers, reads
 * `path` + `method` metadata from each handler, and pulls the
 * `@Can()` metadata when present.
 *
 * The `buildRouteInventory()` planner does the rest (sorting,
 * grouping, summary counts). This runner stays IO-free and small.
 */
@Injectable()
export class RouteInventoryService {
  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(MetadataScanner) private readonly scanner: MetadataScanner,
  ) {}

  build(): RouteInventory {
    void this.scanner;
    const routes: RouteInput[] = [];
    const controllers = this.discovery.getControllers();
    for (const wrapper of controllers) {
      const instance = wrapper.instance as object | null;
      if (!instance) continue;
      const ctor = (instance as { constructor?: { name?: string } }).constructor;
      const controllerName = ctor?.name ?? "anonymous";
      const proto = Object.getPrototypeOf(instance) ?? {};

      // Controller-level path prefix
      const basePath = (Reflect.getMetadata(PATH_METADATA, ctor as object) as string) || "";

      const methodNames = Object.getOwnPropertyNames(proto).filter((n) => n !== "constructor");
      for (const handler of methodNames) {
        const target = (proto as Record<string, unknown>)[handler];
        if (typeof target !== "function") continue;
        const handlerPath = Reflect.getMetadata(PATH_METADATA, target) as
          | string
          | string[]
          | undefined;
        const requestMethod = Reflect.getMetadata(METHOD_METADATA, target) as number | undefined;
        if (handlerPath === undefined || requestMethod === undefined) continue;

        const httpMethod = mapMethod(requestMethod);
        if (!httpMethod) continue;

        const paths = Array.isArray(handlerPath) ? handlerPath : [handlerPath];
        for (const p of paths) {
          const fullPath = joinPath(basePath, p);
          const canMetadata = Reflect.getMetadata(CAN_METADATA_KEY, target) as
            | CanMetadata
            | undefined;
          routes.push({
            method: httpMethod,
            path: fullPath,
            controller: controllerName,
            handler,
            ...(canMetadata
              ? {
                  canMetadata: {
                    action: String(canMetadata.action),
                    subject: String(canMetadata.subject),
                  },
                }
              : {}),
          });
        }
      }
    }
    return buildRouteInventory({
      routes,
      // Routes that legitimately don't carry @Can(). Two kinds:
      //   - `public`   → serves anonymous traffic by design
      //   - `dev-only` → assertDev() throws 404 in production
      // Keep this list tight — it's the seam an auditor checks first.
      publicAllowlist: [
        { prefix: "/health/", kind: "public" },
        // Note: these are raw controller paths (before the global /api/ prefix)
        { prefix: "/openapi", kind: "public" },
        { prefix: "/docs", kind: "public" },
        // BetterAuthController uses @Controller("auth") — raw path is /auth/
        { prefix: "/auth/", kind: "public" },
        { prefix: "/errors", kind: "public" },
        { prefix: "/dev", kind: "dev-only" },
        { prefix: "/admin", kind: "dev-only" },
      ],
    });
  }
}

function mapMethod(rm: number): string | null {
  switch (rm) {
    case RequestMethod.GET:
      return "GET";
    case RequestMethod.POST:
      return "POST";
    case RequestMethod.PUT:
      return "PUT";
    case RequestMethod.DELETE:
      return "DELETE";
    case RequestMethod.PATCH:
      return "PATCH";
    case RequestMethod.OPTIONS:
      return "OPTIONS";
    case RequestMethod.HEAD:
      return "HEAD";
    case RequestMethod.ALL:
      return "ALL";
    default:
      return null;
  }
}

function joinPath(base: string, handler: string): string {
  const b = (base.startsWith("/") ? base : `/${base}`).replace(/\/$/, "");
  const h = handler.startsWith("/") ? handler : `/${handler}`;
  const joined = `${b}${h}`.replace(/\/{2,}/g, "/");
  return joined.length > 1 && joined.endsWith("/") ? joined.slice(0, -1) : joined;
}
