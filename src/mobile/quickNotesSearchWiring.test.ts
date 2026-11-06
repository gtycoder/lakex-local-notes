/** 移动端小记搜索接线护栏（261021）。 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const SHEET = read("./settings/SearchSheet.tsx");
const HOME = read("./home/HomePage.tsx");
const APP = read("./MobileApp.tsx");
const REPO = read("./data/noteRepository.ts");

describe("移动端小记搜索", () => {
  it("全局搜索合并小记，点击走单独回调（不按文档 id 打开）", () => {
    // 261105 搜索增强：合并入口改为「按范围」的同一函数（默认/全部范围语义不变，小记上限仍 20）。
    expect(REPO).toContain("searchQuickNotesByScope(d, query, scope, 20)");
    expect(SHEET).toContain("onOpenQuickNote");
    expect(SHEET).toMatch(/if \(result\.kind === "quick-note"\) onOpenQuickNote\(result\.id\)/);
    // 搜索框文案要覆盖文档 + 小记 + 标签（261105 新增标签范围）
    expect(SHEET).toContain("搜索文档、小记与标签");
  });

  it("搜索命中只回首页定位/高亮小记，不自动进编辑态", () => {
    expect(APP).toContain("openQuickNoteFromSearch");
    expect(APP).toContain("pendingQuickNoteId");
    expect(HOME).toContain("revealedQuickNoteId");
    expect(HOME).toContain("is-revealed");
    // HomePage 接力 effect 里不得再调用 openEdit
    const start = HOME.indexOf("if (!pendingQuickNoteId) return;");
    const block = HOME.slice(start, start + 900);
    expect(block).toContain("scrollIntoView");
    expect(block).not.toContain("openEdit(");
  });
});
