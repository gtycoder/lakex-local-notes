import { describe, expect, it } from "vitest";
import type { IPreset } from "@univerjs/presets";
import {
  UniverDocsMobileUIPlugin,
  UniverDocsUIPlugin,
  UniverMobileUIPlugin,
  UniverSheetsFormulaMobileUIPlugin,
  UniverSheetsFormulaUIPlugin,
  UniverSheetsMobileUIPlugin,
  UniverSheetsNumfmtMobileUIPlugin,
  UniverSheetsNumfmtUIPlugin,
  UniverSheetsUIPlugin,
  UniverUIPlugin,
} from "@univerjs/preset-sheets-core";
import {
  UniverDrawingMobileUIPlugin,
  UniverDrawingUIPlugin,
  UniverSheetsDrawingMobileUIPlugin,
  UniverSheetsDrawingUIPlugin,
} from "@univerjs/preset-sheets-drawing";
import { UniverSheetsHyperLinkMobileUIPlugin, UniverSheetsHyperLinkUIPlugin } from "@univerjs/sheets-hyper-link-ui";
import { createMobileSheetsCorePreset, createMobileSheetsDrawingPreset, createMobileSheetsHyperLinkPreset } from "./mobileUniverPreset";

function ctors(preset: IPreset): unknown[] {
  return preset.plugins.map((entry) => Array.isArray(entry) ? entry[0] : entry);
}

describe("移动端 Univer 预设（261019 表格触摸手势）", () => {
  it("core preset 的 UI 插件族全部换成移动版（不能只换 sheets-ui）", () => {
    const preset = createMobileSheetsCorePreset({ container: "x", toolbar: false, formulaBar: false });
    const got = ctors(preset);
    for (const mobile of [
      UniverMobileUIPlugin,
      UniverDocsMobileUIPlugin,
      UniverSheetsMobileUIPlugin,
      UniverSheetsNumfmtMobileUIPlugin,
      UniverSheetsFormulaMobileUIPlugin,
    ]) expect(got).toContain(mobile);
    for (const desktop of [
      UniverUIPlugin,
      UniverDocsUIPlugin,
      UniverSheetsUIPlugin,
      UniverSheetsNumfmtUIPlugin,
      UniverSheetsFormulaUIPlugin,
    ]) expect(got).not.toContain(desktop);

    // 移动 Workbench 的 footer = 编辑动作面板；阅读态由 DOM 隐去浮动按钮，编辑态必须可用。
    // 顶部 Sheet 标签栏保留，但「＋ 新建工作表」仍隐藏。
    const ui = preset.plugins.find((entry) => Array.isArray(entry) && entry[0] === UniverMobileUIPlugin);
    expect((ui as [unknown, { footer: boolean }])[1].footer).toBe(true);
    const sheets = preset.plugins.find((entry) => Array.isArray(entry) && entry[0] === UniverSheetsMobileUIPlugin);
    expect((sheets as [unknown, { footer: { addSheetButtonConfig: { show: boolean } } }])[1].footer.addSheetButtonConfig.show).toBe(false);
  });

  it("261022 P1：超链接 preset 换成移动 UI 插件（链接编辑器用移动弹层）", () => {
    const got = ctors(createMobileSheetsHyperLinkPreset());
    expect(got).toContain(UniverSheetsHyperLinkMobileUIPlugin);
    expect(got).not.toContain(UniverSheetsHyperLinkUIPlugin);
  });

  it("drawing preset 同步换成移动 UI 插件（否则依赖桌面 UI 插件会启动失败）", () => {
    const got = ctors(createMobileSheetsDrawingPreset());
    expect(got).toContain(UniverDrawingMobileUIPlugin);
    expect(got).toContain(UniverSheetsDrawingMobileUIPlugin);
    expect(got).not.toContain(UniverDrawingUIPlugin);
    expect(got).not.toContain(UniverSheetsDrawingUIPlugin);
  });
});
