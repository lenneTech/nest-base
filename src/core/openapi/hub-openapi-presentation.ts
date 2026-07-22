/**
 * Operator-facing OpenAPI labels for Hub/Admin SPA controllers.
 */
import type { OpenAPIObject } from "@nestjs/swagger";

const TAG_ALIASES: Record<string, string> = {
  DevFiles: "Hub",
  AdminSpa: "Admin",
  EmailOutboxAdmin: "Admin",
};

const OPERATION_ID_PREFIX_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["HubController_", "Hub_"],
  ["DevFilesController_", "HubFiles_"],
  ["AdminSpaController_", "Admin_"],
  ["EmailOutboxAdminController_", "EmailOutboxAdmin_"],
];

/** Rename legacy controller Swagger tags/operationIds to Hub-facing names. */
export function applyHubOpenApiPresentation(document: OpenAPIObject): void {
  if (document.tags) {
    for (const tag of document.tags) {
      const alias = TAG_ALIASES[tag.name];
      if (alias) tag.name = alias;
    }
  }

  if (!document.paths) return;

  for (const pathItem of Object.values(document.paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const operation of Object.values(pathItem)) {
      if (!operation || typeof operation !== "object") continue;
      if (!("tags" in operation) || !Array.isArray(operation.tags)) continue;

      operation.tags = operation.tags.map((tag: string) =>
        typeof tag === "string" ? (TAG_ALIASES[tag] ?? tag) : tag,
      );

      if (typeof operation.operationId === "string") {
        operation.operationId = renameOperationId(operation.operationId);
      }
    }
  }
}

function renameOperationId(operationId: string): string {
  for (const [from, to] of OPERATION_ID_PREFIX_ALIASES) {
    if (operationId.startsWith(from)) {
      return `${to}${operationId.slice(from.length)}`;
    }
  }
  return operationId;
}
