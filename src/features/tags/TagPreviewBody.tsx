import { NoteDocPreview } from "../../components/app/NoteDocPreview";
import { HistorySnapshotPreview } from "../../components/app/HistorySnapshotPreview";
import { QuickNotePreview } from "../quickNotes/QuickNotePreview";

/**
 * 标签空间的只读预览正文（261106 用户验收：**统一成同一个预览能力**）。
 *
 * - doc ⇒ `NoteDocPreview`（回收站/历史面板/文档属性同一实现：只读 Lake viewer + 统一阅读档排版，
 *   正文 14px / 行高 1.7 / 标题 em 缩放 / 列宽 760px）；
 * - 其余四族（usheet / bitable / board / ink）⇒ `HistorySnapshotPreview`（正文是内部 JSON，靠只读编辑器渲染）；
 *   其中 ink 由它的 ink 分支懒加载 `InkPreview`（只读手写画布，261106）。**不要**在这里另起第二套 ink
 *   预览/回退逻辑——两处必须共用同一实现与同一容器；
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
    return docKind === "doc"
      ? <NoteDocPreview noteId={noteId} body={body} />
      : <HistorySnapshotPreview kind={docKind} noteId={noteId} body={body} snapshotId={noteId} />;
  }
  return (
    <div className="tags-preview__quick">
      {/* 只读聚合预览：图片点击不弹灯箱（要看/要改回原空间），正文本身仍然只读。 */}
      <QuickNotePreview body={body} noteId={noteId} assets={[]} onImageClick={() => undefined} />
    </div>
  );
}
