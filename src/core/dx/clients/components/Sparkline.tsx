/**
 * Tiny inline-SVG sparkline. Pure presentational — given an array of
 * non-negative numbers, draws an area chart that scales to the
 * container width. No tooltips, no axes — the sidebar just needs a
 * cheap visual rhythm of "is this endpoint active".
 */
import type { ReactNode } from "react";

export interface SparklineProps {
  values: readonly number[];
  width?: number;
  height?: number;
  /** Override default colour (defaults to the dev-portal accent). */
  color?: string;
}

export function Sparkline({ values, width = 96, height = 24, color }: SparklineProps): ReactNode {
  if (values.length === 0) {
    return <span className="dp-sparkline dp-sparkline--empty" aria-hidden="true" />;
  }
  const max = Math.max(1, ...values);
  const stepX = values.length === 1 ? 0 : width / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - (v / max) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  // Closed area shape: bottom-left → first point → … → bottom-right.
  const area = `0,${height} ${points} ${width},${height}`;
  return (
    <svg
      className="dp-sparkline"
      role="img"
      aria-label={`${values.length}-bucket sparkline`}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
    >
      <polygon points={area} fill={color ?? "var(--accent, #c5fb45)"} fillOpacity="0.18" />
      <polyline
        points={points}
        fill="none"
        stroke={color ?? "var(--accent, #c5fb45)"}
        strokeWidth="1.5"
      />
    </svg>
  );
}
