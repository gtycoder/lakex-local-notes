/**
 * 卡片 / 文本右键（移动端为长按）菜单，桌面与移动端共用。
 * 动作由调用方注入（桌面走 native.*，移动端走注入的 attachment 回调），组件只负责排版与关闭。
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ClipboardPaste, Copy, Download, ExternalLink, FolderOpen, Scissors, TextSelect } from "lucide-react";
import type { AttachmentPreviewItem } from "../attachment/attachmentPreviewController";

export interface CardMenuActions {
  /** 使用默认程序打开（桌面 shell.openPath / 移动端系统应用或分享） */
  openOriginal?: (item: AttachmentPreviewItem) => void;
  /** 在文件管理器中显示（桌面；移动端不传则不渲染该项） */
  showInFolder?: (item: AttachmentPreviewItem) => void;
  /** 剪切卡片：复制到剪贴板并从正文移除 */
  cut?: (item: AttachmentPreviewItem) => void;
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

/** 卡片菜单：使用默认程序打开 / 打开文件位置 / 复制地址（附件复制文件名）。 */
export function CardContextMenu({ x, y, item, actions, onClose }: {
  x: number; y: number; item: AttachmentPreviewItem; actions: CardMenuActions; onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuRef, onClose);
  const ref = item.ref;
  const run = (fn?: (it: AttachmentPreviewItem) => void): void => { fn?.(item); onClose(); };
  return createPortal(
    <div ref={menuRef} className="context-menu" style={{ left: Math.min(x, window.innerWidth - MENU_MAX_W), top: Math.min(y, window.innerHeight - 240) }} role="menu" data-context-menu>
      {ref && actions.openOriginal && (
        <button role="menuitem" onClick={() => run(actions.openOriginal)}><ExternalLink size={15} /><span>使用默认程序打开</span></button>
      )}
      {ref && actions.showInFolder && (
        <button role="menuitem" onClick={() => run(actions.showInFolder)}><FolderOpen size={15} /><span>打开文件位置</span></button>
      )}
      {actions.cut && (
        <button role="menuitem" onClick={() => run(actions.cut)}><Scissors size={15} /><span>剪切</span></button>
      )}
      {ref && item.kind === "image" && actions.copyImage && (
        <button role="menuitem" onClick={() => run(actions.copyImage)}><Copy size={15} /><span>复制图片</span></button>
      )}
      {ref && actions.copyPath && (
        <button role="menuitem" onClick={() => run(actions.copyPath)}><Copy size={15} /><span>复制文件路径</span></button>
      )}
      {ref && actions.saveAs && (
        <button role="menuitem" onClick={() => run(actions.saveAs)}><Download size={15} /><span>另存为…</span></button>
      )}
      {actions.copyName && (
        <button role="menuitem" onClick={() => run(actions.copyName)}><Copy size={15} /><span>复制文件名</span></button>
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
      <button role="menuitem" onClick={() => run("selectAll")}><TextSelect size={15} /><span>全选</span></button>
    </div>,
    document.body
  );
}
