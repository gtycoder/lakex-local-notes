/**
 * PDF 逐页栅格化（261102 T2 spike）：Android 原生 PdfRender 插件的薄封装。
 *
 * 形态照 stylusInput.ts / aiChat.ts：**插件在这里注册一次**，组件只调函数，不直接 registerPlugin。
 * 非原生环境 / 旧 APK 没有该插件时 available = false，调用方据此走「暂不支持 PDF 导入」的提示，
 * 而不是把一个桥调用抛到界面上。
 *
 * 原生侧口径（PdfRenderPlugin.kt）：
 *  · 输入二选一：path = 相对 files/ 的路径；noteId + filename = files/note-assets/{noteId}/{filename}；
 *  · 逐页串行渲染，ARGB_8888 + **始终**缩放到目标宽 maxWidth（默认 1600），WebP（默认 quality 80）落 app cacheDir；
 *  · 页尺寸两套（261102 T2 设备验收修复）：width/height = **逻辑尺寸**（PDF pt×96/72，A4=794×1123，与桌面一致，
 *    写 InkPage.width/height）；pixelWidth/pixelHeight = **位图像素**（如 1600×2264，写 backgroundImage.pixelWidth/Height）；
 *  · 返回 pages[].file 是**宿主机绝对路径**（cacheDir 下），调用方需要自己转成可显示 URL 或读成字节；
 *    这些文件是缓存产物，系统可回收 —— 导入成功后应复制到正式资产目录（走 assetFs），不要长期引用 cacheDir。
 *  · 每页发 progress 事件；cancelPdfRender() 每页边界生效（已完成页仍返回）。
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

export interface PdfRenderPage {
  /** 1-based 页码。 */
  page: number;
  /** 页**逻辑尺寸**（PDF pt × 96/72；A4=794×1123，与桌面导入同口径）→ InkPage.width/height。 */
  width: number;
  height: number;
  /** 位图实际像素宽高（如 1600×2264）→ backgroundImage.pixelWidth/Height。
   *  旧 APK（261102 修复前）没有这两个字段 ⇒ 调用方用 width/height 兜底（旧包本身也没有正确像素尺寸）。 */
  pixelWidth?: number;
  pixelHeight?: number;
  /** 宿主机绝对路径（app cacheDir/pdf-render/<uuid>/page-N.webp）。 */
  file: string;
  bytes: number;
}

export interface PdfRenderProgress extends PdfRenderPage {
  pageCount: number;
}

export interface PdfRenderResult {
  pageCount: number;
  pages: PdfRenderPage[];
  /** true = 中途 cancel，pages 是已完成的那部分。 */
  cancelled: boolean;
  elapsedMs: number;
}

export interface PdfRenderOptions {
  /** 相对 app files/ 的 PDF 路径（与 path 二选一，优先 path）。 */
  path?: string;
  /** 文档资产：files/note-assets/{noteId}/{filename}。 */
  noteId?: string;
  filename?: string;
  /** 目标像素宽（默认 1600；原生夹 320..2400）。A4@2x ≈ 1190。 */
  maxWidth?: number;
  /** WebP 质量 1..100（默认 80）。 */
  quality?: number;
}

interface PdfRenderPlugin {
  renderPdf(options: PdfRenderOptions): Promise<PdfRenderResult>;
  cancel(): Promise<{ cancelled: boolean }>;
  addListener(event: "progress", listener: (progress: PdfRenderProgress) => void): Promise<{ remove: () => Promise<void> }>;
}

const PdfRender = registerPlugin<PdfRenderPlugin>("PdfRender");

/** 原生 PDF 栅格化可用性（浏览器/vitest / 旧 APK ⇒ false，不报错）。 */
export function pdfRenderAvailable(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("PdfRender");
  } catch {
    return false;
  }
}

/**
 * 渲染整份 PDF 为逐页 WebP。onProgress 可选（导入 UI 的「第 n/N 页」用）。
 * 不可用时抛 Error（调用方先查 pdfRenderAvailable()，不要用异常做常态分支）。
 */
export async function renderPdfPages(options: PdfRenderOptions, onProgress?: (progress: PdfRenderProgress) => void): Promise<PdfRenderResult> {
  if (!pdfRenderAvailable()) throw new Error("当前版本不支持 PDF 渲染（需要更新 App）");
  let handle: { remove: () => Promise<void> } | null = null;
  if (onProgress) {
    handle = await PdfRender.addListener("progress", onProgress);
  }
  try {
    return await PdfRender.renderPdf(options);
  } finally {
    try { await handle?.remove(); } catch { /* 面板已卸载/桥已断：忽略 */ }
  }
}

/** 请求取消当前渲染（幂等；每页边界生效，已完成页保留）。 */
export async function cancelPdfRender(): Promise<void> {
  if (!pdfRenderAvailable()) return;
  try {
    await PdfRender.cancel();
  } catch {
    // 没有在渲染 / 桥不可用：取消是尽力而为，不把错误抛给关闭动作
  }
}
/**
 * 读取原生渲染落盘的页图字节（cacheDir 绝对路径 → convertFileSrc → fetch）。
 * 插件按约定返回宿主机绝对路径；Android 的 convertFileSrc 对以 "/" 开头的绝对路径返回
 * `<webviewServerUrl>/_capacitor_file_<path>`（同源 HTTP，可取 arrayBuffer）。
 * 导入成功后字节走 uploadResource 复制进正式资产目录，cacheDir 文件只是中间产物。
 */
export async function readRenderedPdfFileBytes(file: string): Promise<Uint8Array> {
  const url = Capacitor.convertFileSrc(file);
  const response = await fetch(url);
  if (!response.ok) throw new Error("读取 PDF 渲染结果失败（HTTP " + response.status + "）");
  return new Uint8Array(await response.arrayBuffer());
}
