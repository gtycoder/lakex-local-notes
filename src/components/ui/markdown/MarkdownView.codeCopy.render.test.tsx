// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { MarkdownView } from "./MarkdownView";

/**
 * 261116 P4 护栏：代码块的复制按钮写的是**原文**（不是带行号的 DOM 文本）。
 * 行号是 CSS 计数器渲染的 ::before，不在 textContent 里，因此这里同时钉住「复制内容不带行号」。
 */
describe("MarkdownView 代码块复制", () => {
  it("点复制写入原始代码，按钮短暂变成已复制", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(<MarkdownView source={"```js\nconst a = 1;\nconst b = 2;\n```\n"} />);
      });
      const button = host.querySelector(".md-code__copy") as HTMLButtonElement;
      expect(button).not.toBeNull();
      expect(host.querySelectorAll(".md-code__line").length).toBe(2);
      await act(async () => { button.click(); });
      expect(writeText).toHaveBeenCalledWith("const a = 1;\nconst b = 2;");
      expect(button.textContent).toBe("已复制");
    } finally {
      await act(async () => { root.unmount(); });
      host.remove();
    }
  });
});
