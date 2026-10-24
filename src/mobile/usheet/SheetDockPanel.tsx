/**
 * 移动端表格编辑态面板（261023 定稿：面板**占住键盘区域**展开，dock 停在面板上沿）。
 *
 * 五块（与 SheetDock 一级按钮一一对应）：
 * 插入 = 上排 4 连块（插入行列）+ 4 列白块（公式在「更多」里）。
 * T   = 261024 样式对齐钉钉：12px 分组标题（字体 / 字体颜色 / 背景填充）+ 浅灰圆角 chip；
 *       字号改「− 当前 +」步进；色板改 40×40 圆角 4 方块，当前色 = 浅蓝底。
 * 数据 = 升序 / 降序 / 筛选开关 / 查找替换 + 占位（数据验证、分列），行首 20px 线性图标。
 * 视图 = 冻结行列 / 表单视图（占位）/ 图表视图（占位）+ 视图比例。
 * 更多 = 数字格式 / 边框 / 公式（面板内下钻）+ 合并 / 格式刷 / 清除格式 + 条件格式（占位）。
 *
 * 纯展示：所有动作经 props 抛给 MobileUsheetViewer（命令分派仍在 useSheetCommandActions）。
 */
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDownAZ,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpAZ,
  ArrowUpToLine,
  Calendar,
  ChartColumn,
  ChevronLeft,
  Columns2,
  Eraser,
  FileText,
  Filter,
  FunctionSquare,
  Hash,
  Image,
  Link2,
  ListChecks,
  Merge,
  MessageSquare,
  Minus,
  Paintbrush,
  Paperclip,
  PenLine,
  Plus,
  Search,
  SlidersHorizontal,
  Snowflake,
  SquareDashed,
} from "lucide-react";
import {
  SHEET_ALIGN_H,
  SHEET_ALIGN_V,
  SHEET_DATA_ROWS,
  SHEET_DOCK_ITEMS,
  SHEET_FILL_LIGHT,
  SHEET_FILL_STRONG,
  SHEET_FONT_COLORS,
  SHEET_FONT_SIZES,
  SHEET_FORMAT_TOGGLES,
  SHEET_INSERTER_ACTIONS,
  SHEET_INSERT_TILES,
  SHEET_MORE_ROWS,
  SHEET_VIEW_ROWS,
  SHEET_ZOOM_LEVELS,
  buildMoreSubMenu,
  sheetColorEquals,
  type SheetCellFormatLite,
  type SheetDockId,
  type SheetMoreId,
} from "./usheetChromeModel";

const INS_ICONS = {
  "row-above": ArrowUpToLine,
  "row-below": ArrowDownToLine,
  "col-left": ArrowLeftToLine,
  "col-right": ArrowRightToLine,
} as const;

const TILE_ICONS = {
  image: Image,
  sign: PenLine,
  link: Link2,
  date: Calendar,
  attachment: Paperclip,
  chart: ChartColumn,
  comment: MessageSquare,
} as const;

/** 面板列表行的行首图标（模型里只存 id，组件映射在这里，单一来源）。 */
const ROW_ICONS: Record<string, typeof Search> = {
  sortAsc: ArrowUpAZ,
  sortDesc: ArrowDownAZ,
  filter: Filter,
  find: Search,
  validation: ListChecks,
  split: Columns2,
  freeze: Snowflake,
  form: FileText,
  chart: ChartColumn,
  number: Hash,
  border: SquareDashed,
  formula: FunctionSquare,
  merge: Merge,
  painter: Paintbrush,
  clear: Eraser,
  conditional: SlidersHorizontal,
};

export interface SheetDockPanelProps {
  open: SheetDockId;
  fmt: SheetCellFormatLite;
  filterOn: boolean;
  freeze: "none" | "row" | "col";
  zoom: number;
  sub: "numfmt" | "border" | "formula" | null;
  onInsert: (id: string) => void;
  onFormat: (id: string) => void;
  onAlignH: (value: "left" | "center" | "right") => void;
  onAlignV: (value: "top" | "middle" | "bottom") => void;
  onFontColor: (value: string) => void;
  onFill: (value: string) => void;
  onFontSize: (size: number) => void;
  /** 清除格式（放在「字体」分组末尾）。 */
  onClearFormat: () => void;
  onData: (id: string) => void;
  onView: (id: string) => void;
  onZoom: (value: number) => void;
  onMore: (id: SheetMoreId) => void;
  onMoreSub: (id: string) => void;
  onSubBack: () => void;
}

