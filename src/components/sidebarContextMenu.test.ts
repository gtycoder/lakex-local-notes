import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");

/**
 * 260930 目录栏右键菜单优化（用户口径）：
 * 1) 「新建文档/新建表格/新建数据表/新建画板/新建分组」收进「新建」子菜单，不再各占一行；
 * 2) 右键菜单去掉「打开文件位置」（属性弹窗 NoteInfoDialog 里仍保留）。
 * 这是结构护栏，真实鼠标展开/项可见性由 CDP 真实验收覆盖。
 */
describe("目录栏右键菜单", () => {
  it("新建动作收进「新建」子菜单", () => {
    expect(SRC).toMatch(/<Submenu label=\{<><Plus size=\{15\} \/><span>新建<\/span><\/>\}>/);
  });

  it("右键菜单不再有「打开文件位置」及其接线", () => {
    const start = SRC.indexOf("const ContextMenu =");
    const end = SRC.indexOf("interface ConfirmDeleteProps");
    const menu = SRC.slice(start, end);
    expect(menu).not.toContain("打开文件位置");
    expect(menu).not.toContain("onRevealNoteFile");
  });
});
