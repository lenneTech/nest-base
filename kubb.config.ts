import { defineConfig } from '@kubb/core';
import { pluginOas } from '@kubb/plugin-oas';
import { pluginTs } from '@kubb/plugin-ts';

/**
 * Kubb config for SDK generation.
 *
 * Source: the running server's OpenAPI document at
 * `/api/openapi.json`. Run `bun run dev` in one terminal, then
 * `bun run sdk:generate` in another to regenerate `generated/sdk/`.
 *
 * Plugins: pluginOas validates the OpenAPI doc; pluginTs emits
 * pure-TypeScript request/response types per operation.
 */
export default defineConfig({
  root: '.',
  input: {
    path: process.env.KUBB_INPUT ?? 'http://localhost:3000/api/openapi.json',
  },
  output: {
    path: './generated/sdk',
    clean: true,
  },
  plugins: [pluginOas({ validate: true }), pluginTs({})],
});
