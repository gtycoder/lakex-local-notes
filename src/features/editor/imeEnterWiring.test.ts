import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * A01 静态契约（261115）：Enter 提交必须过 IME 判据。
 *
 * 位置清单来自 modern-web-guidance 的 `ime-safe-enter-submit` analyzer（33 处）
 * + 本轮人工补漏 2 处（SearchPanel 搜索框、内核链接编辑弹层），扣除记录面板已删除的内联选项输入
 * ＝ 34 处 / 27 文件。
 *
 * 为什么不写「全仓 key === "Enter" 都必须有 guard」：行/卡片的 Enter 激活、
 * Meta+Enter 保存、方向键式 move 都不是文本提交语义（会误报）。
 * 这份清单的判据是「输入框里的回车会触发提交类副作用」——新增此类入口气时，
 * 请把文件加进本表（这是护栏，不是白名单豁免）。
 */
const SITES: Record<string, number> = {
  "src/components/app/BatchTagDialog.tsx": 1,
  "src/components/app/settings/sections/MaintenanceSection.tsx": 1,
  "src/components/app/SettingsPanel.tsx": 1,
  "src/components/app/sidebar/TreeRowFace.tsx": 1,
  "src/components/app/SearchPanel.tsx": 1,
  "src/components/ui/InlineRenameInput.tsx": 1,
  "src/features/bitable/bitableCells.tsx": 3,
  "src/features/bitable/BitableEditor.tsx": 2,
  "src/features/bitable/BitableKanbanView.tsx": 1,
  "src/features/editor/AssetRenameDialog.tsx": 1,
  "src/features/editor/lockedTextCard.tsx": 2,
  "src/features/editor/selectionToolbar/SelectionToolbar.tsx": 3,
  "src/features/editor/selectionToolbar/kernelUiAtoms.tsx": 1,
  "src/features/ink/InkPageTabForm.tsx": 1,
  "src/features/quickNotes/QuickNotesWorkspace.tsx": 1,
  "src/features/quickNotes/QuickNoteTagPicker.tsx": 1,
  "src/mobile/ai/MobileAiPage.tsx": 1,
  "src/mobile/bitable/MobileBitableFieldSheet.tsx": 1,
  "src/mobile/bitable/MobileBitableRecordSheet.tsx": 1,
  "src/mobile/bitable/MobileBitableTableActions.tsx": 1,
  "src/mobile/bitable/MobileBitableViewActions.tsx": 1,
  "src/mobile/bitable/MobileBitableViewer.tsx": 1,
  "src/mobile/editor/MobileFindBar.tsx": 1,
  "src/mobile/settings/CreateNotebookSheet.tsx": 1,
  "src/mobile/settings/SearchSheet.tsx": 1,
  "src/mobile/tags/TagsHomeTab.tsx": 2,
  "src/mobile/ui/NameSheet.tsx": 1,
};

const read = (rel: string): string => readFileSync(new URL("../../../" + rel, import.meta.url), "utf8");

describe("A01 Enter 提交的 IME 判据（静态契约）", () => {
  it("34 处入口全部经过 isImeConfirming", () => {
    const total = Object.values(SITES).reduce((a, b) => a + b, 0);
    expect(total).toBe(34);
    const missing: string[] = [];
    for (const [file, expected] of Object.entries(SITES)) {
      const source = read(file);
      const used = source.split("isImeConfirming(").length - 1;
      if (used < expected) missing.push(file + "（期望 " + expected + "，实际 " + used + "）");
    }
    expect(missing).toEqual([]);
  });

  it("判据只有一处实现（src/core/ime.ts），文件内不得各自定义", () => {
    const helper = read("src/core/ime.ts");
    expect(helper).toContain("export function isImeConfirming");
    expect(helper).toContain("keyCode === 229");
    for (const file of Object.keys(SITES)) {
      const source = read(file);
      expect(source, file + " 不得自带 isComposing 判据绕开共享函数").not.toMatch(/function\s+isImeConfirming/);
    }
  });
});
