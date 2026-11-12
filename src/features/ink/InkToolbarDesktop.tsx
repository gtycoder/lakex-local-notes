/**
 * 桌面手写板外壳（261112 R2-S10 阶段②：从 InkPad.tsx 原样搬出，纯搬移零行为变化）。
 *
 * 两个组件：顶部工具条（画笔/颜色/笔宽/撤销重做/贴图/文字/缩放）与底部 footer（翻页/页面面板/页签/导出/纸张/背景来源）。
 * 移动端外壳（悬浮导航 + 底部工具坞 + 悬浮面板）仍在 InkPad.tsx（跨端 UI 各自实现，不进本文件）。
 */
import { type Dispatch, type SetStateAction } from "react";
import { ChevronLeft, ChevronRight, Eraser, Highlighter, LayoutGrid, Minus, Pen, Plus, Redo2, Sticker, Type, Undo2 } from "lucide-react";
import type { InkBackground, InkDoc, InkPage } from "../../core/inkDoc.js";
import { InkExportMenu, type InkPageExportFormat } from "./InkExportMenu.js";
import { InkPageTabButton } from "./InkPageTabButton.js";
import { InkBackgroundSourceButtons } from "./InkBackgroundSourceButtons.js";
import type { InkPadMode, InkPadProps } from "./InkPad";

export interface InkToolbarDesktopProps {
  mode: InkPadMode;
  setMode: Dispatch<SetStateAction<InkPadMode>>;
  color: string;
  setColor: Dispatch<SetStateAction<string>>;
  setHighlighterWidth: Dispatch<SetStateAction<number>>;
  setPenWidth: Dispatch<SetStateAction<number>>;
  variant: "desktop" | "mobile";
  readOnly: boolean;
  activeWidth: number;
  onInsertPageImage: InkPadProps["onInsertPageImage"];
  insertPageImage: () => void;
  insertPageText: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
  zoomIn: () => void;
  zoomOut: () => void;
  strokeColors: readonly string[];
  widthPresets: (mode: InkPadMode) => readonly number[];
  widthDotSize: (width: number, mode?: InkPadMode) => number;
  zoomMin: number;
  zoomMax: number;
}

export function InkToolbarDesktop({ mode, setMode, color, setColor, setHighlighterWidth, setPenWidth, variant, readOnly, activeWidth, onInsertPageImage, insertPageImage, insertPageText, undo, redo, canUndo, canRedo, zoom, setZoom, zoomIn, zoomOut, strokeColors, widthPresets, widthDotSize, zoomMin, zoomMax }: InkToolbarDesktopProps) {
  return (
        <div className="ink-toolbar" role="toolbar" aria-label="手写工具">
          <button className={["ink-tool", mode === "pen" ? "is-active" : ""].join(" ")} onClick={() => setMode("pen")} aria-label="画笔" title="画笔" disabled={readOnly}><Pen size={16} /></button>
          <button className={["ink-tool", mode === "highlighter" ? "is-active" : ""].join(" ")} onClick={() => setMode("highlighter")} aria-label="高亮笔" title="高亮笔" disabled={readOnly}><Highlighter size={16} /></button>
          <button className={["ink-tool", mode === "eraser" ? "is-active" : ""].join(" ")} onClick={() => setMode("eraser")} aria-label="整笔橡皮" title="整笔橡皮" disabled={readOnly}><Eraser size={16} /></button>
          <span className="ink-toolbar__sep" />
          {strokeColors.map((value) => (
            <button
              key={value}
              className={["ink-color", color === value ? "is-active" : ""].join(" ")}
              style={{ backgroundColor: value }}
              onClick={() => { setColor(value); if (mode === "eraser") setMode("pen"); }}
              aria-label={`颜色 ${value}`}
              title={`颜色 ${value}`}
              disabled={readOnly}
            />
          ))}
          <span className="ink-toolbar__sep" />
          {widthPresets(mode).map((value) => (
            <button
              key={value}
              className={["ink-width", activeWidth === value ? "is-active" : ""].join(" ")}
              onClick={() => mode === "highlighter" ? setHighlighterWidth(value) : setPenWidth(value)}
              aria-label={`笔宽 ${value}`}
              title={`笔宽 ${value}`}
              disabled={readOnly}
            ><span style={{ width: widthDotSize(value, mode), height: widthDotSize(value, mode) }} /></button>
          ))}
          <span className="ink-toolbar__sep" />
          <button className="ink-tool" onClick={undo} aria-label="撤销" title="撤销" disabled={readOnly || !canUndo}><Undo2 size={16} /></button>
          <button className="ink-tool" onClick={redo} aria-label="重做" title="重做" disabled={readOnly || !canRedo}><Redo2 size={16} /></button>
          <span className="ink-toolbar__sep" />
          {/* 贴图（宿主注入才有）与文字块（两端都有）放在画笔旁边：它们是「往页面上放内容」 */}
          {onInsertPageImage && (
            <button
              className="ink-tool"
              onClick={() => void insertPageImage()}
              disabled={readOnly}
              aria-label="插入贴图"
              title="插入贴图（贴在当前页上，可拖动/缩放）"
            ><Sticker size={16} /></button>
          )}
          <button
            className="ink-tool"
            onClick={insertPageText}
            disabled={readOnly}
            aria-label="插入文字"
            title="插入文字块（双击编辑，可拖动）"
          ><Type size={16} /></button>
          {variant === "desktop" && (
            <>
              <span className="ink-toolbar__sep" />
              <div className="ink-zoom" role="group" aria-label="缩放">
                <button onClick={zoomOut} disabled={zoom <= zoomMin} aria-label="缩小"><Minus size={16} /></button>
                <button className="ink-zoom__value" onClick={() => setZoom(1)} title="恢复为适应页面" aria-label="恢复为适应页面">{Math.round(zoom * 100)}%</button>
                <button onClick={zoomIn} disabled={zoom >= zoomMax} aria-label="放大"><Plus size={16} /></button>
              </div>
            </>
          )}
        </div>
  );
}

