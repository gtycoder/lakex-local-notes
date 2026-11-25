/**
 * 配色合规护栏（P1）—— 261119 配色审计（git 可查）。
 *
 * 钉两件事（判据与审计一致：hex **逐值精确相等**，ΔE 近似不算）：
 * ① 表格三面（字体色 / 背景填充 / 边框内容色）的取值 ⊆ **Univer 桌面色卡 45 预设** ——
 *    消灭「移动端写进正文、桌面端色板选不出」的颜色（审计案 1 已逐值映射，见
 *    `usheetChromeModel.ts` 的 SHEET_* 与 `usheetBorders.ts` 的 USHEET_BORDER_COLOR）。
 * ② 文档 / 手写板 / 应用色板（审计全绿面）⊆ **内核 70 色阶** —— **这批值一个都不许动**，防回归
 *    （值定义在 `src/core/colorPalette.ts` / `src/features/ink/inkPalette.ts`，由并行流维护，本测试只钉包含关系）。
 */
import { describe, expect, it } from "vitest";
import {
  COLOR_BOARD_GROUPS,
  MOBILE_BOARD_LIGHT,
  MOBILE_BOARD_SOLID,
  QUICK_TEXT_COLORS,
} from "../../core/colorPalette";
import { INK_STROKE_COLORS } from "../../features/ink/inkPalette";
import { SHEET_FILL_LIGHT, SHEET_FILL_STRONG, SHEET_FONT_COLORS } from "./usheetChromeModel";
import { USHEET_BORDER_COLOR } from "./usheetBorders";

/**
 * 基线快照：Univer 桌面色卡 45 预设（5 行 × 9）。
 * 来源：`node_modules/@univerjs/design/lib/index.js:3433`（`colorPresets`）——
 * 字体色 / 背景填充 / 边框色三面同一 ColorPicker（sheets-ui TextColorSelector / BackgroundColorSelector / BorderPanel）。
 * ⚠️ 如实口径：本常量是**硬编码快照**，升级 @univerjs/* **不会**让「基线自检」自动变红 ——
 * 升级后必须人工对照 node_modules/@univerjs/design 的 colorPresets 重录本常量、核对 45 预设，
 * 并复核 SHEET_* 映射（步骤见 docs/USHEET-UPGRADE.md §3 playbook 2b）。
 */
const UNIVER_COLOR_PRESETS_45: readonly string[] = [
  "#FFFFFF", "#E1EFFE", "#FDE8E8", "#FEECDC", "#FFF4B9", "#DEF7EC", "#D5F5F6", "#EDEBFE", "#FCE8F3",
  "#CDD0D8", "#A4CAFE", "#F8B4B4", "#FDBA8C", "#FAC815", "#84E1BC", "#7EDCE2", "#CABFFD", "#F8B4D9",
  "#979DAC", "#3F83F8", "#F05252", "#FF5A1F", "#D49D0F", "#0DA471", "#0694A2", "#9061F9", "#E74694",
  "#414657", "#1A56DB", "#C81E1E", "#B43403", "#9A6D15", "#046C4E", "#036672", "#6C2BD9", "#BF125D",
  "#000000", "#233876", "#771D1D", "#8A2C0D", "#634312", "#014737", "#014451", "#4A1D96", "#751A3D",
];

/**
 * 基线快照：内核（Lakex 富文本）固定色卡 70 色阶（7 行 × 10）。
 * 来源：`vendor/lakex-doc-react/src/components/lakex/lakex.js:122960`（调色板常量 `Zc`，`Zd.getColors()` 数据源）。
 * ⚠️ 如实口径：本常量同样是**硬编码快照**，内核升级 / 重转**不会**让「基线自检」自动变红 ——
 * 需人工对照 lakex.js 的色阶常量重录本常量并核对 70 色阶后，再谈任何取色面改动。
 */
