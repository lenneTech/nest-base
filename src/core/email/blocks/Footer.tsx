import * as React from "react";
import { Section, Text } from "@react-email/components";

import { defaultBrandConfig, type BrandConfig } from "../brand.js";

/**
 * Footer block — small print at the bottom of the body. Used for
 * "you can ignore this email" disclaimers + expiration hints. The
 * Barebone layout already renders the legal entity / support row
 * below the body, so this block is for *body-level* footers only.
 */
export interface FooterProps {
  /** Optional brand override; defaults to the built-in brand config. */
  brand?: BrandConfig;
  children: React.ReactNode;
}

export function Footer(props: FooterProps): React.ReactElement {
  const brand = props.brand ?? defaultBrandConfig();
  return (
    <Section
      style={{
        marginTop: 24,
        paddingTop: 18,
        borderTop: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <Text
        style={{
          margin: 0,
          fontSize: 12,
          color: brand.mutedTextColor,
          lineHeight: 1.6,
        }}
      >
        {props.children}
      </Text>
    </Section>
  );
}
