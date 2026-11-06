import { QuickNotePreview } from "../quickNotes/QuickNotePreview";
import { HistorySnapshotPreview } from "../../components/app/HistorySnapshotPreview";

/**
 * 标签空间的只读预览正文（261106 用户验收：**复用通用只读预览**）。
 *
 * - 文档（doc / usheet / bitable / board / ink）⇒ `HistorySnapshotPreview`（与回收站、历史面板同一实现、
 *   同一排版与字号；内部按 kind 懒加载各自只读编辑器，解析不了退化成结构化摘要）；
 * - 小记 ⇒ 既有「快路径 + 内核只读兜底」（QuickNotePreview 内部按 unsupported 节点自动落到内核）。
 *
 * 本模块**只能由 lazy 入口加载**（TagsWorkspace → lazy(() => import("./TagPreviewBody"))）：
 * 它静态引用内核运行时与只读编辑器，进首屏静态图会拖垮冷启动（P12 边界）。
 */
export default function TagPreviewBody({ kind, docKind = "doc", body, noteId }: {
  kind: "doc" | "quickNote";
  docKind?: "doc" | "usheet" | "bitable" | "board" | "ink";
  body: string;
  noteId: string;
}) {
  if (kind === "doc") {
    return <HistorySnapshotPreview kind={docKind} noteId={noteId} body={body} snapshotId={noteId} />;
  }
  return (
    <div className="tags-preview__quick">
      {/* 只读聚合预览：图片点击不弹灯箱（要看/要改回原空间），正文本身仍然只读。 */}
      <QuickNotePreview body={body} noteId={noteId} assets={[]} onImageClick={() => undefined} />
    </div>
  );
}
