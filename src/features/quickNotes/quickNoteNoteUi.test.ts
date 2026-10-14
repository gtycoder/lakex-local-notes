/**
 * 小记编辑器接线护栏（260919 起，261010 更新）。
 *
 * **定稿分工**：
 * - 编辑态 = **文档编辑器外观**（同一套 Lake 编辑器、同样的视觉与手感），只把**工具栏 items** 收成小记最小集；
 * - **「+」插入面板 = 内核全量**（261010：不再用官方钩子 `slash.filterOption` 收白名单 ——
 *   那个白名单正是"移动端没有日期/表情"的真因）；
 * - 卡片预览 = 快路径（零内核实例）+ **内核只读兜底**（见 quickNoteKernelFallback.test.ts）；
 * - **只影响小记**：`quickNoteUi` 只由 `QuickNoteEditor` 传，文档编辑器一个 option 都不加。
 *
 * vitest 跑在 node 环境、起不了内核，故与 cssLayers/blockMenuNative 同套路做**源码级**断言。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

/** 去注释后再断言（注释里会提到旧实现/钩子名，不算代码里还在用）。 */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const RUNTIME_SRC = read("../editor/lakeRuntime.ts");
const EDITOR_SRC = read("./QuickNoteEditor.tsx");

describe("小记编辑器：文档外观 + 受限格式（只影响小记）", () => {
  it("桌面展开层必须压过内核 fixed!important，限定于小记面板而非窗口红绿灯区域", () => {
    const css = stripComments(read("../../styles/app/quick-notes.css"));
    const fullscreen = css.match(/\.quick-notes-pane \.lake-editor-mount\.ne-ui-fullscreen\s*\{([^}]+)\}/)?.[1];
    expect(fullscreen).toMatch(/position:\s*absolute\s*!important;/);
    expect(fullscreen).toContain("inset: 0");
    expect(fullscreen).toContain("height: auto");
    expect(fullscreen).not.toMatch(/position:\s*fixed/);
    expect(css).toMatch(/\.quick-notes-pane\s*\{[^}]*position:\s*relative;/);
    expect(css).toContain(".quick-notes-pane .ne-ui-exit-fullscreen { position: absolute; top: 6px; right: 6px; }");
  });

  it("小卡片走内核 note 版式（含展开按钮）；列表视图直接文档样式；文档页不受影响", () => {
    // 只有 restrictedFormats 分支才用 note 挂载点；文档编辑器仍是 ne-doc-major-editor
    expect(RUNTIME_SRC).toMatch(/mount\.className = quickNoteUi === "card"/);
    expect(RUNTIME_SRC).toMatch(/lake-editor-mount ne-doc-note-editor lakex-note-editor/);
    expect(RUNTIME_SRC).toMatch(/lake-editor-mount ne-doc-major-editor/);
    // 261010：移动端不要「展开」⇒ fullscreen 只在桌面开（isDesktop()）
    expect(RUNTIME_SRC).toMatch(/quickNoteUi === "card"/);
    expect(RUNTIME_SRC).toMatch(/uiSwitch: \{ default: "note" \}, fullscreen: \{ enable: isDesktop\(\) \}/);
  });

  it("小记开关只由小记编辑器传：文档编辑器不传 quickNoteUi", () => {
    expect(EDITOR_SRC).toMatch(/quickNoteUi: ui/);
    // 开关控制的两处裁剪必须都在 quickNoteUi 分支里（否则会误伤文档编辑器）
    expect(RUNTIME_SRC).toMatch(/const quickNoteUi = mode === "editor" \? prefs\?\.quickNoteUi : undefined;/);
    expect(RUNTIME_SRC).toMatch(/note: \{ items: \[\.\.\.QUICK_NOTE_TOOLBAR_ITEMS\] as unknown as string\[\] \}/);
    // 261010：小记开关只裁剪工具栏 items，「+」面板不再有第二处裁剪（filterOption 钩子已撤）
    expect(stripComments(RUNTIME_SRC)).not.toMatch(/filterOption/);
  });

  it("工具栏 = 用户指定的 9 项（内核 agentConfig 整体替换 ⇒ 必须显式给 default）", () => {
    const decl = /QUICK_NOTE_TOOLBAR_ITEMS\s*=\s*\[([\s\S]*?)\]\s*as const;/.exec(RUNTIME_SRC);
    expect(decl, "QUICK_NOTE_TOOLBAR_ITEMS 未找到").toBeTruthy();
    const items = [...(decl?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    // 清单的权威断言在 quickNoteToolbar.test.ts；这里只保证「内置 id 该有的在、禁的不在」（避免两处各维护一份清单）。
    for (const must of ["image", "taskList", "unorderedList", "orderedList", "quote", "hr"]) {
      expect(items).toContain(must);
    }
    // 日期/表情/附件 = 自定义工具项类（不是字符串 id —— 字符串形态会被内核静默丢弃）
    for (const cls of ["QuickNoteDateToolbarItem", "QuickNoteEmojiToolbarItem", "QuickNoteAttachmentToolbarItem"]) {
      expect(RUNTIME_SRC).toContain(cls);
    }
    expect(items).not.toContain("file");
    expect(items).not.toContain("emoji");
    // 展开态必须给内核**完整**默认工具栏（不给 default ⇒ 展开后是空工具条，实测）；
    // 但要在默认项基础上收掉"能插入、预览还原不了"的两个入口（toc / materialLibrary）——
    // 工具条的「…」溢出菜单装的正是同一批 items，去掉即同时收掉溢出里的入口（用户 260920 要求）。
    expect(RUNTIME_SRC).toMatch(/default: \{ items: \[\.\.\.QUICK_NOTE_FULL_TOOLBAR_ITEMS\] \}/);
    expect(RUNTIME_SRC).toMatch(/DEFAULT_TOOLBAR_ITEMS\.filter\(\s*\(item\) => item !== "toc" && item !== "materialLibrary"/);
    for (const item of ["cardSelect", "undo", "formatPainter", "style", "fontsize", "bold", "strikethrough", "color", "bgColor", "alignment", "indent", "lineHeight", "taskList", "link", "quote", "hr", "search", "materialLibrary"]) {
      expect(RUNTIME_SRC).toContain(`"${item}"`);
    }
  });

  it("「+」面板不再过滤（261010 = 内核全量；卡片注册照旧保留）", () => {
    // 旧实现用官方钩子 filterOption 把小记面板收成白名单 —— 那正是"移动端没有日期/表情"的真因
    // （钩子内核仍在，只是我们不再接：面板全量 = 与桌面端一致，格式还原交给内核兜底渲染）。
    expect(stripComments(RUNTIME_SRC)).not.toMatch(/filterOption/);
    expect(stripComments(RUNTIME_SRC)).not.toMatch(/quickNoteInsertFilter/);
    // 卡片注册照旧全量（否则已有小记里的表格/自定义卡一编辑就被内核丢弃）
    expect(RUNTIME_SRC).toMatch(/prepareCustomCards\(mergedOptions\)/);
  });

  it("空小记也要装载一次正文（否则内核 document.ready 不触发、工具条与回传全失效）", () => {
    expect(EDITOR_SRC).toMatch(/initialBody\s*\|\|\s*emptyLakeBody\(ownerId\)/);
  });

  it("内核销毁后热键查表不再炸渲染（260920「保存反复闪、按钮失灵」的真凶）", () => {
    // 内核 hotkey 服务 destroy() 会 `delete this._named`，而工具条 tooltip 之后仍会
    // `renderer.getHotKeyByName(name)` ⇒ React 渲染期 TypeError，整棵工具条/面板崩掉并反复重试。
    // 补丁：createLakeDocument 里给每个实例的 getHotKeyByName 包一层，取不到就返回 null。
    expect(RUNTIME_SRC).toMatch(/hardenDestroyedHotKeyLookup\(editor\)/);
    expect(RUNTIME_SRC).toMatch(/function hardenDestroyedHotKeyLookup\(editor: unknown\): void/);
    expect(RUNTIME_SRC).toMatch(/renderer\.getHotKeyByName = function hardened/);
  });
});
