import * as React from "react";

import { CTA, Footer, Greeting, Paragraph } from "../blocks/index.js";
import { Barebone } from "../layouts/Barebone.js";
import type { BrandConfig } from "../brand.js";

/**
 * API-key expiring template (CF.AUTH.17).
 *
 * Sent by `ApiKeyExpiryRunner` when an active key falls inside the
 * warn-window (default 7 days from expiry). Non-alarming voice — the
 * intent is "rotate before it lapses", not "your account is in danger".
 *
 * The CTA URL is the project's API-keys management page; the renderer
 * caller passes the resolved URL in `vars.manageUrl` so this template
 * stays env-agnostic.
 */
export interface ApiKeyExpiringVars {
  recipientName: string;
  appName: string;
  keyName: string;
  daysUntilExpiry: number;
  expiresAt: string;
  manageUrl: string;
}

export const apiKeyExpiringMeta = {
  name: "api-key-expiring",
  subject: (vars: ApiKeyExpiringVars): string =>
    `API key "${vars.keyName}" expires in ${vars.daysUntilExpiry} days`,
};

export interface ApiKeyExpiringProps extends ApiKeyExpiringVars {
  brand?: BrandConfig;
}

export default function ApiKeyExpiring(props: ApiKeyExpiringProps): React.ReactElement {
  return (
    <Barebone
      brand={props.brand}
      preheader={`Your ${props.appName} API key "${props.keyName}" expires in ${props.daysUntilExpiry} days`}
    >
      <Greeting brand={props.brand}>Hello {props.recipientName},</Greeting>
      <Paragraph brand={props.brand}>
        Your {props.appName} API key {props.keyName} expires in {props.daysUntilExpiry} days (on{" "}
        {props.expiresAt}). Rotate it now to avoid breaking integrations that depend on it.
      </Paragraph>
      <CTA brand={props.brand} href={props.manageUrl}>
        Manage API keys
      </CTA>
      <Footer brand={props.brand}>
        You receive this notification because the key is still active. After it expires, requests
        signed with it will be rejected.
      </Footer>
    </Barebone>
  );
}
