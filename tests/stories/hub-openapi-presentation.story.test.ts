import { describe, expect, it } from "vitest";

import { applyHubOpenApiPresentation } from "../../src/core/openapi/hub-openapi-presentation.js";

describe("Story · applyHubOpenApiPresentation", () => {
  it("renames Hub controller operationIds and DevFiles tags to Hub-facing labels", () => {
    const document = {
      tags: [{ name: "DevFiles" }, { name: "Example" }],
      paths: {
        "/hub/dashboard.json": {
          get: {
            tags: ["Hub"],
            operationId: "HubController_dashboardJson",
          },
        },
      },
    };

    applyHubOpenApiPresentation(document as never);

    expect(document.tags[0]!.name).toBe("Hub");
    expect(document.tags[1]!.name).toBe("Example");
    expect(document.paths["/hub/dashboard.json"]!.get!.tags).toEqual(["Hub"]);
    expect(document.paths["/hub/dashboard.json"]!.get!.operationId).toBe("Hub_dashboardJson");
  });
});
