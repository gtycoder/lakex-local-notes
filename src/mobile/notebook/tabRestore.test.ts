import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** 261027：标签持久化/恢复的回归护栏。
 * 背景：useNotebookTabs 的持久化 effect 在挂载时先写 []，把上次保存的标签清掉，导致
 * 「每次进笔记本只剩第一篇」；同时恢复顺序曾把历史标签排在活动页后面（重启后标签顺序反转）。
 */
const WS = readFileSync(new URL("./NotebookWorkspace.tsx", import.meta.url), "utf8");
const SESSION = readFileSync(new URL("./useNotebookTabs.ts", import.meta.url), "utf8");

describe("标签持久化与恢复顺序（261027）", () => {
  it("挂载首帧不写空列表（不覆盖上次保存的标签）", () => {
    expect(SESSION).toContain("firstPersistRef");
    expect(SESSION).toMatch(/if \(firstPersistRef\.current\) \{ firstPersistRef\.current = false; return; \}/);
  });

  it("恢复时先登记历史标签、最后激活上次活动页（顺序不反转）", () => {
    const block = WS.slice(WS.indexOf("if (saved.length > 0)"));
    const earlier = block.indexOf("saved.slice(0, -1).forEach");
    const activate = block.indexOf("void openTab(saved[saved.length - 1], { activate: true })");
    expect(earlier).toBeGreaterThan(-1);
    expect(activate).toBeGreaterThan(earlier);
  });

  it("恢复前用目录已知 id 过滤（已删/已移出的标签不再打开）", () => {
    expect(WS).toMatch(/saved = saved\.filter\(\(id\) => knownNoteIds\.has\(id\) \|\| id === initialNoteId\)/);
  });
});
