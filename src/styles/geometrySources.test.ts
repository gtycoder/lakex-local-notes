import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// W3（260923）：把 PANEL-CONTRACT §1 的「垂直几何 = 令牌单一来源」变成可执行约束。
// 动机：peek 顶 80 / 浮层顶 112 / 阅读态大纲 74 曾从 P5 一直写死到 260923；macOS 红绿灯 y=13 同理。
// 本测试是"防漂移"的：一旦有人把几何写回字面值，或让令牌出现第二个定义点，立刻红。
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");

const TOKENS = ["--topbar-height", "--breadcrumb-height", "--editor-toolbar-height", "--tab-item-height"];
const SCANNED = [
  "styles/app/base.css", "styles/chrome.css", "styles/app/shell.css", "styles/app/editor.css",
  "styles/app/tabs.css", "features/outline/outline.css", "styles/compat.css", "styles/overlay.css",
  "styles/kit.css", "styles/feature.css", "styles/themes/base.css",
];

describe("垂直几何：令牌单一来源（PANEL-CONTRACT §1）", () => {
  it("4 个令牌各只在 styles/app/base.css 定义一次", () => {
    const defs = new Map<string, string[]>();
    for (const f of SCANNED) {
      for (const m of read(f).matchAll(/--(topbar-height|breadcrumb-height|editor-toolbar-height|tab-item-height)\s*:/g)) {
        const name = "--" + m[1];
        if (!defs.has(name)) defs.set(name, []);
        defs.get(name)!.push(f);
      }
    }
    for (const t of TOKENS) expect(defs.get(t), t + " 的定义点").toEqual(["styles/app/base.css"]);
  });

  it("派生消费者一律引用令牌（不再写死几何）", () => {
    expect(read("styles/chrome.css")).toContain("--lake-dir-peek-top: calc(var(--topbar-height) + 4px + var(--breadcrumb-height))");
    expect(read("styles/app/shell.css")).toContain("--lake-floating-panel-top: calc(var(--topbar-height) + 4px + var(--breadcrumb-height) + var(--editor-toolbar-height))");
    expect(read("styles/chrome.css")).toMatch(/\.protyle-breadcrumb\s*\{[^}]*height:\s*var\(--breadcrumb-height\)/);
    expect(read("styles/app/editor.css")).toMatch(/\.ne-ui-toolbar\s*\{\s*height:\s*var\(--editor-toolbar-height\)/);
    expect(read("styles/app/tabs.css")).toMatch(/height:\s*var\(--tab-item-height\)/);
    // 标签条垂直内距 = (顶栏 − 标签)/2，再 ±2px 把内容下移到「顶栏+4px 拼接缝」可见头区的中心
    expect(read("styles/app/tabs.css")).toMatch(/padding:\s*calc\(\(var\(--topbar-height\)\s*-\s*var\(--tab-item-height\)\)\s*\/\s*2\s*\+\s*2px\)\s*10px\s*calc\(\(var\(--topbar-height\)\s*-\s*var\(--tab-item-height\)\)\s*\/\s*2\s*-\s*2px\)/);
    // 阅读态大纲顶 = 顶栏 + 4 拼接缝 + 面包屑
    expect(read("styles/app/editor.css")).toMatch(/\.ne-viewer-toc-sidebar\s*\{[^}]*top:\s*calc\(var\(--topbar-height\)\s*\+\s*4px\s*\+\s*var\(--breadcrumb-height\)\)/);
  });

  it("过期字面值不得回归（112px 曾是大纲回退值）", () => {
    expect(read("features/outline/outline.css")).not.toContain("112px");
  });
});
