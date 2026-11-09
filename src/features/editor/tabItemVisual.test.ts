/**
 * 标签视觉单一来源（261109 小抽）：文档标签与日记标签必须用同一个 `TabItemVisual`，
 * 谁再手搓一套 `.tab-item > .tab-title` 标记（今天踩过：按钮默认边框让标签看着像输入框）就红。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("标签视觉单一来源", () => {
  it("文档标签与日记标签都通过 TabItemVisual 渲染，且组件内部结构固定", () => {
    const editor = read("./MultiTabEditor.tsx");
    const app = read("../../App.tsx");
    const visual = read("./TabItemVisual.tsx");
    expect(editor).toContain("<TabItemVisual");
    expect(app).toContain("<TabItemVisual");
    // 结构契约：title + close 两个类必须来自同一个组件（调用方不得自己再写一遍）
    expect(visual).toContain('className="tab-title"');
    expect(visual).toContain('className="tab-close"');
    // 日记空间：完全不得自写标签标记。
    expect(app).not.toContain('className="tab-title"');
    expect(app).not.toContain('className="tab-close"');
    // 文档空间：普通标签已走 TabItemVisual；只剩「分屏复合标签」的两个半块会自己写标题
    // （那是把两页并成一格的特殊形态，复用同一套 class 但结构不同 —— 不并进视觉原子）。
    const splitHalves = editor.match(/className="tab-title"/g)?.length ?? 0;
    expect(splitHalves, "仅分屏复合标签的两个半块可以自写 tab-title").toBe(2);
    // 分屏复合标签自带一个总关闭钮（关掉整组两页），其余标签的关闭都来自视觉原子。
    expect(editor.match(/className="tab-close"/g)?.length ?? 0, "普通标签的 tab-close 应只在 TabItemVisual 里").toBe(1);
  });
});
