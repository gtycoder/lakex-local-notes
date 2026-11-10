/**
 * 移动端「知识库列表不含日记本」的测试锁（261109 日记 v1 收尾；docs/DIARY.md 硬规则 5）。
 *
 * 以前这条过滤内联在 MobileApp 的 useMemo 里，只有代码路径没有断言 ⇒ 这里抽成纯函数后逐类钉住：
 * 普通笔记本留下、日记本剔除、回收站笔记本剔除、分组/文档不进列表（它们不是笔记本）。
 * 全部用 core 的常量构造夹具（`DIARY_FOLDER_SPACE` / `TRASH_NOTEBOOK_ID`），**不写死 id 字面量**。
 */
import { describe, expect, it } from "vitest";
import { DIARY_FOLDER_SPACE } from "../../core/diary.js";
import { TRASH_NOTEBOOK_ID } from "../../core/syncDecisions.js";
import type { TreeNode } from "../../lib/types";
import { libraryNotebooks } from "./libraryNotebooks";

const node = (over: Partial<TreeNode> & { id: string; nodeType: TreeNode["nodeType"] }): TreeNode => ({
  workspaceId: "mobile",
  parentId: null,
  title: over.id,
  noteFileId: null,
  sortOrder: 0,
  createdAt: "2026-11-10T00:00:00.000Z",
  updatedAt: "2026-11-10T00:00:00.000Z",
  isConflict: false,
  ...over,
} as TreeNode);

const FIXTURE: TreeNode[] = [
  node({ id: "nb-plain", nodeType: "notebook", title: "工作", space: null }),
  node({ id: "nb-plain-2", nodeType: "notebook", title: "生活" }),
  node({ id: "nb-diary", nodeType: "notebook", title: "日记", space: DIARY_FOLDER_SPACE }),
  node({ id: TRASH_NOTEBOOK_ID, nodeType: "notebook", title: "回收站", space: null }),
  node({ id: "g1", nodeType: "group", parentId: "nb-plain", title: "分组" }),
  node({ id: "n1", nodeType: "note", parentId: "g1", title: "文档", noteFileId: "n1" }),
];

describe("libraryNotebooks（知识库列表的笔记本投影）", () => {
  it("普通笔记本留下；日记本与回收站笔记本剔除", () => {
    const ids = libraryNotebooks(FIXTURE).map((item) => item.id);
    expect(ids).toEqual(["nb-plain", "nb-plain-2"]);
    expect(ids).not.toContain("nb-diary");
    expect(ids).not.toContain(TRASH_NOTEBOOK_ID);
  });

  it("判据来自 core：日记本按 space 识别（不看标题），回收站按 TRASH_NOTEBOOK_ID 识别", () => {
    // 标题叫「日记」但没标记 ⇒ 是普通笔记本，必须留下（标题不参与判据）。
    const titledButNotMarked = node({ id: "nb-title-only", nodeType: "notebook", title: "日记", space: null });
    // 标了未知 space 值 ⇒ core 归一成非日记，同样留下（读取容错，docs/DIARY.md 硬规则 2）。
    const unknownSpace = node({ id: "nb-unknown", nodeType: "notebook", title: "未知", space: "future-space" as never });
    expect(libraryNotebooks([titledButNotMarked, unknownSpace]).map((item) => item.id)).toEqual(["nb-title-only", "nb-unknown"]);
    // 回收站常量来自 core（测试里也不写 "notebook-trash" 字面量）。
    const trash = node({ id: TRASH_NOTEBOOK_ID, nodeType: "notebook", title: "回收站" });
    expect(libraryNotebooks([trash])).toEqual([]);
  });

  it("只做投影：不修改传入数组，子树留在原数组里（渲染层过滤，存储不动）", () => {
    const before = FIXTURE.map((item) => item.id);
    const out = libraryNotebooks(FIXTURE);
    expect(out).not.toBe(FIXTURE);
    expect(FIXTURE.map((item) => item.id)).toEqual(before);
    // 日记本子树里的文档并没有被删掉，只是不在「笔记本列表」里。
    expect(FIXTURE.some((item) => item.id === "nb-diary")).toBe(true);
  });

  it("没有日记本/回收站时原样给出全部笔记本；空树给空数组", () => {
    const plain = [node({ id: "a", nodeType: "notebook" }), node({ id: "b", nodeType: "notebook" })];
    expect(libraryNotebooks(plain)).toEqual(plain);
    expect(libraryNotebooks([])).toEqual([]);
  });
});
