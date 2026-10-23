// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isStackedFocusRing, vendorHostAncestor } from "./vendorFocusProbe";

// jsdom 环境下 import.meta.url 不是 file: 协议 ⇒ 用工程根（vitest cwd）拼路径
const ROOT = process.cwd();
const MAIN = readFileSync(path.join(ROOT, "src/main.tsx"), "utf8");
const CSS = readFileSync(path.join(ROOT, "src/styles/vendor-focus.css"), "utf8");

/** 261023：表格/内核弹窗的输入框反复出现「两层边框」= 第三方宿主里又吃到全局焦点环。
 *  这里卡住三件事：探针能认出宿主、样式表覆盖了宿主列表、且两处都真的接进入口。 */
describe("第三方控件焦点环（261023：表格输入框两层边框的根因护栏）", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("探针能认出第三方宿主：内联编辑器 / 弹窗 portal / 内核浮层", () => {
    const own = document.createElement("div");
    own.className = "app-shell";
    const ownInput = document.createElement("input");
    own.appendChild(ownInput);
    document.body.appendChild(own);
    expect(vendorHostAncestor(ownInput)).toBeNull();

    const sheet = document.createElement("div");
    sheet.className = "usheet-editor";
    const sheetInput = document.createElement("input");
    sheet.appendChild(sheetInput);
    document.body.appendChild(sheet);
    expect(vendorHostAncestor(sheetInput)).toBe(sheet);

    const floating = document.createElement("div");
    floating.setAttribute("data-lake-univer-floating", "");
    const dialogInput = document.createElement("input");
    floating.appendChild(dialogInput);
    document.body.appendChild(floating);
    expect(vendorHostAncestor(dialogInput)).toBe(floating);

    const kernel = document.createElement("div");
    kernel.className = "ne-overlay-container";
    const kernelInput = document.createElement("input");
    kernel.appendChild(kernelInput);
    document.body.appendChild(kernel);
    expect(vendorHostAncestor(kernelInput)).toBe(kernel);
  });

  it("只对「第三方宿主 + 仍带 outline」的控件判为叠层（否则会误报自有控件）", () => {
    const sheet = document.createElement("div");
    sheet.className = "usheet-editor";
    const input = document.createElement("input");
    sheet.appendChild(input);
    document.body.appendChild(sheet);
    expect(isStackedFocusRing(input, { style: "solid", width: "2px" })).toBe(true);
    expect(isStackedFocusRing(input, { style: "none", width: "2px" })).toBe(false);

    const own = document.createElement("div");
    own.className = "app-shell";
    const ownInput = document.createElement("input");
    own.appendChild(ownInput);
    document.body.appendChild(own);
    expect(isStackedFocusRing(ownInput, { style: "solid", width: "2px" })).toBe(false);
  });

  it("样式与入口都接上了：宿主列表含弹窗 portal，入口 import 探针 + 样式", () => {
    // 弹窗是 portal 到 body 的 ⇒ 只写 .usheet-editor 会漏（本次的病根）
    expect(CSS).toContain("[data-lake-univer-floating]");
    expect(CSS).toContain(".usheet-editor");
    expect(CSS).toContain(".lake-editor-mount");
    expect(CSS).toContain(".board-editor");
    // 第三方字段收成我们的口径：单条主色边 + 柔光环，且不再叠 outline
    expect(CSS).toMatch(/:is\(\.usheet-editor, \[data-lake-univer-floating\]\)[\s\S]*border-color: var\(--lake-accent\);/);
    expect(CSS).toMatch(/box-shadow: 0 0 0 2px var\(--lake-focus-halo\);/);
    expect(CSS).toMatch(/outline: none;/);
    // 入口：样式 unlayered 引入 + DEV 探针安装（漏接 → 元素在、样式空）
    expect(MAIN).toContain('import "./styles/vendor-focus.css"');
    expect(MAIN).toContain("installVendorFocusProbe()");
  });
});
