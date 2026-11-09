import { describe, expect, it } from "vitest";
import { documentTreeWithoutDiary, diaryEntryIds, diaryEntryViews, diaryNotebookOf, documentIdOfTreeNode } from "./diaryTree";
import type { TreeNode } from "../../lib/types";

/** 桌面 TreeNode 夹具（只写本片用到的字段，其余按类型补默认）。 */
const node = (patch: Partial<TreeNode> & Pick<TreeNode, "id" | "parentId" | "nodeType" | "title">): TreeNode => ({
  workspaceId: "ws",
  noteFileId: null,
  sortOrder: 0,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  isConflict: false,
  ...patch,
});

const FIXTURE: TreeNode[] = [
  node({ id: "nb-doc", parentId: null, nodeType: "notebook", title: "知识库" }),
  node({ id: "d1", parentId: "nb-doc", nodeType: "note", title: "文档一", noteFileId: "note-d1" }),
  node({ id: "nb-diary", parentId: null, nodeType: "notebook", title: "日记", space: "diary" }),
  node({ id: "y2026", parentId: "nb-diary", nodeType: "group", title: "2026" }),
  node({ id: "m11", parentId: "y2026", nodeType: "group", title: "11" }),
  node({ id: "e-1109", parentId: "m11", nodeType: "note", title: "2026-11-09", noteFileId: "note-1109" }),
  node({ id: "e-1108", parentId: "m11", nodeType: "note", title: "2026-11-08", noteFileId: "note-1108" }),
  node({ id: "y2025", parentId: "nb-diary", nodeType: "group", title: "2025" }),
  node({ id: "m12", parentId: "y2025", nodeType: "group", title: "12" }),
  node({ id: "e-20251231", parentId: "m12", nodeType: "note", title: "2025-12-31", noteFileId: "note-20251231" }),
];

describe("日记树适配（渲染层，判据全部来自 core/diary）", () => {
  it("文档空间目录树剔除日记笔记本**本身**（子节点仍挂它名下 ⇒ 树上不会被渲染成根）", () => {
    const filtered = documentTreeWithoutDiary(FIXTURE);
    expect(filtered.some((item) => item.id === "nb-diary")).toBe(false);
    // 其它笔记本/文档不受影响
    expect(filtered.map((item) => item.id)).toContain("nb-doc");
    expect(filtered.map((item) => item.id)).toContain("d1");
    // 只剔顶层笔记本：子节点保留（渲染层靠 parentId 挂在被剔的 id 上 ⇒ 自然不可见，不能改成"删子树"
    // 否则会随树刷新把节点顺序/展开态打乱）。这是 core 的既有口径，不要在这里另写一套。
    expect(filtered.map((item) => item.id)).toContain("y2026");
  });

  it("没有日记笔记本时原样返回（不做多余的数组拷贝语义变化）", () => {
    const plain = [node({ id: "nb", parentId: null, nodeType: "notebook", title: "知识库" })];
    expect(documentTreeWithoutDiary(plain)).toEqual(plain);
  });

  it("日记笔记本取 core 的稳定排序首个；条目日期倒序；树节点 id → 文档 id 有映射", () => {
    expect(diaryNotebookOf(FIXTURE)?.id).toBe("nb-diary");
    expect(diaryNotebookOf([node({ id: "nb", parentId: null, nodeType: "notebook", title: "知识库" })])).toBeNull();
    const entries = diaryEntryViews(FIXTURE);
    expect(entries.map((entry) => entry.dateKey)).toEqual(["2026-11-09", "2026-11-08", "2025-12-31"]);
    // core 的 noteId = 树节点 id；打开文档要用 documentId（noteFileId）
    expect(entries[0]).toMatchObject({ noteId: "e-1109", nodeId: "e-1109", documentId: "note-1109", year: "2026", month: "11" });
    expect(documentIdOfTreeNode(FIXTURE, "e-1109")).toBe("note-1109");
    expect(documentIdOfTreeNode(FIXTURE, null)).toBeNull();
    expect(documentIdOfTreeNode(FIXTURE, "missing")).toBeNull();
  });

  it("标题不是日期的文档不算日记条目（标题即日期，改标题即退出时间线）", () => {
    const dirty = [...FIXTURE, node({ id: "x", parentId: "m11", nodeType: "note", title: "随便写写", noteFileId: "note-x" })];
    const ids = diaryEntryIds(dirty);
    expect(ids.has("note-x")).toBe(false);
    expect(ids.has("note-1109")).toBe(true);
    expect(ids.has("e-1109")).toBe(false);   // 集合里只有文档 id，不混树节点 id
    expect(ids.size).toBe(3);
  });
});
