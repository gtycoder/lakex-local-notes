import { QuickNotePreview } from "../quickNotes/QuickNotePreview";

/**
 * 标签空间的**小记**只读预览正文（261106 用户验收：统一成同一个预览能力）。
 *
 * 现状（261112 审计 A7，已核实）：唯一调用点是 `TagsWorkspace.tsx:587`，只传 `kind="quickNote"`。
 * 文档预览自 261106 起改为「信息卡 + 点击打开文档」（`TagsWorkspace.tsx:568-578`），**不走本组件**
 * ⇒ 原先的 doc / 非 doc（`NoteDocPreview` / `HistorySnapshotPreview`）分支**不可达**，已删除。
 * 若将来要恢复内嵌文档预览，请直接复用 `components/app/NoteDocPreview` 与
 * `components/app/HistorySnapshotPreview`（回收站/历史面板/文档属性同一实现），**不要**在这里
 * 另写一套——重复实现的根因见 `docs/audit-261112/02-preview-unification.md`。
 *
 * 小记自身走「快路径 + 内核只读兜底」：`QuickNotePreview` 内部按 `unsupported` 节点自动落到
 * `QuickNoteKernelPreview`（懒加载），判据单一来源在解析器里。
 *
 * 本模块**只能由 lazy 入口加载**（TagsWorkspace → lazy(() => import("./TagPreviewBody"))）：
 * 兜底链会经 `QuickNoteKernelPreview` 的 lazy 边界引入内核运行时，进首屏静态图会拖垮冷启动（P12 边界）。
 */
export interface TagPreviewBodyProps {
  /** 唯一调用点仍显式传 `"quickNote"`（本组件不再按 kind 分派，保留以锁定调用契约）。 */
  kind: "quickNote";
  /** 小记正文（.qnote 的 body）。 */
  body: string;
  /** 小记 id：内核兜底渲染与资源解析要用。 */
  noteId: string;
}

export default function TagPreviewBody({ body, noteId }: TagPreviewBodyProps) {
  return (
    <div className="tags-preview__quick">
      {/* 只读聚合预览：图片点击不弹灯箱（要看/要改回原空间），正文本身仍然只读。 */}
      <QuickNotePreview body={body} noteId={noteId} assets={[]} onImageClick={() => undefined} />
    </div>
  );
}
