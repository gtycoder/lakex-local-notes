/**
 * 「＋」面板两个选择型插入的用户口径（261104 修订）：
 *  - 分栏：**贴着「分栏」条目弹气泡**（不是面板底部内联行；用户截图红框指出内联行位置不对）；
 *  - 高亮块：**不再弹类型选择**——块被选中后内核自带色板可改颜色/类型（用户截图），插入只给默认 tips。
 * 只做静态契约（行为在设备上验收）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const DOCK = strip(read("src/mobile/editor/EditorDock.tsx"));
const CSS = strip(read("src/mobile/editor/editor-dock.css"));

describe("＋ 面板：分栏气泡 / 高亮块直插（261104 用户口径）", () => {
  it("分栏 = 锚定气泡（fixed + 贴在条目上），不再是面板内联行", () => {
    expect(DOCK).toContain("openColumnsChooser");
    expect(DOCK).toContain("columnsAnchor");
    expect(DOCK).toContain('role="dialog"' );
    expect(DOCK).toContain('aria-label="分栏栏数"');
    expect(DOCK).toContain("COLUMN_CHOICES.map");
    expect(DOCK).not.toContain("setColumnsOpen");
    expect(CSS).toMatch(/\.med-chooser-pop\s*\{[^}]*position:\s*fixed/);
    expect(CSS).toMatch(/\.med-chooser-pop\s*\{[^}]*z-index:\s*6/);
    // dock 根是 pointer-events:none ⇒ 气泡必须自己打开命中，否则点按穿透到面板（261104 实测）。
    expect(CSS).toMatch(/\.med-chooser-pop\s*\{[^}]*pointer-events:\s*auto/);
    // 三个选项之间要有 0.5px 分隔（用户：一眼看出是 3 个块）。
    expect(CSS).toMatch(/\.med-chooser-pop \.med-f-btn \+ \.med-f-btn\s*\{[^}]*border-left:\s*\.5px solid/);
    // 点外部关闭用透明背板（dock 不许自挂 window pointerdown，见 dockPanelFocusGuard）。
    expect(DOCK).toContain("med-chooser-backdrop");
    expect(CSS).toMatch(/\.med-chooser-backdrop\s*\{[^}]*position:\s*fixed/);
  });

  it("高亮块直接插入（默认 tips），不再有类型选择弹层", () => {
    expect(DOCK).toContain('runPanel("alert", "tips")');
    expect(DOCK).not.toContain("ALERT_TYPES");
    expect(DOCK).not.toContain("toggleAlertChooser");
    expect(DOCK).not.toContain("setAlertOpen");
  });
});