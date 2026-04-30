# `src/core/email/` — agent guide

Transactional-email subsystem. The current shape:

```
email/
├── brand.ts                       ← BrandConfig + defaults + resolveBrandConfig()
├── email.service.ts               ← EmailService (driver + renderer + rate-limit + whitelist)
├── email.module.ts                ← EmailService DI factory
├── email-templates.ts             ← Legacy EJS-subset renderer (kept for back-compat)
├── email-templates.react.ts       ← React-Email loader + renderer (default)
├── layouts/
│   └── Barebone.tsx               ← Default frame (header / body / footer)
├── blocks/
│   ├── Greeting.tsx               ← Title-weight opener
│   ├── Paragraph.tsx              ← Body copy
│   ├── CTA.tsx                    ← Primary button + fallback URL
│   ├── Footer.tsx                 ← Body-level small print
│   ├── Code.tsx                   ← Monospace token / OTP block
│   ├── Divider.tsx                ← Horizontal rule
│   └── index.ts                   ← Re-exports
└── templates/
    ├── email-verification.tsx
    ├── password-reset.tsx
    ├── welcome.tsx
    └── invitation.tsx
```

## How rendering works

1. `EmailService.sendTemplate({ template, locale, vars })`
2. The configured renderer (`ReactEmailTemplateRenderer` by default) resolves
   the template via the file-system priority list — module overlay beats core,
   locale-specific beats default. See `email-templates.react.ts`.
3. The matched module is dynamically imported (cache-busted for `bun --watch`)
   and its **default export** is called with `{ ...vars, brand }`.
4. `@react-email/render` walks the React tree to inline-styled HTML; the
   plain-text fallback is derived via `toPlainText`.
5. Subject is produced by the named `<name>Meta.subject(vars)` factory exported
   from the same file (`password-reset.tsx` exports `passwordResetMeta`).

## Where do project-specific templates go?

Drop `.tsx` files into `src/modules/email/templates/`. Same shape as the core
templates: `<name>.tsx` for the default, `<name>.<locale>.tsx` for locale
variants. A file with the same basename as a core template **overrides** it —
no registration call required. The discovery walker is in
`email-templates.react.ts > discoverReactEmailTemplates()`.

`bun run sync:from-template` only touches `src/core/email/{layouts,blocks,
templates}/`. Module templates are guaranteed untouched — that's the override
contract.

## Brand-aware look + feel

Every layout/block accepts an optional `brand?: BrandConfig`. The renderer
injects the active brand into the props at render time, so individual
templates don't need to import `defaultBrandConfig()` themselves. A single
change in `brand.ts` propagates to every transactional email — that's the
architectural gain over the previous EJS HTML strings, in which each template
duplicated the frame markup.

The brand-loader (read JSON + env overrides) is owned by issue #5; until it
lands the EmailModule wires `resolveBrandConfig()` with no overrides.

## Adding a new template

1. Create `src/core/email/templates/<name>.tsx` (or
   `src/modules/email/templates/<name>.tsx` for project-specific). Export:

   ```tsx
   export interface <Name>Vars { recipientName: string; /* ... */ }

   export const <name>Meta = {
     name: "<name>",
     subject: (vars: <Name>Vars) => `…${vars.…}`,
   };

   export default function <Name>(props: <Name>Vars & { brand?: BrandConfig }) {
     return (
       <Barebone brand={props.brand} preheader="…">
         <Greeting brand={props.brand}>Hello {props.recipientName},</Greeting>
         {/* … */}
       </Barebone>
     );
   }
   ```

2. Add a snapshot/story test under `tests/stories/email-templates-react.story.test.ts`
   (or a sibling file) to lock the rendered HTML.
3. If the template needs a sample payload in `/dev/email-preview`, extend
   `buildEmailPreviewCatalog()` in `src/core/dx/email-preview.ts`.

## Why two renderers coexist

The legacy `EjsEmailTemplateRenderer` + `InMemoryEmailTemplateRegistry` are
still exported from `email-templates.ts`. They cover registration-driven
flows that don't have a `.tsx` file (rare, but possible). The default
`EmailModule` uses the React-Email renderer; consumers can swap providers
inside their bootstrap if they need the EJS path. The legacy stack is
deprecated — favour `.tsx` for any new templates.

## Hard rules

- Templates are server-side React. No DOM APIs, no `process.env` reads inside
  the component (use the brand config instead).
- Inline styles only — `<style>` blocks and external stylesheets get stripped
  by Gmail/Outlook.
- Locale resolution is `<name>.<locale>.tsx` first, `<name>.tsx` as fallback.
  No locale negotiation — caller passes the resolved locale string.
- File-system discovery is sync (`existsSync` + `readdirSync`) for boot
  predictability. The renderer's `import()` is async — that's the I/O surface.