export interface InkFooterDesktopProps {
  doc: InkDoc;
  page: InkPage;
  pageIndex: number;
  readOnly: boolean;
  pagesOpen: boolean;
  setPagesOpen: Dispatch<SetStateAction<boolean>>;
  setPendingDeletePageId: Dispatch<SetStateAction<string | null>>;
  closeSwatches: () => void;
  switchPage: (delta: number) => void;
  addPage: () => void;
  savePageNote: (text: string) => void;
  clearPageNote: () => void;
  onExportPage: InkPadProps["onExportPage"];
  exportOpen: boolean;
  setExportOpen: Dispatch<SetStateAction<boolean>>;
  runExportPage: (format: InkPageExportFormat) => void;
  backgrounds: ReadonlyArray<{ value: InkBackground; label: string }>;
  setBackground: (background: InkBackground) => void;
  isPdfPageBackground: (page: InkPage) => boolean;
  importing: boolean;
  pdfImporting: boolean;
  onImportImages: InkPadProps["onImportImages"];
  importImages: () => void;
  onImportPdf: InkPadProps["onImportPdf"];
  importPdf: () => void;
}

export function InkFooterDesktop({ doc, page, pageIndex, readOnly, pagesOpen, setPagesOpen, setPendingDeletePageId, closeSwatches, switchPage, addPage, savePageNote, clearPageNote, onExportPage, exportOpen, setExportOpen, runExportPage, backgrounds, setBackground, isPdfPageBackground, importing, pdfImporting, onImportImages, importImages, onImportPdf, importPdf }: InkFooterDesktopProps) {
  return (
        <div className="ink-footer">
          <div className="ink-pages">
            <button onClick={() => switchPage(-1)} disabled={pageIndex <= 0} aria-label="上一页"><ChevronLeft size={16} /></button>
            <span>第 {pageIndex + 1} / {doc.pages.length} 页</span>
            <button onClick={() => switchPage(1)} disabled={pageIndex >= doc.pages.length - 1} aria-label="下一页"><ChevronRight size={16} /></button>
            <button onClick={addPage} disabled={readOnly} aria-label="新建页"><Plus size={16} /></button>
            {/* 单一入口（261104 定稿）：「大纲」与「页面管理」合并成这一枚，打开右侧悬浮面板（缩略图 / 大纲） */}
            <button
              className={["ink-tool", pagesOpen ? "is-active" : ""].join(" ")}
              onClick={() => { setPagesOpen((open) => !open); setPendingDeletePageId(null); closeSwatches(); }}
              aria-label="页面"
              title="页面：缩略图 / 大纲"
              aria-expanded={pagesOpen}
            ><LayoutGrid size={16} /></button>
            {/* 页签 = 底栏独立入口（打标记 / 一句话说明 / 清除），不塞进页面面板（用户 261104 定稿） */}
            <InkPageTabButton
              page={page}
              pageNumber={pageIndex + 1}
              readOnly={readOnly}
              onSave={savePageNote}
              onClear={clearPageNote}
            />
          </div>
          <div className="ink-footer__right">
            {/* 只放一个按钮：点开再选格式（用户定稿：不要三个按钮占满工具条）；菜单本体在 InkExportMenu（桌面专用） */}
            {onExportPage && (
              <InkExportMenu
                open={exportOpen}
                onToggle={() => { setExportOpen((open) => !open); closeSwatches(); }}
                onPick={(format) => void runExportPage(format)}
              />
            )}
            <div className="ink-backgrounds">
              {backgrounds.map((item) => (
                <button key={item.value} className={page.background === item.value ? "is-active" : ""} onClick={() => setBackground(item.value)} disabled={readOnly || isPdfPageBackground(page)} title={isPdfPageBackground(page) ? "PDF 页已铺满整页，纸张不可见" : undefined}>{item.label}</button>
              ))}
            </div>
            {/* 背景来源：导入图片/PDF 都是「给本页加背景」，排在纸张后面（用户 261104 定稿） */}
            <InkBackgroundSourceButtons
              disabled={readOnly || importing || pdfImporting}
              onImportImages={onImportImages ? () => void importImages() : undefined}
              onImportPdf={onImportPdf ? () => void importPdf() : undefined}
            />
          </div>
        </div>
  );
}
