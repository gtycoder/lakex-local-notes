/**
 * 内核图片卡「复制」按钮 → 我们自己的复制入口（native.copyAssetImage）。
 *
 * 为什么要在应用侧拦这一下（260924）：
 *   内核图片卡右上角内层按钮的复制走 `editor.execCommand('copy', <card range>)`，写进剪贴板的是
 *   内核私有 `ne-clipboard` 片段，图片在其中只以**本地 canonical URL**（`http://127.0.0.1:<port>/…`）
 *   形式出现 ⇒ 粘到外部应用（微信 / Word / 浏览器）拿不到图片，表现为「复制失败」（内核仍提示成功）。
 *   内核是闭源 bundle、不在我们维护/清理范围（AGENTS §3 #18），故不改造内核，只在应用侧把这个按钮的
 *   动作改接我们主进程的复制入口 —— 与右键菜单「复制图片」同一条路（webp/avif 会转 PNG 再进剪贴板）。
 *
 * 拦截方式：document **捕获阶段** click 命中 `.ne-icon-action-copy` 时 stopPropagation，阻止内核
 * React onClick；再按图片 src 解析 `{noteId, filename}` 调 native.copyAssetImage。
 * 只接管**图片卡内层**的复制键；外链 / data URL 图片、以及容器等其它 `action-copy` 一律交回内核。
 */
import { native } from "../../lib/native";
import { parseAssetRef } from "./selectionToolbar/selectionToolbarModel";

let installed = false;
/** 最近一次悬停的图片卡：小图走「更多」菜单（antd portal 到 body，不在图片卡 DOM 内），用它兜底。 */
let lastImageCard: HTMLElement | null = null;

/** 命中图片卡复制键时返回对应图片卡；否则 null（交回内核）。 */
function imageCardFor(target: HTMLElement | null): HTMLElement | null {
  const icon = target?.closest?.(".ne-icon-action-copy");
  if (!icon) return null;
  // ① 常规：直接复制按钮在 `.ne-image-wrap` 内。
  const direct = icon.closest(".ne-image-wrap");
  if (direct) return direct as HTMLElement;
  // ② 小图「更多」菜单：按钮 portal 到 body，用图片内层菜单限定 + 最近悬停的图片。
  if (icon.closest(".ne-ui-image-inner-menu, .ne-ui-image-inner-menu-menu")) {
    return lastImageCard && lastImageCard.isConnected ? lastImageCard : null;
  }
  return null;
}

export function installImageCopyBridge(): void {
  if (installed) return;
  installed = true;

  document.addEventListener(
    "mouseover",
    (event) => {
      const card = (event.target as HTMLElement | null)?.closest?.(".ne-image-wrap");
      if (card) lastImageCard = card as HTMLElement;
    },
    true,
  );

  document.addEventListener(
    "click",
    (event) => {
      const card = imageCardFor(event.target as HTMLElement | null);
      if (!card) return;
      const img = card.querySelector("img");
      const ref = img ? parseAssetRef(img.getAttribute("src") ?? "") : null;
      if (!ref) return; // 外链 / data URL：交回内核
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void native.copyAssetImage(ref.noteId, ref.filename);
    },
    true,
  );
}
