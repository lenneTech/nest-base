import { Module } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";
import { type ResourceSearchExecutor } from "./cross-resource-search.js";
import { SearchController } from "./search.controller.js";
import { SEARCH_EXECUTORS, SearchService } from "./search.service.js";
import { PrismaUserSearchExecutor } from "./user-search.executor.js";

/**
 * SearchModule — exposes `GET /search?q=…&limit=…&only=table1,table2`.
 *
 * Resource executors are collected via the `SEARCH_EXECUTORS` token.
 * The default registration ships one executor — `PrismaUserSearchExecutor`
 * (Postgres FTS over `users.email + users.name` with `ts_rank` ordering
 * and `ts_headline` highlighting). Project domain modules append
 * additional executors via the standard NestJS multi-provider pattern.
 */
@Module({
  controllers: [SearchController],
  providers: [
    PrismaUserSearchExecutor,
    {
      provide: SEARCH_EXECUTORS,
      useFactory: (userSearch: PrismaUserSearchExecutor): readonly ResourceSearchExecutor[] => [
        userSearch,
      ],
      inject: [PrismaUserSearchExecutor],
    },
    SearchService,
  ],
  exports: [SearchService, SEARCH_EXECUTORS],
})
export class SearchModule {
  // Mark PrismaService as required so the factory injection above
  // resolves. Listed via the `PrismaUserSearchExecutor` constructor.
  static readonly _prismaDependency = PrismaService;
}

export { SearchService, SEARCH_EXECUTORS } from "./search.service.js";
