import { Module } from "@nestjs/common";

import { ErrorCodeController } from "./error-code.controller.js";
import { ErrorCodeRegistry } from "./error-code-registry.js";
import { ERROR_CODE_REGISTRY } from "./error-code.token.js";
import { CORE_ERROR_CODES } from "./error-code.js";

/**
 * ErrorCodesModule — seeds the registry with the CORE_* defaults +
 * mounts `GET /errors` and `GET /errors/{code}` for client tooling.
 *
 * Project-specific codes register themselves in their own module via
 * `app.get(ERROR_CODE_REGISTRY).register({...})` from `OnModuleInit`.
 */
@Module({
  controllers: [ErrorCodeController],
  providers: [
    {
      provide: ERROR_CODE_REGISTRY,
      useFactory: (): ErrorCodeRegistry => {
        const registry = new ErrorCodeRegistry();
        seedCoreCodes(registry);
        return registry;
      },
    },
  ],
  exports: [ERROR_CODE_REGISTRY],
})
export class ErrorCodesModule {}

function seedCoreCodes(registry: ErrorCodeRegistry): void {
  registry.register({
    code: CORE_ERROR_CODES.INTERNAL,
    status: 500,
    messages: {
      en: { title: "Internal Server Error", detail: "Something went wrong on our end." },
      de: { title: "Interner Serverfehler", detail: "Auf unserer Seite ist etwas schiefgelaufen." },
    },
  });
  registry.register({
    code: CORE_ERROR_CODES.NOT_FOUND,
    status: 404,
    messages: {
      en: { title: "Not Found", detail: "The requested resource does not exist." },
      de: { title: "Nicht gefunden", detail: "Die angeforderte Ressource existiert nicht." },
    },
  });
  registry.register({
    code: CORE_ERROR_CODES.UNAUTHORIZED,
    status: 401,
    messages: {
      en: { title: "Unauthorized", detail: "Authentication is required." },
      de: { title: "Nicht authentifiziert", detail: "Authentifizierung ist erforderlich." },
    },
  });
  registry.register({
    code: CORE_ERROR_CODES.FORBIDDEN,
    status: 403,
    messages: {
      en: { title: "Forbidden", detail: "You do not have permission to access this resource." },
      de: { title: "Verboten", detail: "Du hast keine Berechtigung für diese Ressource." },
    },
  });
  registry.register({
    code: CORE_ERROR_CODES.VALIDATION,
    status: 400,
    messages: {
      en: { title: "Validation Error", detail: "The request payload failed validation." },
      de: {
        title: "Validierungsfehler",
        detail: "Die Anfrage hat die Validierung nicht bestanden.",
      },
    },
  });
  registry.register({
    code: CORE_ERROR_CODES.CONFLICT,
    status: 409,
    messages: {
      en: { title: "Conflict", detail: "The request conflicts with the current state." },
      de: { title: "Konflikt", detail: "Die Anfrage konfligiert mit dem aktuellen Zustand." },
    },
  });
  registry.register({
    code: CORE_ERROR_CODES.RATE_LIMITED,
    status: 429,
    messages: {
      en: { title: "Too Many Requests", detail: "Rate limit exceeded; slow down and retry later." },
      de: {
        title: "Zu viele Anfragen",
        detail: "Rate-Limit erreicht; bitte später erneut versuchen.",
      },
    },
  });
}
