/**
 * 文档正文只读预览（**共用实现**，261106）：回收站 / 标签空间 / 历史面板 / 文档属性 都走它。
 *
 * 为什么抽出来：同一个能力（doc 正文只读渲染）此前有 4 份宿主——回收站自己内联
 * `createLakeDocument`、历史面板与属性弹窗各自 `ref + useHistorySnapshotViewer`、标签空间用
 * `HistorySnapshotPreview`（那个组件对 doc 只出兜底文案 ⇒ 预览空白）。四份的挂载参数各写一遍，
 * 字号也跟着挂载点走（默认 18px）⇒ 用户报「预览正文很大」且各处不一致。
 *
 * 三条硬约束：
 *  1. **同一时刻只挂一个 viewer 实例**（hook 内部复用，切正文只 `setDocument`）；
 *  2. **只读**：viewer 模式的 onChange 是 no-op，绝不写盘；
 *  3. 滚动交给**调用方容器**（`.trash-preview-viewer` / `.history-preview-viewer` / …）——
 *     宿主本身不抢滚动，避免「外滚 + 内滚」两条。
 */
import { useRef, useState } from "react";
import { isMobileEnvironment } from "../../features/editor/clipboardHtml";
import { useHistorySnapshotViewer } from "../hooks/useHistorySnapshotViewer";
import "./noteDocPreview.css";

/** 预览固定阅读档字号（内核 defaultFontsize 只认 12/13/14/15/16/19/22/24）。标题/行宽见 CSS。 */
export const NOTE_DOC_PREVIEW_FONT_SIZE = 14;

export interface NoteDocPreviewProps {
  /** 文档 id（资源/资产解析按它走）；空串 = 不渲染。 */
  noteId: string;
  /** 要显示的 lake 正文（当前正文或历史快照）。 */
  body: string;
  /** 渲染失败回调（调用方页面级错误行）。给了它就**不再**在预览内重复显示一行。 */
  onError?: (message: string) => void;
  /** 调用方既有容器类（保留各处的滚动/边框/高度规则，如 `trash-preview-viewer`）。 */
  className?: string;
}

export function NoteDocPreview({ noteId, body, onError, className }: NoteDocPreviewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 移动端借道桌面「文档属性」弹窗时会走到这里：没有内部滚动容器 ⇒ 必须禁用虚拟渲染，否则正文渲染不全
  const mobile = isMobileEnvironment();

  useHistorySnapshotViewer({
    hostRef,
    noteId: noteId || null,
    body,
    prefs: mobile
      ? { fontSize: NOTE_DOC_PREVIEW_FONT_SIZE, disableNativeToc: true, disableVirtualRendering: true, showToolbar: false }
      : { fontSize: NOTE_DOC_PREVIEW_FONT_SIZE, disableNativeToc: true },
    onError: (message) => {
      setError(message);
      onError?.(message);
    },
  });

  return (
    <div className={className ? `note-doc-preview ${className}` : "note-doc-preview"}>
      {error && !onError && <p className="note-doc-preview__error" role="status">正文预览失败：{error}</p>}
      <div className="note-doc-preview__host" ref={hostRef} />
    </div>
  );
}
