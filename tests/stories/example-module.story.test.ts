/**
 * Story tests for the slim Example module — exercise the service
 * against the in-memory `FakePrismaService` so the tests run fast
 * without booting a Postgres container.
 *
 * The same shape applies to your real modules: instantiate the
 * fake, cast it to `PrismaService`, instantiate the service, assert
 * tenant-isolation, list filtering, not-found errors.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  CreateExampleSchema,
  ListExampleQuerySchema,
} from "../../src/modules/example/example.dto.js";
import { ExampleNotFoundError, ExampleService } from "../../src/modules/example/example.service.js";
import { asPrismaService, createFakePrisma } from "../lib/fake-prisma.js";

const TENANT_A = "00000000-0000-7000-8000-00000000000a";
const TENANT_B = "00000000-0000-7000-8000-00000000000b";

function makeService(): ExampleService {
  return new ExampleService(asPrismaService(createFakePrisma()));
}

describe("Story · Example module", () => {
  let service: ExampleService;

  beforeEach(() => {
    service = makeService();
  });

  describe("create", () => {
    it("inserts a record and returns the response shape", async () => {
      const out = await service.create(TENANT_A, {
        name: "Example one",
        description: "A first example",
        status: "draft",
      });
      expect(out).toMatchObject({
        name: "Example one",
        description: "A first example",
        status: "draft",
      });
      expect(out.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("uses the schema default for status when omitted", () => {
      const parsed = CreateExampleSchema.parse({ name: "x" });
      expect(parsed.status).toBe("draft");
    });
  });

  describe("list", () => {
    it("returns only the calling tenant's records", async () => {
      await service.create(TENANT_A, { name: "A", status: "draft" });
      await service.create(TENANT_B, { name: "B", status: "draft" });
      const page = await service.list(TENANT_A, { limit: 20 });
      expect(page.items.map((r) => r.name)).toEqual(["A"]);
    });

    it("filters by status", async () => {
      await service.create(TENANT_A, { name: "draft", status: "draft" });
      await service.create(TENANT_A, { name: "published", status: "published" });
      const page = await service.list(TENANT_A, { limit: 20, status: "published" });
      expect(page.items.map((r) => r.name)).toEqual(["published"]);
    });

    it("paginates with cursor", async () => {
      for (let i = 0; i < 5; i++) {
        // Stagger createdAt so the order-by is deterministic in the
        // fake (which only knows the values we pass it).
        await new Promise((r) => setTimeout(r, 2));
        await service.create(TENANT_A, { name: `n${i}`, status: "draft" });
      }
      const first = await service.list(TENANT_A, { limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).toBeDefined();

      const second = await service.list(TENANT_A, {
        limit: 2,
        cursor: first.items[first.items.length - 1]!.id,
      });
      expect(second.items).toHaveLength(2);
      const firstIds = new Set(first.items.map((r) => r.id));
      for (const id of second.items.map((r) => r.id)) expect(firstIds.has(id)).toBe(false);
    });

    it("query schema coerces string limit to number", () => {
      const parsed = ListExampleQuerySchema.parse({ limit: "30" });
      expect(parsed.limit).toBe(30);
    });
  });

  describe("findById", () => {
    it("returns the record when it exists in the same tenant", async () => {
      const created = await service.create(TENANT_A, { name: "x", status: "draft" });
      const found = await service.findById(TENANT_A, created.id);
      expect(found.id).toBe(created.id);
    });

    it("throws ExampleNotFoundError when the tenant doesn't match", async () => {
      const created = await service.create(TENANT_A, { name: "x", status: "draft" });
      await expect(service.findById(TENANT_B, created.id)).rejects.toBeInstanceOf(
        ExampleNotFoundError,
      );
    });

    it("throws ExampleNotFoundError on missing id", async () => {
      await expect(service.findById(TENANT_A, "no-such-id")).rejects.toBeInstanceOf(
        ExampleNotFoundError,
      );
    });
  });

  describe("update", () => {
    it("patches only the supplied fields", async () => {
      const created = await service.create(TENANT_A, {
        name: "old",
        description: "keep me",
        status: "draft",
      });
      const updated = await service.update(TENANT_A, created.id, { name: "new" });
      expect(updated.name).toBe("new");
      expect(updated.description).toBe("keep me");
      expect(updated.status).toBe("draft");
    });

    it("bumps updatedAt", async () => {
      const created = await service.create(TENANT_A, { name: "x", status: "draft" });
      await new Promise((r) => setTimeout(r, 2));
      const updated = await service.update(TENANT_A, created.id, { name: "y" });
      expect(updated.updatedAt > created.updatedAt).toBe(true);
    });

    it("rejects when the record belongs to another tenant", async () => {
      const created = await service.create(TENANT_A, { name: "x", status: "draft" });
      await expect(service.update(TENANT_B, created.id, { name: "y" })).rejects.toBeInstanceOf(
        ExampleNotFoundError,
      );
    });
  });

  describe("remove", () => {
    it("deletes the record and a subsequent fetch throws", async () => {
      const created = await service.create(TENANT_A, { name: "x", status: "draft" });
      await service.remove(TENANT_A, created.id);
      await expect(service.findById(TENANT_A, created.id)).rejects.toBeInstanceOf(
        ExampleNotFoundError,
      );
    });

    it("rejects deletes from another tenant", async () => {
      const created = await service.create(TENANT_A, { name: "x", status: "draft" });
      await expect(service.remove(TENANT_B, created.id)).rejects.toBeInstanceOf(
        ExampleNotFoundError,
      );
    });
  });
});
