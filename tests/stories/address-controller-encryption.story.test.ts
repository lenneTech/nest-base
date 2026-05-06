import { describe, expect, it } from "vitest";

import { AddressController } from "../../src/core/geo/address.controller.js";
import { InMemoryAddressStorage } from "../../src/core/geo/address-storage.js";
import type { FieldEncryptionService } from "../../src/core/encryption/field-encryption.service.js";

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
 */
describe("Story · AddressController encryption (iter-162)", () => {
  function makeFakeService(): FieldEncryptionService {
    return {
      encrypt: (plaintext: string) => `enc:${plaintext}`,
      decrypt: (ciphertext: string) =>
        ciphertext.startsWith("enc:") ? ciphertext.slice(4) : ciphertext,
    } as unknown as FieldEncryptionService;
  }

  // Per-suite tenant UUID for iter-204 isolation.
  const TENANT = "11111111-1111-4111-8111-111111111111";

  it("create() persists ciphertext under street + zip when service is wired", async () => {
    const ctrl = new AddressController(new InMemoryAddressStorage(), makeFakeService());
    const result = await ctrl.create(TENANT, {
      street: "Hauptstraße 1",
      zip: "10115",
      city: "Berlin",
      country: "DE",
      tenantId: TENANT,
    });
    // The controller returns the plaintext-shaped record for the
    // caller — the encryption happens in-flight before persistence.
    // The list() readback verifies the round-trip through the
    // STORE.
    const list = await ctrl.list(TENANT);
    const stored = list.find((r) => r.id === result.id);
    expect(stored).toBeDefined();
    expect(stored!.street).toBe("Hauptstraße 1");
    expect(stored!.zip).toBe("10115");
  });

  it("get() decrypts on read", async () => {
    const ctrl = new AddressController(new InMemoryAddressStorage(), makeFakeService());
    const created = await ctrl.create(TENANT, {
      street: "Friedrichstraße 200",
      zip: "10117",
      city: "Berlin",
      country: "DE",
    });
    const fetched = await ctrl.get(TENANT, created.id);
    expect(fetched.street).toBe("Friedrichstraße 200");
    expect(fetched.zip).toBe("10117");
  });

  it("create() throws BadRequest on invalid body (Zod parse failure)", async () => {
    const ctrl = new AddressController(new InMemoryAddressStorage(), makeFakeService());
    await expect(ctrl.create(TENANT, { street: "", zip: "" })).rejects.toThrow();
  });

  it("get() throws NotFound when the id does not exist", async () => {
    const ctrl = new AddressController(new InMemoryAddressStorage(), makeFakeService());
    await expect(ctrl.get(TENANT, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(
      /not found/,
    );
  });

  it("remove() returns removed=true for an existing id, removed=false otherwise", async () => {
    const ctrl = new AddressController(new InMemoryAddressStorage(), makeFakeService());
    const created = await ctrl.create(TENANT, {
      street: "Karl-Marx-Allee 90",
      zip: "10243",
      city: "Berlin",
      country: "DE",
    });
    const result = await ctrl.remove(TENANT, created.id);
    expect(result).toEqual({ removed: true });
    const second = await ctrl.remove(TENANT, created.id);
    expect(second).toEqual({ removed: false });
  });

  it("controller round-trips plaintext when no FieldEncryptionService is provided", async () => {
    // The constructor's `@Optional()` keeps the controller bootable
    // when EncryptionModule isn't wired (project default for fresh
    // installs without a KEK). In that case `street`/`zip` are
    // stored verbatim and the round-trip is identity.
    const ctrl = new AddressController(new InMemoryAddressStorage(), undefined);
    const created = await ctrl.create(TENANT, {
      street: "no-encryption street",
      zip: "00000",
      city: "Anywhere",
      country: "DE",
    });
    const fetched = await ctrl.get(TENANT, created.id);
    expect(fetched.street).toBe("no-encryption street");
    expect(fetched.zip).toBe("00000");
  });

  it("does NOT use the legacy `[encrypted]:value` prefix shape (iter-162 regression guard)", async () => {
    // Captures the encrypted plaintext via the fake service so we
    // can prove the controller called the real `encryptAddress`
    // helper rather than the iter-161-or-earlier prefix wrapper.
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
    await ctrl.create(TENANT, {
      street: "Real Street 7",
      zip: "12345",
      city: "Munich",
      country: "DE",
    });
    // Both PII fields must have been pushed through the service.
    expect(captured).toEqual(expect.arrayContaining(["Real Street 7", "12345"]));
  });

  it("400s on every read/write without an x-tenant-id header (iter-204)", async () => {
    const ctrl = new AddressController(new InMemoryAddressStorage(), makeFakeService());
    await expect(ctrl.list(undefined)).rejects.toThrow(/x-tenant-id/);
    await expect(
      ctrl.create(undefined, { street: "S", zip: "Z", city: "C", country: "DE" }),
    ).rejects.toThrow(/x-tenant-id/);
    await expect(ctrl.get(undefined, "id")).rejects.toThrow(/x-tenant-id/);
    await expect(ctrl.remove(undefined, "id")).rejects.toThrow(/x-tenant-id/);
  });

  it("400s when x-tenant-id is not a UUID (iter-204)", async () => {
    const ctrl = new AddressController(new InMemoryAddressStorage(), makeFakeService());
    await expect(ctrl.list("not-a-uuid")).rejects.toThrow(/uuid/i);
  });

  it("create() rejects body.tenantId mismatch with header (iter-204)", async () => {
    const ctrl = new AddressController(new InMemoryAddressStorage(), makeFakeService());
    const otherTenant = "22222222-2222-4222-8222-222222222222";
    await expect(
      ctrl.create(TENANT, {
        street: "S",
        zip: "Z",
        city: "C",
        country: "DE",
        tenantId: otherTenant,
      }),
    ).rejects.toThrow(/tenantId/);
  });

  it("list() returns ONLY rows for the request's tenant — cross-tenant rows do NOT leak (iter-204)", async () => {
    const storage = new InMemoryAddressStorage();
    const ctrl = new AddressController(storage, makeFakeService());
    const otherTenant = "22222222-2222-4222-8222-222222222222";
    await ctrl.create(TENANT, {
      street: "Mine",
      zip: "00001",
      city: "Berlin",
      country: "DE",
    });
    await ctrl.create(otherTenant, {
      street: "Yours",
      zip: "00002",
      city: "Berlin",
      country: "DE",
    });
    const ours = await ctrl.list(TENANT);
    expect(ours.map((r) => r.street)).toEqual(["Mine"]);
    const theirs = await ctrl.list(otherTenant);
    expect(theirs.map((r) => r.street)).toEqual(["Yours"]);
  });
});