export function SheetDockPanel(props: SheetDockPanelProps) {
  const { open, sub } = props;
  return (
    <div className="mb-usheet-panel__body" data-open={open} role="region" aria-label={SHEET_DOCK_ITEMS.find((item) => item.id === open)?.label}>
      {open === "insert" ? <InsertPanel {...props} /> : null}
      {open === "format" ? <FormatPanel {...props} /> : null}
      {open === "data" ? <DataPanel {...props} /> : null}
      {open === "view" ? <ViewPanel {...props} /> : null}
      {open === "more" ? (sub ? <MoreSubPanel {...props} sub={sub} /> : <MorePanel {...props} />) : null}
    </div>
  );
}

function InsertPanel({ onInsert }: SheetDockPanelProps) {
  return (
    <>
      <div className="mb-usheet-inserter" role="group" aria-label="插入行列">
        {SHEET_INSERTER_ACTIONS.map((action) => {
          const Icon = INS_ICONS[action.id];
          return (
            <button key={action.id} type="button" className="mb-usheet-inserter__btn" aria-label={action.label} title={action.label} onClick={() => onInsert(action.id)}>
              <Icon size={26} />
            </button>
          );
        })}
      </div>
      <div className="mb-usheet-tiles" role="group" aria-label="插入内容">
        {SHEET_INSERT_TILES.map((tile) => {
          const Icon = TILE_ICONS[tile.id];
          return (
            <button
              key={tile.id}
              type="button"
              className={"mb-usheet-tile" + (tile.disabled ? " is-disabled" : "")}
              aria-label={tile.label}
              aria-disabled={tile.disabled ? "true" : undefined}
              disabled={tile.disabled}
              onClick={() => onInsert(tile.id)}
            >
              <Icon size={22} />
              <span>{tile.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

const ALIGN_H_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight } as const;
const ALIGN_V_ICONS = {
  top: AlignVerticalJustifyStart,
  middle: AlignVerticalJustifyCenter,
  bottom: AlignVerticalJustifyEnd,
} as const;

/** 字号步进：− 当前 +（钉钉同款；档位仍用 SHEET_FONT_SIZES，显示真实字号）。 */
function FontSizeStepper({ size, onFontSize }: { size?: number; onFontSize: (size: number) => void }) {
  const current = size || 14;
  let index = SHEET_FONT_SIZES.findIndex((value) => value >= current);
  if (index < 0) index = SHEET_FONT_SIZES.length - 1;
  const prev = SHEET_FONT_SIZES[Math.max(0, index - 1)];
  const next = SHEET_FONT_SIZES[Math.min(SHEET_FONT_SIZES.length - 1, index + 1)];
  return (
    <div className="mb-usheet-fcard mb-usheet-fsize" role="group" aria-label="字号">
      <button type="button" className="mb-usheet-fbtn" aria-label="减小字号" title="减小字号" disabled={current <= SHEET_FONT_SIZES[0]} onClick={() => onFontSize(prev)}>
        <Minus size={18} />
      </button>
      <span className="mb-usheet-fsize__value" aria-label="当前字号">{current}</span>
      <button type="button" className="mb-usheet-fbtn" aria-label="增大字号" title="增大字号" disabled={current >= SHEET_FONT_SIZES[SHEET_FONT_SIZES.length - 1]} onClick={() => onFontSize(next)}>
        <Plus size={18} />
      </button>
    </div>
  );
}

function FormatPanel({ fmt, onFormat, onAlignH, onAlignV, onFontColor, onFill, onFontSize, onClearFormat }: SheetDockPanelProps) {
  const alignCurrent = fmt.align === "normal" ? "right" : fmt.align;
  // 内核默认垂直对齐读出来是 general；视觉上等价于居中，反显要落在「中」上。
  const valignCurrent = !fmt.valign || fmt.valign === "general" ? "middle" : fmt.valign;
  return (
    <div className="mb-usheet-fpanel">
      <section className="mb-usheet-fsection">
        <div className="mb-usheet-fsection__title">字体</div>
        <div className="mb-usheet-frow">
          <FontSizeStepper size={fmt.size} onFontSize={onFontSize} />
          <div className="mb-usheet-fcard" data-count={SHEET_FORMAT_TOGGLES.length + 1}>
            {SHEET_FORMAT_TOGGLES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={"mb-usheet-fbtn" + (fmt[item.id] ? " is-on" : "")}
                aria-label={item.label}
                aria-pressed={Boolean(fmt[item.id])}
                onClick={() => onFormat(item.id)}
              >
                <span className="mb-usheet-fglyph" data-style={item.id}>{item.glyph}</span>
              </button>
            ))}
            <button type="button" className="mb-usheet-fbtn" aria-label="清除格式" title="清除格式" onClick={onClearFormat}>
              <Eraser size={20} />
            </button>
          </div>
        </div>
        <div className="mb-usheet-frow">
          <div className="mb-usheet-fcard" data-count={SHEET_ALIGN_H.length} role="group" aria-label="水平对齐">
            {SHEET_ALIGN_H.map((item) => {
              const Icon = ALIGN_H_ICONS[item.id];
              return (
                <button
                  key={item.id}
                  type="button"
                  className={"mb-usheet-fbtn" + (alignCurrent === item.id ? " is-on" : "")}
                  aria-label={"水平对齐 " + item.label}
                  title={"水平对齐 " + item.label}
                  onClick={() => onAlignH(item.id)}
                >
                  <Icon size={20} />
                </button>
              );
            })}
          </div>
          <div className="mb-usheet-fcard" data-count={SHEET_ALIGN_V.length} role="group" aria-label="垂直对齐">
            {SHEET_ALIGN_V.map((item) => {
              const Icon = ALIGN_V_ICONS[item.id];
              return (
                <button
                  key={item.id}
                  type="button"
                  className={"mb-usheet-fbtn" + (valignCurrent === item.id ? " is-on" : "")}
                  aria-label={"垂直对齐 " + item.label}
                  title={"垂直对齐 " + item.label}
                  onClick={() => onAlignV(item.id)}
                >
                  <Icon size={20} />
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mb-usheet-fsection">
        <div className="mb-usheet-fsection__title">字体颜色</div>
        <div className="mb-usheet-ccolors" role="group" aria-label="字体颜色">
          {SHEET_FONT_COLORS.map((color) => {
            const on = sheetColorEquals(fmt.fontColor, color.value);
            return (
              <button
                key={color.id}
                type="button"
                className={"mb-usheet-ccolor" + (on ? " is-on" : "")}
                aria-label={"字体颜色 " + color.label}
                aria-pressed={on}
                onClick={() => onFontColor(color.value)}
              >
                <span className="mb-usheet-fA" style={color.value ? { color: color.value } : undefined}>A</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mb-usheet-fsection">
        <div className="mb-usheet-fsection__title">背景填充</div>
        <div className="mb-usheet-ccolors mb-usheet-ccolors--stack" role="group" aria-label="背景填充">
          <div className="mb-usheet-ccolors__row">
            {SHEET_FILL_LIGHT.map((fill) => {
              const on = sheetColorEquals(fmt.bgColor, fill.value);
              return (
                <button
                  key={fill.id}
                  type="button"
                  className={"mb-usheet-ccolor" + (on ? " is-on" : "")}
                  aria-label={"背景填充 " + fill.label}
                  aria-pressed={on}
                  onClick={() => onFill(fill.value)}
                >
                  <span className={"mb-usheet-cdot" + (fill.value ? "" : " mb-usheet-cdot--none")} style={fill.value ? { background: fill.value } : undefined} />
                </button>
              );
            })}
          </div>
          <div className="mb-usheet-ccolors__row">
            {SHEET_FILL_STRONG.map((fill) => {
              const on = sheetColorEquals(fmt.bgColor, fill.value);
              return (
                <button
                  key={fill.id}
                  type="button"
                  className={"mb-usheet-ccolor" + (on ? " is-on" : "")}
                  aria-label={"背景填充 " + fill.label}
                  aria-pressed={on}
                  onClick={() => onFill(fill.value)}
                >
                  <span className="mb-usheet-cdot" style={{ background: fill.value }} />
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

function RowIcon({ icon }: { icon?: string }) {
  const Icon = icon ? ROW_ICONS[icon] : undefined;
  if (!Icon) return null;
  return <Icon size={20} className="mb-usheet-row__icon" aria-hidden="true" />;
}

function DataPanel({ filterOn, onData }: SheetDockPanelProps) {
  return (
    <div className="mb-usheet-rows">
      {SHEET_DATA_ROWS.map((row) => (
        <button
          key={row.id}
          type="button"
          className={"mb-usheet-row" + (row.disabled ? " is-disabled" : "")}
          aria-label={row.label}
          disabled={row.disabled}
          onClick={() => onData(row.id)}
        >
          <RowIcon icon={row.icon} />
          <span className="mb-usheet-row__label">{row.label}</span>
          {row.switch ? <span className={"mb-usheet-switch" + (filterOn ? " is-on" : "")} /> : null}
          {row.note ? <span className="mb-usheet-row__note">{row.note}</span> : null}
        </button>
      ))}
    </div>
  );
}

function ViewPanel({ freeze, zoom, onView, onZoom }: SheetDockPanelProps) {
  const freezeText = freeze === "none" ? "未冻结" : freeze === "row" ? "首行" : "首列";
  return (
    <>
      <div className="mb-usheet-rows">
        {SHEET_VIEW_ROWS.map((row) => (
          <button
            key={row.id}
            type="button"
            className={"mb-usheet-row" + (row.disabled ? " is-disabled" : "")}
            aria-label={row.label}
            disabled={row.disabled}
            onClick={() => onView(row.id)}
          >
            <RowIcon icon={row.icon} />
            <span className="mb-usheet-row__label">{row.label}</span>
            {row.id === "freeze" ? <span className="mb-usheet-row__note">{freezeText}</span> : null}
            {row.note ? <span className="mb-usheet-row__note">{row.note}</span> : null}
          </button>
        ))}
      </div>
      <div className="mb-usheet-bar" role="group" aria-label="视图比例">
        {SHEET_ZOOM_LEVELS.map((level) => (
          <button
            key={level.id}
            type="button"
            className={"mb-usheet-bar__cell" + (Math.abs(zoom - level.value) < 0.001 ? " is-active" : "")}
            aria-label={level.label}
            onClick={() => onZoom(level.value)}
          >
            {level.label}
          </button>
        ))}
      </div>
    </>
  );
}

function MorePanel({ onMore }: SheetDockPanelProps) {
  return (
    <div className="mb-usheet-rows">
      {SHEET_MORE_ROWS.map((row) => (
        <button
          key={row.id}
          type="button"
          className={"mb-usheet-row" + (row.disabled ? " is-disabled" : "") + (["numfmt", "border", "formula"].includes(row.id) ? " has-child" : "")}
          aria-label={row.label}
          disabled={row.disabled}
          onClick={() => onMore(row.id)}
        >
          <RowIcon icon={row.icon} />
          <span className="mb-usheet-row__label">{row.label}</span>
          {row.disabled ? <span className="mb-usheet-row__note">暂不支持</span> : null}
        </button>
      ))}
    </div>
  );
}

function MoreSubPanel({ sub, fmt, onMoreSub, onSubBack }: SheetDockPanelProps & { sub: "numfmt" | "border" | "formula" }) {
  const items = buildMoreSubMenu(sub, fmt.numfmt);
  const title = sub === "numfmt" ? "数字格式" : sub === "border" ? "边框" : "公式";
  return (
    <>
      <button type="button" className="mb-usheet-back" onClick={onSubBack}>
        <ChevronLeft size={16} />
        <span>{title}</span>
      </button>
      <div className="mb-usheet-rows">
        {items.map((item) => (
          <button key={item.id} type="button" className="mb-usheet-row" aria-label={item.label} onClick={() => onMoreSub(item.id)}>
            <span className="mb-usheet-row__label">{item.label}</span>
            {item.note ? <span className="mb-usheet-row__note">{item.note}</span> : null}
          </button>
        ))}
      </div>
    </>
  );
}

export default SheetDockPanel;
