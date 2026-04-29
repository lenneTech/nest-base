/**
 * kubb config builder (PLAN.md §32 Phase 8).
 *
 * Pure builder for the config object kubb's CLI consumes. The
 * top-level `kubb.config.ts` calls this with the project's OpenAPI
 * source path + output dir, the builder fills in the plugin set
 * (oas → ts → client) so a fresh project gets a working SDK
 * without copy-pasting kubb plumbing.
 *
 * Plugin order matters — `@kubb/plugin-oas` parses the spec into
 * the in-memory model the other plugins read. Keep it first.
 */

export interface KubbPluginConfig {
  name: string;
  options?: Record<string, unknown>;
}

export interface KubbConfig {
  input: { path: string };
  output: { path: string; clean?: boolean };
  plugins: KubbPluginConfig[];
}

export interface KubbConfigInput {
  /** Path to the OpenAPI document (JSON or YAML). */
  specPath: string;
  /** Output directory for the generated SDK. */
  outputDir: string;
  /** Custom HTTP client import path (default: kubb's bundled fetch). */
  clientImportPath?: string;
  /** Base URL embedded into generated client. Optional. */
  baseURL?: string;
}

export function buildKubbConfig(input: KubbConfigInput): KubbConfig {
  if (!input.specPath) throw new Error("kubb-config: specPath must be a non-empty string");
  if (!input.outputDir) throw new Error("kubb-config: outputDir must be a non-empty string");

  const clientOptions: Record<string, unknown> = {};
  if (input.clientImportPath) clientOptions.importPath = input.clientImportPath;
  if (input.baseURL) clientOptions.baseURL = input.baseURL;

  return {
    input: { path: input.specPath },
    output: { path: input.outputDir, clean: true },
    plugins: [
      { name: "@kubb/plugin-oas", options: { validate: true } },
      { name: "@kubb/plugin-ts", options: { output: { path: "types" } } },
      { name: "@kubb/plugin-client", options: clientOptions },
    ],
  };
}
