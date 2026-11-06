/**
 * 261106 task-94 审计：所有「弹窗内含输入框」的 Sheet 都必须走 MobileSheet 原语
 * （键盘「覆盖而不推动」的稳定化逻辑统一挂在 MobileSheet 里，一处接线、全站生效）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import path from "node:path";

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");
const MOBILE_SHEET = read("src/mobile/ui/MobileSheet.tsx");

/** 已确认含文本输入、且必须经 MobileSheet 的界面。 */
const INPUT_SHEETS = [
  "src/mobile/ui/BatchTagPickerSheet.tsx",
  "src/mobile/ui/MoveTargetTreeSheet.tsx",
  "src/mobile/notebook/NoteTagsSheet.tsx",
  "src/mobile/settings/CreateNotebookSheet.tsx",
  "src/mobile/home/MobileQuickNoteTagSheet.tsx",
  "src/mobile/settings/S3ConfigImportSheet.tsx",
  "src/mobile/settings/SearchSheet.tsx",
  "src/mobile/bitable/MobileBitableRecordSheet.tsx",
  "src/mobile/bitable/MobileBitableFieldEditorSheet.tsx",
  "src/mobile/bitable/MobileBitableFieldSheet.tsx",
];

describe("弹窗键盘稳定审计（task-94）", () => {
  it("MobileSheet 原语统一挂 useKeyboardStableSheet（键盘不推动弹窗的唯一接线点）", () => {
    expect(MOBILE_SHEET).toContain("useKeyboardStableSheet(sheetRef, open)");
  });

  it("所有含输入的 Sheet 都经 MobileSheet 渲染（自动获得键盘稳定行为）", () => {
    for (const file of INPUT_SHEETS) {
      const src = read(file);
      expect(src, file + " 应在 MobileSheet 内渲染（键盘补偿统一由它提供）").toContain("MobileSheet");
      expect(src, file + " 应确实含输入框（审计清单准确性）").toMatch(/<input|<textarea/);
    }
  });

  it("PickerSheet 不含文本输入（列表选择器，无需键盘补偿；仍复用 mb-sheet 结构）", () => {
    const picker = read("src/mobile/ui/PickerSheet.tsx");
    expect(picker).not.toMatch(/<input|<textarea/);
    expect(picker).toContain("mb-sheet");
  });
});
