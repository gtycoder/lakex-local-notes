/**
 * 十字高亮（行列高亮）的跨端开关 —— 内核 @univerjs/sheets-crosshair-highlight 1.0.3。
 *
 * 我们默认开启（用户 261022 点单）；桌面另有「视图 → 十字高亮」ribbon 开关（内核自带的 menuSchema），
 * 移动端由 ⋯ 卡条目派发 toggle。命令是 operation（不写文档数据、不进正文）⇒ 纯本机视图。
 */
import type { FUniver } from "@univerjs/presets";

export const USHEET_CROSSHAIR_COMMANDS = {
  enable: "sheet.operation.enable-crosshair-highlight",
  disable: "sheet.operation.disable-crosshair-highlight",
  toggle: "sheet.operation.toggle-crosshair-highlight",
} as const;

/** 打开表格后默认开启。已开启时内核返回 false，属正常；任何异常都不阻塞表格打开。 */
export function enableUsheetCrosshair(api: FUniver): boolean {
  try {
    return Boolean(api.executeCommand(USHEET_CROSSHAIR_COMMANDS.enable));
  } catch {
    return false;
  }
}

/** 内核 1.0.3 的 crosshair 包没有 zh-CN 词条 ⇒ 菜单项无 title/tooltip（实测只有图标）。这里补两条。 */
export const CROSSHAIR_LOCALE_ZH = {
  "sheets-crosshair-highlight.button.tooltip": "十字高亮",
} as const;
