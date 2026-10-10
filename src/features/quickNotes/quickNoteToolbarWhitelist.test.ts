/**
 * 小记工具条白名单护栏（261010）。
 *
 * 两条规则，都来自用户定稿口径：
 *  1. **只放预览能渲染的东西**（260919：「不能预览展示的就不让插入」）——
 *     时间线卡片走 `quickNotePreviewParser` 的只读白名单，工具条加件必须在那个白名单内，
 *     否则插入后预览只能降级成 unsupported 占位。
 *  2. **「展开」按平台开关**（261010）：桌面保留内核 fullscreen（展开成完整工具栏的桌面编辑器）；
 *     移动端 `expand="none"` ⇒ 不传 `fullscreen`（内核那个 ⛶ 不渲染，也不会弹出桌面 lake 页）。
 *     依据：实测展开后是内核 27 项**桌面横向工具条**，在 412px 宽的手机上被裁，且我们的取消/保存消失。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const RUNTIME = read("../editor/lakeRuntime.ts");
const MOBILE_COMPOSER = read("../../mobile/home/QuickNoteComposer.tsx");
const DESKTOP_WORKSPACE = read("../../components/QuickNotesWorkspace.tsx");

/** 预览解析器能还原的条目（见 quickNotePreviewParser.ts 头注释的白名单）。 */
const PREVIEW_RENDERABLE = new Set([
  "|", "undo", "redo", // 分隔符 / 历史（不产出内容）
  "style", "fontsize", "bold", "italic", "strikethrough", "underline", "code", "link", // 标题/字号 + 行内标记 + 链接
  "color", "bgColor", "clearFormat", // 字色/背景色/清除格式（PreviewRun 支持 color/background）
  "unorderedList", "orderedList", "taskList", "quote", "hr",
  "image", // 图片卡（附件同族，预览有 media 节点）
]);

/** 取 QUICK_NOTE_TOOLBAR_ITEMS 的字面量条目。 */
function toolbarItems(): string[] {
  const m = /QUICK_NOTE_TOOLBAR_ITEMS = \[([\s\S]*?)\] as const;/.exec(RUNTIME);
  if (!m) throw new Error("找不到 QUICK_NOTE_TOOLBAR_ITEMS");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("小记工具条与展开（261010 口径）", () => {
  it("工具条只放预览能渲染的条目（不能预览展示的就不让插入）", () => {
    const items = toolbarItems();
    expect(items.length).toBeGreaterThanOrEqual(8);
    const offenders = items.filter((x) => !PREVIEW_RENDERABLE.has(x));
    expect(offenders, "这些条目预览渲染不了（插了只能降级成占位）：" + offenders.join(", ")).toEqual([]);
  });

  it("条目对齐我们的浮动工具栏 + 用户指定的分割线（261010 用户口径）", () => {
    const items = toolbarItems();
    for (const added of ["clearFormat", "style", "fontsize", "bold", "italic", "strikethrough", "underline", "color", "bgColor", "hr", "image"]) {
      expect(items, "缺少新增条目 " + added).toContain(added);
    }
  });

  it("「展开」由 prefs 控制，移动端不传内核 fullscreen", () => {
    expect(RUNTIME).toMatch(/quickNoteExpand\?: "kernel" \| "none"/);
    expect(RUNTIME).toMatch(/prefs\?\.quickNoteExpand === "none" \? \{\} : \{ fullscreen: \{ enable: true \} \}/);
    expect(MOBILE_COMPOSER).toMatch(/expand="none"/);
  });

  it("桌面仍保留内核展开（两端共用同一份条目清单，只差一个平台开关）", () => {
    // 桌面不传 expand ⇒ 用默认 "kernel"
    expect(DESKTOP_WORKSPACE).not.toMatch(/expand="none"/);
    expect(DESKTOP_WORKSPACE).toMatch(/<QuickNoteEditor/);
  });
});
