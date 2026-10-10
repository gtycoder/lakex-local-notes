/**
 * 小记卡片工具条护栏（261010 定稿：用户指定的 9 项）。
 *
 * **事实 1（261010 设备枚举实测）**：内核**静默丢弃未知工具项 id** —— `file` / `attachment` / `dateCard` /
 * `date` / `emoji` 塞进 `agentConfig.note.items` 后**一个都不出现也不报错**（实测 11 个候选只渲染 6 个）。
 * ⇒ 日期/表情/附件**没有内置 id**，必须走内核官方的**自定义工具项**通道（items 里放构造函数）。
 *
 * **事实 2（读码）**：内核 `_createToolbarUI` 对函数型 item 做 `new Cls(editor, id)` + `init()`，
 * `createWidget` 按 `Cls.Type` 选控件；`Button` 控件实际调用 descriptor 的
 * `getInitUIState/getUIState/onEvent/isReady/on('statechange')/name/disabled`。
 * 细节与行号见 `quickNoteToolbarWidgets.ts` 头注释。
 *
 * **规则**：紧凑工具条 = 用户指定的 9 项（日期·表情·图片·附件·待办·无序·有序·引用·分隔线）；
 * 字符串条目必须是内核有效 id，无效 id 一个都不许回来（回来 = 又静默消失）。
 * 预览不再有卡片白名单（还原不了的块交给内核只读视图），所以工具条只需满足"内核认得"。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  QuickNoteAttachmentToolbarItem,
  QuickNoteDateToolbarItem,
  QuickNoteEmojiToolbarItem,
  type QuickNoteToolbarEditor,
} from "./quickNoteToolbarWidgets";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const RUNTIME = read("../editor/lakeRuntime.ts");
const COMPOSER = read("../../mobile/home/QuickNoteComposer.tsx");
/** 去注释后再断言（注释里可能提到旧清单，不算「页面写死清单」）。 */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\*.*$/gm, "").replace(/^\s*\/\/.*$/gm, "");

/** 内核**实测有效**的内置工具项 id。 */
const KERNEL_VALID = new Set(["cardSelect", "image", "taskList", "unorderedList", "orderedList", "quote", "hr"]);
/** 实测**无效**的内置 id（放进去会被静默丢弃）⇒ 这三个能力只能走自定义工具项类。 */
const KERNEL_INVALID = new Set(["file", "attachment", "dateCard", "date", "emoji"]);

/** 把源码里的 items 数组拆成条目：`"image"` = 内置 id；`QuickNoteXxx` = 自定义工具项类。 */
function toolbarEntries(): string[] {
  const m = /QUICK_NOTE_TOOLBAR_ITEMS = \[([\s\S]*?)\] as const;/.exec(RUNTIME);
  if (!m) throw new Error("找不到 QUICK_NOTE_TOOLBAR_ITEMS");
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}

interface FakeEditor extends QuickNoteToolbarEditor { calls: unknown[][] }
function fakeEditor(): FakeEditor {
  const calls: unknown[][] = [];
  return { calls, execCommand: (...args: unknown[]) => { calls.push(args); } };
}

