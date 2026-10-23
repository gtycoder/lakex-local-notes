/**
 * 移动端表格编辑态面板（261023 定稿：面板**占住键盘区域**展开，dock 停在面板上沿）。
 *
 * 五块（与 SheetDock 一级按钮一一对应）：
 * 插入 = 上排 4 连块（插入行列，钉钉式）+ 4 列白块（文档插入面板同款，公式在「更多」里）。
 * T   = 文档 T 面板同款白条：B/I/S/U ｜ 水平对齐 + 垂直对齐 ｜ 字色 9 ｜ 填充两行 ｜ 字号 8 档。
 * 数据 = 升序 / 降序 / 筛选开关 / 查找替换 + 占位（数据验证、分列）。
 * 视图 = 冻结行列 / 表单视图（占位）/ 图表视图（占位）+ 视图比例。
 * 更多 = 数字格式 / 边框 / 公式（面板内下钻）+ 合并 / 格式刷 / 清除格式 + 条件格式（占位）。
 *
 * 纯展示：所有动作经 props 抛给 MobileUsheetViewer（命令分派仍在 useSheetCommandActions）。
 */
import { ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine, ArrowUpToLine, ChevronLeft, Image, Link2, MessageSquare, Paperclip, PenLine, Calendar, ChartColumn } from "lucide-react";
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

function FormatPanel({ fmt, onFormat, onAlignH, onAlignV, onFontColor, onFill, onFontSize }: SheetDockPanelProps) {
  const alignCurrent = fmt.align === "normal" ? "right" : fmt.align;
  return (
    <div className="mb-usheet-fpanel">
      {/* 第一行：B / I / U / S（一张卡） */}
      <div className="mb-usheet-frow">
        <div className="mb-usheet-fcard" data-count={SHEET_FORMAT_TOGGLES.length}>
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
        </div>
      </div>
      {/* 第二行：水平对齐 + 垂直对齐（两张卡按条目数分宽） */}
      <div className="mb-usheet-frow">
        <div className="mb-usheet-fcard" data-count={SHEET_ALIGN_H.length} role="group" aria-label="水平对齐">
          {SHEET_ALIGN_H.map((item) => (
            <button
              key={item.id}
              type="button"
              className={"mb-usheet-fbtn" + (alignCurrent === item.id ? " is-on" : "")}
              aria-label={"水平对齐 " + item.label}
              onClick={() => onAlignH(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="mb-usheet-fcard" data-count={SHEET_ALIGN_V.length} role="group" aria-label="垂直对齐">
          {SHEET_ALIGN_V.map((item) => (
            <button
              key={item.id}
              type="button"
              className={"mb-usheet-fbtn" + ((fmt.valign || "middle") === item.id ? " is-on" : "")}
              aria-label={"垂直对齐 " + item.label}
              onClick={() => onAlignV(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {/* 第三行：字体颜色（A × 8） */}
      <div className="mb-usheet-frow">
        <div className="mb-usheet-fcard mb-usheet-fcolors" data-count={SHEET_FONT_COLORS.length} role="group" aria-label="字体颜色">
          {SHEET_FONT_COLORS.map((color) => (
            <button
              key={color.id}
              type="button"
              className="mb-usheet-fbtn"
              aria-label={"字体颜色 " + color.label}
              onClick={() => onFontColor(color.value)}
            >
              <span className="mb-usheet-fA" style={color.value ? { color: color.value } : undefined}>A</span>
            </button>
          ))}
        </div>
      </div>
      {/* 第四行：背景填充（两行圆点，照文档语雀式色板） */}
      <div className="mb-usheet-frow">
        <div className="mb-usheet-fcard mb-usheet-fboard" role="group" aria-label="背景填充">
          <div className="mb-usheet-fboard-row">
            {SHEET_FILL_LIGHT.map((fill) => (
              <button
                key={fill.id}
                type="button"
                className={"mb-usheet-fsw" + (fill.value ? "" : " mb-usheet-fsw--none")}
                style={fill.value ? { background: fill.value } : undefined}
                aria-label={"背景填充 " + fill.label}
                onClick={() => onFill(fill.value)}
              />
            ))}
          </div>
          <div className="mb-usheet-fboard-row">
            {SHEET_FILL_STRONG.map((fill) => (
              <button
                key={fill.id}
                type="button"
                className="mb-usheet-fsw"
                style={{ background: fill.value }}
                aria-label={"背景填充 " + fill.label}
                onClick={() => onFill(fill.value)}
              />
            ))}
          </div>
        </div>
      </div>
      {/* 第五行：字号（一行常用档） */}
      <div className="mb-usheet-frow">
        <div className="mb-usheet-fcard mb-usheet-fsizes" role="group" aria-label="字号">
          {SHEET_FONT_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              className={"mb-usheet-fbtn" + ((fmt.size || 14) === size ? " is-on" : "")}
              aria-label={"字号 " + size}
              onClick={() => onFontSize(size)}
            >
              {size}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
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
          <span>{row.label}</span>
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
            <span>{row.label}</span>
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
          <span>{row.label}</span>
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
            <span>{item.label}</span>
            {item.note ? <span className="mb-usheet-row__note">{item.note}</span> : null}
          </button>
        ))}
      </div>
    </>
  );
}

export default SheetDockPanel;
