import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");
const APP = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

/**
 * 260930 目录栏右键菜单优化（用户口径）：
 * 1) 「新建文档/新建表格/新建数据表/新建画板/新建分组」收进「新建」子菜单，不再各占一行；
 * 2) 右键菜单去掉「打开文件位置」（属性弹窗 NoteInfoDialog 里仍保留）；
 * 3) 文档级锁定入口放这里（只读锁统一入口）；目录行显示小锁标识。
 * 这是结构护栏，真实鼠标操作/只读生效由 CDP 真实验收覆盖。
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

  it("右键菜单有「锁定（只读）/解锁」入口，App 按 nodeFileId 调用", () => {
    const start = SRC.indexOf("const ContextMenu =");
    const end = SRC.indexOf("interface ConfirmDeleteProps");
    const menu = SRC.slice(start, end);
    expect(menu).toContain("锁定（只读）");
    expect(menu).toContain("解锁");
    expect(menu).toContain("onToggleLock");
    expect(APP).toContain("onToggleLockNote");
    expect(APP).toContain("toggleNoteLock(node.noteFileId)");
  });

  it("已锁定文档在目录行显示小锁（由 lockedNoteIds 驱动）", () => {
    expect(SRC).toContain('className="tree-row-lock"');
    expect(SRC).toContain("lockedNoteIds");
    expect(SRC).toContain("props.lockedNoteIds.has(props.node.noteFileId)");
  });
});
