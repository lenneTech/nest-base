import * as React from "react";

import { Barebone } from "../layouts/Barebone.js";
import { CTA, Footer, Greeting, Paragraph } from "../blocks/index.js";
import type { BrandConfig } from "../brand.js";

/**
 * New-device template (issue #13).
 *
 * Sent when a sign-in lands a previously-unseen fingerprint for
 * the user. Voice is "neutral notification, action button to revoke
 * if it wasn't you" — not a security alarm. Modern auth hygiene.
 *
 * The body intentionally omits exact lat/lng even when GeoIP
 * supplied them. We surface only `City, Country` (or "Location
 * unknown") + the raw IP — the IP is what an attentive user can
 * cross-check against their own router / VPN. Lat/lng would add
 * tracking-vibe without giving the user anything actionable.
 */
export interface NewDeviceVars {
  recipientName: string;
  appName: string;
  deviceLabel: string;
  location: string;
  ipAddress: string;
  signedInAt: string;
  revokeUrl: string;
}

export const newDeviceMeta = {
  name: "new-device",
  subject: (vars: NewDeviceVars): string => `New sign-in to ${vars.appName}`,
};

export interface NewDeviceProps extends NewDeviceVars {
  brand?: BrandConfig;
}

export default function NewDevice(props: NewDeviceProps): React.ReactElement {
  return (
    <Barebone
      brand={props.brand}
      preheader={`A new device just signed in to your ${props.appName} account`}
    >
      <Greeting brand={props.brand}>Hello {props.recipientName},</Greeting>
      <Paragraph brand={props.brand}>
        We noticed a new sign-in to your {props.appName} account. If this was you, no further action
        is needed.
      </Paragraph>
      <Paragraph brand={props.brand}>Device: {props.deviceLabel}</Paragraph>
      <Paragraph brand={props.brand}>Location: {props.location}</Paragraph>
      <Paragraph brand={props.brand}>IP address: {props.ipAddress}</Paragraph>
      <Paragraph brand={props.brand}>Time: {props.signedInAt}</Paragraph>
      <Paragraph brand={props.brand}>
        If you did not sign in, revoke this session immediately and change your password.
      </Paragraph>
      <CTA brand={props.brand} href={props.revokeUrl}>
        Review devices
      </CTA>
      <Footer brand={props.brand}>
        Location is approximate (city / country only). We never store the precise coordinates of
        your sign-in.
      </Footer>
    </Barebone>
  );
}
