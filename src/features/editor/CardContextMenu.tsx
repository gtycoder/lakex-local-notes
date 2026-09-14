/**
 * 卡片 / 文本右键（移动端为长按）菜单，桌面与移动端共用。
 * 顺序理念与文档右键一致：编辑动作（剪切/复制）→ 打开 → 文件位置 → 导出（另存为）。
 * 复制类动作合并进「复制 ▸」子菜单；动作由调用方注入，组件只负责排版与关闭。
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardPaste, ChevronRight, Copy, Download, ExternalLink, FolderOpen, Pencil, Scissors, BoxSelect } from "lucide-react";
import type { AttachmentPreviewItem } from "../attachment/attachmentPreviewController";

export interface CardMenuActions {
  /** 使用默认程序打开（桌面 shell.openPath / 移动端系统应用或分享） */
  openOriginal?: (item: AttachmentPreviewItem) => void;
  /** 在文件管理器中显示（桌面；移动端不传则不渲染该项） */
  showInFolder?: (item: AttachmentPreviewItem) => void;
  /** 剪切卡片：复制到剪贴板并从正文移除 */
  cut?: (item: AttachmentPreviewItem) => void;
  /** 重命名附件展示名（仅 file 卡有效） */
  rename?: (item: AttachmentPreviewItem) => void;
  /** 复制图片到系统剪贴板（桌面，图片卡） */
  copyImage?: (item: AttachmentPreviewItem) => void;
  /** 复制文件的绝对路径（桌面） */
  copyPath?: (item: AttachmentPreviewItem) => void;
  /** 另存为…（桌面） */
  saveAs?: (item: AttachmentPreviewItem) => void;
  /** 复制文件名（两端都有） */
  copyName?: (item: AttachmentPreviewItem) => void;
}

const MENU_MAX_W = 232;
const SUBMENU_W = 180;

/** 选中卡片并触发 cut：由宿主编辑器的 cut 处理器写剪贴板 + 删除选区（模型随 input 更新）。 */
export function cutCardElement(el: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNode(el);
  selection.removeAllRanges();
  selection.addRange(range);
  try { document.execCommand("cut"); } catch { /* 忽略 */ }
}

function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [ref, onClose]);
}

/** 卡片菜单：剪切 / 复制 ▸ / 使用默认程序打开 / 打开文件位置 / 另存为… */
export function CardContextMenu({ x, y, item, actions, onClose }: {
  x: number; y: number; item: AttachmentPreviewItem; actions: CardMenuActions; onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  useDismiss(menuRef, onClose);
  const ref = item.ref;
  const left = Math.min(x, window.innerWidth - MENU_MAX_W);
  const top = Math.min(y, window.innerHeight - 260);
  const submenuClass = left + MENU_MAX_W + SUBMENU_W <= window.innerWidth ? "" : " open-left";
  const run = (fn?: (it: AttachmentPreviewItem) => void): void => { fn?.(item); onClose(); };

  const copyItems: Array<[string, (it: AttachmentPreviewItem) => void]> = [];
  if (ref && item.kind === "image" && actions.copyImage) copyItems.push(["复制图片", actions.copyImage]);
  if (ref && actions.copyPath) copyItems.push(["复制文件路径", actions.copyPath]);
  if (actions.copyName) copyItems.push(["复制文件名", actions.copyName]);

  return createPortal(
    <div ref={menuRef} className="context-menu" style={{ left, top }} role="menu" data-context-menu>
      {actions.cut && (
        <button role="menuitem" onClick={() => run(actions.cut)}><Scissors size={15} /><span>剪切</span></button>
      )}
      {copyItems.length === 1 && (
        <button role="menuitem" onClick={() => run(copyItems[0][1])}><Copy size={15} /><span>{copyItems[0][0]}</span></button>
      )}
      {copyItems.length > 1 && (
        <div
          className="context-menu-item has-submenu"
          onMouseEnter={() => setCopyOpen(true)}
          onMouseLeave={() => setCopyOpen(false)}
          onClick={() => setCopyOpen((v) => !v)}
        >
          <span className="context-menu-item-label"><Copy size={15} /><span>复制</span></span><ChevronRight size={14} />
          {copyOpen && (
            <div className={`context-menu-submenu${submenuClass}`} role="menu">
              {copyItems.map(([label, fn]) => (
                <button key={label} role="menuitem" onClick={() => run(fn)}>{label}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {actions.rename && item.cardName === "file" && (
        <button role="menuitem" onClick={() => run(actions.rename)}><Pencil size={15} /><span>重命名</span></button>
      )}
      {ref && actions.openOriginal && (
        <button role="menuitem" onClick={() => run(actions.openOriginal)}><ExternalLink size={15} /><span>使用默认程序打开</span></button>
      )}
      {ref && actions.showInFolder && (
        <button role="menuitem" onClick={() => run(actions.showInFolder)}><FolderOpen size={15} /><span>打开文件位置</span></button>
      )}
      {ref && actions.saveAs && (
        <button role="menuitem" onClick={() => run(actions.saveAs)}><Download size={15} /><span>另存为…</span></button>
      )}
    </div>,
    document.body
  );
}

/** 文本（正文）菜单：基础编辑动作（execCommand / clipboard）。 */
export function TextContextMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuRef, onClose);
  const run = (cmd: string): void => {
    try { document.execCommand(cmd); } catch { /* 忽略 */ }
    onClose();
  };
  const paste = (): void => {
    void navigator.clipboard.readText()
      .then((text) => { if (text) { try { document.execCommand("insertText", false, text); } catch { /* 忽略 */ } } })
      .catch(() => undefined)
      .finally(onClose);
  };
  return createPortal(
    <div ref={menuRef} className="context-menu" style={{ left: Math.min(x, window.innerWidth - MENU_MAX_W), top: Math.min(y, window.innerHeight - 200) }} role="menu" data-context-menu>
      <button role="menuitem" onClick={() => run("copy")}><Copy size={15} /><span>复制</span></button>
      <button role="menuitem" onClick={() => run("cut")}><Scissors size={15} /><span>剪切</span></button>
      <button role="menuitem" onClick={paste}><ClipboardPaste size={15} /><span>粘贴</span></button>
      <button role="menuitem" onClick={() => run("selectAll")}><BoxSelect size={15} /><span>全选</span></button>
    </div>,
    document.body
  );
}
