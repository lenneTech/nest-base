import "reflect-metadata";

/**
 * Filter-Service Pattern.
 *
 *   @FilterFor('Project')
 *   @Injectable()
 *   class ProjectFilter implements FilterService<Project> {
 *     async filter(value: Project, ctx: FilterContext): Promise<Project> {
 *       // resource-specific shape transformations live here
 *     }
 *   }
 *
 * The registry collects every `@FilterFor()`-decorated provider and
 * dispatches `applyFilter(subject, value, ctx)` to the matching one.
 * Use `FilterServiceRegistry.fromInstances()` to build a registry from
 * an injected provider list (a NestJS DiscoveryService binding lives
 * in the integration slice).
 */

export const FILTER_FOR_METADATA = "core:filter-for";

export type FilterContext = Record<string, unknown>;

export interface FilterService<T> {
  filter(value: T, ctx?: FilterContext): Promise<T> | T;
}

export const FilterFor = (subject: string): ClassDecorator => {
  return (target) => {
    Reflect.defineMetadata(FILTER_FOR_METADATA, subject, target);
  };
};

export interface DiscoveredEntry {
  instance: FilterService<unknown>;
  ctor: { new (...args: unknown[]): unknown } | Function;
}

export class FilterServiceRegistry {
  private readonly bySubject = new Map<string, FilterService<unknown>>();

  register(instance: FilterService<unknown>, ctor: Function): void {
    const subject = Reflect.getMetadata(FILTER_FOR_METADATA, ctor) as string | undefined;
    if (!subject) {
      throw new Error(`FilterServiceRegistry: ${ctor.name} is missing @FilterFor()`);
    }
    if (this.bySubject.has(subject)) {
      throw new Error(`FilterServiceRegistry: duplicate registration for subject "${subject}"`);
    }
    this.bySubject.set(subject, instance);
  }

  get(subject: string): FilterService<unknown> | undefined {
    return this.bySubject.get(subject);
  }

  async applyFilter<T>(subject: string, value: T, ctx?: FilterContext): Promise<T> {
    const svc = this.bySubject.get(subject);
    if (!svc) return value;
    return (await svc.filter(value, ctx)) as T;
  }

  static fromInstances(entries: DiscoveredEntry[]): FilterServiceRegistry {
    const reg = new FilterServiceRegistry();
    for (const { instance, ctor } of entries) {
      const subject = Reflect.getMetadata(FILTER_FOR_METADATA, ctor) as string | undefined;
      if (subject === undefined) continue;
      reg.register(instance, ctor);
    }
    return reg;
  }
}
