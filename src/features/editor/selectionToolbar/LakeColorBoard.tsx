/**
 * 颜色面板：复用内核颜色面板的 CSS 组件类（lake-colorboard*）+ 内核调色板数据。
 *
 * 为什么不是 import 内核组件：内核的大色板面板是模块内部件（bundle 内 erD，全仓仅 2 处引用：
 * 定义 + 固定工具栏颜色按钮里的 createElement），**未导出**；Doc 顶层 120 个导出与
 * FrameworkUiLib 都没有颜色面板（只有 fontColorIcon/bgColorIcon 两个图标）。故这里只做
 * 「用内核自己的类名与调色板组合」，不另造视觉。
 */
import { COLOR_BOARD_GROUPS, isLightColor } from "../../../core/colorPalette.js";
/** 文字色 = 默认；背景色 = 无填充色（内核 i18n defaultColor / nonFillColor）。 */
const TEXT_DEFAULT_LABEL = "默认";
const BG_NO_FILL_LABEL = "无填充色";
const RECENT_LABEL = "最近使用自定义颜色";
const RECENT_EMPTY = "暂无";

/** 浅色/深色判定（内核同一套：按亮度决定是否需要描边 & 勾选色）。 */
const needsBorder = (hex: string): boolean => isLightColor(hex);

/** 选中对勾的两个「固定对比色」：叠在**任意用户色** swatch 上，判据是该 swatch 的亮度
 *  （isLightColor），与主题明暗无关 ⇒ 只是专用调色板令牌（themes/base.css），不做主题分档。 */
const CHECK_INK = "var(--lake-colorboard-check-ink)";
const CHECK_PAPER = "var(--lake-colorboard-check-paper)";
function checkFill(hex: string): string {
  return isLightColor(hex, 210) ? CHECK_INK : CHECK_PAPER;
}

/** 「默认」行的文字色样块（= 黑色文字的含义，不是 UI 语义色，故不走 --lake-text-*）。 */
const DEFAULT_SWATCH = "var(--lake-colorboard-default-swatch)";

/** `<input type="color">` 的兜底值：HTML 属性里不能写 var()，所以这一处必须留颜色字面量。
 *  它不是绘制色（只是表单控件初值），是全文件唯一残留的 hex（登记在 C-PATH-PLAN 执行记录）。 */
const NATIVE_COLOR_FALLBACK = "#000000";

/** 选中对勾（24 网格）。原实现把 24 网格的 Material 对勾塞进 `viewBox="0 0 18 18"`，
 *  而路径范围 x∈[3.5,21] / y∈[5.59,19] ⇒ 右下两笔被 svg 视窗裁掉（261116 修：只改视窗，几何不动）。 */
function BoardCheck({ fill }: { fill: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill={fill} d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z" />
    </svg>
  );
}

function Swatch({ color, active, onSelect }: { color: string; active: boolean; onSelect: (c: string) => void }) {
  const special = color === "transparent";
  const border = special || needsBorder(color);
  return (
    <span
      className={"lake-colorboard-group-item"
        + (border ? " lake-colorboard-group-item-border" : "")
        + (special ? " lake-colorboard-group-item-border-none lake-colorboard-group-item-special" : "")
        + (active ? " lake-colorboard-group-item-active" : "")}
      title={color}
      role="button"
      tabIndex={0}
      aria-label={"选择颜色 " + color}
      aria-pressed={active}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSelect(color); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onSelect(color); } }}
    >
      <span style={special ? undefined : { backgroundColor: color }}>
        {active ? (
          <BoardCheck fill={checkFill(color)} />
        ) : null}
      </span>
    </span>
  );
}

/** 与内核一致的颜色面板：默认/无填充行 + 调色板分组 + 最近使用 + 更多颜色。
 * variant="text" → 默认（文字色）；variant="bg" → 无填充色（背景色，带斜线，内核 nonFillColor）。 */
export function LakeColorBoard({ value, onSelect, variant = "text" }: { value: string; onSelect: (color: string) => void; variant?: "text" | "bg" }) {
  const v = (value || "").toLowerCase();
  const noFill = variant === "bg";
  const rowLabel = noFill ? BG_NO_FILL_LABEL : TEXT_DEFAULT_LABEL;
  const rowActive = !v;
  return (
    <div className="lake-colorboard">
      <div
        className="lake-colorboard-default"
        role="button"
        tabIndex={0}
        aria-label={rowLabel}
        aria-pressed={rowActive}
        onClick={() => onSelect("")}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(""); } }}
      >
        <span
          className={"lake-colorboard-group-item"
            + (noFill ? " lake-colorboard-group-item-special" : " lake-colorboard-group-item-border")
            + (rowActive ? " lake-colorboard-group-item-active" : "")}
          title={rowLabel}
          aria-hidden="true"
        >
          <span style={noFill ? undefined : { backgroundColor: DEFAULT_SWATCH }}>
            {rowActive && !noFill ? <BoardCheck fill={CHECK_PAPER} /> : null}
          </span>
        </span>
        <span className="selection-toolbar__colorboard-label">{rowLabel}</span>
      </div>
      {COLOR_BOARD_GROUPS.map((row, i) => (
        <div className="lake-colorboard-group" key={i}>
          {row.map((c) => <Swatch key={c} color={c} active={v === c.toLowerCase()} onSelect={onSelect} />)}
        </div>
      ))}
      <div className="lake-color-history">{RECENT_LABEL}</div>
      <div className="lake-none-custom-color">{RECENT_EMPTY}</div>
      <div className="lake-more-color">
        <label className="lake-more-color-container">
          <span className="lake-more-color-preview" />
          <span>更多颜色</span>
          <input className="selection-toolbar__nativecolor" type="color" value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : NATIVE_COLOR_FALLBACK} onChange={(e) => onSelect(e.target.value)} aria-label="更多颜色" />
          <span className="selection-toolbar__more-arrow ne-icon ne-icon-kitchen ne-icon-right-arrow" data-name="right-arrow"><svg className="ne-icon-symbol" aria-hidden="true"><use xlinkHref="#icon-right-arrow" /></svg></span>
        </label>
      </div>
    </div>
  );
}
