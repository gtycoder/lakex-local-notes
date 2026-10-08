/**
 * 历史快照预览（kind = usheet / bitable / board）。
 *
 * doc 的快照走只读 Lake viewer（调用方分支，本组件不处理）。
 * 非 doc 的正文是内部 JSON，**图片只有编辑器认识**（表格单元格图片按 filename 拼资产 URL、多维表附件
 * 缩略图、画板整个 canvas）⇒ 自己画等于把资产解析/缩略图档位/画布渲染重写一遍。
 * 所以这里挂**只读编辑器**做真预览（用户 260926 口径："有一点成本也行"）。
 *
 * 三条硬约束（用户明确要求 + 安全）：
 *  1. **同一时刻只挂一个编辑器实例**：切快照 = 换 `key` 重挂（调用方以 snapshotId 作 key），
 *     绝不按快照数量批量创建；
 *  2. **只读 + onChange 一律 no-op**：双保险 —— 预览永不写盘（读过 `readOnlyRef` 闸门，仍不回传）；
 *  3. 解析不了 / 编辑器加载失败 ⇒ 退化成**结构化摘要**（`snapshotPreview` 的模型），不留空白。
 */
import { Component, Suspense, lazy, useMemo, type ErrorInfo, type ReactNode } from "react";
import { snapshotPreview, type SnapshotPreviewBlock } from "../core/historyPreview.js";
import type { NoteKind } from "../core/noteKind.js";
import "./historySnapshotPreview.css";

/** 与 MultiTabEditor 同款懒加载：预览与正式编辑共用同一份分包，不额外增加首屏体积。 */
const BitableEditor = lazy(() => import("../features/bitable/BitableEditor").then((m) => ({ default: m.BitableEditor })));
const BoardEditor = lazy(() => import("../features/board/BoardEditor").then((m) => ({ default: m.BoardEditor })));
const UniverSheetEditor = lazy(() => import("../features/usheet/UniverSheetEditor").then((m) => ({ default: m.UniverSheetEditor })));

export interface HistorySnapshotPreviewProps {
  kind: NoteKind;
  noteId: string;
  /** 快照正文（usheet/bitable/board 的内部 JSON）。 */
  body: string;
  /** 快照 id：作为编辑器的 key ⇒ 切快照重挂（一个实例槽位），同时用于错误边界复位。 */
  snapshotId: number | string;
}

function StructuredBlocks({ blocks }: { blocks: SnapshotPreviewBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === "facts") {
          return <Facts items={block.items} key={`f${index}`} />;
        }
        if (block.type === "table") {
          return (
            <section className="snapshot-preview__section" key={`t${index}`}>
              <div className="snapshot-preview__title">{block.title}</div>
              <div className="snapshot-preview__scroll">
                <table className="snapshot-preview__table">
                  <thead>
                    <tr>{block.head.map((cell, i) => <th key={`h${i}`} scope="col">{cell}</th>)}</tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={`r${r}`}>{row.map((cell, c) => <td key={`c${c}`} title={cell}>{cell}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {block.more && <div className="snapshot-preview__more">{block.more}</div>}
            </section>
          );
        }
        if (block.type === "text") {
          return (
            <section className="snapshot-preview__section" key={`x${index}`}>
              <div className="snapshot-preview__title">{block.title}</div>
              <p className="snapshot-preview__text">{block.text}</p>
            </section>
          );
        }
        return <p className="snapshot-preview__hint" key={`e${index}`}>{block.text}</p>;
      })}
    </>
  );
}

function Facts({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="snapshot-preview__facts">
      {items.map(([label, value]) => (
        <div className="snapshot-preview__fact" key={`${label}-${value}`}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 编辑器侧失败（分包加载异常 / 快照正文诡异）时不炸掉整个弹窗，退回结构化摘要。 */
class PreviewErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn("[history] 快照编辑器预览失败，退回摘要视图", error, info.componentStack);
  }
  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function HistorySnapshotPreview({ kind, noteId, body, snapshotId }: HistorySnapshotPreviewProps) {
  const blocks = useMemo(() => snapshotPreview(kind, body), [kind, body]);
  const facts = blocks.filter((b): b is Extract<SnapshotPreviewBlock, { type: "facts" }> => b.type === "facts");
  // 只有 facts 之外的块才说明"正文解析不了"（模型对坏正文只产出一条 empty/hint）
  const parseable = kind === "doc" ? false : !(blocks.length === 1 && blocks[0].type === "empty");
  const noop = useMemo(() => () => undefined, []);

  if (!parseable) {
    return (
      <div className="history-snapshot">
        <StructuredBlocks blocks={blocks} />
      </div>
    );
  }

  return (
    <div className="history-snapshot">
      {facts.map((block, index) => <Facts items={block.items} key={`f${index}`} />)}
      <div className="history-editor-preview">
        <PreviewErrorBoundary fallback={<StructuredBlocks blocks={blocks} />}>
          {/* key = 快照 id：切快照重挂，始终只有一个编辑器实例 */}
          <Suspense key={snapshotId} fallback={<p className="snapshot-preview__hint">正在加载预览…</p>}>
            {kind === "usheet" ? (
              <UniverSheetEditor noteId={noteId} content={body} visible readOnly onChange={noop} showToolbar={false} />
            ) : kind === "bitable" ? (
              <BitableEditor noteId={noteId} content={body} visible readOnly onChange={noop} chrome={false} />
            ) : (
              <BoardEditor noteId={noteId} content={body} visible readOnly onChange={noop} />
            )}
          </Suspense>
        </PreviewErrorBoundary>
      </div>
    </div>
  );
}
