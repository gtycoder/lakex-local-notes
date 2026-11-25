/**
 * 移动端底部工具坞（底栏；261125 D-06 拆分：从 InkPad.tsx 原样搬出，纯搬移零行为变化）。
 *
 * 仅编辑态挂载（阅读态 InkPad 整块不渲染）：上排画笔工具（横向滚动，含颜色/笔宽/撤销重做），
 * 下排纸张 + 背景来源（背景图片 / 背景 PDF）；色板/笔宽/插入是坞上方的悬浮面板（点外部关闭，见 InkPad 外点收口）。
 * 跨端样式：只发共享 ink-* 类名（inkPad.shared.css 两端副本 + inkSharedCssParity 护栏），不发 mb-*。
 */
import type { Dispatch, SetStateAction } from "react";
import { Eraser, Highlighter, Pen, Redo2, SquarePlus, Sticker, Type, Undo2 } from "lucide-react";
import type { InkBackground, InkPage } from "../../core/inkDoc.js";
import { INK_STROKE_COLORS } from "./inkPalette.js";
import type { InkPadMode, InkPadProps } from "./InkPad";
import { BACKGROUNDS, isPdfPageBackground } from "./useInkPageNav.js";
import { InkBackgroundSourceButtons } from "./InkBackgroundSourceButtons.js";

export interface InkFooterMobileProps {
  insertOpen: boolean;
  setInsertOpen: Dispatch<SetStateAction<boolean>>;
  paletteOpen: boolean;
  setPaletteOpen: Dispatch<SetStateAction<boolean>>;
  widthsOpen: boolean;
  setWidthsOpen: Dispatch<SetStateAction<boolean>>;
  mode: InkPadMode;
  setMode: Dispatch<SetStateAction<InkPadMode>>;
  color: string;
  setColor: Dispatch<SetStateAction<string>>;
  setPenWidth: Dispatch<SetStateAction<number>>;
  setHighlighterWidth: Dispatch<SetStateAction<number>>;
  activeWidth: number;
  widthPresets: (mode: InkPadMode) => readonly number[];
  widthDotSize: (width: number, mode?: InkPadMode) => number;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  page: InkPage;
  setBackground: (background: InkBackground) => void;
  importing: boolean;
  pdfImporting: boolean;
  onImportImages: InkPadProps["onImportImages"];
  importImages: () => void;
  onImportPdf: InkPadProps["onImportPdf"];
  importPdf: () => void;
  insertPageText: () => void;
  insertPageImage: () => void;
  onInsertPageImage: InkPadProps["onInsertPageImage"];
}

