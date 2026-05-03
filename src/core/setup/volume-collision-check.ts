/**
 * Pure planner for the setup-wizard's volume-collision safety gate.
 *
 * Friction: a same-named older workspace leaves behind the docker
 * volume `${COMPOSE_PROJECT_NAME}_postgres_data`. The new workspace
 * generates a fresh `POSTGRES_PASSWORD` in `.env`, but the volume
 * still carries the *old* one — every `prisma:migrate` then fails
 * with `P1000` and the operator has to figure out the cause from a
 * confusing auth error.
 *
 * The planner is intentionally pure: the runner shells `docker volume
 * inspect <name>` (or any equivalent probe) and feeds the boolean
 * outcome here. The planner builds the operator-visible message and
 * names the exact recovery commands. Auto-destruction is explicitly
 * NOT in scope — a `docker compose down -v` is destructive and must
 * remain a deliberate keystroke.
 */

export interface VolumeCollisionInput {
  /** The compose-project name (the value of `COMPOSE_PROJECT_NAME`). */
  composeProjectName: string;
  /** True if the runner's `docker volume inspect` probe succeeded. */
  volumeExists: boolean;
}

export interface VolumeCollisionPlan {
  /** True when it's safe to proceed with `prisma:migrate`. */
  ok: boolean;
  /** The conventional volume name derived from the project. */
  volumeName: string;
  /**
   * Operator-visible message. Defined when `ok === false`; otherwise
   * undefined (no message means "all clear, keep going").
   */
  message?: string;
}

export function planVolumeCollisionCheck(input: VolumeCollisionInput): VolumeCollisionPlan {
  const name = input.composeProjectName;
  if (!name || name.trim().length === 0) {
    // Programmer error rather than a user-visible state — surface
    // loudly so the runner's call site is fixed, not patched around.
    throw new Error("planVolumeCollisionCheck: composeProjectName is required");
  }

  const volumeName = `${name}_postgres_data`;

  if (!input.volumeExists) {
    return { ok: true, volumeName };
  }

  const message = [
    `Detected existing docker volume \`${volumeName}\` from a previous workspace.`,
    "",
    "The volume was initialised with that workspace's POSTGRES_PASSWORD,",
    "but the freshly generated `.env` carries a new password — `prisma:migrate`",
    "will fail with `P1000: Authentication failed` until the volume is reset.",
    "",
    "Recovery (pick one):",
    "  - In this workspace: `docker compose down -v` to wipe the volume,",
    "    then `docker compose up -d` (DESTRUCTIVE — drops the prior data).",
    "  - Re-init with a unique `--name` so the new compose project gets",
    "    its own namespace and its own volume.",
  ].join("\n");

  return { ok: false, volumeName, message };
}
