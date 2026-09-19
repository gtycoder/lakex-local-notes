/**
 * 小记编辑器接线护栏（260919，几轮迭代后的最终形态）。
 *
 * **定稿分工**（用户 260919）：
 * - 编辑态 = **文档编辑器外观**（同一套 Lake 编辑器、同样的视觉与手感），只把「预览显示不了的格式」
 *   从**工具栏 items** 和**「+」插入面板**（内核官方钩子 `slash.filterOption`）里收掉；
 * - 卡片预览 = 自研只读渲染（零内核实例，见 `quickNotePreviewParser.ts`）；
 * - **只影响小记**：`restrictedFormats` 只由 `QuickNoteEditor` 传，文档编辑器一个 option 都不加。
 *
 * vitest 跑在 node 环境、起不了内核，故与 cssLayers/blockMenuNative 同套路做**源码级**断言。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const RUNTIME_SRC = read("../editor/lakeRuntime.ts");
const EDITOR_SRC = read("./QuickNoteEditor.tsx");

describe("小记编辑器：文档外观 + 受限格式（只影响小记）", () => {
  it("小卡片走内核 note 版式（含展开按钮）；列表视图直接文档样式；文档页不受影响", () => {
    // 只有 restrictedFormats 分支才用 note 挂载点；文档编辑器仍是 ne-doc-major-editor
    expect(RUNTIME_SRC).toMatch(/mount\.className = quickNoteUi === "card"/);
    expect(RUNTIME_SRC).toMatch(/lake-editor-mount ne-doc-note-editor lakex-note-editor/);
    expect(RUNTIME_SRC).toMatch(/lake-editor-mount ne-doc-major-editor/);
    expect(RUNTIME_SRC).toMatch(/quickNoteUi === "card" \? \{ uiSwitch: \{ default: "note" \}, fullscreen: \{ enable: true \} \} : \{\}/);
  });

  it("小记开关只由小记编辑器传：文档编辑器不传 quickNoteUi", () => {
    expect(EDITOR_SRC).toMatch(/quickNoteUi: ui/);
    // 开关控制的两处裁剪必须都在 quickNoteUi 分支里（否则会误伤文档编辑器）
    expect(RUNTIME_SRC).toMatch(/const quickNoteUi = mode === "editor" \? prefs\?\.quickNoteUi : undefined;/);
    expect(RUNTIME_SRC).toMatch(/note: \{ items: \[\.\.\.QUICK_NOTE_TOOLBAR_ITEMS\] \}/);
    expect(RUNTIME_SRC).toMatch(/quickNoteUi \? \{ filterOption: filterQuickNoteInsert \} : \{\}/);
  });

  it("工具栏 = 预览支持的白名单（内核 agentConfig 整体替换 ⇒ 必须显式给 default）", () => {
    const decl = /QUICK_NOTE_TOOLBAR_ITEMS\s*=\s*\[([\s\S]*?)\]\s*as const;/.exec(RUNTIME_SRC);
    expect(decl, "QUICK_NOTE_TOOLBAR_ITEMS 未找到").toBeTruthy();
    const items = [...(decl?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    // 小卡片 = 用户指定的最小集（图片/待办/有序/无序/分割线）
    expect(items).toEqual(["image", "taskList", "orderedList", "unorderedList", "hr"]);
    // 展开态必须给内核**完整**默认工具栏（不给 default ⇒ 展开后是空工具条，实测）；
    // 但要在默认项基础上收掉"能插入、预览还原不了"的两个入口（toc / materialLibrary）——
    // 工具条的「…」溢出菜单装的正是同一批 items，去掉即同时收掉溢出里的入口（用户 260920 要求）。
    expect(RUNTIME_SRC).toMatch(/default: \{ items: \[\.\.\.QUICK_NOTE_FULL_TOOLBAR_ITEMS\] \}/);
    expect(RUNTIME_SRC).toMatch(/DEFAULT_TOOLBAR_ITEMS\.filter\(\s*\(item\) => item !== "toc" && item !== "materialLibrary"/);
    for (const item of ["cardSelect", "undo", "formatPainter", "style", "fontsize", "bold", "strikethrough", "color", "bgColor", "alignment", "indent", "lineHeight", "taskList", "link", "quote", "hr", "search", "materialLibrary"]) {
      expect(RUNTIME_SRC).toContain(`"${item}"`);
    }
  });

  it("「+」面板用内核官方钩子过滤（白名单外的条目隐藏，卡片注册保留）", () => {
    expect(RUNTIME_SRC).toMatch(/import \{ filterQuickNoteInsert \} from "\.\.\/quickNotes\/quickNoteInsertFilter"/);
    expect(RUNTIME_SRC).toMatch(/filterOption: filterQuickNoteInsert/);
    // 只过滤面板条目，不动 customCard 注册（否则已有小记里的表格/自定义卡一编辑就被内核丢弃）
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
