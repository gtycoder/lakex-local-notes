import { ArrowLeft, ArrowRight, Plus, Trash2, X } from "lucide-react";
import type { InkPage } from "../../core/inkDoc.js";
import { InkPaper } from "./InkPaper.js";

export interface InkPageStripProps {
  pages: InkPage[];
  activePageId?: string;
  pendingDeleteId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onAdd: () => void;
  onRequestDelete: (id: string) => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onClose: () => void;
}

function PageThumb({ page }: { page: InkPage }) {
  return (
    <svg viewBox={`0 0 ${page.width} ${page.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <InkPaper width={page.width} height={page.height} background={page.background} />
      {page.strokes.map((stroke) => (
        <polyline
          key={stroke.id}
          points={stroke.points.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke={stroke.color}
          strokeWidth={Math.max(1.5, stroke.width)}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={stroke.tool === "highlighter" ? 0.35 : 1}
        />
      ))}
    </svg>
  );
}

export function InkPageStrip({
  pages,
  activePageId,
  pendingDeleteId,
  onSelect,
  onMove,
  onAdd,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onClose,
}: InkPageStripProps) {
  const pendingIndex = pendingDeleteId ? pages.findIndex((page) => page.id === pendingDeleteId) : -1;

  return (
    <div className="ink-page-strip" role="region" aria-label="页面管理">
      <div className="ink-page-strip__list">
        {pages.map((page, index) => (
          <div key={page.id} className="ink-page-thumb" data-active={page.id === activePageId ? "true" : undefined}>
            <button
              className="ink-page-thumb__paper"
              data-background={page.background}
              onClick={() => onSelect(page.id)}
              aria-label={`打开第 ${index + 1} 页`}
              aria-current={page.id === activePageId ? "page" : undefined}
            >
              <PageThumb page={page} />
              <span className="ink-page-thumb__index">{index + 1}</span>
            </button>
            <div className="ink-page-thumb__actions">
              <button onClick={() => onMove(page.id, -1)} disabled={index === 0} aria-label={`第 ${index + 1} 页前移`} title="前移"><ArrowLeft size={14} /></button>
              <button onClick={() => onMove(page.id, 1)} disabled={index === pages.length - 1} aria-label={`第 ${index + 1} 页后移`} title="后移"><ArrowRight size={14} /></button>
              <button onClick={() => onRequestDelete(page.id)} disabled={pages.length <= 1} aria-label={`删除第 ${index + 1} 页`} title="删除页"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
        <button className="ink-page-strip__add" onClick={onAdd} aria-label="新建页" title="新建页"><Plus size={18} /></button>
      </div>
      {pendingDeleteId && pendingIndex >= 0 ? (
        <div className="ink-page-strip__confirm" role="alertdialog" aria-label={`确认删除第 ${pendingIndex + 1} 页`}>
          <span>删除第 {pendingIndex + 1} 页？</span>
          <button onClick={onCancelDelete}>取消</button>
          <button className="is-danger" onClick={onConfirmDelete}>删除</button>
        </div>
      ) : null}
      <button className="ink-page-strip__close" onClick={onClose} aria-label="关闭页面管理" title="关闭"><X size={16} /></button>
    </div>
  );
}

export default InkPageStrip;
