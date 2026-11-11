import { describe, expect, it } from "vitest";
import {
  AI_WRITING_QUICK_GROUPS,
  docRefKey,
  notebookSelectionState,
  refsForNotebook,
  refsForQuickGroup,
  selectableDocuments,
  selectableNotebooks,
  toggleDocRef,
  toggleNotebookRefs,
} from "./aiWritingDocs";
import { TRASH_NOTEBOOK_ID } from "../../core/syncDecisions";
import type { QuickNoteListSummary, TreeNode } from "../../lib/types";

const NOW = new Date(2026, 10, 9, 12, 0, 0);

function node(overrides: Partial<TreeNode>): TreeNode {
  return {
    id: "id",
    workspaceId: "w",
    parentId: "notebook-personal",
    nodeType: "note",
    title: "标题",
    noteFileId: "note-1",
    sortOrder: 0,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    isConflict: false,
    ...overrides,
  } as TreeNode;
}

function quickNote(overrides: Partial<QuickNoteListSummary>): QuickNoteListSummary {
  return {
    id: "q1", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), previewText: "小记内容",
    imageCount: 0, contentHash: "h", syncState: "local", isConflict: false,
    tagIds: [], tags: [], assetMimeTypes: [],
    ...overrides,
  } as QuickNoteListSummary;
}

const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

describe("selectableDocuments / selectableNotebooks", () => {
  it("只留可当资料的真实文档：排除非文档、无正文文件、回收站、已删、云端已删", () => {
    const nodes = [
      node({ id: "ok", noteFileId: "f1" }),
      node({ id: "notebook", nodeType: "notebook", noteFileId: null }),
      node({ id: "no-file", noteFileId: null }),
      node({ id: "trash", parentId: TRASH_NOTEBOOK_ID }),
      node({ id: "purged", isPurged: true }),
      node({ id: "cloud", cloudDeleted: true }),
    ];
    expect(selectableDocuments(nodes).map((item) => item.id)).toEqual(["ok"]);
  });

  it("笔记本列表排除回收站", () => {
    const nodes = [
      node({ id: "nb", nodeType: "notebook", noteFileId: null }),
      node({ id: TRASH_NOTEBOOK_ID, nodeType: "notebook", noteFileId: null }),
    ];
    expect(selectableNotebooks(nodes).map((item) => item.id)).toEqual(["nb"]);
  });

  it("日记是独立空间：资料集与「生成文档」目标都不含日记子树（261109）", () => {
    const nodes = [
      node({ id: "nb", nodeType: "notebook", noteFileId: null }),
      node({ id: "nb-diary", nodeType: "notebook", noteFileId: null, space: "diary" }),
      node({ id: "grp-diary", nodeType: "group", noteFileId: null, parentId: "nb-diary" }),
      node({ id: "doc-diary", parentId: "grp-diary", noteFileId: "f-diary", updatedAt: NOW.toISOString() }),
      node({ id: "doc-ok", noteFileId: "f-ok", updatedAt: NOW.toISOString() }),
    ];
    // 资料：日记正文默认不外发第三方（包含「今天我编辑的文档」这类快捷组）
    expect(selectableDocuments(nodes).map((item) => item.id)).toEqual(["doc-ok"]);
    expect(refsForQuickGroup(AI_WRITING_QUICK_GROUPS.find((item) => item.id === "today-docs")!, nodes, [], NOW).map((ref) => ref.id)).toEqual(["f-ok"]);
    // 发布目标：日记本不能作为落点（否则文档既不进日记时间线、又被文档空间隐藏 ⇒ 找不到）
    expect(selectableNotebooks(nodes).map((item) => item.id)).toEqual(["nb"]);
  });
});

