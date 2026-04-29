import { Module } from '@nestjs/common';

import { type ResourceSearchExecutor } from './cross-resource-search.js';
import { SearchController } from './search.controller.js';
import { SEARCH_EXECUTORS, SearchService } from './search.service.js';

/**
 * SearchModule — exposes `GET /search?q=…&limit=…&only=table1,table2`.
 *
 * Resource executors are collected via the `SEARCH_EXECUTORS` token.
 * Default registration is empty (no resources searchable yet); domain
 * modules append executors via the standard NestJS multi-provider
 * pattern when their search migrations land.
 */
@Module({
  controllers: [SearchController],
  providers: [
    { provide: SEARCH_EXECUTORS, useValue: [] satisfies readonly ResourceSearchExecutor[] },
    SearchService,
  ],
  exports: [SearchService, SEARCH_EXECUTORS],
})
export class SearchModule {}

export { SearchService, SEARCH_EXECUTORS } from './search.service.js';
