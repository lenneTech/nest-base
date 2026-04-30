import * as React from "react";
import { Hr } from "@react-email/components";

/**
 * Divider block — thin horizontal rule used between content
 * sections. Stays subtle so it doesn't compete with the CTA button.
 */
export interface DividerProps {
  /** Optional spacing override; defaults to comfortable section padding. */
  spacing?: number;
}

export function Divider(props: DividerProps = {}): React.ReactElement {
  const spacing = props.spacing ?? 18;
  return (
    <Hr
      style={{
        borderColor: "rgba(255,255,255,0.06)",
        margin: `${spacing}px 0`,
      }}
    />
  );
}
