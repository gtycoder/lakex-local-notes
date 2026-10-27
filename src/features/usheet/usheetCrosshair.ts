/**
 * 十字高亮（行列高亮）的跨端开关 —— 内核 @univerjs/sheets-crosshair-highlight 1.0.3。
 *
 * **默认关闭**（用户 261022 晚改口径：「默认关，且我需要开关」；此前 261022 白天曾按点单默认开启）。
 * 内核侧初始值就是关（`_enabled$ = new BehaviorSubject(false)`）⇒ 打开表格时**不做任何开启动作**，
 * 需要时由入口显式调用 setUsheetCrosshair(api, true)。
 *
 * 命令是 operation（不写文档数据、不进正文）⇒ 纯本机视图；**不持久化**：每次打开表格回到「关」。
 * 桌面另有「视图」页签里内核自带的开关（本机状态，同样不落正文）。
 */
import type { FUniver } from "@univerjs/presets";

export const USHEET_CROSSHAIR_COMMANDS = {
  enable: "sheet.operation.enable-crosshair-highlight",
  disable: "sheet.operation.disable-crosshair-highlight",
  toggle: "sheet.operation.toggle-crosshair-highlight",
} as const;

/** 显式开/关；返回内核是否接受。异常一律 false（不阻塞表格打开/操作）。 */
export function setUsheetCrosshair(api: FUniver, on: boolean): boolean {
  try {
    return Boolean(api.executeCommand(on ? USHEET_CROSSHAIR_COMMANDS.enable : USHEET_CROSSHAIR_COMMANDS.disable));
  } catch {
    return false;
  }
}
