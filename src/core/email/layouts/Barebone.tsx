import * as React from "react";

import { Body, Container, Head, Hr, Html, Preview, Section, Text } from "@react-email/components";

import { defaultBrandConfig, type BrandConfig } from "../brand.js";

/**
 * Barebone layout — minimal frame inspired by react.email/01-Barebone.
 *
 * Acts as the default frame around every transactional email: page
 * background, centered card, brand row at the top, footer at the
 * bottom. Templates compose Greeting/Paragraph/CTA/Footer blocks as
 * children — the layout wraps them and applies brand styling.
 *
 * Why a layout split: a single brand-color tweak in `brand.ts`
 * propagates to every template that imports `<Barebone>`. The four
 * built-ins (verification, password-reset, welcome, invitation) all
 * share the same shell — no duplicated frame markup, no four-way
 * find-and-replace when the marketing team wants a new accent color.
 */
export interface BareboneProps {
  /** Inline preview text shown in mail clients before the recipient opens. */
  preheader?: string;
  /** Optional brand override; resolves to `defaultBrandConfig()` when absent. */
  brand?: BrandConfig;
  children: React.ReactNode;
}

export function Barebone(props: BareboneProps): React.ReactElement {
  const brand = props.brand ?? defaultBrandConfig();

  return (
    <Html>
      <Head />
      {props.preheader ? <Preview>{props.preheader}</Preview> : null}
      <Body
        style={{
          margin: 0,
          padding: "24px 16px",
          background: brand.backgroundColor,
          color: brand.textColor,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <Container
          style={{
            maxWidth: 560,
            margin: "0 auto",
            background: brand.surfaceColor,
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          <Section
            style={{
              padding: "24px 28px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <Text
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 600,
                color: "#ffffff",
                letterSpacing: "-0.01em",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  background: brand.primaryColor,
                  borderRadius: 999,
                  marginRight: 8,
                  verticalAlign: "middle",
                }}
              />
              {brand.appName}
            </Text>
          </Section>

          <Section style={{ padding: "28px 28px 20px" }}>{props.children}</Section>

          <Hr style={{ borderColor: "rgba(255,255,255,0.06)", margin: 0 }} />
          <Section
            style={{
              padding: "18px 28px",
              background: "#0c0d11",
              fontSize: 11,
              color: brand.mutedTextColor,
              textAlign: "center",
              letterSpacing: "0.04em",
            }}
          >
            <Text style={{ margin: 0, color: brand.mutedTextColor, fontSize: 11 }}>
              Sent by {brand.legalEntity} · This is an automated message.
            </Text>
            {brand.supportEmail ? (
              <Text style={{ margin: "4px 0 0", color: brand.mutedTextColor, fontSize: 11 }}>
                Need help? {brand.supportEmail}
              </Text>
            ) : null}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
