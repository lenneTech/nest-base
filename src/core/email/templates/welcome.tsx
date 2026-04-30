import * as React from "react";

import { Barebone } from "../layouts/Barebone.js";
import { Greeting, Paragraph } from "../blocks/index.js";
import type { BrandConfig } from "../brand.js";

/**
 * Welcome template.
 *
 * Optional onboarding email sent after a verified login. Keeps the
 * voice friendly + short — the verification flow handles the
 * "important next step" nudges so this just confirms readiness.
 */
export interface WelcomeVars {
  recipientName: string;
  appName: string;
}

export const welcomeMeta = {
  name: "welcome",
  subject: (vars: WelcomeVars): string => `Welcome to ${vars.appName}`,
};

export interface WelcomeProps extends WelcomeVars {
  brand?: BrandConfig;
}

export default function Welcome(props: WelcomeProps): React.ReactElement {
  return (
    <Barebone brand={props.brand} preheader={`Welcome to ${props.appName}`}>
      <Greeting brand={props.brand}>Hello {props.recipientName},</Greeting>
      <Paragraph brand={props.brand}>
        Welcome to {props.appName}! Your account is ready to go.
      </Paragraph>
      <Paragraph brand={props.brand}>
        Reach out any time — we&apos;re glad to have you.
      </Paragraph>
    </Barebone>
  );
}
