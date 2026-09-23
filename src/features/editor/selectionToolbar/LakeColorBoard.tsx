/**
 * 颜色面板：复用内核颜色面板的 CSS 组件类（lake-colorboard*）+ 内核调色板数据。
 *
 * 为什么不是 import 内核组件：内核的大色板面板是模块内部件（bundle 内 erD，全仓仅 2 处引用：
 * 定义 + 固定工具栏颜色按钮里的 createElement），**未导出**；Doc 顶层 120 个导出与
 * FrameworkUiLib 都没有颜色面板（只有 fontColorIcon/bgColorIcon 两个图标）。故这里只做
 * 「用内核自己的类名与调色板组合」，不另造视觉。
 */
const DEFAULT_LABEL = "默认";

/** 内核调色板（bundle 常量 Zc，经 Zd.getColors() 使用）：中性 10 + 6 组彩色各 10。 */
export const KERNEL_COLOR_GROUPS: string[][] = [
  ["#000000", "#262626", "#595959", "#8C8C8C", "#BFBFBF", "#D9D9D9", "#E9E9E9", "#F5F5F5", "#FAFAFA", "#FFFFFF"],
  ["#F5222D", "#FA541C", "#FA8C16", "#FADB14", "#52C41A", "#13C2C2", "#1890FF", "#2F54EB", "#722ED1", "#EB2F96"],
  ["#FFE8E6", "#FFECE0", "#FFEFD1", "#FCFCCA", "#E4F7D2", "#D3F5F0", "#D4EEFC", "#DEE8FC", "#EFE1FA", "#FAE1EB"],
  ["#FFA39E", "#FFBB96", "#FFD591", "#FFFB8F", "#B7EB8F", "#87E8DE", "#91D5FF", "#ADC6FF", "#D3ADF7", "#FFADD2"],
  ["#FF4D4F", "#FF7A45", "#FFA940", "#FFEC3D", "#73D13D", "#36CFC9", "#40A9FF", "#597EF7", "#9254DE", "#F759AB"],
  ["#CF1322", "#D4380D", "#D46B08", "#D4B106", "#389E0D", "#08979C", "#096DD9", "#1D39C4", "#531DAB", "#C41D7F"],
  ["#820014", "#871400", "#873800", "#614700", "#135200", "#00474F", "#003A8C", "#061178", "#22075E", "#780650"],
];

/** 浅色/深色判定（内核同一套：按亮度决定是否需要描边 & 勾选色）。 */
function needsBorder(hex: string): boolean {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (299 * r + 587 * g + 114 * b) / 1000 >= 240;
}
function checkFill(hex: string): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return "#FFFFFF";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (299 * r + 587 * g + 114 * b) / 1000 >= 210 ? "#8C8C8C" : "#FFFFFF";
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
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSelect(color); }}
    >
      <span style={special ? undefined : { backgroundColor: color }}>
        {active ? (
          <svg viewBox="0 0 18 18"><path fill={checkFill(color)} d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z" /></svg>
        ) : null}
      </span>
    </span>
  );
}

/** 与内核一致的颜色面板：默认行 + 调色板分组 +（更多颜色改由上层输入处理）。 */
export function LakeColorBoard({ value, onSelect }: { value: string; onSelect: (color: string) => void }) {
  const v = (value || "").toLowerCase();
  return (
    <div className="lake-colorboard">
      <div className="lake-colorboard-default" onClick={() => onSelect("")}>
        <span className="lake-colorboard-group-item lake-colorboard-group-item-border" title={DEFAULT_LABEL}>
          <span style={{ backgroundColor: "#000000" }} />
        </span>
        <span className="selection-toolbar__colorboard-label">{DEFAULT_LABEL}</span>
      </div>
      {KERNEL_COLOR_GROUPS.map((row, i) => (
        <div className="lake-colorboard-group" key={i}>
          {row.map((c) => <Swatch key={c} color={c} active={v === c.toLowerCase()} onSelect={onSelect} />)}
        </div>
      ))}
      <div className="lake-more-color">
        <label className="lake-more-color-container">
          <span className="lake-more-color-preview" />
          <span>更多颜色</span>
          <input className="selection-toolbar__nativecolor" type="color" value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"} onChange={(e) => onSelect(e.target.value)} aria-label="更多颜色" />
          <span className="selection-toolbar__more-arrow ne-icon ne-icon-kitchen ne-icon-right-arrow" data-name="right-arrow"><svg className="ne-icon-symbol" aria-hidden="true"><use xlinkHref="#icon-right-arrow" /></svg></span>
        </label>
      </div>
    </div>
  );
}
