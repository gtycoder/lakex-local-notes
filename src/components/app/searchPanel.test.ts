/** 全局搜索面板：文档 + 小记分组/图标/点击分流（261021）。 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("./SearchPanel.tsx", import.meta.url), "utf8");

describe("全局搜索：小记结果", () => {
  it("按 kind 分组并区分图标/徽标", () => {
    // 结果形状收敛到 features/search（SearchHit）：kind 仍区分 note / quick-note
    expect(SRC).toContain("type SearchHit");
    expect(readFileSync(new URL("../../features/search/searchScope.ts", import.meta.url), "utf8")).toContain('kind?: "note" | "quick-note"');
    expect(SRC).toContain("firstQuickIndex");
    expect(SRC).toContain("search-panel-section");
    expect(SRC).toContain("<StickyNote size={14} />");
  });

  it("小记结果走 onOpenQuickNote，不当作文档 openNote", () => {
    expect(SRC).toMatch(/if \(result\.kind === "quick-note"\) onOpenQuickNote\(result\.id\)/);
    expect(SRC).toContain("onOpenQuickNote: (id: string) => void");
    expect(SRC).toContain("搜索标题、正文、标签和小记");
  });
});
/**
 * 261106 搜索增强：范围筛选（全部/标题/正文/标签）、最近搜索、空态/无结果引导。
 * 逻辑本身由 features/search/*.test.ts 与 searchPanelEnhancements.render.test.tsx 覆盖，
 * 这里只钉「面板确实接了这些能力」（避免以后改回只有关键词的搜索框）。
 */
describe("全局搜索：范围筛选 / 最近搜索 / 空态引导", () => {
  it("范围页签走 kit 的 .ln-tabs 原语，顺序来自 SEARCH_SCOPES 单一来源", () => {
    expect(SRC).toContain("SEARCH_SCOPES");
    expect(SRC).toContain('className="ln-tabs search-scope-tabs"');
    expect(SRC).toContain('role="tablist"');
    expect(SRC).toContain("aria-selected={scope === item.id}");
    // 261109 日记空间：先按日记条目文档 id 集合收窄（单一来源 = features/diary/diarySearch），再走范围页签。
    expect(SRC).toContain("filterDiarySearchHits(mergedResults, scopeNoteIds)");
    expect(SRC).toContain("filterByScope(scopedResults, scope)");
    // 范围是设备本地视图（localStorage 记忆），不写设置
    expect(SRC).toContain("SEARCH_SCOPE_STORAGE_KEY");
    expect(SRC).toContain("writeLocalStorage(SEARCH_SCOPE_STORAGE_KEY, scope)");
  });

  it("标签命中用既有 IPC 拼接（不新增索引），与主进程结果按 kind:id 去重合并", () => {
    expect(SRC).toContain("loadTagSearchIndex");
    expect(SRC).toContain("matchTagSearch(tagIndex, trimmedQuery)");
    expect(SRC).toContain("mergeSearchHits(results, tagHits)");
    expect(SRC).toContain("result.matchType === \"tag\"");
  });

  it("最近搜索：空查询展示、点击执行、可清空（localStorage）", () => {
    expect(SRC).toContain("readRecentSearches()");
    expect(SRC).toContain("pushRecentSearch(recent, value)");
    expect(SRC).toContain("writeRecentSearches(next)");
    expect(SRC).toContain("clearRecentSearches()");
    expect(SRC).toContain("最近搜索");
  });

  it("空态/无结果引导：无关键词给搜索说明 + ⌘K；无结果按当前范围给放宽出口", () => {
    expect(SRC).toContain("searchIdleHint()");
    expect(SRC).toContain("searchNoResultHint(scope)");
    expect(SRC).toContain("搜索全部范围");
    expect(SRC).toContain("noResultHint.broadenToAll");
  });

  it("键盘与 Esc 不回归：↑↓ 步进（还没选时 ↓ 落第一条）+ Enter 打开 + Esc 关闭", () => {
    expect(SRC).toContain("stepSelection(1)");
    expect(SRC).toContain("stepSelection(-1)");
    expect(SRC).toMatch(/const stepSelection = \(delta: 1 \| -1\)/);
    expect(SRC).toContain("if (index < 0) return delta > 0 ? 0 : navigable.length - 1;");
    expect(SRC).toContain("nextSearchIndex(index, delta, navigable.length)");
    expect(SRC).toMatch(/event\.key === "Escape"\s*\)? *\{ onClose\(\); return; \}/);
  });
});

describe("测试/断言与最新 UI 对齐", () => {
  it("打包冒烟的搜索无障碍名与 SearchPanel 的 Dialog label 一致", () => {
    const label = /<Dialog[^>]*label="([^"]+)"/.exec(SRC)?.[1];
    expect(label).toBeTruthy();
    const smoke = readFileSync(new URL("../../../scripts/e2e-electron-smoke.mjs", import.meta.url), "utf8");
    expect(smoke).toContain(`result.search.dialogLabel !== "${label}"`);
  });
});
