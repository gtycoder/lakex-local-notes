/**
 * 移动端顶部「页面条」（261125 D-06 拆分：从 InkPad.tsx 原样搬出，纯搬移零行为变化）。
 *
 * 悬浮导航面（data-overlay="nav"，不占布局高度）：翻页 | 缩放 | 全局预览 | 页签注入点，阅读态 + 编辑态同一条。
 * 三者都是纯视图操作，阅读态也可用；纸张是正文数据，只出现在编辑态底部工具坞（InkFooterMobile.tsx）。
 * 跨端样式：只发共享 ink-* 类名（inkPad.shared.css 两端副本 + inkSharedCssParity 护栏），不发 mb-*。
 */
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { ChevronLeft, ChevronRight, LayoutGrid, Minus, Plus } from "lucide-react";
import type { InkDoc, InkPage } from "../../core/inkDoc.js";
import type { InkPadProps } from "./InkPad";

export interface InkNavMobileProps {
  doc: InkDoc;
  page: InkPage | null;
  pageIndex: number;
  readOnly: boolean;
  switchPage: (delta: number) => void;
  addPage: () => void;
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomMin: number;
  zoomMax: number;
  pagesOpen: boolean;
  setPagesOpen: Dispatch<SetStateAction<boolean>>;
  setPendingDeletePageId: Dispatch<SetStateAction<string | null>>;
  closeSwatches: () => void;
  renderPageTab?: InkPadProps["renderPageTab"];
  savePageNote: (text: string) => void;
  clearPageNote: () => void;
}

export function InkNavMobile({ doc, page, pageIndex, readOnly, switchPage, addPage, zoom, setZoom, zoomIn, zoomOut, zoomMin, zoomMax, pagesOpen, setPagesOpen, setPendingDeletePageId, closeSwatches, renderPageTab, savePageNote, clearPageNote }: InkNavMobileProps): ReactNode {
  return (
        // 移动端顶部固定条（阅读态 + 编辑态同一条）：翻页 | 缩放 | 全局预览。
        // 三者都是纯视图操作，阅读态也可用；纸张是正文数据，只出现在编辑态底部工具坞。
        <div className="ink-toolbar" role="toolbar" aria-label="手写板导航" data-overlay="nav">
          <div className="ink-pages">
            <button onClick={() => switchPage(-1)} disabled={pageIndex <= 0} aria-label="上一页"><ChevronLeft size={16} /></button>
            {/* 移动端页码紧凑（「第 n / N 页」→「n / N」）：顶部胶囊要塞下 翻页+缩放+全局预览+页签 四组 */}
            <span>{pageIndex + 1} / {doc.pages.length}</span>
            <button onClick={() => switchPage(1)} disabled={pageIndex >= doc.pages.length - 1} aria-label="下一页"><ChevronRight size={16} /></button>
            <button onClick={addPage} disabled={readOnly} aria-label="新建页"><Plus size={16} /></button>
          </div>
          <span className="ink-toolbar__sep" />
          <div className="ink-zoom" role="group" aria-label="缩放">
            <button onClick={zoomOut} disabled={zoom <= zoomMin} aria-label="缩小"><Minus size={16} /></button>
            <button className="ink-zoom__value" onClick={() => setZoom(1)} title="恢复为适应页面" aria-label="恢复为适应页面">{Math.round(zoom * 100)}%</button>
            <button onClick={zoomIn} disabled={zoom >= zoomMax} aria-label="放大"><Plus size={16} /></button>
          </div>
          <span className="ink-toolbar__sep" />
          <button
            className="ink-tool"
            data-popover-trigger="preview"
            onClick={() => { setPagesOpen((open) => !open); setPendingDeletePageId(null); closeSwatches(); }}
            aria-label="全局预览"
            title="全局预览"
            aria-expanded={pagesOpen}
          ><LayoutGrid size={16} /></button>
          {renderPageTab ? (
            <>
              <span className="ink-toolbar__sep" />
              {renderPageTab({
                pageNumber: pageIndex + 1,
                readOnly,
                note: page?.note,
                onSave: savePageNote,
                onClear: clearPageNote,
              })}
            </>
          ) : null}
        </div>
  );
}
