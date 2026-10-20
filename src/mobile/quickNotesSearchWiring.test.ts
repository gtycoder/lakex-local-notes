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
    expect(REPO).toContain("searchQuickNotes(d, query, 20)");
    expect(SHEET).toContain("onOpenQuickNote");
    expect(SHEET).toMatch(/if \(r\.kind === "quick-note"\) onOpenQuickNote\(r\.id\)/);
    expect(SHEET).toContain("搜索文档和小记");
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