export function InkFooterMobile({ insertOpen, setInsertOpen, paletteOpen, setPaletteOpen, widthsOpen, setWidthsOpen, mode, setMode, color, setColor, setPenWidth, setHighlighterWidth, activeWidth, widthPresets, widthDotSize, undo, redo, canUndo, canRedo, page, setBackground, importing, pdfImporting, onImportImages, importImages, onImportPdf, importPdf, insertPageText, insertPageImage, onInsertPageImage }: InkFooterMobileProps) {
  return (
        // 移动端底部工具坞（仅编辑态）：上排画笔工具（横向滚动，含颜色/笔宽/撤销重做），
        // 下排纸张 + 背景来源（背景图片 / 背景 PDF）。编辑态工作区胶囊已由工作区隐藏，工具坞贴底并自己接系统安全区。
        <div className="ink-footer" role="toolbar" aria-label="手写工具" data-overlay="dock">
          <div className="ink-toolbar" role="group" aria-label="画笔工具">
            {/* 插入（＋）放第一位：坞内悬浮菜单只放「文字 / 贴图」（背景图片 / 背景 PDF 已下沉到纸张行，261104 二十五批） */}
            {(onInsertPageImage || onImportImages || onImportPdf) && (
              <>
                <button
                  className={["ink-tool", insertOpen ? "is-active" : ""].join(" ")}
                  data-popover-trigger="insert"
                  onClick={() => { setInsertOpen((open) => !open); setPaletteOpen(false); setWidthsOpen(false); }}
                  aria-label="插入"
                  title="插入"
                  aria-expanded={insertOpen}
                ><SquarePlus size={18} /></button>
                <span className="ink-toolbar__sep" />
              </>
            )}
            <button className={["ink-tool", mode === "pen" ? "is-active" : ""].join(" ")} onClick={() => setMode("pen")} aria-label="画笔" title="画笔"><Pen size={18} /></button>
            <button className={["ink-tool", mode === "highlighter" ? "is-active" : ""].join(" ")} onClick={() => setMode("highlighter")} aria-label="高亮笔" title="高亮笔"><Highlighter size={18} /></button>
            <button className={["ink-tool", mode === "eraser" ? "is-active" : ""].join(" ")} onClick={() => setMode("eraser")} aria-label="整笔橡皮" title="整笔橡皮"><Eraser size={18} /></button>
            <span className="ink-toolbar__sep" />
            {/* 颜色/笔宽都收成「当前值按钮」（平板与手机一致，261102 晚点单）：点开坞上方悬浮面板 */}
            <button
              className={["ink-color", paletteOpen ? "is-active" : ""].join(" ")}
              data-popover-trigger="color"
              onClick={() => { setPaletteOpen((open) => !open); setWidthsOpen(false); setInsertOpen(false); }}
              aria-label="选择颜色"
              title="选择颜色"
              aria-expanded={paletteOpen}
            ><span style={{ backgroundColor: color }} /></button>
            <span className="ink-toolbar__sep" />
            <button
              className={["ink-width", widthsOpen ? "is-active" : ""].join(" ")}
              data-popover-trigger="width"
              onClick={() => { setWidthsOpen((open) => !open); setPaletteOpen(false); setInsertOpen(false); }}
              aria-label="选择笔宽"
              title="选择笔宽"
              aria-expanded={widthsOpen}
            ><span style={{ width: widthDotSize(activeWidth, mode), height: widthDotSize(activeWidth, mode) }} /></button>
            <span className="ink-toolbar__sep" />
            <button className="ink-tool" onClick={undo} aria-label="撤销" title="撤销" disabled={!canUndo}><Undo2 size={18} /></button>
            <button className="ink-tool" onClick={redo} aria-label="重做" title="重做" disabled={!canRedo}><Redo2 size={18} /></button>
          </div>
          <div className="ink-backgrounds" role="group" aria-label="纸张">
            {BACKGROUNDS.map((item) => (
              <button key={item.value} className={page.background === item.value ? "is-active" : ""} onClick={() => setBackground(item.value)} disabled={isPdfPageBackground(page)}>{item.label}</button>
            ))}
            {/* 背景来源与纸张同一行：导入图片 / 导入 PDF 都是「给本页加背景」（261104 用户定稿：不要塞进 ＋ 菜单） */}
            <InkBackgroundSourceButtons
              disabled={importing || pdfImporting}
              onImportImages={onImportImages ? () => void importImages() : undefined}
              onImportPdf={onImportPdf ? () => void importPdf() : undefined}
            />
          </div>
          {paletteOpen && (
            <div role="group" aria-label="选择颜色" data-overlay="palette">
              {INK_STROKE_COLORS.map((value) => (
                <button
                  key={value}
                  className={["ink-color", color === value ? "is-active" : ""].join(" ")}
                  onClick={() => { setColor(value); if (mode === "eraser") setMode("pen"); setPaletteOpen(false); }}
                  aria-label={`颜色 ${value}`}
                  title={`颜色 ${value}`}
                ><span style={{ backgroundColor: value }} /></button>
              ))}
            </div>
          )}
          {widthsOpen && (
            <div role="group" aria-label="选择笔宽" data-overlay="widths">
              {widthPresets(mode).map((value) => (
                <button
                  key={value}
                  className={["ink-width", activeWidth === value ? "is-active" : ""].join(" ")}
                  onClick={() => { if (mode === "highlighter") setHighlighterWidth(value); else setPenWidth(value); setWidthsOpen(false); }}
                  aria-label={`笔宽 ${value}`}
                  title={`笔宽 ${value}`}
                ><span style={{ width: widthDotSize(value, mode), height: widthDotSize(value, mode) }} /></button>
              ))}
            </div>
          )}
          {insertOpen && (
            <div role="group" aria-label="插入" data-overlay="insert">
              <button
                className="ink-tool"
                onClick={() => { setInsertOpen(false); insertPageText(); }}
                aria-label="插入文字"
                title="插入文字块（双击编辑）"
              ><Type size={18} /><span>文字</span></button>
              {onInsertPageImage && (
                <button
                  className="ink-tool"
                  onClick={() => { setInsertOpen(false); void insertPageImage(); }}
                  aria-label="插入贴图"
                  title="插入贴图（贴在当前页，可拖动/缩放）"
                ><Sticker size={18} /><span>贴图</span></button>
              )}
            </div>
          )}
        </div>
  );
}
