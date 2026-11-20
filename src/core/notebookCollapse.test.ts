import { describe, expect, it } from "vitest";
import { FALLBACK_NOTEBOOK_ID, TRASH_NOTEBOOK_ID } from "./syncDecisions";
import { canCollapseNotebook, normalizeCollapsedNotebookIds, pruneCollapsedNotebookIds, splitCollapsedNotebooks } from "./notebookCollapse";

const nb = (id: string, extra: { nodeType?: string; space?: "diary" | null } = {}) => ({
  id,
  nodeType: (extra.nodeType ?? "notebook") as "notebook" | "note" | "group",
  space: extra.space ?? null,
});

describe("「已收起」笔记本判定（261120 用户点单）", () => {
  it("普通笔记本可收起；文档/分组不可（收起只针对笔记本）", () => {
    expect(canCollapseNotebook(nb("nb1"))).toBe(true);
    expect(canCollapseNotebook(nb("note1", { nodeType: "note" }))).toBe(false);
    expect(canCollapseNotebook(nb("g1", { nodeType: "group" }))).toBe(false);
  });

  it("三类特殊本**逻辑上**排除（不只是 UI 不给入口）", () => {
    expect(canCollapseNotebook(nb(TRASH_NOTEBOOK_ID))).toBe(false);
    expect(canCollapseNotebook(nb(FALLBACK_NOTEBOOK_ID))).toBe(false);
    expect(canCollapseNotebook(nb("nb-diary", { space: "diary" }))).toBe(false);
    // 普通本 space 为 null / 缺省都算普通本
    expect(canCollapseNotebook(nb("nb2", { space: null }))).toBe(true);
  });

  it("prune：已知但不可收起的 id 清掉；未知 id 保留（加载期不误删）", () => {
    const byId = new Map([
      ["nb1", nb("nb1")],
      ["nb-diary", nb("nb-diary", { space: "diary" })],
      [TRASH_NOTEBOOK_ID, nb(TRASH_NOTEBOOK_ID)],
    ]);
    expect(pruneCollapsedNotebookIds(["nb1", "nb-diary", TRASH_NOTEBOOK_ID, "nb-unknown"], byId))
      .toEqual(["nb1", "nb-unknown"]);
  });

  it("split：按收起状态切两份；非法 id 留在主列表（不会凭空消失）", () => {
    const list = [nb("nb1"), nb("nb2"), nb(TRASH_NOTEBOOK_ID), nb("nb-diary", { space: "diary" })];
    const { active, collapsed } = splitCollapsedNotebooks(list, ["nb2", TRASH_NOTEBOOK_ID, "nb-di e"]);
    expect(active.map((n) => n.id)).toEqual(["nb1", TRASH_NOTEBOOK_ID, "nb-diary"]);
    expect(collapsed.map((n) => n.id)).toEqual(["nb2"]);
  });

  it("normalize：去重、丢空串与非字符串", () => {
    expect(normalizeCollapsedNotebookIds(["a", "a", "", 5, null, "b"])).toEqual(["a", "b"]);
  });
});
