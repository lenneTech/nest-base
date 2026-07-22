import type { Features } from "../features/features.js";

/**
 * Hub planner.
 *
 * Pure function: features + DX-tool configs → ordered link list for
 * the `/hub` landing page. The page itself is a thin controller that
 * calls this planner; keeping the planner I/O-free lets us evolve
 * link categorisation, gating, and ordering without booting NestJS
 * in the test suite.
 *
 * Categorisation: api → architecture → data → async (the order users
 * actually scan visually). Within a category, links are alphabetical
 * by label so toggling a feature on/off doesn't shuffle the rest of
 * the page.
 *
 * Production / test environments return an empty list — `/hub` is
 * a developer affordance and the controller itself is admin-gated,
 * but a missing list is one fewer attack surface.
 */

export type HubEnv = "development" | "production" | "test";
export type HubCategory = "api" | "architecture" | "data" | "async";

export interface HubLink {
  label: string;
  url: string;
  category: HubCategory;
}

export interface HubInput {
  env: HubEnv;
  features: Features;
  scalar?: { mountPath: string; specUrl?: string };
}

const CATEGORY_ORDER: HubCategory[] = ["api", "architecture", "data", "async"];

export function planHub(input: HubInput): HubLink[] {
  if (input.env !== "development") return [];

  const links: HubLink[] = [];

  // api ----------------------------------------------------------------
  if (input.scalar) {
    links.push({
      label: "Scalar API Reference",
      url: input.scalar.mountPath,
      category: "api",
    });
    if (input.scalar.specUrl) {
      links.push({
        label: "OpenAPI Spec (raw)",
        url: input.scalar.specUrl,
        category: "api",
      });
    }
  }
  links.push({
    label: "Permission Tester",
    url: "/hub/admin/permissions/test",
    category: "api",
  });

  // architecture ------------------------------------------------------
  links.push({
    label: "Active Features",
    url: "/hub/features",
    category: "architecture",
  });

  // data --------------------------------------------------------------
  if (input.features.audit.enabled) {
    links.push({
      label: "Audit Browser",
      url: "/hub/admin/audit",
      category: "data",
    });
  }

  // async -------------------------------------------------------------
  if (input.features.webhooks.enabled) {
    links.push({
      label: "Webhook Inspector",
      url: "/hub/admin/webhooks",
      category: "async",
    });
  }
  if (input.features.realtime.enabled) {
    links.push({
      label: "Realtime Inspector",
      url: "/hub/admin/realtime",
      category: "async",
    });
  }
  if (input.features.search.enabled) {
    links.push({
      label: "Search Tester",
      url: "/hub/admin/search",
      category: "async",
    });
  }

  // Stable order: category bucket first, alphabetical label within.
  return links.sort((a, b) => {
    const categoryDiff = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    if (categoryDiff !== 0) return categoryDiff;
    return a.label.localeCompare(b.label);
  });
}
