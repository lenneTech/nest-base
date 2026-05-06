/**
 * Story · User admin planner (issue #86).
 *
 * Pure unit tests for `filterUsers()` — the planner that drives the
 * `/admin/users` search logic. No I/O, no NestJS booting.
 *
 * Covered cases:
 *   - Empty query returns all users (up to limit)
 *   - Query matching email substring is included
 *   - Query matching name substring is included
 *   - Query matching neither email nor name is excluded
 *   - Matching is case-insensitive
 *   - Limit cap is respected (default 50)
 */
import { describe, expect, it } from "vitest";

import { filterUsers } from "../../src/core/dx/user-admin-planner.js";

const USERS = [
  { id: "1", email: "alice@example.com", name: "Alice Archer", banned: false },
  { id: "2", email: "bob@example.com", name: "Bob Builder", banned: false },
  { id: "3", email: "carol@example.com", name: "Carol Crown", banned: true },
  { id: "4", email: "dave@example.com", name: null, banned: false },
] as const;

describe("Story · user-admin-planner · filterUsers", () => {
  it("empty query returns all users", () => {
    const result = filterUsers({ query: "", users: USERS });
    expect(result).toHaveLength(4);
  });

  it("query matches email substring and returns matching user", () => {
    const result = filterUsers({ query: "alice@", users: USERS });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("query matches name substring and returns matching user", () => {
    const result = filterUsers({ query: "Builder", users: USERS });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
  });

  it("query matching neither email nor name excludes user", () => {
    const result = filterUsers({ query: "zzznomatch", users: USERS });
    expect(result).toHaveLength(0);
  });

  it("matching is case-insensitive on email", () => {
    const result = filterUsers({ query: "ALICE@EXAMPLE", users: USERS });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("matching is case-insensitive on name", () => {
    const result = filterUsers({ query: "carol crown", users: USERS });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("3");
  });

  it("users with null name still match by email", () => {
    const result = filterUsers({ query: "dave@", users: USERS });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("4");
  });

  it("users with null name are not crashed on name query that doesn't match", () => {
    const result = filterUsers({ query: "SomeNameSearch", users: USERS });
    // Only non-null names are checked; dave (null) shouldn't crash the loop
    expect(result).toHaveLength(0);
  });

  it("limit cap is respected", () => {
    const manyUsers = Array.from({ length: 60 }, (_, i) => ({
      id: String(i),
      email: `user${i}@example.com`,
      name: `User ${i}`,
      banned: false,
    }));
    const result = filterUsers({ query: "", users: manyUsers, limit: 50 });
    expect(result).toHaveLength(50);
  });

  it("custom limit smaller than result set is respected", () => {
    const result = filterUsers({ query: "", users: USERS, limit: 2 });
    expect(result).toHaveLength(2);
  });

  it("default limit is 50", () => {
    const manyUsers = Array.from({ length: 60 }, (_, i) => ({
      id: String(i),
      email: `u${i}@x.com`,
      name: null,
      banned: false,
    }));
    const result = filterUsers({ query: "", users: manyUsers });
    expect(result).toHaveLength(50);
  });
});
