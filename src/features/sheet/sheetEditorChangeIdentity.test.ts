import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("./SheetEditor.tsx", import.meta.url), "utf8");

/**
 * 260930 状态栏高频闪烁的根因回归护栏。
 *
 * FortuneSheet 内核的 onChange effect **依赖 onChange 的身份**：内联箭头每次 render 都是新身份 ⇒ 内核每次
 * render 都回调 onChange ⇒ 无条件 scheduleSave() ⇒ onDirty ⇒ 外层（全局）保存状态 dirty ⇒ render ⇒ 再回调，
 * 形成 dirty↔saving 死循环（隐藏的表格 tab 会每 ~1s 触发一次，当前文档状态栏一直闪）。
 * 因此必须给内核传**稳定身份**的包装函数（逻辑走 ref）。
 */
describe("SheetEditor 内核 onChange 身份稳定", () => {
  it("传给 Workbook 的 onChange 是稳定引用，不是每次 render 的内联箭头", () => {
    expect(SRC).toMatch(/onChange=\{handleWorkbookChange\}/);
    expect(SRC).toMatch(/const handleWorkbookChange = useCallback\(/);
    expect(SRC).toMatch(/workbookChangeRef/);
    expect(SRC).not.toMatch(/onChange=\{\(next\) =>/);
  });
});
