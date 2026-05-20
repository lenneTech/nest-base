import { describe, expect, it } from "vitest";

import { compareTableValues, sortTableRows } from "../../src/core/dx/clients/lib/use-table-sort.js";

describe("compareTableValues", () => {
  it("sorts strings with localeCompare", () => {
    expect(compareTableValues("b", "a")).toBeGreaterThan(0);
    expect(compareTableValues("a", "b")).toBeLessThan(0);
  });

  it("sorts numbers numerically", () => {
    expect(compareTableValues(2, 10)).toBeLessThan(0);
    expect(compareTableValues(10, 2)).toBeGreaterThan(0);
  });

  it("sorts booleans as false before true", () => {
    expect(compareTableValues(false, true)).toBeLessThan(0);
    expect(compareTableValues(true, false)).toBeGreaterThan(0);
  });

  it("sorts ISO date strings chronologically", () => {
    expect(
      compareTableValues("2024-01-02T00:00:00.000Z", "2024-01-01T00:00:00.000Z"),
    ).toBeGreaterThan(0);
  });

  it("places nullish values last regardless of the other operand", () => {
    expect(compareTableValues(null, "a")).toBeGreaterThan(0);
    expect(compareTableValues(undefined, 1)).toBeGreaterThan(0);
    expect(compareTableValues("a", null)).toBeLessThan(0);
  });
});

describe("sortTableRows", () => {
  const rows = [
    { name: "Charlie", count: 3, createdAt: "2024-03-01T00:00:00.000Z", note: null },
    { name: "Alice", count: 1, createdAt: "2024-01-01T00:00:00.000Z", note: "x" },
    { name: "Bob", count: 2, createdAt: "2024-02-01T00:00:00.000Z", note: null },
  ];

  it("returns a copy unchanged when no sort key is active", () => {
    const sorted = sortTableRows(rows, null, "asc");
    expect(sorted).toEqual(rows);
    expect(sorted).not.toBe(rows);
  });

  it("sorts ascending by string key", () => {
    expect(sortTableRows(rows, "name", "asc").map((row) => row.name)).toEqual([
      "Alice",
      "Bob",
      "Charlie",
    ]);
  });

  it("sorts descending by number key", () => {
    expect(sortTableRows(rows, "count", "desc").map((row) => row.count)).toEqual([3, 2, 1]);
  });

  it("sorts by ISO date key", () => {
    expect(sortTableRows(rows, "createdAt", "asc").map((row) => row.name)).toEqual([
      "Alice",
      "Bob",
      "Charlie",
    ]);
  });

  it("keeps nullish values last in ascending order", () => {
    const sorted = sortTableRows(rows, "note", "asc").map((row) => row.name);
    expect(sorted[0]).toBe("Alice");
    expect(sorted.slice(1).sort()).toEqual(["Bob", "Charlie"]);
  });

  it("supports custom getValue resolver", () => {
    const sorted = sortTableRows(rows, "label", "asc", (row) => row.name.toLowerCase());
    expect(sorted.map((row) => row.name)).toEqual(["Alice", "Bob", "Charlie"]);
  });
});
