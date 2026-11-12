import { describe, expect, it, vi } from "vitest";

// docBatch 顶层 import bridge（会拖进原生桥）；这里只需要纯映射函数。
vi.mock("../bridge", () => ({ bridge: {} }));

import { moveTargetsFromSnapshot } from "./docBatch";

const node = (id: string, parentId: string | null, nodeType: "notebook" | "group" | "note", title: string, space?: "diary" | null) => ({
  id, workspaceId: "mobile", parentId, nodeType, title, noteFileId: null, sortOrder: 0,
  createdAt: "t", updatedAt: "t", isConflict: false, icon: null, ...(space === undefined ? {} : { space }),
});
const snapshot = (treeNodes: ReturnType<typeof node>[]) => ({ treeNodes, notes: [], quickNotes: { items: [], nextCursor: null } }) as never;

describe("移动目标列表（261112 §3#25：日记本不作移动目标）", () => {
  it("不含日记本及其年/月组；普通笔记本/分组保留", () => {
    const targets = moveTargetsFromSnapshot(snapshot([
      node("nb-work", null, "notebook", "工作"),
      node("g", "nb-work", "group", "分组"),
      node("nb-diary", null, "notebook", "日记", "diary"),
      node("y", "nb-diary", "group", "2026"),
      node("m", "y", "group", "11"),
    ]));
    expect(targets.map((t) => t.id)).toEqual(["nb-work", "g"]);
  });
});
