/**
 * 工作区「更多」菜单护栏（261014 用户点单）。
 *
 * 用户明确：**去掉工作区「更多」里的「设置」和「搜索」** —— 设置入口 = 首页左上齿轮，搜索入口 = 首页底部胶囊，
 * 工作区里再放一份只是重复；两个 prop（`onOpenSettings` / `onOpenSearch`）随之删掉（没有消费者就不留死 prop）。
 * 本护栏钉住：菜单里不再有 settings / search 项与这两个 prop；而首页的设置、搜索入口都还在（功能没丢）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const WORKSPACE = read("./NotebookWorkspace.tsx");
const APP = read("../MobileApp.tsx");
const HOME = read("../home/HomePage.tsx");
const HOMEPAGE = read("../home/HomePage.tsx");
const GRID = read("../home/NotebookGrid.tsx");

describe("工作区「更多」菜单（261014）", () => {
  it("不再有「设置」项，也不再有 onOpenSettings 这个死 prop", () => {
    expect(WORKSPACE).not.toContain('id: "settings"');
    expect(WORKSPACE).not.toContain("onOpenSettings");
    expect(APP).not.toContain("onOpenSettings");
  });

  it("「搜索」也已移出工作区菜单（只留首页底部那一个入口）", () => {
    expect(WORKSPACE).not.toContain('id: "search"');
    expect(WORKSPACE).not.toContain("onOpenSearch");
    expect(APP).not.toMatch(/<NotebookWorkspace[\s\S]{0,600}onOpenSearch/);
    // 首页那条搜索入口必须还在（功能没丢）
    expect(HOME).toContain('aria-label="搜索"');
  });

  it("目录抽屉「新建」：工具栏（笔记本层）+ 每一行（子项）都有，清单与桌面同款，四类文档都能新建", () => {
    // 笔记本层：抽屉工具栏的「新建」
    expect(WORKSPACE).toContain('aria-label="新建" title="新建"');
    // 每一行的「新建子项」
    expect(WORKSPACE).toContain('aria-label="新建子项"');
    // 清单同款同序（桌面 Sidebar CREATE_CHILD_ITEMS：文档/表格/数据表/画板/分组）
    const items = [...WORKSPACE.matchAll(/\{ id: "(note|usheet|bitable|board|group)", label: "([^"]+)"/g)].map((m) => m[2]);
    expect(items).toEqual(["新建文档", "新建表格", "新建数据表", "新建画板", "新建分组"]);
    // 261020：数据表已有移动编辑器 ⇒ 五类创建项全部可点，不再有"建得出来但打不开"的置灰项
    for (const kind of ["note", "usheet", "bitable", "board", "group"]) {
      expect(WORKSPACE).not.toMatch(new RegExp('id: "' + kind + '"[^}]*disabled'));
    }
    // 单一创建通道：建库（按 kind 分派）→ 刷新目录 → 收抽屉 → 打开标签；清单 id → kind 只有一份映射
    expect(WORKSPACE).toContain("const CREATE_MENU_KINDS");
    for (const [id, kind] of [["note", "doc"], ["usheet", "usheet"], ["bitable", "bitable"], ["board", "board"]]) {
      expect(WORKSPACE).toMatch(new RegExp(id + ': "' + kind + '"'));
    }
    expect(WORKSPACE).toMatch(/const pid = parentId \|\| notebookId;/);
    expect(WORKSPACE).toContain('bridge.createNote("无标题文档", pid)');
    expect(WORKSPACE).toContain('bridge.createUsheet("无标题表格", pid)');
    expect(WORKSPACE).toContain('bridge.createBitable("无标题数据表", pid)');
    expect(WORKSPACE).toContain('bridge.createBoard("无标题画板", pid)');
    // 新建后关掉目录抽屉：否则编辑器在抽屉后面打开（设备实测）
    expect(WORKSPACE).toMatch(/await bridge\.createBoard\("无标题画板", pid\);\n\s*await loadTree\(\);\n\s*setSidebarOpen\(false\);/);
    // 三类新文档建完都直接进编辑态（文档停在阅读态）
    expect(WORKSPACE).toMatch(/if \(kind !== "doc"\) pendingEditRef\.current = true;/);
    // 菜单只把 note/usheet/bitable/board 交给创建通道，group 走分组创建
    expect(WORKSPACE).toMatch(/const kind = CREATE_MENU_KINDS\[it\.id\];/);
  });

  it("笔记本编辑入口 = 首页「知识库」长按卡片（261014 用户最终定稿）", () => {
    // 抽屉里**不再**有笔记本 ⋮（用户点单去掉），但仍展示笔记本自己的图标（只展示、不可点）
    expect(WORKSPACE).not.toContain("笔记本菜单");
    expect(WORKSPACE).not.toContain("notebookMenuOpen");
    expect(WORKSPACE).toContain('className="mb-tree-icon" aria-hidden="true">{nbIcon ? <MobileNodeIconGlyph value={nbIcon} /> : <Book size={16} />}');
    // 长按入口在知识库卡片上：NotebookGrid 必须接 onLongPressNotebook（书架卡与列表行都要）
    expect(GRID).toContain("onLongPressNotebook");
    expect(GRID.match(/pressProps\(nb\)/g)?.length).toBe(2);
    // 菜单只有编辑三项 —— **不含**新建文档 / 新建分组（用户明确去掉）
    const block = HOMEPAGE.slice(HOMEPAGE.indexOf("笔记本编辑菜单"), HOMEPAGE.indexOf("{/* 筛选 / 排序 */}"));
    const labels = [...block.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
    expect(labels).toEqual(["重命名", "设置图标", "删除笔记本"]);
    // 删除笔记本 = 整棵移入回收站（可恢复），不是物理删除
    expect(HOMEPAGE).toMatch(/trashTreeItem\(nb\.id, "folder"\)/);
    // 重命名/设置图标仍保留（能力没丢）
    expect(HOMEPAGE).toMatch(/renameTreeNode\(cur\.id, value\)/);
    expect(HOMEPAGE).toMatch(/setNodeIcon\(nb\.id, icon\)/);
  });

  it("目录行 ⋮ 菜单不再放「新建文档 / 新建分组」（261019 用户点单：新建统一走 ＋）", () => {
    const block = WORKSPACE.slice(WORKSPACE.indexOf("const treeMenuItems"), WORKSPACE.indexOf("const onTreeMenuSelect"));
    expect(block).not.toContain('id: "new-note"');
    expect(block).not.toContain('id: "new-group"');
    // 新建能力没丢：行内 ＋（新建子项）与抽屉工具栏「新建」都还在，且共用同一份 5 项清单
    expect(WORKSPACE).toContain('aria-label="新建子项"');
    expect(WORKSPACE).toContain('aria-label="新建" title="新建"');
    // 菜单只保留「对这一行本身的动作」
    for (const label of ["重命名", "设置图标", "移动到…", "移入回收站"]) {
      expect(block).toContain(label);
    }
  });

  it("工作区胶囊最后一格 = 切换笔记本（261014：原「更多」已无意义）", () => {
    expect(WORKSPACE).toContain('aria-label="切换笔记本"');
    // 胶囊那格「更多」与它的死 prop 都不许回来（编辑在顶栏、新建在抽屉/行内）；
    // 注意：目录**行**的 ⋯ 仍叫「更多」（那是行菜单），别把断言写宽成整份源码不含"更多"
    expect(WORKSPACE).not.toContain('aria-label="更多" title="更多"');
    expect(WORKSPACE).not.toContain("moreOpen");
    expect(WORKSPACE).not.toContain("onCreateNote");
    expect(APP).not.toMatch(/<NotebookWorkspace[\s\S]{0,700}onCreateNote/);
    // 编辑入口仍在顶栏（功能没丢）
    expect(WORKSPACE).toContain('aria-label={active?.editing ? "完成" : "编辑"}');
    // 切换笔记本面板仍在
    expect(WORKSPACE).toContain("open={notebookSwitchOpen}");
  });

  it("设置入口仍在首页顶栏（功能没有丢）", () => {
    expect(HOME).toContain('aria-label="设置"');
  });
});
