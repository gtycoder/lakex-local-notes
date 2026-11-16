// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LakeColorBoard } from "./LakeColorBoard";

/**
 * 261116：选中对勾重画到 24 网格 + 颜色落 token。
 * 原实现把 24 网格的 Material 对勾塞进 viewBox="0 0 18 18"，路径 x∈[3.5,21] / y∈[5.59,19]
 * ⇒ 右下两笔被 svg 视窗裁掉；且 5 个颜色字面量违反「颜色只允许出现在 themes/」。
 * 这里钉住：① 所有对勾 24 网格；② 对勾颜色只走专用令牌（深底=paper / 浅底=ink）；
 * ③ 绘制属性里不再出现 hex。
 */
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false); });

const renderBoard = (value: string) => act(() => root.render(createElement(LakeColorBoard, { value, onSelect: () => {} })));

describe("LakeColorBoard（选色盘对勾）", () => {
  it("所有对勾都是 24 网格（原 18 视窗会裁掉右下角）", () => {
    renderBoard("#FFFFFF");
    // 面板里还有内核 `<use>` 的箭头 svg（.ne-icon-symbol，无 viewBox，由 sprite 决定）⇒ 只查对勾
    const checks = [...host.querySelectorAll("svg")].filter((svg) => svg.querySelector("path"));
    expect(checks.length).toBeGreaterThan(0);
    for (const svg of checks) expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
  });

  it("深色 swatch 用 paper 对勾、浅色 swatch 用 ink 对勾（亮度判据不变）", () => {
    renderBoard("#000000");
    const dark = host.querySelector(".lake-colorboard-group-item-active path")!;
    expect(dark.getAttribute("fill")).toBe("var(--lake-colorboard-check-paper)");

    renderBoard("#FFFFFF");
    const light = host.querySelector(".lake-colorboard-group-item-active path")!;
    expect(light.getAttribute("fill")).toBe("var(--lake-colorboard-check-ink)");
  });

  it("「默认」行（value 为空）激活时用 paper 对勾，色样块走专用令牌", () => {
    renderBoard("");
    const def = host.querySelector(".lake-colorboard-default")!;
    expect(def.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(def.querySelector("path")!.getAttribute("fill")).toBe("var(--lake-colorboard-check-paper)");
    expect(def.innerHTML).toContain("var(--lake-colorboard-default-swatch)");
  });

  it("绘制属性里不再有颜色字面量（hex 只剩 <input type=color> 的初值）", () => {
    renderBoard("#FFFFFF");
    const html = host.innerHTML;
    expect(html).not.toMatch(/fill="#/);
    expect(html).not.toMatch(/stroke="#/);
    expect(html).toContain("--lake-colorboard-check-ink");
  });
});
