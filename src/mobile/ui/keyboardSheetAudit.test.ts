/**
 * 261106 task-94 审计：所有「弹窗内含输入框」的 Sheet 都必须走 MobileSheet 原语
 * （键盘「覆盖而不推动」的稳定化逻辑统一挂在 MobileSheet 里，一处接线、全站生效）。
 */
import { readdirSync, readFileSync } from "node:fs";
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
  // 261117 全面排查补录：此前清单漏掉的含输入 Sheet
  "src/mobile/bitable/MobileBitableViewActions.tsx",
  "src/mobile/bitable/MobileBitableTableActions.tsx",
  "src/mobile/ui/NameSheet.tsx",
  // （AiCorpusSheet 是**手写** Sheet（不走 MobileSheet 组件），由下方通用规则钉住直接挂 hook。）
];

/** 261117：随视口收缩的**非 Sheet** 输入面 —— 原生 focus 滚动发生在键盘弹起前、之后失效 ⇒ 必须挂 useKeyboardRevealFocus。 */
const KEYBOARD_REVEAL_FACES = [
  "src/mobile/bitable/MobileBitableFormView.tsx",
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

  it("通用规则：手写 Sheet（不走 MobileSheet 原语）带输入框就必须直接挂 useKeyboardStableSheet（261117）", () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (e.name.endsWith(".tsx") && !e.name.endsWith(".test.tsx")) out.push(p);
      }
      return out;
    };
    const offenders: string[] = [];
    for (const file of walk("src/mobile")) {
      const src = readFileSync(file, "utf8");
      const handRolledSheet = /className="[^"]*mb-sheet[ "]/.test(src) && !src.includes("<MobileSheet");
      if (handRolledSheet && /<input|<textarea/.test(src) && !src.includes("useKeyboardStableSheet(")) {
        offenders.push(path.relative(process.cwd(), file));
      }
    }
    expect(offenders, "手写 Sheet 带输入却无键盘补偿（挂 useKeyboardStableSheet 或迁 MobileSheet）：" + offenders.join(", ")).toEqual([]);
  });

  it("随视口收缩的非 Sheet 输入面挂 useKeyboardRevealFocus（261117 表单视图被键盘盖）", () => {
    for (const file of KEYBOARD_REVEAL_FACES) {
      const src = read(file);
      expect(src, file + " 应挂 useKeyboardRevealFocus（键盘弹起后把焦点输入框滚进可见区）").toContain("useKeyboardRevealFocus(");
      expect(src, file + " 应确实含输入框（审计清单准确性）").toMatch(/<input|<textarea/);
    }
  });

  it("Sheet 标题区/手柄点按收键盘 + 返回键优先收键盘（261117 完成编辑出口）", () => {
    expect(MOBILE_SHEET, "点标题区/手柄 = 显式收起键盘").toContain("onPointerDown={dismissKeyboardOnPointerDown}");
    expect(read("src/mobile/ui/backStack.ts"), "返回键先收键盘再轮到返回动作").toContain("activeIsTextInput()");
  });

  it("PickerSheet 不含文本输入（列表选择器，无需键盘补偿；仍复用 mb-sheet 结构）", () => {
    const picker = read("src/mobile/ui/PickerSheet.tsx");
    expect(picker).not.toMatch(/<input|<textarea/);
    expect(picker).toContain("mb-sheet");
  });
});
