/** 全局搜索面板：文档 + 小记分组/图标/点击分流（261021）。 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("./SearchPanel.tsx", import.meta.url), "utf8");

describe("全局搜索：小记结果", () => {
  it("按 kind 分组并区分图标/徽标", () => {
    expect(SRC).toContain("kind?: \"note\" | \"quick-note\"");
    expect(SRC).toContain("firstQuickIndex");
    expect(SRC).toContain("search-panel-section");
    expect(SRC).toContain("<StickyNote size={14} />");
  });

  it("小记结果走 onOpenQuickNote，不当作文档 openNote", () => {
    expect(SRC).toMatch(/if \(result\.kind === "quick-note"\) onOpenQuickNote\(result\.id\)/);
    expect(SRC).toContain("onOpenQuickNote: (id: string) => void");
    expect(SRC).toContain("搜索标题、正文和小记");
  });
});
