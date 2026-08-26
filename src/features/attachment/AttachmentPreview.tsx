/**
 * 附件预览 overlay（桌面/移动端共用，方案 B）：
 * - PDF → Chromium 内置 PDF viewer（<embed>，需要 asset server 返回 application/pdf）
 * - 音频/视频 → <audio>/<video> 内联播放（controls）
 * - 其他（office/压缩包/二进制）→ 文件信息 + 操作按钮
 * - 工具栏：用系统应用打开 / 在文件夹中显示（桌面平台动作）/ 关闭
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, FolderOpen, Paperclip, X } from "lucide-react";
import { closeAttachmentPreview, subscribeAttachmentPreview, type AttachmentPreviewState } from "./attachmentPreviewController";
import { formatFileSize } from "../../core/fileCard";
import { SystemBars, SystemBarsStyle } from "@capacitor/core";

const KIND_LABEL: Record<string, string> = {
  image: "图片", pdf: "PDF 文档", audio: "音频", video: "视频", document: "文档", archive: "压缩包", other: "文件",
};

export function AttachmentPreview() {
  const [state, setState] = useState<AttachmentPreviewState | null>(null);

  useEffect(() => subscribeAttachmentPreview((s) => setState(s)), []);

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeAttachmentPreview(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);

  // 沉浸顶栏（移动端）：预览是深色背景，状态栏图标切换为浅色（白），关闭恢复浅色背景图标。
  // 桌面无 SystemBars（try/catch 静默）。
  useEffect(() => {
    if (!state) return;
    let active = true;
    const applyDark = async () => {
      try {
        if (typeof SystemBars?.setStyle === "function") {
          await SystemBars.setStyle({ style: SystemBarsStyle.Dark });
          if (!active) void SystemBars.setStyle({ style: SystemBarsStyle.Light }).catch(() => undefined);
        }
      } catch { /* 桌面端无 SystemBars */ }
    };
    void applyDark();
    return () => {
      active = false;
      try {
        if (typeof SystemBars?.setStyle === "function") {
          void SystemBars.setStyle({ style: SystemBarsStyle.Light }).catch(() => undefined);
        }
      } catch { /* 桌面端无 SystemBars */ }
    };
  }, [state]);

  if (!state) return null;
  const { item, onOpen, onShowInFolder } = state;
  const kind = item.kind;
  // 移动端原生平台（Capacitor）判定：移动端统一「打开」面板（系统应用打开，文件在本地）；
  // 桌面保留 PDF/音视频内联预览。注意不能用 isDesktop()——移动端也映射了 lakeNative。
  const win = window as Window & { Capacitor?: { isNativePlatform?: () => boolean } };
  const isMobileNative = typeof win.Capacitor !== "undefined" && !!win.Capacitor.isNativePlatform?.();

  return createPortal(
    <div className="attachment-preview" role="dialog" aria-modal="true" aria-label="附件预览"
      onClick={(e) => { if (e.target === e.currentTarget) closeAttachmentPreview(); }}>
      <div className="attachment-preview__toolbar">
        <span className="attachment-preview__title"><Paperclip size={15} />{item.name}
          <small>{KIND_LABEL[kind] ?? "文件"} · {formatFileSize(item.size)}</small></span>
        <span className="attachment-preview__spacer" />
        {onOpen && (
          <button className="attachment-preview__btn" onClick={() => onOpen(item)}>
            <ExternalLink size={15} />用系统应用打开
          </button>
        )}
        {onShowInFolder && (
          <button className="attachment-preview__btn" onClick={() => onShowInFolder(item)}>
            <FolderOpen size={15} />在文件夹中显示
          </button>
        )}
        <button className="attachment-preview__btn attachment-preview__close" onClick={closeAttachmentPreview} aria-label="关闭"><X size={19} /></button>
      </div>
      <div className="attachment-preview__body">
        {/* 桌面：PDF/音视频内联预览；移动端：所有附件统一「打开」面板（系统应用打开，文件已在本地） */}
        {!isMobileNative && kind === "pdf" && (
          <embed src={item.src} type="application/pdf" className="attachment-preview__embed" />
        )}
        {!isMobileNative && kind === "audio" && (
          <div className="attachment-preview__media">
            <audio controls autoPlay src={item.src} className="attachment-preview__audio" />
            <p className="attachment-preview__hint">{item.name}</p>
          </div>
        )}
        {!isMobileNative && kind === "video" && (
          <video controls autoPlay src={item.src} className="attachment-preview__video" />
        )}
        {(isMobileNative || kind === "document" || kind === "archive" || kind === "other" || kind === "image") && (
          <div className="attachment-preview__fallback">
            <Paperclip size={40} />
            <p className="attachment-preview__fallback-name">{item.name}</p>
            <p className="attachment-preview__hint">{formatFileSize(item.size)}{isMobileNative ? " · 点击打开查看" : " · 此类型不支持内联预览"}</p>
            {onOpen && (
              <button className="attachment-preview__btn attachment-preview__btn--primary" onClick={() => onOpen(item)}>
                <ExternalLink size={15} />用系统应用打开
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
