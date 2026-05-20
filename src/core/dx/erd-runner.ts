import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildErdFromSchema, type ErdPlan } from "./erd-builder.js";

/**
 * Thin runner that reads the active Prisma schema (concatenated by
 * `bun run prepare:schema`, falls back to the source `schema.prisma`
 * when the generated file is absent) and hands it to the planner.
 *
 * Errors land as a synthetic ErdPlan with an empty diagram so the
 * Hub page renders gracefully — we'd rather show "0 models" than
 * crash the page.
 */
export function buildErdForProject(projectRoot: string = process.cwd()): ErdPlan {
  const candidatePaths = [
    resolve(projectRoot, "prisma/schema.generated.prisma"),
    resolve(projectRoot, "prisma/schema.prisma"),
  ];
  for (const path of candidatePaths) {
    if (!existsSync(path)) continue;
    try {
      const source = readFileSync(path, "utf8");
      return buildErdFromSchema(source);
    } catch {
      // Fall through to next candidate / empty plan.
    }
  }
  return { mermaid: "erDiagram", modelCount: 0, relationCount: 0 };
}
