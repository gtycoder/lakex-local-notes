/**
 * 日记子树禁用拖拽排序（261110 用户定稿）：
 *  · 日记顺序由「日期 + 创建时间」决定，拖拽不会改变显示顺序；桌面端也没有拖拽排序。
 *  · 判据单一来源 = `treeDragEnabled(space)`；工作区只把 notebook.space 传进去。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { treeDragEnabled } from "./useTreeDrag";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(path.join(HERE, file), "utf8");

describe("日记子树禁用拖拽（261110）", () => {
  it("判据：space=diary ⇒ 禁用；其它/未标记 ⇒ 启用", () => {
    expect(treeDragEnabled("diary")).toBe(false);
    expect(treeDragEnabled(null)).toBe(true);
    expect(treeDragEnabled(undefined)).toBe(true);
    expect(treeDragEnabled("")).toBe(true);
  });

  it("工作区把 notebookSpace 接进 useTreeDrag.enabled", () => {
    const workspace = read("NotebookWorkspace.tsx");
    expect(workspace).toContain("treeDragEnabled(notebookSpace)");
    expect(workspace).toContain("enabled: dragEnabled");
  });

  it("长按回调先看开关：禁用后不再起手（不进拖拽、不挂 body 类）", () => {
    const source = read("useTreeDrag.ts");
    expect(source).toContain("if (!enabledRef.current) return;");
  });
});
