import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ASSEMBLE = readFileSync(new URL("./useWorkspaceAssemble.ts", import.meta.url), "utf8");
const PANE = readFileSync(new URL("./NotePaneHost.tsx", import.meta.url), "utf8");
const TREE_DATA = readFileSync(new URL("./useNotebookTreeData.ts", import.meta.url), "utf8");

/**
 * 打开笔记本时的「初次进入」决策（261120 用户点单）：
 * **没有标签页就保持空态，不要自己开一个文档。**
 *
 * 历史：初次进入的最后一条兜底是「开树中第一篇」（firstNoteInTree）——用户明确要去掉它；
 * 显式打开（首页/搜索/新建文档带 initialNoteId）与「恢复上次标签」两条路径保持不变。
 * 空态界面沿用 NotePaneHost 既有文案，不新造第二套空态。
 */
describe("打开笔记本：没有标签页 → 空态", () => {
  it("初次进入不再自动打开树中第一篇（firstNote 兜底已删除）", () => {
    expect(ASSEMBLE).not.toContain("firstNote");
    expect(ASSEMBLE).not.toContain("restore([firstNote.id]");
    // 无标签时仍要清掉存档里失效的占位（hook initial state 可能还带着它们）
    expect(ASSEMBLE).toContain("restore([], null)");
    expect(ASSEMBLE).toContain("保持空态");
  });

  it("显式打开与恢复上次标签两条路径仍在（不被这次改动连坐）", () => {
    expect(ASSEMBLE).toContain("if (initialNoteId)");
    expect(ASSEMBLE).toContain("restore([initialNoteId,");
    expect(ASSEMBLE).toMatch(/if \(saved\.length > 0\)/);
    expect(ASSEMBLE).toContain("restore(saved, savedTabActiveId)");
  });

  it("空态由 NotePaneHost 的既有文案承担（不新造空态组件）", () => {
    expect(PANE).toContain("暂无打开的文档");
    // 目录侧也不再为「自动开第一篇」预先算候选
    expect(TREE_DATA).not.toMatch(/const firstNote\s*=/);
    expect(TREE_DATA).not.toContain("firstNoteInTree");
  });
});
