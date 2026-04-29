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
  Query,
} from '@nestjs/common';

import {
  type CreateFileInput,
  type FileRecord,
  type FileServiceStorage,
  FileNotFoundError,
  FileService,
} from './file.service.js';
import {
  type FolderRecord,
  type FolderStorage,
  FolderNotFoundError,
  FolderService,
} from './folder.service.js';
import { AssetController } from './asset.controller.js';

const FILE_STORAGE = Symbol.for('lt:FileStorage');
const FOLDER_STORAGE = Symbol.for('lt:FolderStorage');

class InMemoryFileStorage implements FileServiceStorage {
  private readonly map = new Map<string, FileRecord>();
  async insert(r: FileRecord) {
    this.map.set(r.id, r);
    return r;
  }
  async findById(id: string) {
    return this.map.get(id) ?? null;
  }
  async listByFolder(tenantId: string, folderId: string | null) {
    return [...this.map.values()].filter((r) => r.tenantId === tenantId && r.folderId === folderId);
  }
  async update(id: string, patch: Partial<FileRecord>) {
    const r = this.map.get(id);
    if (!r) return null;
    const updated = { ...r, ...patch };
    this.map.set(id, updated);
    return updated;
  }
  async delete(id: string) {
    return this.map.delete(id);
  }
}

class InMemoryFolderStorage implements FolderStorage {
  private readonly map = new Map<string, FolderRecord>();
  async insert(r: FolderRecord) {
    this.map.set(r.id, r);
    return r;
  }
  async findById(id: string) {
    return this.map.get(id) ?? null;
  }
  async listByParent(tenantId: string, parentId: string | null) {
    return [...this.map.values()].filter((r) => r.tenantId === tenantId && r.parentId === parentId);
  }
  async update(id: string, patch: Partial<FolderRecord>) {
    const r = this.map.get(id);
    if (!r) return null;
    const updated = { ...r, ...patch };
    this.map.set(id, updated);
    return updated;
  }
  async delete(id: string) {
    return this.map.delete(id);
  }
}

@Controller('files')
class FileController {
  constructor(private readonly service: FileService) {}

  @Get()
  async list(
    @Query('tenantId') tenantId: string,
    @Query('folderId') folderId: string | undefined,
  ): Promise<FileRecord[]> {
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.service.listInFolder(
      tenantId,
      folderId === '' || folderId === undefined ? null : folderId,
    );
  }

  @Post()
  async create(@Body() body: CreateFileInput): Promise<FileRecord> {
    return this.service.create(body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ removed: boolean }> {
    try {
      await this.service.remove(id);
      return { removed: true };
    } catch (err) {
      if (err instanceof FileNotFoundError) throw new NotFoundException(err.message);
      throw err;
    }
  }
}

@Controller('folders')
class FolderController {
  constructor(private readonly service: FolderService) {}

  @Get()
  async list(
    @Query('tenantId') tenantId: string,
    @Query('parentId') parentId: string | undefined,
  ): Promise<FolderRecord[]> {
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.service.listChildren(
      tenantId,
      parentId === '' || parentId === undefined ? null : parentId,
    );
  }

  @Post()
  async create(@Body() body: { tenantId: string; parentId: string | null; name: string }): Promise<FolderRecord> {
    return this.service.create(body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ removed: boolean }> {
    try {
      await this.service.remove(id);
      return { removed: true };
    } catch (err) {
      if (err instanceof FolderNotFoundError) throw new NotFoundException(err.message);
      throw err;
    }
  }
}

/**
 * FilesModule — `/files` + `/folders` CRUD over in-memory storage.
 * S3/Local/Postgres-FileBlob adapters are wired via the existing
 * StorageAdapter abstraction; the module here only owns the metadata
 * tier. TUS uploads + sharp-backed asset transforms mount in their
 * own modules in follow-up slices.
 */
@Module({
  controllers: [FileController, FolderController, AssetController],
  providers: [
    { provide: FILE_STORAGE, useClass: InMemoryFileStorage },
    { provide: FOLDER_STORAGE, useClass: InMemoryFolderStorage },
    {
      provide: FileService,
      useFactory: (storage: FileServiceStorage) => new FileService(storage),
      inject: [FILE_STORAGE],
    },
    {
      provide: FolderService,
      useFactory: (storage: FolderStorage) => new FolderService(storage),
      inject: [FOLDER_STORAGE],
    },
  ],
  exports: [FileService, FolderService],
})
export class FilesModule {}
