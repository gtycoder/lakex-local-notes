/**
 * 编辑面只保留少量必要结构护栏；关闭时序、焦点守卫与隐藏实例隔离由
 * useEditSurface.test.ts 的 jsdom 行为测试验证。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const DOCK = read("src/mobile/editor/EditorDock.tsx");
const COMPOSER = read("src/mobile/home/QuickNoteComposer.tsx");
const USHEET = read("src/mobile/usheet/MobileUsheetViewer.tsx");

const HOOK_CALL = /\buse(?:State|Ref|Effect|LayoutEffect|Callback|Memo|Context)\s*\(/g;

describe("编辑面：必要结构护栏", () => {
  it("表格锚定卡片不再复制底部面板/输入法状态机", () => {
    for (const token of ["closingHold", "renderedPanel", "panelHeight", "inSetback"]) {
      expect(USHEET, `MobileUsheetViewer 不应再持有 ${token}`).not.toContain(token);
    }
  });

  it("编辑面 owner 只有 useEditSurface：dock 不再自己挂全局焦点监听", () => {
    expect(DOCK).toContain("useEditSurface(");
    expect(DOCK).not.toContain('addEventListener("focusin"');
    expect(DOCK).not.toContain('addEventListener("pointerdown"');
  });

  it("外壳高度只有一处实现：dock 不写 --mb-app-h", () => {
    expect(DOCK).not.toContain('setProperty("--mb-app-h"');   // 注释里提到它可以，写它不行
    expect(DOCK).not.toContain("setPanelMode");
    expect(DOCK).not.toContain("useState<PanelMode>");
    expect(DOCK).not.toContain("setPanelHeight");
  });

  it("hook 必须在早退之前（文档从阅读态切编辑态会崩）", () => {
    // ⚠️ 早退位置必须用"独占一行"的正则来找：源码注释里也提到过这行字，indexOf 会命中注释 ⇒ 假红。
    const dockAt = /\n\s*if \(!editing\) return null;/.exec(DOCK)?.index ?? -1;
    for (const [name, src, at] of [
      ["EditorDock", DOCK, dockAt],
      ["QuickNoteComposer", COMPOSER, COMPOSER.indexOf("if (!draftReady) return")],
    ] as const) {
      expect(at, name + " 找不到早退语句").toBeGreaterThan(0);
      expect([...src.slice(at).matchAll(HOOK_CALL)], name + " 早退之后仍有 hook").toEqual([]);
    }
  });
});
