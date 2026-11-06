/**
 * 261106 task-95：画板**离屏快照**（批量导出 PDF 用）。
 *
 * 场景：批量导出时用户选中的画板大多**没打开**（BoardEditor 未挂载）⇒ 没有画板实例、也没有 previewImage 可拿。
 * 做法（与 Markdown 导入管线的离屏容器同一套路，不 patch vendor）：
 *   1) 在可见文档流里挂一个**离屏但可测量**的容器（width 800 / position:fixed / left:-10000px / visibility:hidden，
 *      **不是 display:none** —— 画布引擎量不到尺寸会画出空白）；
 *   2) 懒加载 vendor 的画布核心（`loadDrawnixBoardCore`，不静态 import ⇒ 不把 511KB 引擎拉进首屏），
 *      用该画板正文的值挂上去；
 *   3) 画布核心挂载后会自己发一次 `onChange({ previewImage })`（vendor 内部 = @plait/core toImage，
 *      与画板「导出 PNG」同一个函数），拿到整幅 PNG data URL 即得字节；
 *   4) 无论成功/超时/异常，都卸载 React 根 + 移除容器（超时默认 8s；失败返回 null，由调用方 skipped）。
 *
 * 保密：只在内存里做，不写盘、不改源数据；读的是调用方给的正文（磁盘上那份）。
 */
import { parseBoardBody } from "../../core/boardDoc";
import { dataUrlToBytes, type BoardBytesResult } from "./boardExport";

/** 画板 PNG 快照的容器宽度（与画布默认视口同量级；太窄会让自适应缩放失真）。 */
export const BOARD_SNAPSHOT_WIDTH = 800;
export const BOARD_SNAPSHOT_HEIGHT = 600;
/** 等首张 previewImage 的上限。 */
export const BOARD_SNAPSHOT_TIMEOUT_MS = 8_000;

export interface BoardSnapshotDeps {
  /**
   * 测试注入：把画板值渲染进容器，并在拿到整幅 PNG data URL 时调 onSnapshot。
   * 返回卸载函数（必须调用，用于清 React 根/监听器）。
   */
  mount?: (container: HTMLElement, value: BoardSnapshotValue, onSnapshot: (dataUrl: string) => void) => Promise<() => void>;
  timeoutMs?: number;
  width?: number;
  height?: number;
}

/** 传给画布核心的卡片值（只保留离屏渲染需要的字段）。 */
export interface BoardSnapshotValue {
  version: 2;
  engine: "drawnix";
  preset: unknown;
  plaitValue: unknown[];
}

/** 缺省 mount：懒加载 vendor 画布核心，React 18 createRoot 挂到离屏容器。 */
async function defaultMount(container: HTMLElement, value: BoardSnapshotValue, onSnapshot: (dataUrl: string) => void): Promise<() => void> {
  const [{ createElement, Suspense }, { createRoot }, vendor] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("@dlient/lakex-doc-react"),
  ]);
  const { default: DrawnixBoardCore } = await vendor.loadDrawnixBoardCore();
  const theme = typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const root = createRoot(container);
  root.render(
    createElement(Suspense, { fallback: null },
      createElement(DrawnixBoardCore as never, {
        value,
        locale: "zh-CN",
        theme,
        // 只读：离屏快照不该响应编辑；previewImage 由 vendor 自己按 toImage 生成，与只读无关。
        readOnly: true,
        onChange: (partial: { previewImage?: string }) => {
          if (typeof partial?.previewImage === "string") onSnapshot(partial.previewImage);
        },
      })),
  );
  return () => {
    try { root.unmount(); } catch { /* React 已卸载/并发卸载失败不影响导出 */ }
  };
}

function createSnapshotContainer(doc: Document, width: number, height: number): HTMLDivElement {
  const container = doc.createElement("div");
  container.setAttribute("data-board-snapshot-host", "1");
  container.setAttribute("aria-hidden", "true");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = width + "px";
  container.style.height = height + "px";
  // 关键：不是 display:none / opacity:0 —— 画布引擎要靠可测量尺寸做自适应与栅格化。
  container.style.visibility = "hidden";
  container.style.pointerEvents = "none";
  container.style.zIndex = "-1";
  container.style.overflow = "hidden";
  (doc.body ?? doc.documentElement).appendChild(container);
  return container;
}

/**
 * 由画板正文（落盘 JSON）离屏渲染出整幅 PNG 字节。
 * 返回 null = 正文不可解析 / 超时没拿到快照 / 取不到字节（调用方按 skipped 处理，绝不产出坏文件）。
 */
export async function renderBoardSnapshotBytes(content: string | null | undefined, deps: BoardSnapshotDeps = {}): Promise<BoardBytesResult | null> {
  const doc = parseBoardBody(content ?? "");
  const elements = Array.isArray(doc.elements) ? doc.elements : [];
  // 空画板也允许导出（得到一张空白页 PDF），但坏正文（解析退化）不伪造：交给调用方 skipped。
  if (typeof document === "undefined") return null;
  const timeoutMs = Math.max(500, deps.timeoutMs ?? BOARD_SNAPSHOT_TIMEOUT_MS);
  const container = createSnapshotContainer(document, deps.width ?? BOARD_SNAPSHOT_WIDTH, deps.height ?? BOARD_SNAPSHOT_HEIGHT);
  const mountFn: (container: HTMLElement, value: BoardSnapshotValue, onSnapshot: (dataUrl: string) => void) => Promise<() => void> = deps.mount ?? defaultMount;
  /** 卸载函数用数组收集：回调内赋值 + finally 读取，避免 TS 把 let 收窄成 null。 */
  const disposers: Array<() => void> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const bytes = await new Promise<Uint8Array | null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
      void mountFn(
        container,
        { version: 2, engine: "drawnix", preset: doc.preset, plaitValue: elements },
        (dataUrl) => {
          const decoded = dataUrlToBytes(dataUrl);
          if (decoded && decoded.byteLength > 0) resolve(decoded);
        },
      ).then((unmount) => { disposers.push(unmount); }, () => resolve(null));
    });
    return bytes ? { bytes, format: "png" } : null;
  } finally {
    if (timer) clearTimeout(timer);
    for (const dispose of disposers) {
      try { dispose(); } catch { /* 清理失败不改变结果 */ }
    }
    try { container.remove(); } catch { /* 同上 */ }
  }
}
