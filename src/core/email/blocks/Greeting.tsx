import * as React from "react";
import { Text } from "@react-email/components";

import { defaultBrandConfig, type BrandConfig } from "../brand.js";

/**
 * Greeting block — the bold "Hello {name}," opener at the top of the
 * body. Title-weight, slightly larger than paragraph copy.
 */
export interface GreetingProps {
  /** Optional brand override (textColor); defaults to the built-in brand. */
  brand?: BrandConfig;
  children: React.ReactNode;
}

export function Greeting(props: GreetingProps): React.ReactElement {
  const brand = props.brand ?? defaultBrandConfig();
  return (
    <Text
      style={{
        margin: "0 0 14px",
        fontSize: 18,
        fontWeight: 600,
        color: "#ffffff",
        letterSpacing: "-0.015em",
      }}
      data-block="greeting"
      data-brand-text={brand.textColor}
    >
      {props.children}
    </Text>
  );
}
