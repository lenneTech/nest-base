import * as React from "react";
import { Text } from "@react-email/components";

import { defaultBrandConfig, type BrandConfig } from "../brand.js";

/**
 * Code block — monospace background-tinted block for one-time codes
 * (verification codes, magic-link tokens, OTP). Stays inline-styled
 * so Gmail/Outlook render the box reliably.
 */
export interface CodeProps {
  /** Optional brand override; defaults to the built-in brand config. */
  brand?: BrandConfig;
  children: React.ReactNode;
}

export function Code(props: CodeProps): React.ReactElement {
  const brand = props.brand ?? defaultBrandConfig();
  return (
    <Text
      style={{
        margin: "12px 0",
        padding: "12px 16px",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 8,
        fontFamily: "'SFMono-Regular', Menlo, Consolas, monospace",
        fontSize: 14,
        color: brand.primaryColor,
        wordBreak: "break-all",
      }}
    >
      {props.children}
    </Text>
  );
}
