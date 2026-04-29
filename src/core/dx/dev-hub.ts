import type { Features } from "../features/features.js";

/**
 * Dev-Hub planner (PLAN.md §27.4 + §32 Phase 8).
 *
 * Pure function: features + DX-tool configs → ordered link list for
 * the `/dev` landing page. The page itself is a thin controller that
 * calls this planner; keeping the planner I/O-free lets us evolve
 * link categorisation, gating, and ordering without booting NestJS
 * in the test suite.
 *
 * Categorisation mirrors PLAN.md §27.4's mockup: api → architecture
 * → data → async (the order users actually scan visually). Within a
 * category, links are alphabetical by label so toggling a feature
 * on/off doesn't shuffle the rest of the page.
 *
 * Production / test environments return an empty list — `/dev` is
 * a developer affordance and the controller itself is admin-gated,
 * but a missing list is one fewer attack surface.
 */

export type DevHubEnv = "development" | "production" | "test";
export type DevHubCategory = "api" | "architecture" | "data" | "async";

export interface DevHubLink {
  label: string;
  url: string;
  category: DevHubCategory;
}

export interface DevHubInput {
  env: DevHubEnv;
  features: Features;
  scalar?: { mountPath: string; specUrl?: string };
  devtools?: { enabled: boolean; port: number };
}

const CATEGORY_ORDER: DevHubCategory[] = ["api", "architecture", "data", "async"];

export function planDevHub(input: DevHubInput): DevHubLink[] {
  if (input.env !== "development") return [];

  const links: DevHubLink[] = [];

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
    url: "/admin/permissions/test",
    category: "api",
  });

  // architecture ------------------------------------------------------
  if (input.devtools?.enabled) {
    links.push({
      label: "NestJS DevTools",
      url: `http://localhost:${input.devtools.port}`,
      category: "architecture",
    });
  }
  links.push({
    label: "Active Features",
    url: "/dev/features",
    category: "architecture",
  });

  // data --------------------------------------------------------------
  links.push({
    label: "Audit Browser",
    url: "/admin/audit",
    category: "data",
  });

  // async -------------------------------------------------------------
  if (input.features.webhooks.enabled) {
    links.push({
      label: "Webhook Inspector",
      url: "/admin/webhooks",
      category: "async",
    });
  }
  if (input.features.realtime.enabled) {
    links.push({
      label: "Realtime Inspector",
      url: "/admin/realtime",
      category: "async",
    });
  }
  if (input.features.search.enabled) {
    links.push({
      label: "Search Tester",
      url: "/admin/search",
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
