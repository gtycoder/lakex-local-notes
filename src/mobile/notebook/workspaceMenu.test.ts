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

  it("目录抽屉「新建」：工具栏（笔记本层）+ 每一行（子项）都有，且清单与桌面同款、不可编辑的类型置灰", () => {
    // 笔记本层：抽屉工具栏的「新建」
    expect(WORKSPACE).toContain('aria-label="新建" title="新建"');
    // 每一行的「新建子项」
    expect(WORKSPACE).toContain('aria-label="新建子项"');
    // 清单同款同序（桌面 Sidebar CREATE_CHILD_ITEMS：文档/表格/数据表/画板/分组）
    const items = [...WORKSPACE.matchAll(/\{ id: "(note|usheet|bitable|board|group)", label: "([^"]+)"/g)].map((m) => m[2]);
    expect(items).toEqual(["新建文档", "新建表格", "新建数据表", "新建画板", "新建分组"]);
    // 只有文档/分组可点；其余 disabled 且必须给理由（移动端没有 hover）
    for (const kind of ["usheet", "bitable", "board"]) {
      expect(WORKSPACE).toMatch(new RegExp('id: "' + kind + '"[^}]*disabled: true[^}]*note: "移动端暂不支持编辑"'));
    }
    expect(WORKSPACE).not.toMatch(/id: "note"[^}]*disabled/);
    expect(WORKSPACE).not.toMatch(/id: "group"[^}]*disabled/);
  });

  it("笔记本这一层也有 ⋮ 菜单与图标（261014）：新建/重命名/设置图标/删除，删除走回收站", () => {
    // 笔记本行：图标 + ⋮（⋮ 在工具栏里，与行内 ⋮ 同语义）
    expect(WORKSPACE).toContain('aria-label="笔记本菜单"');
    const block = WORKSPACE.slice(WORKSPACE.indexOf("{/* 笔记本行的 ⋮ 菜单"), WORKSPACE.indexOf("{/* 更多（思源"));
    const labels = [...block.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
    expect(labels).toEqual(["新建文档", "新建分组", "重命名", "设置图标", "删除笔记本"]);
    // 图标：有自定义表情就展示它，否则默认 Book（与首页笔记本卡同款默认图标）
    expect(WORKSPACE).toContain("{nbIcon ? nbIcon : <Book size={16} />}");
    // 图标可点 = 设置图标（桌面 .tree-row-icon 的手势），且命中区走 mb-tap 补足
    expect(WORKSPACE).toMatch(/className="mb-tree-icon mb-tap" aria-label="设置图标"/);
    // 删除笔记本 = 整棵移入回收站（可恢复），不是物理删除
    expect(WORKSPACE).toMatch(/trashTreeItem\(notebookId, "folder"\)/);
  });

  it("设置入口仍在首页顶栏（功能没有丢）", () => {
    expect(HOME).toContain('aria-label="设置"');
  });
});
