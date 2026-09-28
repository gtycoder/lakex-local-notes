/**
 * 内核图片卡「复制」→ 我们自己的复制入口（native.copyAssetImage）。
 *
 * 覆盖两条路径（260924 用户报「复制失败」）：
 *   ① 图片右上角内层「复制」按钮：内核走 `editor.execCommand('copy', <card range>)`；
 *   ② 选中图片后按 ⌘C / Ctrl+C：内核的键盘复制。
 * 两条都写内核私有 `ne-clipboard` 片段，图片在其中只以**本地 canonical URL**
 * （`http://127.0.0.1:<port>/…`）形式出现 ⇒ 粘到外部应用（微信 / Word / 浏览器）拿不到图片，
 * 表现为「复制失败」（① 内核甚至仍提示成功）。内核是闭源 bundle、不在我们维护/清理范围
 * （AGENTS §3 #18），故不改造内核，只在应用侧把这两条动作改接主进程的复制入口 ——
 * 与右键菜单「复制图片」同一条路（webp/avif 会转 PNG 再进剪贴板）。
 *
 * 只接管**图片卡**上的本地资产图；外链 / data URL 图、以及文字选区一律交回内核/浏览器。
 */
import { native } from "../../lib/native";
import { reportNativeActionError } from "../../lib/nativeErrors";
import { parseAssetRef } from "./selectionToolbar/selectionToolbarModel";

let installed = false;
/** 最近交互到的图片卡（悬停 / 指针按下 / 点内层按钮）：按钮复制与 ⌘C 都用它定位资产。 */
let activeImageCard: HTMLElement | null = null;

/** 图片卡 → 本地资产引用；非本地资产（外链/data）或卡已卸载返回 null。 */
function assetOf(card: HTMLElement | null): { noteId: string; filename: string } | null {
  if (!card || !card.isConnected) return null;
  const img = card.querySelector("img");
  return img ? parseAssetRef(img.getAttribute("src") ?? "") : null;
}

/** 命中图片卡复制键（内层按钮，或小图「更多」菜单）时返回对应图片卡；否则 null（交回内核）。 */
function imageCardForCopyKey(target: HTMLElement | null): HTMLElement | null {
  const icon = target?.closest?.(".ne-icon-action-copy");
  if (!icon) return null;
  const direct = icon.closest(".ne-image-wrap");
  if (direct) return direct as HTMLElement;
  // 小图「更多」菜单：菜单 antd portal 到 body，用图片内层菜单限定 + 最近交互的图片。
  if (icon.closest(".ne-ui-image-inner-menu, .ne-ui-image-inner-menu-menu")) return activeImageCard;
  return null;
}

export function installImageCopyBridge(): void {
  if (installed) return;
  installed = true;

  // 记录「当前图片卡」：悬停或用指针碰到图片即记为当前；指针落回正文则清除（避免 ⌘C 误复制旧图）。
  document.addEventListener(
    "mouseover",
    (event) => {
      const card = (event.target as HTMLElement | null)?.closest?.(".ne-image-wrap");
      if (card) activeImageCard = card as HTMLElement;
    },
    true,
  );
  document.addEventListener(
    "mousedown",
    (event) => {
      const t = event.target as HTMLElement | null;
      const card = t?.closest?.(".ne-image-wrap");
      if (card) {
        activeImageCard = card as HTMLElement;
        return;
      }
      if (t?.closest?.(".ne-engine, .ne-editor-wrap")) activeImageCard = null;
    },
    true,
  );

  // ① 内层「复制」按钮：捕获阶段拦下内核 onClick，改走我们的入口。
  document.addEventListener(
    "click",
    (event) => {
      const ref = assetOf(imageCardForCopyKey(event.target as HTMLElement | null));
      if (!ref) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void native.copyAssetImage(ref.noteId, ref.filename).catch((error) => reportNativeActionError("复制图片", error));
    },
    true,
  );

  // ② ⌘C / Ctrl+C：当前目标是图片卡、且没有文字选区时，同样改走我们的入口。
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.altKey) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if ((event.key || "").toLowerCase() !== "c") return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return; // 输入框内不接管
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return; // 复制文字，不接管
      const ref = assetOf(activeImageCard);
      if (!ref) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void native.copyAssetImage(ref.noteId, ref.filename).catch((error) => reportNativeActionError("复制图片", error));
    },
    true,
  );
}
