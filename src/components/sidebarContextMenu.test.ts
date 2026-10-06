import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");
const APP = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const SHELL = readFileSync(new URL("../desktop/useDesktopShell.ts", import.meta.url), "utf8");

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

  it("目录行「＋」弹「新建子项」快捷菜单（在 ⋯ 右侧），与右键「新建」共用同一组动作（单一来源）", () => {
    const start = SRC.indexOf('<span className="tree-row-actions">');
    const actions = SRC.slice(start, SRC.indexOf("</span>", start));
    // 用户 261006：＋ 放在 ⋯ 右侧
    expect(actions.indexOf('aria-label="更多操作"')).toBeGreaterThanOrEqual(0);
    expect(actions.indexOf('aria-label="新建子项"')).toBeGreaterThan(actions.indexOf('aria-label="更多操作"'));
    expect(SRC).toContain("props.onCreateMenu(event, props.node)");
    // 五个动作只声明一处（CreateChildItems / CREATE_CHILD_ITEMS），右键子菜单与「＋」菜单都引用它
    expect(SRC).toContain("const CREATE_CHILD_ITEMS");
    expect(SRC).toContain("<CreateChildItems onNewChild={onNewChild} onClose={onClose} />");
    expect(SRC).toContain("<CreateMenu anchor={createMenu.anchor}");
  });

  it("重命名 = 弹窗（不再内联）；打开期间目录栏保持展开（用户 261006）", () => {
    expect(SRC).not.toContain("tree-rename-input");
    expect(SRC).toContain("function TreeRenameDialog");
    expect(SRC).toContain("<TreeRenameDialog key={editingId}");
    expect(SRC).toContain("props.onSidebarHold?.(editingId != null)");
    // 悬浮态下钉住：hideSidebarPreview 先看 hold
    expect(SHELL).toContain("sidebarHoldRef");
    expect(SHELL).toMatch(/if \(sidebarHoldRef\.current\) return;/);
    expect(SHELL).toContain("holdSidebarExpanded");
    expect(APP).toContain("onSidebarHold={holdSidebarExpanded}");
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
