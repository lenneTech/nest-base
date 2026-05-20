import {
  DEFAULT_MEMBER_PER_USER_RESOURCES,
  DEFAULT_MEMBER_RESOURCES,
} from "./member-role-rules.js";
import { collectGatedAbilitySubjects } from "./route-audit-planner.js";

/**
 * Framework / admin CASL subjects that are not project-facing member
 * resources but still appear on `@Can()` handlers. Kept explicit so the
 * permissions matrix lists every operator-relevant subject even before
 * a tenant seeds permission rows.
 */
export const FRAMEWORK_ABILITY_SUBJECTS = [
  "Account",
  "Asset",
  "AuditLogAdmin",
  "EmailOutboxAdmin",
  "GdprData",
  "Geo",
  "Hub",
  "Permission",
  "PermissionsAdmin",
  "Policy",
  "PowerSync",
  "RateLimitAdmin",
  "Role",
  "Search",
  "Session",
  "Tenant",
  "TenantAdmin",
  "User",
  "WebhookEndpoint",
] as const;

/** Subjects that should never appear as matrix rows. */
const MATRIX_EXCLUDED_SUBJECTS = new Set(["all"]);

export interface AbilitySubjectCatalogInput {
  /** Extra resources from `PermissionsModule.forFeature()` / app overrides. */
  extraTenantResources?: readonly string[];
  extraUserResources?: readonly string[];
  /**
   * Subjects discovered from the route-gating audit (`@Can` decorators).
   * When omitted, only the static catalog is returned.
   */
  auditedSubjects?: readonly string[];
}

/**
 * Canonical sorted list of CASL subjects for the permissions matrix.
 * Merges member defaults, framework admin subjects, optional extras,
 * and every gated route subject from the audit planner.
 */
export function buildAbilitySubjectCatalog(input: AbilitySubjectCatalogInput = {}): string[] {
  const set = new Set<string>();
  for (const resource of DEFAULT_MEMBER_RESOURCES) set.add(resource);
  for (const resource of DEFAULT_MEMBER_PER_USER_RESOURCES) set.add(resource);
  for (const subject of FRAMEWORK_ABILITY_SUBJECTS) set.add(subject);
  for (const resource of input.extraTenantResources ?? []) set.add(resource);
  for (const resource of input.extraUserResources ?? []) set.add(resource);
  for (const subject of input.auditedSubjects ?? []) set.add(subject);
  for (const excluded of MATRIX_EXCLUDED_SUBJECTS) set.delete(excluded);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/**
 * Build the catalog using a live route audit walk (runner-side only).
 * The matrix controller calls this once per request in development; the
 * walk is pure and fast enough for admin tooling.
 */
export function buildAbilitySubjectCatalogFromRepo(root: string): string[] {
  const auditedSubjects = collectGatedAbilitySubjects({ root });
  return buildAbilitySubjectCatalog({ auditedSubjects });
}
