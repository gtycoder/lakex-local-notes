import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 261117「新建文档位置」接线护栏（用户要求：做彻底、抽公共方法、不要多份相同逻辑）。
 *
 * 两道防线：
 * ① **接线**：设置值必须一路传到所有创建入口（App → useNoteLifecycle / useTreeActions → native/preload → IPC）；
 * ② **排序单一实现**：tree_nodes/notes 的「顶部后移 / MAX+1」SQL 只允许存在于 electron/treeSort.ts，
 *    store 与 noteMetadataRepository 不得再各写一份（这正是本次改造要消灭的重复）。
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("新建文档位置：接线", () => {
  it("App 把 settings.newNotePosition 注入两个 hook", () => {
    const app = read("../App.tsx");
    expect(app).toContain("newNotePosition: settings.newNotePosition");
    expect((app.match(/newNotePosition: settings\.newNotePosition/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("useNoteLifecycle 五种创建都透传 newNotePosition（含默认落点 createNote）", () => {
    const hook = read("./useNoteLifecycle.ts");
    expect(hook).toContain("native.createNote(title, newNotePosition)");
    expect(hook).toContain("native.createNoteIn(parentId, title, newNotePosition)");
    for (const fn of ["createUsheetIn", "createBitableIn", "createBoardIn", "createInkIn"]) {
      expect(hook, fn).toContain("native." + fn + "(parentId, title, newNotePosition)");
    }
  });

  it("目录创建（分组/笔记本）同样透传", () => {
    const tree = read("./useTreeActions.ts");
    expect(tree).toContain("native.createNotebook(resolvedTitle, undefined, newNotePosition)");
    expect(tree).toContain("native.createGroup(parentId, resolvedTitle, newNotePosition)");
  });

  it("native 接口 / preload 8 个通道都带 position", () => {
    const native = read("../lib/native.ts");
    const preload = read("../../electron/preload.cjs");
    // 接口声明里至少 8 处可选 position（createNote / createNoteIn / 四 kind / group / notebook）
    const declared = native.match(/position\?: NoteInsertPosition/g) ?? [];
    expect(declared.length).toBeGreaterThanOrEqual(8);
    for (const invoke of ["create_note", "create_note_in", "create_usheet_in", "create_bitable_in", "create_board_in", "create_ink_in", "create_group", "create_notebook"]) {
      expect(preload, "preload " + invoke).toContain('invoke("' + invoke + '"');
    }
    // 逐字断言两条最容易漏的透传（历史上就漏过 create_note）
    expect(preload).toContain('createGroup: (parentId, title, position) => invoke("create_group", parentId, title, position)');
    expect(preload).toContain('createNote: (title, position) => invoke("create_note", title, position)');
  });
});

describe("新建文档位置：排序逻辑单一实现（禁止回退成多份 SQL）", () => {
  const treeSort = read("../../electron/treeSort.ts");
  const store = read("../../electron/store.ts");
  const metadata = read("../../electron/noteMetadataRepository.ts");

  it("顶部后移 / 指定值后移的 SQL 只在 treeSort.ts", () => {
    expect(treeSort).toContain("sort_order=sort_order+1");
    expect(store).not.toContain("sort_order=sort_order+1");
    expect(metadata).not.toContain("sort_order=sort_order+1");
  });

  it("MAX(sort_order)+1 只在 treeSort.ts", () => {
    expect(treeSort).toContain("COALESCE(MAX(sort_order),-1)");
    expect(store).not.toContain("COALESCE(MAX(sort_order),-1)");
    expect(metadata).not.toContain("COALESCE(MAX(sort_order),-1)");
  });

  it("两个调用方都走共用 helper，而不是自己拼 SQL", () => {
    expect(store).toContain("shiftSiblingsForTop(");
    expect(store).toContain("shiftSiblingsAfter(");
    expect(metadata).toContain("shiftSiblingsForTop(");
    expect(metadata).toContain("nextSiblingSortOrder(");
  });
});
