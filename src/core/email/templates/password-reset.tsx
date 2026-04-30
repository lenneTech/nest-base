import * as React from "react";

import { Barebone } from "../layouts/Barebone.js";
import { CTA, Footer, Greeting, Paragraph } from "../blocks/index.js";
import type { BrandConfig } from "../brand.js";

/**
 * Password-reset template.
 *
 * Sent when the user requests a password-reset link. Subject pulls
 * the appName so the message reads natural across multi-brand
 * deployments — `Reset your Acme password` instead of a generic
 * fallback.
 */
export interface PasswordResetVars {
  recipientName: string;
  appName: string;
  resetUrl: string;
}

export const passwordResetMeta = {
  name: "password-reset",
  subject: (vars: PasswordResetVars): string => `Reset your ${vars.appName} password`,
};

export interface PasswordResetProps extends PasswordResetVars {
  brand?: BrandConfig;
}

export default function PasswordReset(props: PasswordResetProps): React.ReactElement {
  return (
    <Barebone brand={props.brand} preheader={`Reset your ${props.appName} password`}>
      <Greeting brand={props.brand}>Hello {props.recipientName},</Greeting>
      <Paragraph brand={props.brand}>
        We received a request to reset your password. Click the button below to choose a new one.
      </Paragraph>
      <CTA brand={props.brand} href={props.resetUrl}>
        Reset password
      </CTA>
      <Footer brand={props.brand}>
        If you did not request a password reset, you can safely ignore this email — your password
        stays unchanged.
      </Footer>
    </Barebone>
  );
}
