import * as React from "react";

import { Barebone } from "../layouts/Barebone.js";
import { CTA, Footer, Greeting, Paragraph } from "../blocks/index.js";
import type { BrandConfig } from "../brand.js";

/**
 * Magic-link sign-in template.
 *
 * Sent when a user requests a passwordless sign-in link. Subject pulls
 * the appName so it reads natural across multi-brand deployments —
 * `Your Acme sign-in link` instead of a generic fallback.
 */
export interface MagicLinkVars {
  recipientName: string;
  appName: string;
  magicLinkUrl: string;
}

export const magicLinkMeta = {
  name: "magic-link",
  subject: (vars: MagicLinkVars): string => `Your ${vars.appName} sign-in link`,
};

export interface MagicLinkProps extends MagicLinkVars {
  brand?: BrandConfig;
}

export default function MagicLink(props: MagicLinkProps): React.ReactElement {
  return (
    <Barebone brand={props.brand} preheader={`Your ${props.appName} sign-in link`}>
      <Greeting brand={props.brand}>Hello {props.recipientName},</Greeting>
      <Paragraph brand={props.brand}>
        Tap the button below to sign in to {props.appName}. This link works once and expires
        shortly.
      </Paragraph>
      <CTA brand={props.brand} href={props.magicLinkUrl}>
        Sign in
      </CTA>
      <Footer brand={props.brand}>
        If you did not request this link, you can safely ignore this email — no one can sign in
        without it.
      </Footer>
    </Barebone>
  );
}
