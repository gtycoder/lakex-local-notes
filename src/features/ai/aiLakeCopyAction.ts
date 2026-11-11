/**
 * 「复制为 Lake」的通用入口（AI 写作等**没有活动文档编辑器**的场合，261110）。
 *
 * 内核来源顺序（一次点击只走命中得最早的一条）：
 * 1. AI 写作答案 viewer 登记的内核（aiLakeKernelRegistry：当前可见回答的实例）；
 * 2. 当前活动的文档编辑器内核（editorInstanceAt(activeEditorMount())，与文档 AI 弹窗同口径）；
 * 3. 都没有 ⇒ 懒建一个**屏幕外 1×1 的只读 viewer**，只建一次并缓存（隐藏宿主，永不显示）。
 *
 * 转换 / 写剪贴板仍只有一套实现：aiLakeClipboard.copyMarkdownAsLake（本文件不碰剪贴板格式）。
 *
 * ⚠️ 禁止静态 import ../editor/lakeRuntime：桌面内核 chunk ≈1.6MB gz，必须留在 lazy 边界
 * 之后（desktopKernelLazy.test.ts / check:bundle）。这里只在第 3 步动态 import。
 */
import { copyMarkdownAsLake, type LakePayloadKernel } from "./aiLakeClipboard";
import { getRegisteredLakeKernel } from "./aiLakeKernelRegistry";
import { activeEditorMount } from "../editor/activeEditor";
import { editorInstanceAt } from "../editor/editorRegistry";

/** 隐藏宿主类名（只建一次；调试时一眼能看出是「复制为 Lake」的兜底实例）。 */
const HIDDEN_HOST_CLASS = "ai-lake-copy-host";

/** 内核实例最小形状：这里只用到 kernel（createLakeDocument 的返回值是懒加载后的对象）。 */
type HiddenLakeEditor = { kernel?: unknown };

let hiddenEditor: HiddenLakeEditor | null = null;
let hiddenPending: Promise<LakePayloadKernel | null> | null = null;

/** 内核形状守卫：不同来源（viewer / 文档编辑器）都可能是未初始化实例，缺方法就当作拿不到。 */
function asCopyKernel(kernel: unknown): LakePayloadKernel | null {
  if (!kernel || typeof kernel !== "object") return null;
  const candidate = kernel as Partial<LakePayloadKernel>;
  if (typeof candidate.readData !== "function" || typeof candidate.writeData !== "function") return null;
  return kernel as LakePayloadKernel;
}

/** 当前活动文档的内核（AI 写作空间里通常为 null）。 */
function activeDocumentKernel(): LakePayloadKernel | null {
  return asCopyKernel(editorInstanceAt(activeEditorMount())?.kernel);
}

/** 懒建屏幕外隐藏 viewer：1×1 + fixed 到视口左侧外，照常初始化但不可见、不可点。 */
async function hiddenKernel(): Promise<LakePayloadKernel | null> {
  const ready = asCopyKernel(hiddenEditor?.kernel);
  if (ready) return ready;
  if (!hiddenPending) {
    hiddenPending = (async () => {
      try {
        const { createLakeDocument } = await import("../editor/lakeRuntime");
        // 这个宿主是**命令式 DOM**（不是 React 组件、没有样式层归属）：几何只能就地写。
        // 1×1 + 视口外 ⇒ 内核照常初始化，但永远不可见、不可点（不参与布局、不进无障碍树）。
        const host = document.createElement("div");
        host.className = HIDDEN_HOST_CLASS;
        host.setAttribute("aria-hidden", "true");
        host.style.position = "fixed";
        host.style.left = "-9999px";
        host.style.top = "0";
        host.style.width = "1px";
        host.style.height = "1px";
        host.style.overflow = "hidden";
        host.style.pointerEvents = "none";
        document.body.append(host);
        hiddenEditor = createLakeDocument(host, "viewer", () => {}, false, "ai-writing-lake-copy", null, {
          disableNativeToc: true,
          disableVirtualRendering: true,
          showToolbar: false,
          floatingToolbar: false,
          blockHandle: false,
        });
        return asCopyKernel(hiddenEditor.kernel);
      } catch {
        // chunk 加载失败 / 内核初始化失败：允许下次重试，本次静默返回「拿不到」。
        hiddenPending = null;
        return null;
      }
    })();
  }
  return hiddenPending;
}

/**
 * 把 Markdown 写成 Lake 原生剪贴板负载（粘贴到 Lake 是原生样式、不弹「是否转换」）。
 * 返回是否成功：失败（拿不到内核 / 剪贴板被拒）静默返回 false，由调用方决定回退。
 */
export async function copyMarkdownAsLakeFromAnywhere(markdown: string): Promise<boolean> {
  if (!markdown) return false;
  let kernel = getRegisteredLakeKernel() ?? activeDocumentKernel();
  if (!kernel) kernel = await hiddenKernel();
  if (!kernel) return false;
  try {
    return await copyMarkdownAsLake(kernel, markdown, window.location.href);
  } catch {
    return false;
  }
}
