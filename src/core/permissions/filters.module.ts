import { Injectable, Module, type OnApplicationBootstrap } from "@nestjs/common";
import { DiscoveryModule, DiscoveryService } from "@nestjs/core";

import {
  FILTER_FOR_METADATA,
  type FilterService,
  FilterServiceRegistry,
} from "./filter-service.js";

export const FILTER_SERVICE_REGISTRY = Symbol.for("lt:FilterServiceRegistry");

@Injectable()
class FilterDiscoveryService implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly registry: FilterServiceRegistry,
  ) {}

  onApplicationBootstrap(): void {
    const providers = this.discovery.getProviders();
    for (const wrapper of providers) {
      const instance = wrapper.instance as unknown;
      if (!instance || typeof instance !== "object") continue;
      const ctor = (instance as { constructor?: unknown }).constructor;
      if (typeof ctor !== "function") continue;
      const subject = Reflect.getMetadata(FILTER_FOR_METADATA, ctor) as string | undefined;
      if (!subject) continue;
      // Avoid double-registration if multiple boots share a registry instance.
      try {
        this.registry.register(instance as FilterService<unknown>, ctor);
      } catch {
        // duplicate registration — ignore (idempotent boot)
      }
    }
  }
}

/**
 * FiltersModule — auto-discovers `@FilterFor()`-decorated providers
 * via `@nestjs/core`'s DiscoveryService and registers them in the
 * FilterServiceRegistry on `onApplicationBootstrap`.
 *
 * Consumers add `@FilterFor('Subject') @Injectable()` classes to any
 * imported feature module — discovery picks them up automatically.
 * `applyFilter(subject, value, ctx)` is then available via the
 * registry.
 */
@Module({
  imports: [DiscoveryModule],
  providers: [
    FilterServiceRegistry,
    FilterDiscoveryService,
    { provide: FILTER_SERVICE_REGISTRY, useExisting: FilterServiceRegistry },
  ],
  exports: [FilterServiceRegistry, FILTER_SERVICE_REGISTRY],
})
export class FiltersModule {}
