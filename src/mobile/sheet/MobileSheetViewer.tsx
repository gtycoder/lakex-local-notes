/**
 * 移动端表格只读视图（kind=sheet）。
 *
 * 桌面编辑态是 FortuneSheet（canvas/DOM 重型内核，没进移动端分包）。移动端只需要「看得见」：
 * 这里用**共享 core 的同一份正文模型**（`parseSheetBody`：FortuneSheet v2 的 sparse `celldata`）画一张只读网格 ——
 * 显示值 / 粗斜体 / 字色底色 / 对齐 / 合并单元格 / 行列号，横向纵向滚动 + 表头吸顶。
 * 公式只显示已存的显示值（不求值）、单元格图片与条件格式不渲染（属「完整版」范围，见 HANDOFF §2.14 待办）。
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { parseSheetBody, sheetImageSrc, sheetImages, type SheetCell, type SheetWorksheet } from "../../core/sheetDoc.js";

/** 只读预览渲染上限：手机屏幕看不清更多，也能避免超大表把 DOM 撑爆。 */
const MAX_ROWS = 500;
const MAX_COLS = 60;
/** 网格原点兜底偏移（行号列宽 / 表头行高）：首帧尚未量到实测值时先用它，量到后以实测为准。 */
const FALLBACK_ORIGIN = { x: 44, y: 30 };

