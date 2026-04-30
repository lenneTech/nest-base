import * as React from "react";

import { Barebone } from "../layouts/Barebone.js";
import { CTA, Footer, Greeting, Paragraph } from "../blocks/index.js";
import { defaultBrandConfig, type BrandConfig } from "../brand.js";

/**
 * Invitation template.
 *
 * Sent when an existing user invites someone to their tenant. The
 * sender's name is highlighted so the recipient immediately sees who
 * the invitation is from — invitations from unknown senders go
 * straight to the spam folder anyway.
 */
export interface InvitationVars {
  recipientName: string;
  senderName: string;
  appName: string;
  acceptUrl: string;
}

export const invitationMeta = {
  name: "invitation",
  subject: (vars: InvitationVars): string => `You have been invited to ${vars.appName}`,
};

export interface InvitationProps extends InvitationVars {
  brand?: BrandConfig;
}

export default function Invitation(props: InvitationProps): React.ReactElement {
  const accentColor = props.brand?.primaryColor ?? defaultBrandConfig().primaryColor;
  return (
    <Barebone brand={props.brand} preheader={`${props.senderName} invited you to ${props.appName}`}>
      <Greeting brand={props.brand}>Hello {props.recipientName},</Greeting>
      <Paragraph brand={props.brand}>
        <strong style={{ color: accentColor }}>{props.senderName}</strong> has invited you to join{" "}
        {props.appName}.
      </Paragraph>
      <Paragraph brand={props.brand}>
        Accept the invitation to set up your account and start collaborating.
      </Paragraph>
      <CTA brand={props.brand} href={props.acceptUrl}>
        Accept invitation
      </CTA>
      <Footer brand={props.brand}>
        Invitations expire after 7 days. If you weren&apos;t expecting this, you can ignore the
        email.
      </Footer>
    </Barebone>
  );
}
