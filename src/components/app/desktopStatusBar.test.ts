import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("./DesktopStatusBar.tsx", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../../styles/document-status.css", import.meta.url), "utf8");

/**
 * 260930 用户：状态栏「已锁定」做成可点解锁（方案 B：点开小浮层再确认）。
 * 硬约束：**只有锁胶囊可点**；「表格」「同步状态」保持纯展示（可选中文字、无动作）。
 */
describe("状态栏锁定标识", () => {
  it("锁标识是 button + 解锁浮层，且浮层走 Overlay 原语 + usePopoverPosition", () => {
    expect(SRC).toMatch(/<button[\s\S]{0,200}className="document-statusbar-lock"/);
    expect(SRC).toContain("onUnlock");
    expect(SRC).toMatch(/<Popover open onDismiss=\{\(\) => setUnlockOpen\(false\)\}/);
    expect(SRC).toContain("usePopoverPosition");
    expect(SRC).toContain("本文档已锁定（只读）");
  });

  it("「表格」「同步状态」区域不绑任何点击（保持不可点）", () => {
    const start = SRC.indexOf('className="document-statusbar-fixed"');
    const end = SRC.indexOf("</footer>", start);
    const fixed = SRC.slice(start, end);
    expect(fixed).not.toContain("<button");
    expect(fixed).not.toContain("onClick");
  });

  it("CSS：只有 button.document-statusbar-lock 开 pointer-events；stats/state 未变", () => {
    expect(CSS).toMatch(/button\.document-statusbar-lock\s*\{[^}]*pointer-events: auto/);
    // 容器仍穿透，且没有给 stats/state 加动作
    expect(CSS).not.toMatch(/\.document-statusbar-(stats|state)[^{]*\{[^}]*cursor: pointer/);
  });
});
