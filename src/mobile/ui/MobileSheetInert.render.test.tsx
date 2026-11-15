// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { MobileSheet } from "./MobileSheet";

/**
 * 261116 护栏（overlay-matrix 实测的 FAIL 子项）：
 * 模态 Sheet 打开时 aria-modal 只是声明 —— 背景控件仍能被 focus。
 * 现在沿祖先链把兄弟节点 inert 化；遮罩必须保留可点（它是关闭入口）。
 */
describe("MobileSheet 背景惰性化", () => {
  it("打开时兄弟节点 inert，Sheet 与遮罩不受影响；关闭后复原", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const outside = document.createElement("button");
    outside.textContent = "背景按钮";
    document.body.appendChild(outside);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(<MobileSheet open title="标签" onClose={() => {}}>内容</MobileSheet>);
      });
      expect(outside.hasAttribute("inert")).toBe(true);
      const sheet = document.querySelector(".mb-sheet") as HTMLElement;
      expect(sheet).not.toBeNull();
      expect(sheet.hasAttribute("inert")).toBe(false);
      expect(sheet.closest("[inert]")).toBeNull();
      const scrim = document.querySelector(".mb-scrim") as HTMLElement;
      expect(scrim.hasAttribute("inert")).toBe(false);
      expect(outside.closest("[inert]")).toBe(outside);
      await act(async () => { root.unmount(); });
      expect(outside.hasAttribute("inert")).toBe(false);
    } finally {
      outside.remove();
      host.remove();
    }
  });
});
