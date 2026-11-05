/**
 * P2-D a11y：文档列表标签筛选 chip 的可访问性契约。
 * ① 可切换控件必须有 aria-pressed（读屏能听出选中态）；
 * ② 点按命中盒 ≥ 44（--mb-tap-min）——筛选条 chip 是控件，卡内展示型标签仍是 28。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");
const SHEET = read("src/mobile/editor/DocListSheet.tsx");
const CSS = read("src/mobile/quick-notes.css");

describe("文档列表标签筛选 a11y（P2-D）", () => {
  it("chips 带 aria-pressed（全部与每个标签）", () => {
    expect(SHEET).toContain("aria-pressed={activeTagId === null}");
    expect(SHEET).toContain("aria-pressed={activeTagId === tag.id}");
  });

  it("筛选条 chip 命中盒 ≥ 44（--mb-tap-min），不靠卡内展示型 28 撑点按", () => {
    expect(CSS).toMatch(/\.qn-tag-filter-bar \.qn-tag \{[^}]*min-height:\s*var\(--mb-tap-min\)/);
    // 卡内展示型标签维持 28（不作控件用），避免把整页标签都抬高
    expect(CSS).toMatch(/\.qn-tag \{[^}]*min-height:\s*28px/);
  });
});
