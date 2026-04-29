import { Controller, Get, Inject, NotFoundException, Param, Query } from '@nestjs/common';

import { ERROR_CODE_REGISTRY, type ErrorCodeRegistry } from './error-code.token.js';
import {
  type ErrorCodeDefinition,
  ErrorCodeNotFoundError,
  type ResolvedErrorMessage,
} from './error-code-registry.js';

const DEFAULT_LOCALE = 'en';

/**
 * `/errors` — public catalogue of error codes the API can emit.
 *
 * Frontends use this to map `ProblemDetails.code` to localised user
 * messages. SDK generators (kubb) embed the catalogue as a TypeScript
 * union so callers get autocomplete on `code`.
 *
 * Public route by design: error documentation is not sensitive — the
 * registry contains `code`, status, and i18n strings only.
 */
@Controller('errors')
export class ErrorCodeController {
  constructor(@Inject(ERROR_CODE_REGISTRY) private readonly registry: ErrorCodeRegistry) {}

  @Get()
  list(): ErrorCodeDefinition[] {
    return this.registry.list();
  }

  @Get(':code')
  resolve(@Param('code') code: string, @Query('locale') locale?: string): ResolvedErrorMessage {
    try {
      return this.registry.resolve(code, locale ?? DEFAULT_LOCALE, {});
    } catch (err) {
      if (err instanceof ErrorCodeNotFoundError) {
        throw new NotFoundException({ code: 'CORE_NOT_FOUND', detail: `unknown error code: ${code}` });
      }
      throw err;
    }
  }
}
