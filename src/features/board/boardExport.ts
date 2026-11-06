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
 *
 * 261106 task-95 补充：批量导出要的是**字节**而不是浏览器下载 ⇒ 新增 registerBoardBytes / readBoardBytes。
 * 字节与 Drawnix 导出**同源**：宿主从 DrawnixBoardCore 的 onChange({ previewImage }) 拿到整幅 PNG
 * data URL（vendor 内部就是 @plait/core 的 toImage，与 saveAsPng 同一个函数），不 patch vendor、
 * 也不拦截 anchor.click。没打开的画板由 boardSnapshot.ts 离屏挂载现取。
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

// ---------------------------------------------------------------------------
// 261106 task-95：画板**字节**提供者（批量导出走主进程内嵌 PDF，不落浏览器下载）
// ---------------------------------------------------------------------------

export interface BoardBytesResult {
  /** 整幅画板图像字节。 */
  bytes: Uint8Array;
  /** 批量导出只消费 png；svg 一并支持便于以后扩展。 */
  format: BoardImageFormat;
}

/** provider 由 BoardEditor 挂载时注册（画板已打开 ⇒ 给当前画面，含未保存的编辑）。 */
export type BoardBytesProvider = () => Promise<BoardBytesResult | null>;

const bytesProviders = new Map<string, BoardBytesProvider>();

/** BoardEditor 挂载时登记；返回注销函数（卸载必须调用，否则会留下已卸载画板的引用）。 */
export function registerBoardBytes(noteId: string, provider: BoardBytesProvider): () => void {
  bytesProviders.set(noteId, provider);
  return () => {
    if (bytesProviders.get(noteId) === provider) bytesProviders.delete(noteId);
  };
}

/** 取某画板的图像字节：没有已打开的画板 ⇒ null（调用方回退到 boardSnapshot.ts 的离屏渲染）。 */
export async function readBoardBytes(noteId: string): Promise<BoardBytesResult | null> {
  const provider = bytesProviders.get(noteId);
  if (!provider) return null;
  try {
    return await provider();
  } catch {
    return null;
  }
}

/** 画板是否已打开（UI 可据此优先实时字节、否则离屏渲染）。 */
export function hasBoardBytesProvider(noteId: string): boolean {
  return bytesProviders.has(noteId);
}

/** data URL（`data:image/png;base64,...`）→ 字节；格式不认返回 null。 */
export function dataUrlToBytes(dataUrl: string | null | undefined): Uint8Array | null {
  if (typeof dataUrl !== "string") return null;
  const match = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  const payload = match[3];
  try {
    if (!match[2]) return new TextEncoder().encode(decodeURIComponent(payload));
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
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
