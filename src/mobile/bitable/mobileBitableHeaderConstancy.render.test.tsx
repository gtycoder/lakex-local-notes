// @vitest-environment jsdom
/**
 * 261119（task-3 切换跳动收口 + 跳变审计 F-D）：表格 ↔ 表单切换时**顶部恒定**。
 *
 * 钉的行为：
 * - 头部 DOM/类/结构不随视图变化（两视图同一容器、同一几何来源；只换内容部件）；
 * - 壳层与头部几何不带视图态选择器（旧 .mbt-is-form 另设容器/头部 padding 是跳动根因，已删）；
 * - 表格内容有正常内边距（.mbt-grid-wrap 吃 --mb-page-pad ⇒ 序号列不贴左缘、统计行完整可见）；
 * - 多选态与两行头部同槽换装（.mbt-headslot，进入/退出多选网格不位移）。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MobileBitableViewer } from "./MobileBitableViewer";

const readCss = () => readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "mobileBitable.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ts = "2026-01-01T00:00:00.000Z";
const body = JSON.stringify({
  kind: "bitable",
  version: 1,
  activeTableId: "t1",
  tables: [{
    id: "t1",
    name: "数据表 1",
    activeViewId: "v-grid",
    views: [
      { id: "v-grid", name: "表格", type: "grid", rowHeight: "low" },
      { id: "v-form", name: "表单", type: "form" },
    ],
    fields: [{ id: "f-text", name: "文本", type: "text" }],
    records: [{ id: "r1", createdAt: ts, updatedAt: ts, values: { "f-text": "记录一" } }],
  }],
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = () => act(() => {
  root.render(createElement(MobileBitableViewer, { noteId: "n-const", content: body }));
});

/** 头部结构签名：标签 + 类名序列（视图切换只允许换内容/选中态，不允许换容器/类/结构；is-active 归一）。 */
const headerSignature = () => {
  const sig = (className: string) => String(className).replace(/\bis-active\b/g, "").replace(/\s+/g, " ").trim();
  const header = host.querySelector(".mbt-header")!;
  return [sig(header.className), ...[...header.querySelectorAll("*")].map((el) => el.tagName + "." + sig(String(el.className || "")))].join("|");
};
const clickTab = (label: string) => {
  const tab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === label);
  expect(tab).toBeTruthy();
  act(() => tab!.click());
};

describe("多维表 表格 ↔ 表单 切换：顶部几何恒定（261119）", () => {
  it("切换视图：头部 DOM/类/结构不变、根容器类不变；表格区/表单区只是内容互换", () => {
    render();
    // 默认落表单（有表单视图时）
    expect(host.querySelector(".mbt-form")).toBeTruthy();
    const rootClasses = host.querySelector(".mobile-bitable")!.className;
    const formHeader = headerSignature();
    // 切到表格
    clickTab("表格");
    expect(host.querySelector(".mbt-grid")).toBeTruthy();
    expect(host.querySelector(".mobile-bitable")!.className).toBe(rootClasses);
    expect(host.querySelector(".mobile-bitable")!.className).not.toContain("mbt-is-form");
    expect(headerSignature()).toBe(formHeader);
    // 切回表单：同样恒定
    clickTab("表单");
    expect(host.querySelector(".mbt-form")).toBeTruthy();
    expect(headerSignature()).toBe(formHeader);
  });

  it("CSS 同源几何：头部/网格吃统一 --mb-page-pad，壳层与头部没有视图态几何选择器", () => {
    const css = readCss();
    // 头部左右内距唯一来源（两视图同一几何）；不存在任何 mbt-is-form 覆盖（视图态几何已删）
    expect(css).toMatch(/\.mbt-header\s*\{[^}]*padding:\s*0 var\(--mb-page-pad\)/);
    expect(css).not.toContain("mbt-is-form");
    // 壳层只留顶部留白 + 左右安全区（页面内距由内容块自管）
    expect(css).toMatch(/\.mobile-bitable\s*\{[^}]*padding:\s*var\(--lake-space-md\) var\(--mobile-right-safe-area\) 0 var\(--mobile-left-safe-area\)/);
    // 表格视图正常内边距：序号列不贴左缘、网格末尾「N 条记录」统计行完整可见
    expect(css).toMatch(/\.mbt-grid-wrap\s*\{[^}]*margin:\s*0 var\(--mb-page-pad\)/);
    expect(css).toContain(".mbt-grid-foot");
    // 表单内容同源：表单字段/提交条也吃同一个 --mb-page-pad
    expect(css).toMatch(/\.mbt-form-fields\s*\{[^}]*padding:[^;]*var\(--mb-page-pad\)/);
  });

  it("多选态同槽换装（F-D）：.mbt-headslot 常在、头部 visibility 换装不换高", () => {
    const css = readCss();
    // 同槽规则：头部留在流里定高、多选栏绝对定位盖上（两元素不再互换 ⇒ 网格不位移）
    expect(css).toMatch(/\.mbt-headslot\s*\{[^}]*position:\s*relative/);
    expect(css).toMatch(/\.mbt-headslot\.is-selecting \.mbt-header\s*\{[^}]*visibility:\s*hidden/);
    expect(css).toMatch(/\.mbt-headslot__sel\s*\{[^}]*position:\s*absolute/);
  });
});
