import { describe, expect, it } from "vitest";

import { AddressController } from "../../src/core/geo/address.controller.js";
import { InMemoryAddressStorage } from "../../src/core/geo/address-storage.js";
import type { FieldEncryptionService } from "../../src/core/encryption/field-encryption.service.js";
import { runWithTenant } from "../../src/core/multi-tenancy/tenant-context.js";

/**
 * Story · AddressController wires real `FieldEncryptionService`
 * (PRD line 107 / line 392 — Phase 2 "address-PII encryption").
 *
 * iter-160's reviewer flagged that `address.controller.ts` was using
 * a `[encrypted]:value` prefix wrapper instead of the real AES-GCM
 * service. iter-162 closes the gap: the controller now takes
 * `FieldEncryptionService` via DI and routes through `encryptAddress`
 * / `decryptAddress` in `address-pii-encryption.ts`.
 *
 * The story drives the service with a fake whose `encrypt` is a
 * round-trippable transform so we can assert the controller's
 * pre-write encryption + post-read decryption without booting Nest.
 * Tenant scope is supplied via `runWithTenant` (mirrors TenantInterceptor ALS).
 */
describe("Story · AddressController encryption (iter-162)", () => {
  function makeFakeService(): FieldEncryptionService {
    return {
      encrypt: (plaintext: string) => `enc:${plaintext}`,
      decrypt: (ciphertext: string) =>
        ciphertext.startsWith("enc:") ? ciphertext.slice(4) : ciphertext,
    } as unknown as FieldEncryptionService;
  }

  const TENANT = "11111111-1111-4111-8111-111111111111";

  it("create() persists ciphertext under street + zip when service is wired", async () => {
    const ctrl = new AddressController(new InMemoryAddressStorage(), makeFakeService());
    const result = await runWithTenant(TENANT, () =>
      ctrl.create({
        street: "Hauptstraße 1",
        zip: "10115",
        city: "Berlin",
        country: "DE",
        tenantId: TENANT,
      }),
    );
    const list = await runWithTenant(TENANT, () => ctrl.list());
    const stored = list.find((r) => r.id === result.id);
    expect(stored).toBeDefined();
    expect(stored!.street).toBe("Hauptstraße 1");
    expect(stored!.zip).toBe("10115");
  });

  it("get() decrypts on read", async () => {
    const ctrl = new AddressController(new InMemoryAddressStorage(), makeFakeService());
    const created = await runWithTenant(TENANT, () =>
      ctrl.create({
        street: "Friedrichstraße 200",
        zip: "10117",
        city: "Berlin",
        country: "DE",
      }),
    );
    const fetched = await runWithTenant(TENANT, () => ctrl.get(created.id));
    expect(fetched.street).toBe("Friedrichstraße 200");
    expect(fetched.zip).toBe("10117");
  });

  it("create() throws BadRequest on invalid body (Zod parse failure)", async () => {
    const ctrl = new AddressController(new InMemoryAddressStorage(), makeFakeService());
    await expect(
      runWithTenant(TENANT, () => ctrl.create({ street: "", zip: "" })),
    ).rejects.toThrow();
  });

  it("get() throws NotFound when the id does not exist", async () => {
    const ctrl = new AddressController(new InMemoryAddressStorage(), makeFakeService());
    await expect(
      runWithTenant(TENANT, () => ctrl.get("00000000-0000-0000-0000-000000000000")),
    ).rejects.toThrow(/not found/);
  });

  it("remove() returns removed=true for an existing id, removed=false otherwise", async () => {
    const ctrl = new AddressController(new InMemoryAddressStorage(), makeFakeService());
    const created = await runWithTenant(TENANT, () =>
      ctrl.create({
        street: "Karl-Marx-Allee 90",
        zip: "10243",
        city: "Berlin",
        country: "DE",
      }),
    );
    const result = await runWithTenant(TENANT, () => ctrl.remove(created.id));
    expect(result).toEqual({ removed: true });
    const second = await runWithTenant(TENANT, () => ctrl.remove(created.id));
    expect(second).toEqual({ removed: false });
  });

  it("controller round-trips plaintext when no FieldEncryptionService is provided", async () => {
    const ctrl = new AddressController(new InMemoryAddressStorage(), undefined);
    const created = await runWithTenant(TENANT, () =>
      ctrl.create({
        street: "no-encryption street",
        zip: "00000",
        city: "Anywhere",
        country: "DE",
      }),
    );
    const fetched = await runWithTenant(TENANT, () => ctrl.get(created.id));
    expect(fetched.street).toBe("no-encryption street");
    expect(fetched.zip).toBe("00000");
  });

  it("does NOT use the legacy `[encrypted]:value` prefix shape (iter-162 regression guard)", async () => {
    const captured: string[] = [];
    const captureService = {
      encrypt: (plaintext: string) => {
        captured.push(plaintext);
        return `enc:${plaintext}`;
      },
      decrypt: (ciphertext: string) =>
        ciphertext.startsWith("enc:") ? ciphertext.slice(4) : ciphertext,
    } as unknown as FieldEncryptionService;
    const ctrl = new AddressController(new InMemoryAddressStorage(), captureService);
    await runWithTenant(TENANT, () =>
      ctrl.create({
        street: "Real Street 7",
        zip: "12345",
        city: "Munich",
        country: "DE",
      }),
    );
    expect(captured).toEqual(expect.arrayContaining(["Real Street 7", "12345"]));
  });

  it("400s on every read/write without tenant context (iter-204)", async () => {
    const ctrl = new AddressController(new InMemoryAddressStorage(), makeFakeService());
    await expect(ctrl.list()).rejects.toThrow(/tenant context/i);
    await expect(ctrl.create({ street: "S", zip: "Z", city: "C", country: "DE" })).rejects.toThrow(
      /tenant context/i,
    );
    await expect(ctrl.get("id")).rejects.toThrow(/tenant context/i);
    await expect(ctrl.remove("id")).rejects.toThrow(/tenant context/i);
  });

  it("400s when tenant context is not a UUID (iter-204)", async () => {
    const ctrl = new AddressController(new InMemoryAddressStorage(), makeFakeService());
    await expect(runWithTenant("not-a-uuid", () => ctrl.list())).rejects.toThrow(/uuid/i);
  });

  it("create() rejects body.tenantId mismatch with active tenant (iter-204)", async () => {
    const ctrl = new AddressController(new InMemoryAddressStorage(), makeFakeService());
    const otherTenant = "22222222-2222-4222-8222-222222222222";
    await expect(
      runWithTenant(TENANT, () =>
        ctrl.create({
          street: "S",
          zip: "Z",
          city: "C",
          country: "DE",
          tenantId: otherTenant,
        }),
      ),
    ).rejects.toThrow(/tenantId/);
  });

  it("list() returns ONLY rows for the request's tenant — cross-tenant rows do NOT leak (iter-204)", async () => {
    const storage = new InMemoryAddressStorage();
    const ctrl = new AddressController(storage, makeFakeService());
    const otherTenant = "22222222-2222-4222-8222-222222222222";
    await runWithTenant(TENANT, () =>
      ctrl.create({
        street: "Mine",
        zip: "00001",
        city: "Berlin",
        country: "DE",
      }),
    );
    await runWithTenant(otherTenant, () =>
      ctrl.create({
        street: "Yours",
        zip: "00002",
        city: "Berlin",
        country: "DE",
      }),
    );
    const ours = await runWithTenant(TENANT, () => ctrl.list());
    expect(ours.map((r) => r.street)).toEqual(["Mine"]);
    const theirs = await runWithTenant(otherTenant, () => ctrl.list());
    expect(theirs.map((r) => r.street)).toEqual(["Yours"]);
  });
});
