import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("./SplitPane.tsx", import.meta.url), "utf8");
const KIT = readFileSync(new URL("../../styles/kit.css", import.meta.url), "utf8");
const MISC = readFileSync(new URL("../../styles/app/misc.css", import.meta.url), "utf8");
const PANELS = readFileSync(new URL("../../styles/app/panels.css", import.meta.url), "utf8");
const SIDEBAR = readFileSync(new URL("../Sidebar.tsx", import.meta.url), "utf8");
const TRASH = readFileSync(new URL("../TrashPanel.tsx", import.meta.url), "utf8");
const HISTORY = readFileSync(new URL("../HistoryPanel.tsx", import.meta.url), "utf8");
const ASSETS = readFileSync(new URL("../AssetsBrowser.tsx", import.meta.url), "utf8");

/**
 * 左右分栏（可拖动）结构护栏（用户 261006：回收站 / 历史版本 / 资源 三处都要能左右拖）。
 * 判定只看"是不是同一套实现 + 关键行为在不在"，真实拖拽由真机 CDP 验收覆盖。
 */
describe("左右分栏（可拖动）", () => {
  it("三处左右结构共用同一个 SplitPane，不再各写一套", () => {
    const sites: Array<[string, string]> = [[TRASH, "trash"], [HISTORY, "history"], [ASSETS, "resources"]];
    for (const [site, key] of sites) {
      expect(site).toContain("<SplitPane");
      expect(site).toContain(`storageKey="${key}"`);
      expect(site).toContain("ariaLabel=");
      expect(site).toContain("minRight=");
    }
  });

  it("把手视觉/交互只有一处实现（kit 的 .ln-split-handle），侧栏把手也并进同一类", () => {
    expect(KIT).toContain(".ln-split-handle {");
    expect(KIT).toContain(".ln-split-handle::before {");   // 命中带
    expect(KIT).toContain(".ln-split-handle::after {");    // 药丸
    expect(SRC).toContain('className="ln-split-handle"');
    expect(SRC).toContain('role="separator"');
    expect(SIDEBAR).toContain('className="ln-split-handle sidebar-resize-handle desktop-only"');
    // 侧栏那份旧实现里不该再留光标/药丸（已并入 kit 唯一实现），只留它自己的定位
    expect(MISC).not.toContain("cursor: col-resize");
    expect(MISC).not.toContain(".sidebar-resize-handle::after");   // 药丸已搬走
    expect(MISC).toContain(".sidebar-resize-handle {");
  });

  it("宽度设备本地、默认走 CSS（没拖过不写内联变量）、键盘与双击复位齐全", () => {
    expect(SRC).toContain("lake-notes-v3.split.");
    expect(SRC).toContain("localStorage.removeItem");
    expect(SRC).toContain("onDoubleClick={() => commit(null)}");
    expect(SRC).toContain('"ArrowLeft"');
    expect(SRC).toContain('"ArrowRight"');
    expect(SRC).toContain("ResizeObserver");              // 容器变窄时夹回合法区间
    expect(PANELS).toContain("flex: 0 0 var(--split-left, 320px)");
    expect(PANELS).toContain(".history-split > .ln-split-handle { position: relative; flex: 0 0 0; width: 0; }");
  });

  it("破坏性按钮只有一种长相：.ft__error 自带透明底（漏写 --outline 也不再是实心块）", () => {
    expect(KIT).toMatch(/\.ft__error \{\n  color: var\(--lake-status-error\);\n  background: transparent;/);
  });
});
