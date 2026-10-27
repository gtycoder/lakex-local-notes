/**
 * 「按需下载附件」占位（261027）：图片/附件在首拉时被跳过，打开文档/卡片时若本地还没有文件，
 * AssetServer 返回 404 ⇒ 内核里就是一张破图。这里在**捕获阶段**监听 img 的 error：
 *  - 给该 img 打标记 + 写 alt（移动端会把 alt 显示在破图框里），CSS 再把它撑成一张「未下载」卡片；
 *  - 点击该图 → 调 deps.download 补拉这条（文档/小记）缺失的媒体，成功后对所有同 key 的图片重挂 src（带 cache-bust）。
 *
 * 只改渲染态 DOM（加 class/dataset/alt、最终换 src），不碰 Lake 内核文档模型；
 * 同一张图只标记一次（dataset 判定），避免 error → 改 src → 再 error 的循环。
 */
import { parseLocalAssetUrl, type LocalAssetRef } from "../../core/assetUrl.js";

export const MISSING_ASSET_CLASS = "mb-asset-missing";
const ATTR_ORIGINAL_SRC = "data-mb-missing-src";
const ATTR_KEY = "data-mb-missing-key";

export interface MissingAssetPlaceholderDeps {
  /** 补拉这些引用对应的缺失媒体；返回实际下载/失败数（0/0 通常 = 离线或云端没有）。 */
  download: (refs: LocalAssetRef[]) => Promise<{ downloaded: number; failed: number }>;
  /** 补拉失败/离线时的提示（可选）。 */
  showToast?: (message: string, type?: "error" | "info") => void;
}

/** 资源归属键：文档 = {noteId}，小记 = quick-notes/{id}（与 bridge.ensureQuickNoteAssets 入参一致）。 */
export function assetKeyOf(ref: LocalAssetRef): string {
  return ref.space === "quick-notes" ? "quick-notes/" + ref.noteId : ref.noteId;
}

function markMissing(img: HTMLImageElement): void {
  if (img.classList.contains(MISSING_ASSET_CLASS)) return;
  const ref = parseLocalAssetUrl(img.getAttribute("src") ?? "");
  if (!ref) return;
  img.setAttribute(ATTR_ORIGINAL_SRC, img.getAttribute("src") ?? "");
  img.setAttribute(ATTR_KEY, assetKeyOf(ref));
  img.classList.add(MISSING_ASSET_CLASS);
  img.setAttribute("alt", "图片未下载，点击下载");
  img.setAttribute("title", "图片未下载，点击下载");
}

/** 补拉成功后把同一条的所有占位图恢复成真实地址（cache-bust 防 AssetServer 404 被浏览器缓存住）。 */
export function restoreMissingAssets(root: Document | Element, key: string, now = Date.now()): number {
  const nodes = root.querySelectorAll("img." + MISSING_ASSET_CLASS);
  let restored = 0;
  nodes.forEach((node) => {
    const img = node as HTMLImageElement;
    if (img.getAttribute(ATTR_KEY) !== key) return;
    const src = img.getAttribute(ATTR_ORIGINAL_SRC);
    if (!src) return;
    const bust = src.includes("?") ? "&" : "?";
    img.setAttribute("src", src + bust + "r=" + now);
    img.classList.remove(MISSING_ASSET_CLASS);
    img.removeAttribute(ATTR_ORIGINAL_SRC);
    img.removeAttribute(ATTR_KEY);
    img.removeAttribute("title");
    img.setAttribute("alt", "");
    restored += 1;
  });
  return restored;
}

/** 安装占位监听；返回卸载函数（App 级只装一次）。 */
export function installMissingAssetPlaceholders(target: Document, deps: MissingAssetPlaceholderDeps): () => void {
  const onError = (event: Event): void => {
    const el = event.target as Element | null;
    if (!el || el.tagName !== "IMG") return;
    markMissing(el as HTMLImageElement);
  };
  const onClick = (event: Event): void => {
    const el = event.target as Element | null;
    const img = el?.closest?.("img." + MISSING_ASSET_CLASS) as HTMLImageElement | null;
    if (!img) return;
    event.preventDefault();
    event.stopPropagation();
    if (img.dataset.mbMissingBusy === "1") return;
    img.dataset.mbMissingBusy = "1";
    const key = img.getAttribute(ATTR_KEY) ?? "";
    const ref = parseLocalAssetUrl(img.getAttribute(ATTR_ORIGINAL_SRC) ?? "");
    if (!ref || !key) { delete img.dataset.mbMissingBusy; return; }
    void deps.download([ref])
      .then((result) => {
        const restored = result.downloaded > 0 ? restoreMissingAssets(target, key) : 0;
        if (restored === 0) {
          deps.showToast?.(result.downloaded === 0 ? "图片暂未下载（离线或未配置云同步）" : "图片下载失败，请稍后重试", "error");
        }
      })
      .catch(() => { deps.showToast?.("图片下载失败，请稍后重试", "error"); })
      .finally(() => { delete img.dataset.mbMissingBusy; });
  };
  target.addEventListener("error", onError, true);
  target.addEventListener("click", onClick, true);
  return () => {
    target.removeEventListener("error", onError, true);
    target.removeEventListener("click", onClick, true);
  };
}
