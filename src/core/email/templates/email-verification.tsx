import * as React from "react";

import { Barebone } from "../layouts/Barebone.js";
import { CTA, Footer, Greeting, Paragraph } from "../blocks/index.js";
import type { BrandConfig } from "../brand.js";

/**
 * Email-verification template.
 *
 * Sent right after sign-up. Confirms the recipient owns the address
 * before account-bearing flows can use it (login, password reset).
 */
export interface EmailVerificationVars {
  recipientName: string;
  appName: string;
  verificationUrl: string;
}

export const emailVerificationMeta = {
  name: "email-verification",
  subject: (_vars: EmailVerificationVars): string => "Please verify your email",
};

export interface EmailVerificationProps extends EmailVerificationVars {
  brand?: BrandConfig;
}

export default function EmailVerification(props: EmailVerificationProps): React.ReactElement {
  return (
    <Barebone brand={props.brand} preheader="Confirm your email address">
      <Greeting brand={props.brand}>Hello {props.recipientName},</Greeting>
      <Paragraph brand={props.brand}>
        Welcome to {props.appName}! Please confirm this is your address so we know where to send
        important account updates.
      </Paragraph>
      <CTA brand={props.brand} href={props.verificationUrl}>
        Verify email
      </CTA>
      <Footer brand={props.brand}>
        The verification link is valid for 24 hours. If you did not sign up, you can safely ignore
        this email.
      </Footer>
    </Barebone>
  );
}
