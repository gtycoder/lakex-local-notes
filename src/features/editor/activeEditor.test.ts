/**
 * 「谁是活动标签」护栏（261005）。
 *
 * 背景：多标签 keep-alive 下 DOM 里有多个编辑器实例。历史上多处用**几何/display**
 * （rect.width/height > 0、`style.display === "none"`、`getComputedStyle().display`）反推
 * 「哪个是活动的」—— 那等于把「怎么藏」当契约。而隐藏方式**换过两次**（display:none →
 * 保留布局的 opacity+visibility，261005 为修内核表格切标签重排而定稿），每次都让一批
 * 这类判断静默失准（拿到隐藏实例的几何）。
 *
 * 现在唯一来源 = activeEditor.ts + 宿主上的 data-active="true"。这里锁住：
 * ① 唯一来源只用属性、不看几何；② 4 种编辑器宿主都打信号；
 * ③ 曾经白猜的消费者（AI 面板/编辑器顶边/滚动归零）不再做几何或 display 推断。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const HELPER = read("./activeEditor.ts");
const AI_DIALOG = read("../ai/AiAssistantDialog.tsx");
const TOP_VAR = read("../../hooks/useEditorTopVar.ts");
const DERIVED = read("../../hooks/desktopDerivedState.ts");
const EDITOR_TAB = read("./EditorTab.tsx");

describe("活动标签判定：唯一来源 data-active（261005）", () => {
  it("唯一来源只用显式属性，不看几何", () => {
    expect(HELPER).toContain('[data-active="true"]');
    expect(HELPER).not.toContain("getBoundingClientRect");
    expect(HELPER).not.toContain("clientWidth");
  });

  it("4 种编辑器宿主都打 data-active", () => {
    const hosts: Array<[string, string]> = [
      ["EditorTab", read("./EditorTab.tsx")],
      ["SheetEditor", read("../sheet/SheetEditor.tsx")],
      ["BitableEditor", read("../bitable/BitableEditor.tsx")],
      ["BoardEditor", read("../board/BoardEditor.tsx")],
    ];
    for (const [name, src] of hosts) {
      expect(src, name + " 必须打 data-active（焦点栏）").toMatch(/data-active=\{\(focused \?\? visible\) \? "true" : undefined\}/);
      expect(src, name + " 必须打 data-pane-visible（分屏可见）").toContain('data-pane-visible={visible ? "true" : undefined}');
    }
  });

  it("原「几何猜可见」的消费者不再全局搜（改用自身 container / 显式信号）", () => {
    // AI 面板：不再全局找「第一个宽度>0 的 .lake-editor-mount」
    expect(AI_DIALOG).not.toContain("visibleEditorMount");
    expect(AI_DIALOG).not.toMatch(/querySelectorAll[^\n]*lake-editor-mount/);
    expect(AI_DIALOG).toContain("activeEditorMount()");
    // 编辑器顶边：不再把 pane 下**所有** .ne-ui 当候选
    expect(TOP_VAR).toContain("activeEditorHost()");
    expect(TOP_VAR).not.toMatch(/pane\.querySelectorAll<HTMLElement>\("\.protyle-breadcrumb, \.ne-ui"\)/);
    // 「活动编辑器滚动归零」的兜底：不再用 getComputedStyle(host).display !== "none" 过滤
    //（隐藏标签现在保留布局，display 恒为 block ⇒ 会命中所有标签，把所有编辑器都滚到顶）
    expect(DERIVED).toContain("activeEditorHost()");
    expect(DERIVED).not.toMatch(/getComputedStyle\(host\)\.display/);
    // EditorTab 里不得再用 host.style.display 判「本标签是否在显示」（inline display 已移除，恒为空串）
    expect(EDITOR_TAB).not.toMatch(/style\.display === "none"/);
  });
});
