import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 261019 优化：恢复历史标签时**只挂当前页**的正文分量（其余等切到时再挂）。
 * 状态机与懒读行为由 useNotebookTabs.test.ts 验证；本文件只卡工作区接线。
 */
const WS = readFileSync(new URL("./NotebookWorkspace.tsx", import.meta.url), "utf8");

describe("工作区正文懒挂载接线", () => {
  it("标签会话交给 useNotebookTabs；恢复历史标签只让活动页读正文", () => {
    expect(WS).toContain("useNotebookTabs({");
    expect(WS).toContain("load: false");
    expect(WS).toMatch(/void openTab\(initialNoteId, \{ enterEditor: initialMode === "editor" \}\);/);
    expect(WS).toMatch(/saved\.filter\(\(id\) => id !== initialNoteId\)\.forEach\(\(id\) => void openTab\(id, \{ activate: false, load: false \}\)\)/);
    expect(WS).toMatch(/void openTab\(saved\[saved\.length - 1\], \{ activate: true \}\);/);
    expect(WS).toMatch(/saved\.slice\(0, -1\)\.forEach\(\(id\) => void openTab\(id, \{ activate: false, load: false \}\)\)/);
    expect(WS).not.toContain("pendingEditRef");
    expect(WS).toMatch(/enterEditor: kind === "usheet" \|\| kind === "bitable" \|\| kind === "board"/);
  });

  it("活动页未挂载时显示骨架；正文只在 mountedIds 命中后起编辑器", () => {
    expect(WS).toMatch(/!active \|\| !mountedIds\.has\(active\.id\)/);
    expect(WS).toMatch(/!mountedIds\.has\(t\.id\) \? null :/);
  });
});
