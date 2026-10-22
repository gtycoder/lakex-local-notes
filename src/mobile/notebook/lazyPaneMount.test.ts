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

  it("恢复历史标签只建占位，活动页才读正文；编辑态由显式参数传入", () => {
    expect(WS).toMatch(/const openTab = useCallback\(\(id: string, options: OpenTabOptions = \{\}\): Promise<void>/);
    expect(WS).toContain("load: false");
    expect(WS).toMatch(/void openTab\(initialNoteId, \{ enterEditor: initialMode === "editor" \}\);/);
    expect(WS).toMatch(/saved\.filter\(\(id\) => id !== initialNoteId\)\.forEach\(\(id\) => void openTab\(id, \{ activate: false, load: false \}\)\)/);
    expect(WS).toMatch(/void openTab\(saved\[saved\.length - 1\], \{ activate: true \}\);/);
    expect(WS).toMatch(/saved\.slice\(0, -1\)\.forEach\(\(id\) => void openTab\(id, \{ activate: false, load: false \}\)\)/);
    expect(WS).not.toContain("pendingEditRef");
    expect(WS).toMatch(/enterEditor: kind === "usheet" \|\| kind === "bitable" \|\| kind === "board"/);
  });

  it("活动页变化时补挂载；tab 关闭/驱逐时回收标记", () => {
    expect(WS).toMatch(/prev\.has\(active\.id\) \? prev : new Set\(prev\)\.add\(active\.id\)/);
    expect(WS).toMatch(/const ids = new Set\(tabs\.map\(\(t\) => t\.id\)\)/);
  });

  it("并发恢复时淘汰保护当前活动页；占位正文由活动页统一懒读", () => {
    expect(WS).toMatch(/activeNoteId: activeIdRef\.current/);
    expect(WS).toMatch(/if \(!active \|\| active\.loaded\) return;\s*\n\s*void loadTabBody\(active\.id, tabEpochRef\.current\)/);
    // 自愈：活动页不在 tabs 且没有在途读取 ⇒ 落到第一个标签，避免永远骨架/空白
    expect(WS).toMatch(/pendingIdsRef\.current\.has\(activeId\)/);
    expect(WS).toMatch(/setActiveId\(tabs\[0\]\.id\)/);
    expect(WS).toMatch(/pendingIdsRef\.current\.delete\(id\);\s*\n\s*setReadTick\(\(t\) => t \+ 1\);/);
  });
});

describe("活动页悬空自愈（261021）", () => {
  it("恢复的历史标签读回空/失败后必须退出骨架（无标签时收回 activeId）", () => {
    // 读回空/失败不会新增 tab；pendingIdsRef 是 ref，必须靠 readTick 触发重渲染让自愈判据重跑
    expect(WS).toMatch(/setReadTick\(\(t\) => t \+ 1\)/);
    expect(WS).toMatch(/\}, \[activeId, tabs, readTick\]\)/);
    // 没有标签时不能因 tabs.length === 0 提前 return（旧实现会永远停在 mb-doc-skeleton）
    expect(WS).toContain("if (activeId && !pendingIdsRef.current.has(activeId)) setActiveId(null);");
  });
});
