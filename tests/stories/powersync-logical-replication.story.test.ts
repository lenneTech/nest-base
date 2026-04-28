import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = resolve(import.meta.dirname, '..', '..');

/**
 * Story · Postgres logical replication for PowerSync (PLAN.md §15.5 + §32 Phase 5b).
 *
 * PowerSync subscribes to the WAL stream to ship row changes to mobile
 * clients. That requires `wal_level = logical` (default is `replica`),
 * a replication slot, and `max_wal_senders` headroom for the slot.
 *
 * docker-compose.yml is the only place this is configured for local
 * dev; the production guide (docs/operations/) documents the same flags
 * for hosted Postgres. We assert here that the local dev container is
 * launched with the right command-line arguments — without them
 * PowerSync silently fails to bootstrap a slot and clients never sync.
 */
describe('Story · Postgres logical replication for PowerSync', () => {
  function readCompose(): { raw: string; parsed: { services: Record<string, { command?: string | string[]; environment?: Record<string, string> }> } } {
    const composePath = resolve(ROOT, 'docker-compose.yml');
    expect(existsSync(composePath), 'docker-compose.yml must exist').toBe(true);
    const raw = readFileSync(composePath, 'utf8');
    const parsed = parse(raw) as { services: Record<string, { command?: string | string[]; environment?: Record<string, string> }> };
    return { raw, parsed };
  }

  it('postgres service uses wal_level=logical so PowerSync can decode the WAL', () => {
    const { parsed } = readCompose();
    const pg = parsed.services?.postgres;
    expect(pg, 'postgres service must exist').toBeDefined();
    const command = Array.isArray(pg!.command) ? pg!.command.join(' ') : (pg!.command ?? '');
    expect(command).toMatch(/wal_level\s*=\s*logical/);
  });

  it('postgres service raises max_wal_senders so the replication slot can attach', () => {
    const { parsed } = readCompose();
    const command = Array.isArray(parsed.services.postgres?.command)
      ? (parsed.services.postgres!.command as string[]).join(' ')
      : (parsed.services.postgres?.command ?? '');
    expect(command).toMatch(/max_wal_senders\s*=\s*[1-9][0-9]*/);
  });

  it('postgres service raises max_replication_slots so PowerSync can hold a logical slot', () => {
    const { parsed } = readCompose();
    const command = Array.isArray(parsed.services.postgres?.command)
      ? (parsed.services.postgres!.command as string[]).join(' ')
      : (parsed.services.postgres?.command ?? '');
    expect(command).toMatch(/max_replication_slots\s*=\s*[1-9][0-9]*/);
  });

  it('still starts the standard postgres entrypoint (no custom binary path)', () => {
    const { parsed } = readCompose();
    const command = Array.isArray(parsed.services.postgres?.command)
      ? (parsed.services.postgres!.command as string[]).join(' ')
      : (parsed.services.postgres?.command ?? '');
    expect(command).toMatch(/^postgres\b/);
  });

  it('keeps healthcheck working (still uses pg_isready against the configured user/db)', () => {
    const { raw } = readCompose();
    expect(raw).toMatch(/pg_isready/);
  });
});