function columnLabel(index: number): string {
  let label = "";
  let value = index;
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

interface RenderedCell {
  text: string;
  style: Record<string, string>;
  rowSpan?: number;
  colSpan?: number;
  /** 被合并区域覆盖、无需渲染的格子 */
  hidden?: boolean;
}

interface SheetGrid {
  rows: number;
  cols: number;
  cells: Map<string, RenderedCell>;
  truncated: boolean;
}

function buildGrid(sheet: SheetWorksheet): SheetGrid {
  const source = (sheet.celldata ?? []).filter(
    (cell): cell is SheetCell => !!cell && Number.isFinite(cell.r) && Number.isFinite(cell.c),
  );
  const cells = new Map<string, RenderedCell>();
  let rows = 0;
  let cols = 0;
  const spans: Array<{ r: number; c: number; rs: number; cs: number }> = [];

  for (const cell of source) {
    const value = cell.v ?? null;
    const raw = value?.m ?? value?.v;
    const text = raw == null ? "" : String(raw);
    const style: Record<string, string> = {};
    const fc = value?.fc;
    const bg = value?.bg;
    if (typeof fc === "string" && fc) style.color = fc;
    if (typeof bg === "string" && bg && bg !== "rgb(255, 255, 255)") style.background = bg;
    if (value?.bl) style.fontWeight = "600";
    if (value?.it) style.fontStyle = "italic";
    if (typeof value?.ht === "string" && value.ht) {
      style.textAlign = value.ht === "center" ? "center" : value.ht === "right" ? "right" : "left";
    }
    const merge = value?.mc as { r?: number; c?: number; rs?: number; cs?: number } | undefined;
    const entry: RenderedCell = { text, style };
    if (merge && Number.isFinite(merge.rs) && Number.isFinite(merge.cs)) {
      const rs = Math.max(1, Number(merge.rs));
      const cs = Math.max(1, Number(merge.cs));
      if (rs > 1 || cs > 1) {
        entry.rowSpan = rs;
        entry.colSpan = cs;
        spans.push({ r: cell.r, c: cell.c, rs, cs });
      }
    }
    cells.set(`${cell.r}:${cell.c}`, entry);
    rows = Math.max(rows, cell.r + (entry.rowSpan ?? 1));
    cols = Math.max(cols, cell.c + (entry.colSpan ?? 1));
  }
  // 合并区域内的其它格子不渲染（与表格语义一致）
  for (const span of spans) {
    for (let r = span.r; r < span.r + span.rs; r++) {
      for (let c = span.c; c < span.c + span.cs; c++) {
        if (r === span.r && c === span.c) continue;
        const key = `${r}:${c}`;
        const cell = cells.get(key);
        if (cell) cell.hidden = true;
        else cells.set(key, { text: "", style: {}, hidden: true });
      }
    }
  }
  const truncated = rows > MAX_ROWS || cols > MAX_COLS;
  return { rows: Math.min(rows, MAX_ROWS), cols: Math.min(cols, MAX_COLS), cells, truncated };
}

export interface MobileSheetViewerProps {
  noteId: string;
  content: string;
}

export function MobileSheetViewer({ noteId, content }: MobileSheetViewerProps) {
  const doc = useMemo(() => parseSheetBody(content), [content]);
  const [activeIndex, setActiveIndex] = useState(0);
  const sheet = doc?.sheets[activeIndex] ?? doc?.sheets[0];
  const grid = useMemo(() => (sheet ? buildGrid(sheet) : null), [sheet]);
  const images = useMemo(
    () => (sheet ? sheetImages(sheet)
      .map((image) => ({ ...image, url: sheetImageSrc(image.src, noteId) }))
      .filter((image): image is typeof image & { url: string } => !!image.url) : []),
    [sheet, noteId],
  );
  /** 网格内容原点（A1 左上角相对画布容器）：图片坐标是「相对网格内容原点」的像素，必须按实测偏移。 */
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [gridOrigin, setGridOrigin] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => {
      const a1 = canvas.querySelector<HTMLElement>(".mst-grid tbody tr td");
      if (!a1) return;
      const canvasBox = canvas.getBoundingClientRect();
      const a1Box = a1.getBoundingClientRect();
      const next = { x: Math.round(a1Box.left - canvasBox.left), y: Math.round(a1Box.top - canvasBox.top) };
      setGridOrigin((prev) => (prev && prev.x === next.x && prev.y === next.y ? prev : next));
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(canvas);
    return () => observer?.disconnect();
  }, [sheet, grid]);
  const origin = gridOrigin ?? FALLBACK_ORIGIN;

  if (!doc || !sheet || !grid) {
    return <div className="mobile-empty">这张表格还没有工作表。</div>;
  }

  const rowIndexes = Array.from({ length: grid.rows }, (_, index) => index);
  const colIndexes = Array.from({ length: grid.cols }, (_, index) => index);
  /** 有图但数据为空/不覆盖图片位置时，按图片范围撑开画布（只读预览只求"看得见图"）。 */
  const imageExtent = images.reduce(
    (acc, image) => ({ width: Math.max(acc.width, image.left + image.width), height: Math.max(acc.height, image.top + image.height) }),
    { width: 0, height: 0 },
  );
  const hasImages = images.length > 0;

  return (
    <div className="mobile-sheet" data-mobile-sheet>
      {doc.sheets.length > 1 && (
        <div className="mst-sheets" role="tablist" aria-label="工作表">
          {doc.sheets.map((item, index) => (
            <button
              key={item.id ?? item.name}
              type="button"
              role="tab"
              className={"mst-sheet-tab" + (index === activeIndex ? " is-active" : "")}
              aria-selected={index === activeIndex}
              onClick={() => setActiveIndex(index)}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}
      <div className="mst-meta">
        <span>{sheet.name}</span>
        <span className="mst-meta-sep">·</span>
        <span>{grid.rows} 行 × {grid.cols} 列</span>
        <span className="mst-readonly">只读</span>
      </div>
      <div className="mst-wrap">
        <div
          ref={canvasRef}
          className="mst-canvas"
          style={hasImages
            ? { minWidth: origin.x + imageExtent.width, minHeight: origin.y + imageExtent.height }
            : undefined}
        >
          <table className="mst-grid">
            <thead>
              <tr>
                <th className="mst-corner" aria-hidden="true" />
                {colIndexes.map((col) => (
                  <th key={col} className="mst-col-head">{columnLabel(col)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowIndexes.map((row) => (
                <tr key={row}>
                  <th className="mst-row-head" scope="row">{row + 1}</th>
                  {colIndexes.map((col) => {
                    const cell = grid.cells.get(`${row}:${col}`);
                    if (cell?.hidden) return null;
                    return (
                      <td
                        key={col}
                        style={cell?.style}
                        rowSpan={cell?.rowSpan}
                        colSpan={cell?.colSpan}
                      >
                        {cell?.text ?? ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {/* 浮动图叠层：图片几何是"相对网格内容原点"的像素 ⇒ 偏移掉行号列宽与表头行高即可对齐单元格。 */}
          {hasImages && (
            <div className="mst-image-layer" aria-hidden="true">
              {images.map((image) => (
                <img
                  key={image.id}
                  className="mst-image"
                  src={image.url}
                  alt=""
                  loading="lazy"
                  style={{
                    left: origin.x + image.left,
                    top: origin.y + image.top,
                    width: image.width,
                    height: image.height,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      {grid.truncated && (
        <div className="mst-truncated">只读预览仅显示前 {MAX_ROWS} 行 / {MAX_COLS} 列，完整表格请在桌面端查看。</div>
      )}
    </div>
  );
}

export default MobileSheetViewer;
