/**
 * 卡片 / 文本右键（移动端为长按）菜单，桌面与移动端共用。
 * 动作由调用方注入（桌面走 native.*，移动端走注入的 attachment 回调），组件只负责排版与关闭。
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ClipboardPaste, Copy, ExternalLink, FolderOpen, Scissors, TextSelect } from "lucide-react";
import type { AttachmentPreviewItem } from "../attachment/attachmentPreviewController";

export interface CardMenuActions {
  /** 打开原始文件（桌面 shell.openPath / 移动端系统应用或分享） */
  openOriginal?: (item: AttachmentPreviewItem) => void;
  /** 在文件管理器中显示（桌面；移动端不传则不渲染该项） */
  showInFolder?: (item: AttachmentPreviewItem) => void;
  /** 复制文本（地址 / 文件名） */
  copyText?: (text: string) => void;
}

const MENU_MAX_W = 232;

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

/** 卡片菜单：打开原始文件 / 打开文件位置 / 复制地址（附件复制文件名）。 */
export function CardContextMenu({ x, y, item, actions, onClose }: {
  x: number; y: number; item: AttachmentPreviewItem; actions: CardMenuActions; onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuRef, onClose);
  const ref = item.ref;
  const isMedia = item.kind === "image" || item.kind === "video" || item.kind === "audio";
  const copyText = isMedia ? item.src : item.name;
  return createPortal(
    <div ref={menuRef} className="context-menu" style={{ left: Math.min(x, window.innerWidth - MENU_MAX_W), top: Math.min(y, window.innerHeight - 200) }} role="menu" data-context-menu>
      {ref && actions.openOriginal && (
        <button role="menuitem" onClick={() => { actions.openOriginal?.(item); onClose(); }}><ExternalLink size={15} /><span>打开原始文件</span></button>
      )}
      {ref && actions.showInFolder && (
        <button role="menuitem" onClick={() => { actions.showInFolder?.(item); onClose(); }}><FolderOpen size={15} /><span>打开文件位置</span></button>
      )}
      {actions.copyText && (
        <button role="menuitem" onClick={() => { actions.copyText?.(copyText); onClose(); }}><Copy size={15} /><span>{isMedia ? "复制地址" : "复制文件名"}</span></button>
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
