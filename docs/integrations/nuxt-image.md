# `@nuxt/image` integration

The asset pipeline at `/_ipx/<modifiers>/<source>` is **wire-compatible
with the official Nuxt-Image IPX provider** (issue #17). Frontend apps
built on Nuxt 3 can consume images from this server without writing a
custom provider.

## Frontend setup

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@nuxt/image"],
  image: {
    provider: "ipx",
    ipx: {
      // Point at the API server's IPX mount. Strip trailing `/`s.
      baseURL: "https://api.example.com/_ipx",
    },
  },
});
```

```vue
<template>
  <NuxtImg
    src="/files/<storageKey>"
    width="300"
    height="300"
    format="webp"
    fit="cover"
  />
</template>
```

`<NuxtImg>` builds the URL by concatenating modifiers in IPX syntax:

```
https://api.example.com/_ipx/w_300,h_300,f_webp,fit_cover/files/<storageKey>
```

## Modifier reference

| Modifier        | Maps to            | Example                    |
| --------------- | ------------------ | -------------------------- |
| `w_<n>`         | `width`            | `w_300`                    |
| `h_<n>`         | `height`           | `h_200`                    |
| `f_<format>`    | webp / avif / jpeg / png | `f_webp`             |
| `q_<n>`         | quality (1–100)    | `q_75`                     |
| `fit_<mode>`    | cover / contain / inside / outside | `fit_cover` |
| `blur_<n>`      | gaussian blur      | `blur_3`                   |
| `sharpen_<n>`   | sharpen            | `sharpen_1`                |
| `preset_<name>` | named server-side preset (see below) | `preset_thumbnail` |

Multiple modifiers join with `,`:

```
/_ipx/w_300,h_200,f_webp,q_75/files/<storageKey>
```

## Server-side presets

For URLs that stay short on the wire and can't be tampered with by the
frontend, register a preset on the server:

```ts
// src/modules/<your-module>/asset-presets.ts
const registry = AssetPresetRegistry.fromDefaults();
registry.register("avatar-square", {
  width: 256,
  height: 256,
  format: "webp",
  fit: "cover",
  quality: 80,
});
```

Hit it from the client:

```vue
<NuxtImg src="/files/<storageKey>" :modifiers="{ preset: 'avatar-square' }" />
```

The default registry ships with `thumbnail` (200×200), `avatar`
(400×400), and `hero` (1920×1080).

## Authentication

If the underlying file is private, the frontend must include the
session cookie / Authorization header on the IPX request. NestJS
guards run **per IPX request** — so:

```vue
<NuxtImg
  src="/files/<storageKey>"
  width="300"
  :imgAttrs="{ crossorigin: 'use-credentials' }"
/>
```

Same-origin deployments inherit cookies automatically.

## Cache & invalidation

- IPX emits `Cache-Control: max-age=86400, public, s-maxage=86400` and
  an ETag computed from the rendered bytes. CDNs and browsers
  revalidate via `If-None-Match`.
- The asset-service cache (one layer below IPX) keys per
  `(sourceKey, options)` and survives across restarts.
- Admins can drop the asset-cache via `DELETE /_ipx/cache/<sourcePath>`
  (RBAC: `delete` on `Asset`). The next request re-renders.

## Verification

```bash
curl -I "https://api.example.com/_ipx/w_300,f_webp/files/<storageKey>"
# HTTP/1.1 200 OK
# Content-Type: image/webp
# Cache-Control: max-age=86400, public, s-maxage=86400
# Etag: "<hex>"
```

A round-trip through `<NuxtImg>` from a Nuxt 3 app should render the
correctly-sized image without any provider config beyond `baseURL`.
