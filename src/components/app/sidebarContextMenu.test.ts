import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 261112 R2 S6：Sidebar 的 7 个内部组件已搬到 ./sidebar/ ⇒ 源码级护栏按「组件 + 子件」聚合读
// （顺序有讲究：下面的 slice 断言依赖 ContextMenu → ConfirmDelete → TreeRow* → TreeRenameDialog → 创建件）。
const SIDEBAR_PARTS = ["./sidebar/ContextMenu.tsx", "./sidebar/ConfirmDelete.tsx", "./sidebar/TreeRow.tsx", "./sidebar/TreeRowFace.tsx", "./sidebar/TreeRenameDialog.tsx", "./sidebar/CreateChildItems.tsx", "./sidebar/CreateMenu.tsx", "./Sidebar.tsx"];
const SRC = SIDEBAR_PARTS.map((rel) => readFileSync(new URL(rel, import.meta.url), "utf8")).join("\n");
const APP = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const SHELL = readFileSync(new URL("../../desktop/useDesktopShell.ts", import.meta.url), "utf8");

/**
 * 目录栏右键菜单（用户口径）：
 * 1) **261106：右键菜单不再有「新建」**（行内/头部的「＋」是唯一入口；此前 260930 曾收进子菜单，现整体撤掉）；
 * 2) 右键菜单去掉「打开文件位置」（属性弹窗 NoteInfoDialog 里仍保留）；
 * 3) 文档级锁定入口放这里（只读锁统一入口）；目录行显示小锁标识。
 * 这是结构护栏，真实鼠标操作/只读生效由 CDP 真实验收覆盖。
 */
describe("目录栏右键菜单", () => {
  it("右键菜单不再提供「新建」子菜单（创建入口只剩行内/头部 ＋）", () => {
    const start = SRC.indexOf("const ContextMenu =");
    const end = SRC.indexOf("interface ConfirmDeleteProps");
    const menu = SRC.slice(start, end);
    expect(menu).not.toContain("<Submenu");
    expect(menu).not.toContain("CreateChildItems");
    expect(menu).not.toContain("onNewChild");
    expect(menu).not.toContain(">新建<");
    // 创建动作仍只有一处声明（CreateChildItems / CREATE_CHILD_ITEMS），由「＋」菜单使用
    expect(SRC).toContain("const CREATE_CHILD_ITEMS");
    // 261022 用户点单：创建项文案 = 文档类型名「多维表」（表内层级才叫「数据表」）
    expect(SRC).toContain('label: "新建多维表"');
    expect(SRC).not.toContain('label: "新建数据表"');
  });

  it("目录行「＋」弹「新建子项」快捷菜单（在 ⋯ 右侧），动作单一来源", () => {
    const start = SRC.indexOf('<span className="tree-row-actions">');
    const actions = SRC.slice(start, SRC.indexOf("</span>", start));
    // 用户 261006：＋ 放在 ⋯ 右侧
    expect(actions.indexOf('aria-label="更多操作"')).toBeGreaterThanOrEqual(0);
    expect(actions.indexOf('aria-label="新建子项"')).toBeGreaterThan(actions.indexOf('aria-label="更多操作"'));
    expect(SRC).toContain("props.onCreateMenu(event, props.node)");
    // 六个动作只声明一处（CreateChildItems / CREATE_CHILD_ITEMS），由「＋」菜单引用（261106 起右键菜单不再引用）
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

  it("重命名弹窗允许接受默认名/原名称，只有空名不能确认", () => {
    const start = SRC.indexOf("function TreeRenameDialog");
    const dialog = SRC.slice(start, SRC.indexOf("type CreateChildKind", start));
    expect(dialog).toContain("const canConfirm = trimmed.length > 0;");
    expect(dialog).not.toContain("trimmed !== initial.trim()");
    expect(dialog).toContain('disabled={!canConfirm}');
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