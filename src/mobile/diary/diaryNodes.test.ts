/**
 * 日记判据输入投影（261109 片 C 缺陷的回归护栏）：
 * `bridge.getHomeSnapshot().treeNodes` **只有 folders**，日记条目在 notes 表里。
 * 这个投影漏了 notes ⇒ 日记页永远空、日记内搜索恒 0 条、转文档的目标条目也找不到。
 */
import { describe, expect, it } from "vitest";
import type { TreeNode } from "../../lib/types";
import type { LocalNoteSummary } from "../data/noteRepository";
import { diaryEntries, diaryNotebookId } from "../../core/diary.js";
import { diaryNodesFrom } from "./diaryNodes";

const T = "2026-11-09T09:00:00.000Z";
const folder = (over: Partial<TreeNode> & { id: string; title: string }): TreeNode => ({
  workspaceId: "mobile", parentId: null, nodeType: "group", noteFileId: null, sortOrder: 0,
  createdAt: T, updatedAt: T, isConflict: false, icon: null, space: null, ...over,
});

const FOLDERS: TreeNode[] = [
  folder({ id: "nb-diary", title: "日记", nodeType: "notebook", space: "diary" }),
  folder({ id: "y2026", title: "2026", parentId: "nb-diary" }),
  folder({ id: "m11", title: "11", parentId: "y2026" }),
  folder({ id: "nb-work", title: "工作", nodeType: "notebook" }),
];
const NOTES: LocalNoteSummary[] = [
  { id: "d1109", title: "2026-11-09", parentId: "m11", updatedAt: T },
  { id: "n-work", title: "周报", parentId: "nb-work", updatedAt: T },
];

describe("diaryNodesFrom（目录 + 文档混合视图）", () => {
  it("只有 folders 时日记条目为空（这正是漏投影的旧行为）", () => {
    expect(diaryEntries(FOLDERS, diaryNotebookId(FOLDERS))).toEqual([]);
  });

  it("补上 notes 投影后，日记条目能被 core 判据识别（标题即日期 + 父子链）", () => {
    const nodes = diaryNodesFrom(FOLDERS, NOTES);
    const entries = diaryEntries(nodes, diaryNotebookId(nodes));
    expect(entries.map((entry) => entry.noteId)).toEqual(["d1109"]);
    expect(entries[0].dateKey).toBe("2026-11-09");
    expect(entries[0].parentId).toBe("m11");
    // 非日记文档不进条目（在别的笔记本下）
    expect(entries.some((entry) => entry.noteId === "n-work")).toBe(false);
  });

  it("投影只补形状：不复制判据、不改 folders 引用内容", () => {
    const nodes = diaryNodesFrom(FOLDERS, NOTES);
    expect(nodes.slice(0, FOLDERS.length)).toEqual(FOLDERS);
    expect(nodes.length).toBe(FOLDERS.length + NOTES.length);
    const projected = nodes.find((node) => node.id === "d1109")!;
    expect(projected.nodeType).toBe("note");
    expect(projected.space).toBeNull();
    expect(projected.title).toBe("2026-11-09");
  });
});