describe("小记卡片工具条（261010：用户指定 9 项）", () => {
  it("顺序 = 日期 · 表情 · 图片 · 附件 · 待办 · 无序 · 有序 · 引用 · 分隔线", () => {
    expect(toolbarEntries()).toEqual([
      "QuickNoteDateToolbarItem",
      "QuickNoteEmojiToolbarItem",
      String.raw`"image"`,
      "QuickNoteAttachmentToolbarItem",
      String.raw`"taskList"`,
      String.raw`"unorderedList"`,
      String.raw`"orderedList"`,
      String.raw`"quote"`,
      String.raw`"hr"`,
    ]);
  });

  it("字符串条目必须是内核有效 id；被静默丢弃过的无效 id 一个都不许回来", () => {
    const ids = toolbarEntries().filter((e) => e.startsWith(String.raw`"`)).map((e) => e.replace(/"/g, ""));
    expect(ids.filter((x) => !KERNEL_VALID.has(x))).toEqual([]);
    expect(ids.filter((x) => KERNEL_INVALID.has(x))).toEqual([]);
    // 日期/表情/附件在这里必须是**自定义工具项类**（字符串形态已被实测证伪）
    expect(toolbarEntries()).toEqual(expect.arrayContaining(["QuickNoteDateToolbarItem", "QuickNoteEmojiToolbarItem", "QuickNoteAttachmentToolbarItem"]));
  });

  it("自定义工具项满足内核 Button 控件契约（Type / 图标 / 状态 / tooltip 形状）", () => {
    for (const Cls of [QuickNoteDateToolbarItem, QuickNoteEmojiToolbarItem, QuickNoteAttachmentToolbarItem]) {
      expect((Cls as unknown as { Type: string }).Type).toBe("Button");
      const item = new Cls(fakeEditor(), "quicknote-x");
      const init = item.getInitUIState();
      expect(typeof init.icon).toBe("string");
      // tooltip 形状 = 字符串数组（内核 ToolbarUIDescriptor.getTooltip 的返回形状）
      expect(Array.isArray(init.tooltip)).toBe(true);
      expect(item.isReady()).toBe(false);
      item.refresh();
      expect(item.isReady()).toBe(true);
      expect(item.getUIState().disabled).toBe(false);
    }
    expect(QuickNoteDateToolbarItem.QuickNoteIcon).toBe("editor-main-date");
    expect(QuickNoteEmojiToolbarItem.QuickNoteIcon).toBe("editor-main-expression");
    expect(QuickNoteAttachmentToolbarItem.QuickNoteIcon).toBe("editor-main-attachment");
  });

  it("日期按钮：插入 dateCard（与内核插入面板同一条命令），其它事件无副作用", () => {
    const editor = fakeEditor();
    const item = new QuickNoteDateToolbarItem(editor, "quicknote-date");
    item.onEvent("click");
    expect(editor.calls).toEqual([["insertCard", "dateCard", { date: expect.any(Number) }, false]]);
    item.onEvent("hoverIn");
    expect(editor.calls).toHaveLength(1);
  });

  it("表情按钮：选中后按**文本**插入（内核表情卡同源），绝不插那张只会画占位图标的空卡", () => {
    // 机制护栏（源码级）：emoji 走 insertText；`unicodeEmoji` 卡的内核 UI 写死只画「插入表情」图标、
    // 从不渲染 value（bundle 200615-200625）⇒ 插卡 = 一个点不开的死框。
    const src = read("quickNoteToolbarWidgets.ts");
    expect(src).toMatch(/execCommand\("insertAtSelection", "text\/lake", "<span>" \+ emoji \+ "<\/span>"\)/);
    expect(src).not.toMatch(/insertCard", "unicodeEmoji"/);
    // 原生 execCommand('insertText') 在本内核模型下不生效（设备实测）⇒ 不许回退到它
    expect(src).not.toMatch(/document\.execCommand\("insertText"/);
    // 接线：选择器选中 → 走到 insertEmoji
    class TestEmoji extends QuickNoteEmojiToolbarItem {
      picked: string | null = null;
      protected override openPicker(_anchor: HTMLElement | null, onPick: (emoji: string) => void): void { onPick("😀"); }
      protected override insertEmoji(emoji: string): void { this.picked = emoji; }
    }
    const item = new TestEmoji(fakeEditor(), "quicknote-emoji");
    item.onEvent("click");
    expect(item.picked).toBe("😀");
    item.onEvent("hoverIn");
    expect(item.picked).toBe("😀");
  });

  it("附件按钮：选到文件才 insertFiles(category=file)；取消不插", async () => {
    class TestAttachment extends QuickNoteAttachmentToolbarItem {
      constructor(editor: QuickNoteToolbarEditor, name: string, private readonly files: File[]) { super(editor, name); }
      protected override pickFiles(): Promise<File[]> { return Promise.resolve(this.files); }
    }
    const editor = fakeEditor();
    const pdf = new File([new Uint8Array([1])], "报告.pdf", { type: "application/pdf" });
    new TestAttachment(editor, "quicknote-attachment", [pdf]).onEvent("click");
    await new Promise((r) => setTimeout(r, 0));
    expect(editor.calls).toEqual([["insertFiles", [pdf], { from: "ui", category: "file" }]]);

    const editor2 = fakeEditor();
    new TestAttachment(editor2, "quicknote-attachment", []).onEvent("click");
    await new Promise((r) => setTimeout(r, 0));
    expect(editor2.calls).toEqual([]);
  });

  it("插入面板入口没有丢：它在展开态的完整工具条里（紧凑条按用户指定不含 cardSelect）", () => {
    expect(RUNTIME).toMatch(/const DEFAULT_TOOLBAR_ITEMS = \[\s*\n\s*"cardSelect"/);
    expect(toolbarEntries()).not.toContain(String.raw`"cardSelect"`);
  });

  it("预览不再靠白名单：还原不了的块整条交给内核只读视图", () => {
    const preview = read("QuickNotePreview.tsx");
    expect(preview).toMatch(/hasUnsupportedNodes\(nodes\)/);
    expect(preview).toMatch(/<QuickNoteKernelPreview body=\{body\} noteId=\{noteId\} \/>/);
  });

  it("footer 不再写死工具条清单（条目一变就是假话）", () => {
    expect(stripComments(COMPOSER)).not.toContain("工具条：图片");
  });
});
