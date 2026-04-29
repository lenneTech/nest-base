/**
 * Pure planner for `bun run doctor`.
 *
 * Comprehensive environment health check. The runner gathers the
 * inputs (Bun version, env-file presence, container statuses via
 * `docker compose ps`, service reachability via TCP probes, free
 * disk space via `node:fs.statfs`) and pipes them through here for
 * a structured report.
 *
 * Three severities:
 *   - `ok`       → step passed
 *   - `warning`  → degraded but non-blocking; runner returns 0
 *   - `blocked`  → fix-now; runner returns non-zero
 *
 * The shape mirrors `OnboardReport` so future tooling can union them.
 */

export type DoctorStatus = "ok" | "warning" | "blocked";

export type ContainerState = "running" | "not-running" | "unknown";

export interface DoctorInput {
  bunVersion?: string;
  requiredBunVersion: string;
  envFileExists: boolean;
  /** Subset of `process.env` containing at least the required keys. */
  env: Record<string, string | undefined>;
  /** Keys that MUST be present in env. Missing keys → blocked. */
  requiredEnvKeys: string[];
  /** Per-container state from `docker compose ps`. */
  containers: Record<string, ContainerState>;
  /** Per-service reachability from TCP probes. */
  services: Record<string, boolean>;
  /** Free disk bytes on the cwd's filesystem, from `node:fs.statfs`. */
  diskFreeBytes: number;
}

export interface DoctorStep {
  id: string;
  label: string;
  status: DoctorStatus;
  detail?: string;
  remediation?: string;
}

export interface DoctorReport {
  kind: "doctor-report";
  version: 1;
  steps: DoctorStep[];
  summary: { ok: number; warning: number; blocked: number };
  ok: boolean;
}

const MIN_DISK_FREE_BYTES = 1024 * 1024 * 1024; // 1 GB
const MIN_SECRET_LENGTH = 32;

export function buildDoctorReport(input: DoctorInput): DoctorReport {
  const steps: DoctorStep[] = [
    bunStep(input),
    envFileStep(input),
    envKeysStep(input),
    envStrengthStep(input),
    containersStep(input),
    serviceProbesStep(input),
    diskStep(input),
  ];

  const summary = { ok: 0, warning: 0, blocked: 0 };
  for (const step of steps) summary[step.status]++;

  return {
    kind: "doctor-report",
    version: 1,
    steps,
    summary,
    ok: summary.blocked === 0,
  };
}

function bunStep(input: DoctorInput): DoctorStep {
  const id = "bun";
  const label = `Bun ≥ ${input.requiredBunVersion}`;
  if (!input.bunVersion) {
    return {
      id,
      label,
      status: "blocked",
      detail: "Bun is not installed (or not on PATH)",
      remediation: "curl -fsSL https://bun.sh/install | bash",
    };
  }
  if (compareSemver(input.bunVersion, input.requiredBunVersion) < 0) {
    return {
      id,
      label,
      status: "blocked",
      detail: `Bun ${input.bunVersion} is too old`,
      remediation: `bun upgrade (need ≥ ${input.requiredBunVersion})`,
    };
  }
  return { id, label, status: "ok", detail: `Bun ${input.bunVersion}` };
}

function envFileStep(input: DoctorInput): DoctorStep {
  const id = "env-file";
  if (!input.envFileExists) {
    return {
      id,
      label: ".env present",
      status: "blocked",
      detail: ".env is missing",
      remediation: "bun run setup",
    };
  }
  return { id, label: ".env present", status: "ok" };
}

function envKeysStep(input: DoctorInput): DoctorStep {
  const id = "env-keys";
  const missing = input.requiredEnvKeys.filter((k) => !input.env[k]);
  if (missing.length > 0) {
    return {
      id,
      label: "Required env-vars present",
      status: "blocked",
      detail: `missing: ${missing.join(", ")}`,
      remediation: "bun run setup (regenerates .env from .env.example with random secrets)",
    };
  }
  return { id, label: "Required env-vars present", status: "ok" };
}

function envStrengthStep(input: DoctorInput): DoctorStep {
  const id = "env-strength";
  const label = "Secret strength";
  const weak: string[] = [];
  const placeholders: string[] = [];
  for (const key of input.requiredEnvKeys) {
    const value = input.env[key];
    if (!value) continue;
    if (/change-me/i.test(value)) {
      placeholders.push(key);
    } else if (key.toLowerCase().includes("secret") && value.length < MIN_SECRET_LENGTH) {
      weak.push(key);
    }
  }
  if (placeholders.length > 0) {
    return {
      id,
      label,
      status: "blocked",
      detail: `placeholder "change-me" values still present: ${placeholders.join(", ")}`,
      remediation: "bun run setup --rotate (or hand-edit .env to replace `change-me` values)",
    };
  }
  if (weak.length > 0) {
    return {
      id,
      label,
      status: "warning",
      detail: `secrets shorter than ${MIN_SECRET_LENGTH} chars: ${weak.join(", ")}`,
      remediation: "rotate via `bun run setup --rotate`",
    };
  }
  return { id, label, status: "ok" };
}

function containersStep(input: DoctorInput): DoctorStep {
  const id = "containers";
  const label = "Docker containers";
  const stopped = Object.entries(input.containers)
    .filter(([, state]) => state === "not-running")
    .map(([name]) => name);
  if (stopped.length > 0) {
    return {
      id,
      label,
      status: "blocked",
      detail: `stopped: ${stopped.join(", ")}`,
      remediation: "docker compose up -d",
    };
  }
  return { id, label, status: "ok" };
}

function serviceProbesStep(input: DoctorInput): DoctorStep {
  const id = "service-probes";
  const label = "Service reachability";
  const unreachable = Object.entries(input.services)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  if (unreachable.length > 0) {
    return {
      id,
      label,
      status: "blocked",
      detail: `unreachable: ${unreachable.join(", ")}`,
      remediation: "check container ports + .env URLs",
    };
  }
  return { id, label, status: "ok" };
}

function diskStep(input: DoctorInput): DoctorStep {
  const id = "disk";
  const label = "Free disk space";
  const free = input.diskFreeBytes;
  const freeGb = (free / (1024 * 1024 * 1024)).toFixed(1);
  if (free < MIN_DISK_FREE_BYTES) {
    return {
      id,
      label,
      status: "warning",
      detail: `${freeGb} GB free — low for Postgres + node_modules`,
      remediation: "free disk or move docker volumes",
    };
  }
  return { id, label, status: "ok", detail: `${freeGb} GB free` };
}

function compareSemver(a: string, b: string): number {
  const pa = a
    .split("-")[0]!
    .split(".")
    .map((p) => Number.parseInt(p, 10));
  const pb = b
    .split("-")[0]!
    .split(".")
    .map((p) => Number.parseInt(p, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}