const KERNEL_COLOR_SCALE_70: readonly string[] = [
  "#000000", "#262626", "#595959", "#8C8C8C", "#BFBFBF", "#D9D9D9", "#E9E9E9", "#F5F5F5", "#FAFAFA", "#FFFFFF",
  "#F5222D", "#FA541C", "#FA8C16", "#FADB14", "#52C41A", "#13C2C2", "#1890FF", "#2F54EB", "#722ED1", "#EB2F96",
  "#FFE8E6", "#FFECE0", "#FFEFD1", "#FCFCCA", "#E4F7D2", "#D3F5F0", "#D4EEFC", "#DEE8FC", "#EFE1FA", "#FAE1EB",
  "#FFA39E", "#FFBB96", "#FFD591", "#FFFB8F", "#B7EB8F", "#87E8DE", "#91D5FF", "#ADC6FF", "#D3ADF7", "#FFADD2",
  "#FF4D4F", "#FF7A45", "#FFA940", "#FFEC3D", "#73D13D", "#36CFC9", "#40A9FF", "#597EF7", "#9254DE", "#F759AB",
  "#CF1322", "#D4380D", "#D46B08", "#D4B106", "#389E0D", "#08979C", "#096DD9", "#1D39C4", "#531DAB", "#C41D7F",
  "#820014", "#871400", "#873800", "#614700", "#135200", "#00474F", "#003A8C", "#061178", "#22075E", "#780650",
];

describe("配色合规护栏（261119 审计 P1）", () => {
  it("基线自检：Univer 45 / 内核 70 快照规模与唯一性未漂（来源 file:line 见常量注释）", () => {
    expect(UNIVER_COLOR_PRESETS_45).toHaveLength(45);
    expect(new Set(UNIVER_COLOR_PRESETS_45).size).toBe(45);
    expect(KERNEL_COLOR_SCALE_70).toHaveLength(70);
    expect(new Set(KERNEL_COLOR_SCALE_70).size).toBe(70);
  });

  it("SHEET_* 字体/背景 + 边框内容色 ⊆ Univer 45 预设（桌面色板逐值选得出；来源 usheetChromeModel.ts / usheetBorders.ts）", () => {
    const presets = new Set<string>(UNIVER_COLOR_PRESETS_45);
    const surface: Array<[string, string]> = [
      ...SHEET_FONT_COLORS.map((color): [string, string] => ["SHEET_FONT_COLORS." + color.id, color.value]),
      ...SHEET_FILL_LIGHT.map((fill): [string, string] => ["SHEET_FILL_LIGHT." + fill.id, fill.value]),
      ...SHEET_FILL_STRONG.map((fill): [string, string] => ["SHEET_FILL_STRONG." + fill.id, fill.value]),
      ["USHEET_BORDER_COLOR", USHEET_BORDER_COLOR],
    ];
    // 「默认 / 无填充」格 = 空串（UI 侧画的空态格，不落正文），只此两处允许为空。
    expect(surface.filter(([, value]) => value === "").map(([name]) => name)).toEqual([
      "SHEET_FONT_COLORS.font-default",
      "SHEET_FILL_LIGHT.fill-none",
    ]);
    const violations = surface.filter(([, value]) => value !== "" && !presets.has(value));
    expect(violations).toEqual([]);
  });

  it("MOBILE_BOARD_LIGHT/SOLID、QUICK_TEXT_COLORS、INK_STROKE_COLORS、COLOR_BOARD_GROUPS ⊆ 内核 70 色阶（审计全绿面防回归；这批值一个都不许动）", () => {
    const scale = new Set<string>(KERNEL_COLOR_SCALE_70);
    const surfaces: Array<[string, readonly string[]]> = [
      ["COLOR_BOARD_GROUPS", COLOR_BOARD_GROUPS.flat()],
      ["MOBILE_BOARD_LIGHT", MOBILE_BOARD_LIGHT],
      ["MOBILE_BOARD_SOLID", MOBILE_BOARD_SOLID],
      ["QUICK_TEXT_COLORS", QUICK_TEXT_COLORS],
      ["INK_STROKE_COLORS", INK_STROKE_COLORS],
    ];
    const violations: string[] = [];
    for (const [name, values] of surfaces) {
      for (const value of values) {
        if (!scale.has(value)) violations.push(name + " " + value);
      }
    }
    expect(violations).toEqual([]);
  });
});
