/**
 * 移动端 Univer 预设：只把 **UI 插件族**从桌面版换成移动版，数据/公式/渲染插件完全沿用官方 preset。
 *
 * 为什么不能直接用 `UniverSheetsCorePreset`：
 * - 它注册的是 `UniverUIPlugin` / `UniverSheetsUIPlugin`（桌面 UI），其 selection render service
 *   仍是桌面版：手指横拖会拉出多选范围，而不是交给 `MobileSheetsScrollRenderController` 滚动画布
 *   （实测 AVD：横向拖动后选成 B12:D12，表格不滚动）。
 * - Univer 官方把「单指拖动 = 滚动、点按 = 选一个单元格、长按/拖控制点 = 扩选」放在
 *   `UniverSheetsMobileUIPlugin` + `UniverMobileUIPlugin` 及对应的 docs/numfmt/formula/drawing
 *   移动 UI 插件里。这里只做类替换，不复制任何内核逻辑。
 *
 * 依赖关系是成套的：sheets-ui / docs-ui / drawing-ui 等桌面插件都声明依赖桌面 UI 插件，
 * 因此必须把所有 UI 插件一起换掉；只换 sheets-ui 会在 Univer 启动时因依赖缺失而失败。
 */
import type { IPreset, IPresetPlugin } from "@univerjs/presets";
import {
  UniverDocsMobileUIPlugin,
  UniverDocsUIPlugin,
  UniverMobileUIPlugin,
  UniverSheetsCorePreset,
  UniverSheetsFormulaMobileUIPlugin,
  UniverSheetsFormulaUIPlugin,
  UniverSheetsMobileUIPlugin,
  UniverSheetsNumfmtMobileUIPlugin,
  UniverSheetsNumfmtUIPlugin,
  UniverSheetsUIPlugin,
  UniverUIPlugin,
} from "@univerjs/preset-sheets-core";
import { UniverSheetsHyperLinkMobileUIPlugin, UniverSheetsHyperLinkUIPlugin } from "@univerjs/sheets-hyper-link-ui";
import { UniverSheetsHyperLinkPreset } from "@univerjs/preset-sheets-hyper-link";
import {
  UniverDrawingMobileUIPlugin,
  UniverDrawingUIPlugin,
  UniverSheetsDrawingMobileUIPlugin,
  UniverSheetsDrawingPreset,
  UniverSheetsDrawingUIPlugin,
} from "@univerjs/preset-sheets-drawing";

/** 桌面 UI 插件 → 对应移动 UI 插件；必须成套替换（见文件头）。 */
const MOBILE_UI_REPLACEMENTS = new Map<unknown, IPresetPlugin>([
  [UniverUIPlugin, UniverMobileUIPlugin],
  [UniverDocsUIPlugin, UniverDocsMobileUIPlugin],
  [UniverSheetsUIPlugin, UniverSheetsMobileUIPlugin],
  [UniverSheetsNumfmtUIPlugin, UniverSheetsNumfmtMobileUIPlugin],
  [UniverSheetsFormulaUIPlugin, UniverSheetsFormulaMobileUIPlugin],
  [UniverDrawingUIPlugin, UniverDrawingMobileUIPlugin],
  [UniverSheetsDrawingUIPlugin, UniverSheetsDrawingMobileUIPlugin],
  // 261022 P1：超链接（桌面 UI → 移动 UI；数据插件沿用 preset）。
  [UniverSheetsHyperLinkUIPlugin, UniverSheetsHyperLinkMobileUIPlugin],
]);

/** 把 preset 里的桌面 UI 插件替换为移动 UI 插件，保留原插件 config 与其余插件。 */
export function withMobileUniverUi(preset: IPreset): IPreset {
  return {
    ...preset,
    plugins: preset.plugins.map((entry) => {
      const ctor = Array.isArray(entry) ? entry[0] : entry;
      const config = Array.isArray(entry) ? entry[1] : undefined;
      // 移动 Workbench 的 footer = 底部动作面板（「开始编辑」浮动按钮 + 样式/插入工具）。
      // 这里必须保留它：只读态用 DOM 隐去浮动按钮，编辑态才显示；否则单元格编辑没有移动端公式/输入面。
      if (ctor === UniverUIPlugin) {
        return [UniverMobileUIPlugin, { ...(config ?? {}), footer: true }] as IPresetPlugin;
      }
      // 移动版工作表标签栏仍保留（顶部 Sheet1 切换），但只读态不提供「＋ 新建工作表」。
      if (ctor === UniverSheetsUIPlugin) {
        return [UniverSheetsMobileUIPlugin, { ...(config ?? {}), footer: { addSheetButtonConfig: { show: false } } }] as IPresetPlugin;
      }
      const replacement = MOBILE_UI_REPLACEMENTS.get(ctor);
      if (!replacement) return entry;
      return (Array.isArray(entry) ? [replacement, entry[1]] : replacement) as IPresetPlugin;
    }),
  };
}

type CorePresetConfig = Parameters<typeof UniverSheetsCorePreset>[0];

/** 移动端表格 preset：保留官方 core 定义，只换 UI 插件族。 */
export function createMobileSheetsCorePreset(config: CorePresetConfig): IPreset {
  return withMobileUniverUi(UniverSheetsCorePreset(config));
}

/** 移动端图片/绘图 preset：同样只换 UI 插件族。 */
export function createMobileSheetsDrawingPreset(): IPreset {
  return withMobileUniverUi(UniverSheetsDrawingPreset());
}

/** 移动端超链接 preset：把桌面 UI 换成移动 UI（弹出的是移动版编辑/查看弹层）。 */
export function createMobileSheetsHyperLinkPreset(config: Parameters<typeof UniverSheetsHyperLinkPreset>[0] = {}): IPreset {
  return withMobileUniverUi(UniverSheetsHyperLinkPreset(config));
}
