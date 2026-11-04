/**
 * 移动端「格式刷」的内核接入（261104，设备实测 + bundle 实据）。
 *
 * 背景：kernnel 的 formatPainter 插件注册的是 `command: { paintFormat: 'paintFormat' }`，
 * 但**「记录格式」不是命令**——内核唯一入口是 formatPainter 的 **toolbar descriptor 的 onEvent('click')**
 * → `editor.renderer.getService(IFormatRenderService).recordPaintFormat(once)`
 * （记录时给 `renderer.domRootNode` 加 `.ne-paint-formatting`，并把 `renderer.queryCommandValue('paintFormat')` 存进 `_activeFormat`）；
 * 命令 `paintFormat` 只在**带 `_activeFormat` 参数**时用于「应用」（见 bundle 内 format-painter-toolbar-descriptor / format-painter 命令实现）。
 *
 * 移动端**关掉了内核工具栏**（`disabledPlugins: ["save","toolbar"]`）⇒ 没有 descriptor 可点；
 * 过去 dock 直接 `execCommand('paintFormat')`（无参）⇒ 既不记录也不应用 = **静默 no-op**（261104 设备实测）。
 *
 * 口径：这里按内核 hub 的 service token 取服务（`getService(token)` 实际读 `token.value`，见 bundle framework/hub.ts），
 * 记录/取消都走服务 API；**不要**再退回无参 execCommand。service 缺失（内核换代）时由调用方决定兜底。
 */
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";

/** 内核 formatPainter 服务（bundle 内 `IFormatRenderService`）的最小面。 */
export interface KernelFormatPaintService {
  /** 记录当前选区格式；once=true = 用一次即退出（单击），false = 连续刷（双击）。 */
  recordPaintFormat?: (once?: boolean) => void;
  /** 是否处于刷形态（`_activeFormat` 非空）。 */
  hasPaintFormat?: () => boolean;
  /** 退出刷形态（移除 `.ne-paint-formatting` 并清空已记录格式）。 */
  clearPaintFormat?: () => void;
}

/** service token：内核 hub 用 `token.value` 做键（bundle framework/public/src/hub.ts:112），所以这里只需同形对象。 */
export const FORMAT_PAINT_SERVICE_TOKEN = { value: "IFormatRenderService" } as const;

/** 取内核格式刷服务；内核形态不符/未注册时返回 null（不抛错）。 */
export function formatPaintService(editor: LakeEditorInstance | null | undefined): KernelFormatPaintService | null {
  const renderer = (editor as { renderer?: { getService?: (token: unknown) => unknown } } | null | undefined)?.renderer;
  if (!renderer || typeof renderer.getService !== "function") return null;
  try {
    const service = renderer.getService(FORMAT_PAINT_SERVICE_TOKEN) as KernelFormatPaintService | null;
    return service && typeof service.recordPaintFormat === "function" ? service : null;
  } catch {
    return null;
  }
}

export type BeginFormatPainterResult = "recorded" | "cancelled" | "unavailable";

/**
 * 点「格式刷」：已在刷形态则**取消**（与桌面点击同一颗按钮的语义一致），否则记录当前选区格式。
 * 调用前必须先把选区还原到正文（dock 面板会偷焦点，见 useEditorCommandDispatcher.restoreSelection）。
 */
export function beginFormatPainter(editor: LakeEditorInstance | null | undefined): BeginFormatPainterResult {
  const service = formatPaintService(editor);
  if (!service) return "unavailable";
  try {
    if (typeof service.hasPaintFormat === "function" && service.hasPaintFormat()) {
      service.clearPaintFormat?.();
      return "cancelled";
    }
    service.recordPaintFormat?.(true);
    return "recorded";
  } catch {
    return "unavailable";
  }
}
