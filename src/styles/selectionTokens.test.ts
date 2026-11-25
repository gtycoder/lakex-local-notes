/**
 * 选中态语义令牌护栏（261017 Q3）。
 *
 * 口径：
 * - UI 选中（目录行/页签/菜单/胶囊…）继续用主题色，但只经 3 个语义令牌：
 *   --lake-bg-selected / --lake-fg-selected / --lake-bg-selected-hover；
 * - 文字选中背景走主题无关中性灰 --lake-select-bg；
 * - 内容选区边框（表格/多维表单元格）保留主题主色 --lake-accent。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const BASE = read("./themes/base.css");
const KIT = read("./kit.css");
const KERNEL = read("./kernel-theme.css");
const CHROME = read("./chrome.css");
const BITABLE = read("../features/bitable/bitableEditor.css");
const M_TOKENS = read("../mobile/theme/tokens.css");
const M_KIT = read("../mobile/kit.css");
const M_CSS = read("../mobile/mobile.css");
const OUTLINE = read("../features/outline/outline.css");

describe("选中态语义令牌（261017 Q3）", () => {
  it("桌面与移动端都定义 3 个令牌，hover 档用 color-mix 自适应主题", () => {
    for (const css of [BASE, M_TOKENS]) {
      expect(css).toContain("--lake-bg-selected: var(--lake-accent-tint);");
      expect(css).toContain("--lake-fg-selected: var(--lake-accent-text);");
      expect(css).toContain(
        "--lake-bg-selected-hover: color-mix(in srgb, var(--lake-accent-tint) 88%, var(--lake-accent));",
      );
    }
  });

  it("桌面选中面只经语义令牌（不再直接写 accent-tint / accent-text）", () => {
    expect(KIT).toMatch(/\.ln-row\.is-selected,[\s\S]{0,900}?background: var\(--lake-bg-selected\)/);
    // 261110：选中态三层（secondary/outlined/ghost）合并成一条规则，仍只经语义令牌。
    expect(KIT).toMatch(/\.ln-btn--secondary\.is-selected[^{]*\{[^}]*background: var\(--lake-bg-selected\)/);
    expect(KIT).toMatch(/\.ln-iconbtn\.is-selected \{[^}]*background: var\(--lake-bg-selected\)/);
    expect(KIT).toMatch(/\.ln-tabs__item\.is-active \.ln-tabs__count \{[^}]*background: var\(--lake-bg-selected\)/);
    expect(CHROME).toMatch(/\.note-row\.active \{[^}]*background: var\(--lake-bg-selected\)/);
  });

  it("选中 + hover 走专用档（行/菜单/图标钮/目录行）", () => {
    expect(KIT).toMatch(/\.ln-row\.is-selected:hover,[\s\S]{0,220}?background: var\(--lake-bg-selected-hover\)/);
    expect(KIT).toMatch(/\.ln-iconbtn\.is-selected:hover:not\(:disabled\) \{ background: var\(--lake-bg-selected-hover\); \}/);
    expect(KIT).toMatch(/\.ln-btn--secondary\.is-selected:hover:not\(:disabled\)[^{]*\{[^}]*background: var\(--lake-bg-selected-hover\)/);
    expect(CHROME).toMatch(/\.note-row\.active:hover \{ background: var\(--lake-bg-selected-hover\); \}/);
  });

  it("输入框与全局文字选区都落到主题无关中性灰令牌", () => {
    expect(KIT).toMatch(/\.ln-input::selection, \.ln-input__field::selection \{ background: var\(--lake-select-bg\); \}/);
    expect(KERNEL).toMatch(/:root ::selection \{ background: var\(--lake-select-bg\); color: inherit; \}/);
  });

  it("移动端选中面同样只经语义令牌（无 hover 档）", () => {
    expect(M_KIT).toMatch(/\.mb-row\.is-selected \{[^}]*background: var\(--lake-bg-selected\)/);
    expect(M_KIT).toMatch(/\.mb-list-item\.is-selected \{[^}]*color: var\(--lake-fg-selected\)/);
    expect(M_CSS).toMatch(/\.mobile-bottom-bar__item\.active \{[^}]*background-color: var\(--lake-bg-selected\)/);
  });

  it("内容选区边框仍用主题主色（不要被「内容选中去主题色」误改）", () => {
    expect(BITABLE).toMatch(/\.bt-grid \.bt-td\.sel-top \{ --bt-sel-t: inset 0 2px 0 0 var\(--lake-accent\); \}/);
    expect(BITABLE).not.toMatch(/\.bt-grid \.bt-td\.sel-top \{ --bt-sel-t: inset 0 2px 0 0 var\(--lake-select/);
  });

  it("大纲选中 = UI 选中三件套，且不再有左侧 3px 主色条（261125 用户裁决 4 / 审计 R-01）", () => {
    // 同一交互语义（UI 选中）与目录行/页签同套令牌：bg-selected 底 + fg-selected 字 + 600 字重。
    expect(OUTLINE).toMatch(/\.outline-item--selected \{[^}]*color: var\(--lake-fg-selected\)/);
    expect(OUTLINE).toMatch(/\.outline-item--selected \{[^}]*background: var\(--lake-bg-selected\)/);
    expect(OUTLINE).toMatch(/\.outline-item--selected \{[^}]*font-weight: var\(--lake-font-weight-semibold\)/);
    // DESIGN Shapes：禁止 >1px 单侧色条（左侧 3px 主色条已删，禁止回流）。
    expect(OUTLINE).not.toMatch(/\.outline-item--selected[^{]*\{[^}]*box-shadow/);
    expect(OUTLINE).not.toMatch(/box-shadow:\s*inset\s*[2-9](?:\.\d+)?px/);
  });
});
