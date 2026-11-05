import { QuickNoteKernelPreview } from "../quickNotes/QuickNoteKernelPreview";
import { QuickNotePreview } from "../quickNotes/QuickNotePreview";
import { HistorySnapshotPreview } from "../../components/app/HistorySnapshotPreview";

/**
 * 标签空间的只读预览正文（P1）。
 *
 * - 普通文档（Lake 标记）⇒ **内核只读视图**（与编辑器同一份渲染，不另写一套）；
 * - 表格 / 多维表 / 画板（正文是内部 JSON，内核不认识）⇒ 复用历史快照那套**结构化只读预览**
 *   （同一份单一来源；内部按 kind 懒加载各自编辑器）；
 * - 小记 ⇒ 既有「快路径 + 内核只读兜底」（QuickNotePreview 内部按 unsupported 节点自动落到内核）。
 *
 * 本模块**只能由 lazy 入口加载**（TagsWorkspace → lazy(() => import("./TagPreviewBody"))）：
 * 它静态引用内核运行时（Lake 6MB chunk），进首屏静态图会拖垮冷启动（P12 边界）。
 */
export default function TagPreviewBody({ kind, docKind = "doc", body, noteId }: {
  kind: "doc" | "quickNote";
  docKind?: "doc" | "usheet" | "bitable" | "board" | "ink";
  body: string;
  noteId: string;
}) {
  if (kind === "doc" && docKind === "doc") {
    return (
      <div className="tags-preview__doc">
        <QuickNoteKernelPreview body={body} noteId={noteId} />
      </div>
    );
  }
  if (kind === "doc") {
    return (
      <div className="tags-preview__doc">
        <HistorySnapshotPreview kind={docKind} noteId={noteId} body={body} snapshotId={noteId} />
      </div>
    );
  }
  return (
    <div className="tags-preview__quick">
      {/* 只读聚合预览：图片点击不弹灯箱（要看/要改回原空间），正文本身仍然只读。 */}
      <QuickNotePreview body={body} noteId={noteId} assets={[]} onImageClick={() => undefined} />
    </div>
  );
}
