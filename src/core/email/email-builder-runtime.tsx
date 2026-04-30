/**
 * Email-Builder runtime — renders a composition (JSON spec + vars) to
 * HTML+text+subject **without** writing a `.tsx` to disk. Used by the
 * `POST /dev/email-builder/preview.json` endpoint so the live preview
 * always reflects the current draft, not the last save.
 *
 * Why a runtime module:
 *   - The codegen planner (`composeEmailTemplateSource`) is pure but
 *     produces source code, not a React tree. Spawning it through Bun
 *     for every preview render would be wasteful.
 *   - The `ReactEmailTemplateRenderer` (issue #6) only knows about
 *     file-system templates. The builder UI mutates a draft live, so
 *     a file-system round-trip would lose typing-cadence freshness.
 *   - Both code paths (live preview + saved `.tsx`) ultimately call
 *     `@react-email/render` against the same Barebone + block tree —
 *     a shared block-rendering helper here keeps them visually
 *     identical.
 *
 * The renderer interpolates `{{varName}}` placeholders against the
 * supplied `vars` and resolves missing vars to an empty string (the
 * `.tsx` codegen path declares them as required `string`s, but a
 * preview shouldn't crash because the user hasn't typed a value yet).
 */
import * as React from "react";
import { render, toPlainText } from "@react-email/render";

import { Barebone } from "./layouts/Barebone.js";
import { CTA, Code, Divider, Footer, Greeting, Paragraph } from "./blocks/index.js";
import { defaultBrandConfig, type BrandConfig } from "./brand.js";
import {
  type EmailBlockSpec,
  type EmailComposition,
} from "./email-builder.js";

export interface RenderEmailCompositionInput {
  composition: EmailComposition;
  vars?: Record<string, string>;
  brand?: BrandConfig;
}

export interface RenderEmailCompositionResult {
  subject: string;
  html: string;
  text: string;
}

const VAR_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

function interpolate(value: string, vars: Record<string, string>): string {
  return value.replace(VAR_PATTERN, (_match, name: string) => {
    const replacement = vars[name];
    return replacement === undefined ? "" : replacement;
  });
}

/**
 * Render a composition to HTML + plain-text + subject. Used by the
 * live-preview endpoint; the saved `.tsx` files render via the
 * regular `ReactEmailTemplateRenderer`.
 */
export async function renderEmailComposition(
  input: RenderEmailCompositionInput,
): Promise<RenderEmailCompositionResult> {
  const vars = input.vars ?? {};
  const brand = input.brand ?? defaultBrandConfig();
  const subject = interpolate(input.composition.subject, vars);
  const preheader =
    input.composition.preheader !== undefined
      ? interpolate(input.composition.preheader, vars)
      : undefined;

  const children = input.composition.children.map((block, i) =>
    renderBlock(block, vars, brand, i),
  );

  const tree = React.createElement(
    Barebone,
    preheader !== undefined ? { brand, preheader } : { brand },
    ...children,
  );
  const html = await render(tree);
  const text = toPlainText(html);
  return { subject, html, text };
}

function renderBlock(
  block: EmailBlockSpec,
  vars: Record<string, string>,
  brand: BrandConfig,
  index: number,
): React.ReactElement {
  const key = `block-${index}`;
  const text =
    typeof block.props?.text === "string" ? interpolate(block.props.text, vars) : "";
  switch (block.type) {
    case "greeting":
      return React.createElement(Greeting, { key, brand }, text);
    case "paragraph":
      return React.createElement(Paragraph, { key, brand }, text);
    case "cta": {
      const href =
        typeof block.props?.href === "string" ? interpolate(block.props.href, vars) : "#";
      return React.createElement(CTA, { key, brand, href }, text);
    }
    case "footer":
      return React.createElement(Footer, { key, brand }, text);
    case "code":
      return React.createElement(Code, { key, brand }, text);
    case "divider":
      return React.createElement(Divider, { key });
    default:
      // Unknown block: render an empty fragment so the surrounding
      // tree still renders. Validation upstream (validateEmailComposition)
      // catches this before it ever reaches us.
      return React.createElement(React.Fragment, { key });
  }
}
