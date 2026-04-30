import * as React from "react";
import { Button, Section, Text } from "@react-email/components";

import { defaultBrandConfig, type BrandConfig } from "../brand.js";

/**
 * Call-to-action block — primary button with a fallback URL line.
 *
 * Email clients sometimes strip linked buttons (Outlook with strict
 * security, plain-text mode); the secondary URL paragraph below the
 * button keeps the action reachable as a copyable link. Button color
 * is pulled from the brand config so a single brand tweak repaints
 * every CTA across all templates.
 */
export interface CTAProps {
  /** Destination URL — also rendered as a fallback copy-paste link. */
  href: string;
  /** Optional brand override; defaults to the built-in brand config. */
  brand?: BrandConfig;
  children: React.ReactNode;
}

export function CTA(props: CTAProps): React.ReactElement {
  const brand = props.brand ?? defaultBrandConfig();
  return (
    <Section style={{ padding: "8px 0" }}>
      <Button
        href={props.href}
        style={{
          display: "inline-block",
          padding: "12px 24px",
          borderRadius: 8,
          background: brand.primaryColor,
          color: brand.primaryColorInk,
          textDecoration: "none",
          fontWeight: 600,
          fontSize: 14,
          letterSpacing: "0.01em",
        }}
      >
        {props.children}
      </Button>
      <Text
        style={{
          margin: "12px 0 4px",
          fontSize: 12,
          color: brand.mutedTextColor,
        }}
      >
        If the button doesn&apos;t work, paste this URL into your browser:
      </Text>
      <Text
        style={{
          margin: 0,
          fontSize: 12,
          wordBreak: "break-all",
          fontFamily: "'SFMono-Regular', Menlo, Consolas, monospace",
        }}
      >
        <a href={props.href} style={{ color: brand.primaryColor, textDecoration: "none" }}>
          {props.href}
        </a>
      </Text>
    </Section>
  );
}
