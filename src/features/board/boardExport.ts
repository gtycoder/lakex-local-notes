/**
 * 画板「导出 PNG / SVG」接线（统一导出菜单 ↔ 画板内已有的 Drawnix 导出）。
 *
 * 背景：画板编辑器里的 Drawnix 工具条本来就有「导出 SVG / PNG」（lakex-drawnix 的
 * saveAsSvg / saveAsPng，含图片 base64 化，CSP 已放行 data:），而目录树/文档 ⋯ 的统一
 * 「导出」子菜单里这两项一直是 disabled 占位。这里不另写一份画布渲染：直接把菜单动作转给
 * 画板里那套已验证的导出（类名契约见 docs/LAKEX-CONTRACT.md §5.13）。
 *
 * 为什么走 DOM：DrawnixBoardCore 不暴露 board 实例/导出回调，改 vendor 需重建 dist 分包
 * （且与并行会话冲突），代价远大于收益。因此按画板工具条的稳定类名触发它自己的菜单项。
 *
 * 已知边界（如实提示，不假装是保存到用户选定的目录）：
 * - 只有画板已打开（BoardEditor 挂载）时才能导出；从目录树导出未打开的画板会提示先去打开；
 * - 文件由浏览器下载通道落到系统下载目录（画板工具栏导出本来就是这种行为）。
 */
export type BoardImageFormat = "png" | "svg";

/** 最小 DOM 形状：只用到两处查询 + click，便于在 node 环境测试。 */
export interface BoardExportHost {
  querySelector(selector: string): { click(): void; textContent?: string | null } | null;
  querySelectorAll(selector: string): ArrayLike<{ click(): void; textContent?: string | null }>;
}

type BoardTrigger = (format: BoardImageFormat) => Promise<boolean>;

const triggers = new Map<string, BoardTrigger>();

/** 画板编辑器挂载时登记；返回注销函数（卸载必须调用）。 */
export function registerBoardExport(noteId: string, trigger: BoardTrigger): () => void {
  triggers.set(noteId, trigger);
  return () => {
    if (triggers.get(noteId) === trigger) triggers.delete(noteId);
  };
}

/** 统一导出菜单调用：没有已打开的画板 ⇒ false（调用方提示先打开）。 */
export async function exportBoardImage(noteId: string, format: BoardImageFormat): Promise<boolean> {
  const trigger = triggers.get(noteId);
  if (!trigger) return false;
  try {
    return await trigger(format);
  } catch {
    return false;
  }
}

/**
 * 等 React 把菜单挂出来（单击属离散事件，18 的 setState 通常在 click 内已同步 flush；这里只做一次让步）。
 * ⚠️ 用 setTimeout 而不是 requestAnimationFrame：隐藏窗口（CDP 依附 / 最小化）里 rAF 不触发，
 *    用 rAF 会把导出 promise 永久挂住（TROUBLESHOOTING「隐藏窗口」同类坑）。
 */
function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 找到菜单项：优先按文案（SVG / PNG）匹配，文案变了再退回工具条里的固定顺序。 */
function pickMenuItem(items: ArrayLike<{ click(): void; textContent?: string | null }>, format: BoardImageFormat): { click(): void } | null {
  const wanted = format === "svg" ? "SVG" : "PNG";
  const list = Array.from(items);
  const byText = list.find((item) => (item.textContent ?? "").toUpperCase().includes(wanted));
  if (byText) return byText;
  // vendor 当前顺序：SVG 在 PNG 之前（LakexExportMenu），中英文文案都含 SVG/PNG，正常不会走到这里。
  return list[format === "svg" ? 0 : 1] ?? null;
}

/**
 * 触发画板自己的导出菜单（点开导出按钮 → 点目标格式）。返回是否确实找到了按钮并点下去。
 * 菜单没出来时会把触发器再点一次收起，避免留下一个悬空的菜单。
 */
export async function triggerBoardExport(host: BoardExportHost | null | undefined, format: BoardImageFormat): Promise<boolean> {
  if (!host) return false;
  const trigger = host.querySelector(".lakex-drawnix-export__trigger");
  if (!trigger) return false;
  trigger.click();
  await nextTick();
  const target = pickMenuItem(host.querySelectorAll(".lakex-drawnix-export__menu [role=menuitem]"), format);
  if (!target) {
    trigger.click();
    return false;
  }
  target.click();
  return true;
}
