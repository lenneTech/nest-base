/**
 * Thin recharts re-export that wires the dev-portal CSS-variable
 * colour scheme into chart fills. Components are re-exported directly
 * so callers can import from one place.
 *
 * Kept minimal on purpose — this is not the full shadcn chart primitive,
 * which requires a more complex config pattern. We expose only what the
 * operator dashboard actually uses.
 */
export {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
