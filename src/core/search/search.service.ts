import { Inject, Injectable } from "@nestjs/common";

import {
  CrossResourceSearchService,
  type ResourceSearchExecutor,
  type SearchHit,
  type SearchOptions,
} from "./cross-resource-search.js";

export const SEARCH_EXECUTORS = Symbol.for("lt:SearchExecutors");

@Injectable()
export class SearchService {
  private readonly underlying: CrossResourceSearchService;

  constructor(@Inject(SEARCH_EXECUTORS) executors: readonly ResourceSearchExecutor[]) {
    this.underlying = new CrossResourceSearchService(executors);
  }

  search(query: string, options: SearchOptions): Promise<SearchHit[]> {
    return this.underlying.search(query, options);
  }
}
