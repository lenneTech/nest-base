import { describe, expect, it } from "vitest";

import { planVolumeCollisionCheck } from "../../src/core/setup/volume-collision-check.js";

/**
 * Story · Setup-Wizard · Volume-Collision-Safety.
 *
 * Friction-log run 2026-05-03-06-15-57: a fresh `lt fullstack init
 * --next --name my-next-fs` failed with `prisma:migrate` P1000 because
 * a same-named older workspace had already created the docker volume
 * `my-next-fs_postgres_data`. The new `.env` had a freshly random
 * `POSTGRES_PASSWORD`, but the volume still carried the *old* one.
 *
 * `planVolumeCollisionCheck()` is the pure planner that the wizard's
 * runner calls before `prisma:migrate`. It takes the compose-project
 * name + the result of a "does this volume already exist?" probe
 * (the runner shells `docker volume inspect <name>`) and returns a
 * fail-fast plan with a message that names the exact recovery
 * commands. The runner never auto-destroys the volume — silent data
 * loss is not on the table.
 */
describe("Story · Setup-Wizard volume-collision-check planner", () => {
  it("returns ok=true when no volume exists for the compose project", () => {
    const plan = planVolumeCollisionCheck({
      composeProjectName: "my-next-fs",
      volumeExists: false,
    });
    expect(plan.ok).toBe(true);
    expect(plan.message).toBeUndefined();
  });

  it("returns ok=false when the compose-project's postgres volume already exists", () => {
    const plan = planVolumeCollisionCheck({
      composeProjectName: "my-next-fs",
      volumeExists: true,
    });
    expect(plan.ok).toBe(false);
  });

  it("derives the conventional volume name `<project>_postgres_data` and surfaces it", () => {
    const plan = planVolumeCollisionCheck({
      composeProjectName: "my-next-fs",
      volumeExists: true,
    });
    expect(plan.volumeName).toBe("my-next-fs_postgres_data");
    expect(plan.message).toContain("my-next-fs_postgres_data");
  });

  it("fail-fast message includes the actionable `docker compose down -v` recovery line", () => {
    const plan = planVolumeCollisionCheck({
      composeProjectName: "my-next-fs",
      volumeExists: true,
    });
    expect(plan.message).toMatch(/docker compose down -v/);
  });

  it("fail-fast message also offers the alternative of re-init with a unique --name", () => {
    const plan = planVolumeCollisionCheck({
      composeProjectName: "my-next-fs",
      volumeExists: true,
    });
    expect(plan.message).toMatch(/--name|unique/i);
  });

  it("explains the root cause (old volume + new password) so a human can self-diagnose", () => {
    const plan = planVolumeCollisionCheck({
      composeProjectName: "my-next-fs",
      volumeExists: true,
    });
    expect(plan.message).toMatch(/(password|previous|prior|existing)/i);
  });

  it("never sets `ok=true` when the volume exists, regardless of project name", () => {
    for (const name of ["foo", "bar-baz", "MY_APP", "x"]) {
      const plan = planVolumeCollisionCheck({
        composeProjectName: name,
        volumeExists: true,
      });
      expect(plan.ok).toBe(false);
      expect(plan.volumeName).toBe(`${name}_postgres_data`);
    }
  });

  it("treats an empty/whitespace project name as a programmer error (throws)", () => {
    expect(() => planVolumeCollisionCheck({ composeProjectName: "", volumeExists: false })).toThrow(
      /composeProjectName/,
    );
    expect(() =>
      planVolumeCollisionCheck({ composeProjectName: "   ", volumeExists: false }),
    ).toThrow(/composeProjectName/);
  });

  // Friction-log entry 14:21 follow-up: a freshly initialised workspace
  // bakes `COMPOSE_PROJECT_NAME=<name>-<path-hash>` into `.env`, and the
  // path-hash already prevents cross-workspace volume collisions in
  // practice. The planner accepts an optional `expectedComposeProjectName`
  // so the runner can also skip a *legacy* non-hashed name's volume
  // collision when the operator clearly didn't generate that volume in
  // this workspace path. Without this, a user who runs `bun run setup`
  // in path A after a different-path workspace had `COMPOSE_PROJECT_NAME=
  // my-next-fs` would falsely abort.
  describe("expectedComposeProjectName false-positive avoidance", () => {
    it("returns ok=true when the active name does not match the expected hashed name (foreign workspace's volume)", () => {
      const plan = planVolumeCollisionCheck({
        composeProjectName: "my-next-fs",
        volumeExists: true,
        expectedComposeProjectName: "my-next-fs-a1b2c3",
      });
      expect(plan.ok).toBe(true);
      expect(plan.message).toBeUndefined();
    });

    it("still flags a real collision when the active name matches the expected hashed name", () => {
      const plan = planVolumeCollisionCheck({
        composeProjectName: "my-next-fs-a1b2c3",
        volumeExists: true,
        expectedComposeProjectName: "my-next-fs-a1b2c3",
      });
      expect(plan.ok).toBe(false);
      expect(plan.message).toMatch(/my-next-fs-a1b2c3_postgres_data/);
    });

    it("ignores expectedComposeProjectName when the volume does not exist", () => {
      const plan = planVolumeCollisionCheck({
        composeProjectName: "my-next-fs",
        volumeExists: false,
        expectedComposeProjectName: "my-next-fs-a1b2c3",
      });
      expect(plan.ok).toBe(true);
    });
  });
});
