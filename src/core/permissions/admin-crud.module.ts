import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Module,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";

interface IdRecord {
  id: string;
  [key: string]: unknown;
}

class InMemoryStore<T extends IdRecord> {
  private readonly map = new Map<string, T>();
  list(): T[] {
    return [...this.map.values()];
  }
  get(id: string): T | undefined {
    return this.map.get(id);
  }
  insert(record: T): T {
    this.map.set(record.id, record);
    return record;
  }
  delete(id: string): boolean {
    return this.map.delete(id);
  }
}

const ROLES = new InMemoryStore<IdRecord>();
const POLICIES = new InMemoryStore<IdRecord>();
const PERMISSIONS = new InMemoryStore<IdRecord>();

function makeId(): string {
  return crypto.randomUUID();
}

abstract class CrudController {
  protected abstract store: InMemoryStore<IdRecord>;

  protected listImpl(): IdRecord[] {
    return this.store.list();
  }

  protected createImpl(body: Record<string, unknown>): IdRecord {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("body must be an object");
    }
    const id = (body.id as string) ?? makeId();
    return this.store.insert({ ...body, id });
  }

  protected getImpl(id: string): IdRecord {
    const record = this.store.get(id);
    if (!record) throw new NotFoundException(`not found: ${id}`);
    return record;
  }

  protected deleteImpl(id: string): { removed: boolean } {
    return { removed: this.store.delete(id) };
  }
}

@Controller("admin/roles")
class RoleAdminController extends CrudController {
  protected store = ROLES;

  @Get() list(): IdRecord[] {
    return this.listImpl();
  }
  @Post() create(@Body() body: Record<string, unknown>): IdRecord {
    return this.createImpl(body);
  }
  @Get(":id") get(@Param("id") id: string): IdRecord {
    return this.getImpl(id);
  }
  @Delete(":id") remove(@Param("id") id: string): { removed: boolean } {
    return this.deleteImpl(id);
  }
}

@Controller("admin/policies")
class PolicyAdminController extends CrudController {
  protected store = POLICIES;

  @Get() list(): IdRecord[] {
    return this.listImpl();
  }
  @Post() create(@Body() body: Record<string, unknown>): IdRecord {
    return this.createImpl(body);
  }
  @Get(":id") get(@Param("id") id: string): IdRecord {
    return this.getImpl(id);
  }
  @Delete(":id") remove(@Param("id") id: string): { removed: boolean } {
    return this.deleteImpl(id);
  }
}

@Controller("admin/permissions")
class PermissionAdminController extends CrudController {
  protected store = PERMISSIONS;

  @Get() list(): IdRecord[] {
    return this.listImpl();
  }
  @Post() create(@Body() body: Record<string, unknown>): IdRecord {
    return this.createImpl(body);
  }
  @Get(":id") get(@Param("id") id: string): IdRecord {
    return this.getImpl(id);
  }
  @Delete(":id") remove(@Param("id") id: string): { removed: boolean } {
    return this.deleteImpl(id);
  }

  @Post("test")
  test(@Body() body: { userId: string; tenantId: string; action: string; subject: string }): {
    ok: true;
    request: typeof body;
    rules: IdRecord[];
  } {
    if (!body?.userId || !body?.tenantId || !body?.action || !body?.subject) {
      throw new BadRequestException("userId, tenantId, action, subject are required");
    }
    // Stub: returns the registered permission rules. Real evaluation hooks
    // into PermissionService once a Prisma-backed PermissionStorage lands.
    return { ok: true, request: body, rules: PERMISSIONS.list() };
  }
}

/**
 * AdminCrudModule — `/admin/{roles,policies,permissions}` CRUD plus
 * `POST /admin/permissions/test`. Storage is process-local; Prisma-
 * backed adapters land with the auth-schema migration.
 */
@Module({
  controllers: [RoleAdminController, PolicyAdminController, PermissionAdminController],
})
export class AdminCrudModule {}
