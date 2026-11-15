import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 键盘激活契约（261115，MODERN-WEB-AUDIT A10）。
 *
 * 审计里「33 处可点 div」逐条复核后只有少数是真缺口：
 * · 12+ 处是遮罩/背板（aria-hidden，Esc/返回键是等价出口）——不该变按钮；
 * · 5 处是 stopPropagation 容器（防止点击穿透，不是激活）；
 * · 2 处已带 role=button（目录行操作）；
 * 真正的 mouse-only 控件在本文件钉住：色板（全部色块 + 默认/无填充行）、
 * 历史快照列表（Enter/Space 就地预览）、移动端「打开的标签」行。
 */
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.resolve(HERE, "..");
const read = (rel: string): string => readFileSync(path.join(SRC, rel), "utf8");

describe("键盘激活契约（A10）", () => {
  it("色板：色块与默认行都是 role=button + tabIndex + Enter/Space", () => {
    const src = read("features/editor/selectionToolbar/LakeColorBoard.tsx");
    expect(src.match(/role="button"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(src.match(/tabIndex=\{0\}/g)?.length).toBeGreaterThanOrEqual(2);
    expect(src.match(/onKeyDown=/g)?.length).toBeGreaterThanOrEqual(2);
    expect(src).toContain('e.key === "Enter" || e.key === " "');
  });

  it("历史列表：Enter/Space 就地点当前选中行（单个 tab 停点，不把每行变成停点）", () => {
    const src = read("components/app/HistoryPanel.tsx");
    expect(src).toContain('.ln-list-item--focus .ln-list-item__text');
    expect(src).toMatch(/event\.key === "Enter" \|\| event\.key === " "/);
  });

  it("移动端标签行：role=button + tabIndex + 键盘打开", () => {
    const src = read("mobile/notebook/WorkspaceOverlayHost.tsx");
    expect(src).toMatch(/role="button"\s+tabIndex=\{0\}/);
    expect(src).toContain("props.onOpenTab(t.id); }");
  });
});
