import * as React from "react";
import { Text } from "@react-email/components";

import { defaultBrandConfig, type BrandConfig } from "../brand.js";

/**
 * Paragraph block — a single body paragraph with brand-aware text
 * color and comfortable line-height for transactional copy.
 */
export interface ParagraphProps {
  /** Optional brand override; defaults to the built-in brand config. */
  brand?: BrandConfig;
  children: React.ReactNode;
}

export function Paragraph(props: ParagraphProps): React.ReactElement {
  const brand = props.brand ?? defaultBrandConfig();
  return (
    <Text
      style={{
        margin: "0 0 14px",
        fontSize: 15,
        lineHeight: 1.65,
        color: brand.textColor,
      }}
    >
      {props.children}
    </Text>
  );
}