describe("refsForQuickGroup", () => {
  const group = (id: string) => AI_WRITING_QUICK_GROUPS.find((item) => item.id === id)!;

  it("文档组按时间窗口过滤并按 updatedAt 倒序", () => {
    const nodes = [
      node({ id: "today", noteFileId: "f-today", updatedAt: daysAgo(0.2) }),
      node({ id: "old", noteFileId: "f-old", updatedAt: daysAgo(20) }),
      node({ id: "week", noteFileId: "f-week", updatedAt: daysAgo(3) }),
    ];
    expect(refsForQuickGroup(group("today-docs"), nodes, [], NOW).map((ref) => ref.id)).toEqual(["f-today"]);
    expect(refsForQuickGroup(group("week-docs"), nodes, [], NOW).map((ref) => ref.id)).toEqual(["f-today", "f-week"]);
    expect(refsForQuickGroup(group("month-docs"), nodes, [], NOW).map((ref) => ref.id)).toEqual(["f-today", "f-week", "f-old"]);
  });

  it("小记组取纯文本首 24 字做标题", () => {
    const notes = [quickNote({ id: "q1", previewText: "一二三四五六七八九十一二三四五六七八九十一二三四五六" })];
    const refs = refsForQuickGroup(group("today-quick-notes"), [], notes, NOW);
    expect(refs[0].kind).toBe("quick-note");
    expect(Array.from(refs[0].title).length).toBe(24);
  });

  it("最多 50 篇（避免一次挂太多资料）", () => {
    const nodes = Array.from({ length: 60 }, (_, index) => node({ id: "n" + index, noteFileId: "f" + index, updatedAt: daysAgo(1) }));
    expect(refsForQuickGroup(group("week-docs"), nodes, [], NOW).length).toBe(50);
  });
});

describe("refsForNotebook / toggleDocRef / docRefKey", () => {
  it("按笔记本取该笔记本的文档（含分组后代，不含其它笔记本）", () => {
    const nodes = [
      node({ id: "a", parentId: "nb-1", noteFileId: "f-a", updatedAt: daysAgo(2) }),
      node({ id: "b", parentId: "nb-1", noteFileId: "f-b", updatedAt: daysAgo(1) }),
      node({ id: "group", nodeType: "group", parentId: "nb-1", noteFileId: null }),
      node({ id: "nested", parentId: "group", noteFileId: "f-nested", updatedAt: daysAgo(3) }),
      node({ id: "c", parentId: "nb-2", noteFileId: "f-c" }),
    ];
    expect(refsForNotebook(nodes, "nb-1").map((ref) => ref.id)).toEqual(["f-b", "f-a", "f-nested"]);
  });

  it("整本勾选：none ⇒ 补齐缺的；all ⇒ 只移除该本；多本互不影响（用户 261111）", () => {
    const nb1 = refsForNotebook([
      node({ id: "a", parentId: "nb-1", noteFileId: "f-a", updatedAt: daysAgo(2) }),
      node({ id: "b", parentId: "nb-1", noteFileId: "f-b", updatedAt: daysAgo(1) }),
    ], "nb-1");
    const nb2 = refsForNotebook([
      node({ id: "c", parentId: "nb-2", noteFileId: "f-c", updatedAt: daysAgo(1) }),
    ], "nb-2");
    expect(nb1.map((r) => r.id)).toEqual(["f-b", "f-a"]);

    // 空 → 勾整本 1
    expect(notebookSelectionState([], nb1)).toBe("none");
    const first = toggleNotebookRefs([], nb1);
    expect(first.map((r) => r.id)).toEqual(["f-b", "f-a"]);
    expect(notebookSelectionState(first, nb1)).toBe("all");

    // 再勾整本 2 ⇒ 两本同时选（多选）
    const both = toggleNotebookRefs(first, nb2);
    expect(both.map((r) => r.id)).toEqual(["f-b", "f-a", "f-c"]);
    expect(notebookSelectionState(both, nb2)).toBe("all");

    // 取消整本 1 ⇒ 只移除 nb-1，nb-2 保留
    const onlyTwo = toggleNotebookRefs(both, nb1);
    expect(onlyTwo.map((r) => r.id)).toEqual(["f-c"]);
    expect(notebookSelectionState(onlyTwo, nb2)).toBe("all");

    // 半选：整本内只选了一部分
    const partial = toggleDocRef(toggleNotebookRefs([], nb1), nb1[0]);
    expect(notebookSelectionState(partial, nb1)).toBe("some");
    // 半选时再点勾选框 ⇒ 补齐其余（而不是全部取消）
    expect(toggleNotebookRefs(partial, nb1).map((r) => r.id).sort()).toEqual(["f-a", "f-b"]);

    // 空笔记本：状态 none，切换不改动
    expect(notebookSelectionState(both, [])).toBe("none");
    expect(toggleNotebookRefs(both, [])).toEqual(both);
  });

  it("toggle：已选取消、未选追加", () => {
    const ref = { kind: "note" as const, id: "n1", title: "文档" };
    const once = toggleDocRef([], ref);
    expect(once).toEqual([ref]);
    expect(toggleDocRef(once, ref)).toEqual([]);
    expect(docRefKey(ref)).toBe("note:n1");
  });
});
