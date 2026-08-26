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

  if (!state) return null;
  const { item, onOpen, onShowInFolder } = state;
  const kind = item.kind;

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
        {kind === "pdf" && (
          <embed src={item.src} type="application/pdf" className="attachment-preview__embed" />
        )}
        {kind === "audio" && (
          <div className="attachment-preview__media">
            <audio controls autoPlay src={item.src} className="attachment-preview__audio" />
            <p className="attachment-preview__hint">{item.name}</p>
          </div>
        )}
        {kind === "video" && (
          <video controls autoPlay src={item.src} className="attachment-preview__video" />
        )}
        {(kind === "document" || kind === "archive" || kind === "other" || kind === "image") && (
          <div className="attachment-preview__fallback">
            <Paperclip size={40} />
            <p className="attachment-preview__fallback-name">{item.name}</p>
            <p className="attachment-preview__hint">{formatFileSize(item.size)} · 此类型不支持内联预览</p>
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
