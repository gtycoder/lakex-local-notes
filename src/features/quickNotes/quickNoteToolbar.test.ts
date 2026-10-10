/**
 * 小记卡片工具条护栏（261010）。
 *
 * 两条硬事实 + 一条规则，都在这里钉住：
 *
 * **事实 1（261010 设备枚举实测）**：内核**静默丢弃未知工具项 id** —— 把 `file`/`attachment`/`dateCard`/`date`/`emoji`
 * 塞进 `agentConfig.note.items` 后，工具条上**一个都不出现也不报错**（实测：11 个候选只渲染出 6 个）。
 * ⇒ 附件/日期/表情**没有内置工具项**：附件与日期走官方入口 `cardSelect`（插入面板；官方 04 注释 `toolbarItems.cardSelect // 插入面板`），
 * 表情在官方 05 里给的就是**自定义工具项**范例（`StatusDropdownButton` 那节原文「自定义一个表情插入的 toolbar」）。
 * 把这些无效 id 再加回来 = 又一次静默消失，所以这里显式禁止。
 *
 * **事实 2**：`cardSelect` 是**面板入口**、不产出内容 —— 预览白名单规则对它是例外。
 *
 * **规则（260919 用户口径）**：除 `cardSelect`/分隔符外，工具条条目必须落在预览解析器能还原的白名单内
 * （"不能预览展示的就不让插入"）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const RUNTIME = read("../editor/lakeRuntime.ts");
const COMPOSER = read("../../mobile/home/QuickNoteComposer.tsx");
/** 去注释后再断言（注释里可能提到旧清单，不算「页面写死清单」）。 */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\*.*$/gm, "").replace(/^\s*\/\/.*$/gm, "");

/** 内核**实测有效**的小记工具条条目（枚举得到；candidate 里其余一律被静默丢弃）。 */
const KERNEL_VALID = new Set(["cardSelect", "image", "taskList", "unorderedList", "orderedList", "quote", "hr"]);
/** 实测**无效**（会被静默丢弃）——显式禁止再加回来。 */
const KERNEL_INVALID = new Set(["file", "attachment", "dateCard", "date", "emoji"]);
/** 预览解析器能还原的条目（`PreviewRun`/媒体卡白名单）。 */
const PREVIEW_RENDERABLE = new Set(["image", "video", "audio", "file", "taskList", "unorderedList", "orderedList", "quote", "hr", "style", "bold", "italic", "strikethrough", "underline", "color", "bgColor", "clearFormat", "fontsize"]);

function toolbarItems(): string[] {
  const m = /QUICK_NOTE_TOOLBAR_ITEMS = \[([\s\S]*?)\] as const;/.exec(RUNTIME);
  if (!m) throw new Error("找不到 QUICK_NOTE_TOOLBAR_ITEMS");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("小记卡片工具条（261010 实测口径）", () => {
  it("只放内核有效的条目（未知 id 会被静默丢弃）", () => {
    const items = toolbarItems();
    const bad = items.filter((x) => !KERNEL_VALID.has(x));
    expect(bad).toEqual([]);
  });

  it("不再把附件/日期/表情当工具项（它们没有内置 id，走 cardSelect 面板）", () => {
    const items = toolbarItems();
    const regressed = items.filter((x) => KERNEL_INVALID.has(x));
    expect(regressed).toEqual([]);
    // 附件/日期/表情的官方入口 = 插入面板（cardSelect）
    expect(items).toContain("cardSelect");
  });

  it("除 cardSelect 外，条目必须在预览白名单内（不能预览展示的不让插入）", () => {
    const offenders = toolbarItems().filter((x) => x !== "cardSelect" && !PREVIEW_RENDERABLE.has(x));
    expect(offenders).toEqual([]);
  });

  it("footer 不再写死工具条清单（条目一变就是假话）", () => {
    expect(stripComments(COMPOSER)).not.toContain("工具条：图片");
  });
});
