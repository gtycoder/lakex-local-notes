import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 261019 优化：恢复历史标签时**只挂当前页**的正文分量（其余等切到时再挂）。
 * 背景：一上来 map 出 8 个 .doc-pane 会同时起 8 个内核/Univer 实例，实测 workspace push 后
 * 骨架约 1s；改成懒挂载后只起当前这一页。这里钉住结构与接线（行为由设备时间线验收）。
 */
const WS = readFileSync(new URL("./NotebookWorkspace.tsx", import.meta.url), "utf8");

describe("工作区正文懒挂载（261019）", () => {
  it("有挂载集合，且渲染只在已挂载时起正文分量；活动页未挂载时继续显示骨架", () => {
    expect(WS).toContain("mountedIds");
    expect(WS).toMatch(/!mountedIds\.has\(t\.id\) \? null :/);
    expect(WS).toMatch(/!active \|\| !mountedIds\.has\(active\.id\)/);
  });

  it("恢复历史标签时不激活（只登记），活动页先读且单独 open", () => {
    expect(WS).toMatch(/const openTab = useCallback\(\(id: string, activate = true\)/);
    // 当前文档的读取排在历史标签之前（别被队头拖慢）
    expect(WS).toMatch(/void openTab\(initialNoteId\);\s*\n\s*saved\.filter\(\(id\) => id !== initialNoteId\)\.forEach\(\(id\) => void openTab\(id, false\)\)/);
    expect(WS).toMatch(/void openTab\(saved\[saved\.length - 1\], true\);\s*\n\s*saved\.slice\(0, -1\)\.forEach\(\(id\) => void openTab\(id, false\)\)/);
  });

  it("活动页变化时补挂载；tab 关闭/驱逐时回收标记", () => {
    expect(WS).toMatch(/prev\.has\(active\.id\) \? prev : new Set\(prev\)\.add\(active\.id\)/);
    expect(WS).toMatch(/const ids = new Set\(tabs\.map\(\(t\) => t\.id\)\)/);
  });

  it("并发恢复时淘汰要保护**当前活动页**，不是刚加入的那一条（261019 偶发空白根因）", () => {
    expect(WS).toMatch(/activeNoteId: activeIdRef\.current \?\? id/);
    // 自愈：活动页不在 tabs 且没有在途读取 ⇒ 落到第一个标签，避免永远骨架/空白
    expect(WS).toMatch(/pendingIdsRef\.current\.has\(activeId\)/);
    expect(WS).toMatch(/setActiveId\(tabs\[0\]\.id\)/);
    expect(WS).toMatch(/finally\(\(\) => \{ pendingIdsRef\.current\.delete\(id\); \}\)/);
  });
});
