/**
 * 页内文字块（v4 `page.texts`）的纯函数：插入落点、换行估算、命中、移动、删除（261104 二十三批）。
 *
 * **换行用同一份估算**（渲染层画、导出画、命中算高度都调这里）：主进程不能 canvas 量文字，
 * 若渲染层用精确测量、导出用估算，导出的 PDF 就会和屏幕不一致。宁可两边都"估算一致"。
 */
import type { InkPage, InkPageText } from "../../core/inkDoc.js";

/** 默认宽度 = 页宽 50%（居左留白，便于阅读）。 */
export const INK_TEXT_DEFAULT_WIDTH_RATIO = 0.5;
/** 默认字号（页面逻辑 px）。 */
export const INK_TEXT_DEFAULT_FONT_SIZE = 16;
/** 行高倍数（与渲染/导出共用）。 */
export const INK_TEXT_LINE_HEIGHT = 1.5;
/** 最小可点中的宽/高。 */
export const INK_TEXT_MIN_WIDTH = 60;
const MAX_TEXT_LINES = 400;

export interface InkTextPlacementInput {
  id: string;
  width: number;
  fontSize: number;
  color: string;
  align?: "left" | "center" | "right";
}

/** 插入位置：水平居中、垂直方向落在页面 15% 处（当标题用，不挡中间的图）。 */
export function placeInkPageText(page: Pick<InkPage, "width" | "height">, input: InkTextPlacementInput): InkPageText {
  const width = Math.max(INK_TEXT_MIN_WIDTH, Math.round(page.width * INK_TEXT_DEFAULT_WIDTH_RATIO * 100) / 100);
  return {
    id: input.id,
    x: Math.round(((page.width - width) / 2) * 100) / 100,
    y: Math.round(page.height * 0.15 * 100) / 100,
    width,
    text: "",
    fontSize: input.fontSize,
    color: input.color,
    ...(input.align ? { align: input.align } : {}),
  };
}

/** 单个字符的估算宽度：CJK/全角按 1em，其它按 0.55em。 */
export function estimateInkCharWidth(char: string, fontSize: number): number {
  const code = char.codePointAt(0) ?? 0;
  const wide = (code >= 0x2e80 && code <= 0x9fff) || (code >= 0xac00 && code <= 0xd7af) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xffef);
  return (wide ? 1 : 0.55) * fontSize;
}

/** 文本 → 行数组（保留显式换行；超宽按估算折行；空文本返回空数组）。 */
export function wrapInkTextLines(text: string, width: number, fontSize: number): string[] {
  if (!text) return [];
  const limit = Math.max(fontSize, width);
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") {
      lines.push("");
      if (lines.length >= MAX_TEXT_LINES) break;
      continue;
    }
    let current = "";
    let currentWidth = 0;
    for (const char of paragraph) {
      const charWidth = estimateInkCharWidth(char, fontSize);
      if (currentWidth + charWidth > limit && current !== "") {
        lines.push(current);
        current = char;
        currentWidth = charWidth;
        if (lines.length >= MAX_TEXT_LINES) return lines;
      } else {
        current += char;
        currentWidth += charWidth;
      }
    }
    lines.push(current);
    if (lines.length >= MAX_TEXT_LINES) break;
  }
  return lines;
}

/** 文字块高度（行数 × 行高，至少 1 行）。 */
export function inkTextHeight(text: Pick<InkPageText, "text" | "width" | "fontSize">): number {
  const lines = Math.max(1, wrapInkTextLines(text.text, text.width, text.fontSize).length);
  return lines * text.fontSize * INK_TEXT_LINE_HEIGHT;
}

/** 命中测试：返回最上层文字块 id（后加的在上）。 */
export function hitTestPageText(page: Pick<InkPage, "texts">, point: { x: number; y: number }): string | null {
  const texts = page.texts ?? [];
  for (let index = texts.length - 1; index >= 0; index -= 1) {
    const item = texts[index];
    const height = inkTextHeight(item);
    if (point.x >= item.x && point.x <= item.x + item.width && point.y >= item.y && point.y <= item.y + height) return item.id;
  }
  return null;
}

/** 移动（拖动落地）：至少留一段在页内。 */
export function movePageText(page: InkPage, id: string, dx: number, dy: number): InkPageText[] | null {
  const texts = page.texts ?? [];
  const target = texts.find((item) => item.id === id);
  if (!target) return null;
  const height = inkTextHeight(target);
  const x = Math.min(Math.max(target.x + dx, -(target.width - 40)), page.width - 40);
  const y = Math.min(Math.max(target.y + dy, -(height - 40)), page.height - 40);
  return texts.map((item) => (item.id === id ? { ...item, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 } : item));
}

/** 改文本内容（空串 = 由调用方决定是否删除）。 */
export function updatePageText(page: InkPage, id: string, text: string): InkPageText[] | null {
  const texts = page.texts ?? [];
  if (!texts.some((item) => item.id === id)) return null;
  return texts.map((item) => (item.id === id ? { ...item, text } : item));
}

export function removePageText(page: InkPage, id: string): InkPageText[] {
  return (page.texts ?? []).filter((item) => item.id !== id);
}
