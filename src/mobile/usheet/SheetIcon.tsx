/** 表格 chrome 的内核无关图标（lucide，描边 1.75；语雀自有 sprite 不能照搬，只按语义映射）。 */
import {
  AlignLeft, AlignVerticalJustifyCenter, ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine,
  ArrowUpDown, ArrowUpToLine, Baseline, Bold, ChartColumn, Columns3, Filter, Grid2x2, Italic,
  Link2, Lock, Merge, Minus, PaintBucket, Plus, Rows3, Search, Sigma, Snowflake,
  SquareDashedMousePointer, Strikethrough, Table2, Type, Underline, UnfoldHorizontal,
  UnfoldVertical, WrapText, Wrench,
} from "lucide-react";

const ICONS = {
  minus: Minus, plus: Plus, type: Type, bold: Bold, italic: Italic, strike: Strikethrough,
  underline: Underline, baseline: Baseline, paintbucket: PaintBucket, grid: Grid2x2,
  "align-left": AlignLeft, "align-vertical": AlignVerticalJustifyCenter, wrap: WrapText,
  merge: Merge, filter: Filter, sort: ArrowUpDown, table: Table2, link: Link2,
  select: SquareDashedMousePointer, chart: ChartColumn, sigma: Sigma, freeze: Snowflake,
  lock: Lock, search: Search, "row-height": UnfoldVertical, "col-width": UnfoldHorizontal,
  rows: Rows3, columns: Columns3, wrench: Wrench, "row-above": ArrowUpToLine,
  "row-below": ArrowDownToLine, "col-left": ArrowLeftToLine, "col-right": ArrowRightToLine,
} as const;

export type SheetIconName = keyof typeof ICONS;

export function SheetIcon({ name, size = 18 }: { name: string; size?: number }) {
  const Icon = ICONS[name as SheetIconName] ?? Grid2x2;
  return <Icon size={size} strokeWidth={1.75} aria-hidden="true" />;
}
