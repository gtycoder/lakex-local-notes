/**
 * 手写板画布（261112 R2-S10 阶段②：从 InkPad.tsx 原样搬出，纯搬移零行为变化）。
 *
 * 内容 = 纸张/底纹 + SVG 笔迹层 + 页内贴图/文字块 + 选中控件；指针状态机与保存管线仍归 InkPad（组合根），
 * 这里只收 props（不可变数据 + 回调），保持与抽出前逐字相同的 JSX。
 */
import { memo, type CSSProperties, type MutableRefObject, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent } from "react";
import type { InkBackgroundImage, InkPage, InkPoint, InkStroke } from "../../core/inkDoc.js";
import { InkImageRemoveButton, InkImageResizeHandle, InkSelectionRect } from "./InkImageSelection.js";
import { INK_TEXT_LINE_HEIGHT, hitTestPageText, inkTextBaselineOffset, inkTextHeight, wrapInkTextLines } from "./inkPageTexts.js";
import { InkPageTextEditor } from "./InkPageTextEditor.js";
import { InkPaper } from "./InkPaper.js";
import { InkTextSelectionControls } from "./InkTextSelectionControls.js";
import { inkStrokeStyle } from "./inkStrokeStyle.js";
import type { RenderedStrokePath } from "./inkRenderCache.js";

export interface InkCanvasProps {
  page: InkPage;
  pageIndex: number;
  readOnly: boolean;
  zoom: number;
  fitSize: { width: number; height: number } | null;
  stageRef: MutableRefObject<HTMLDivElement | null>;
  onStageTouchStart: (event: ReactTouchEvent<HTMLDivElement>) => void;
  onStageTouchEnd: (event: ReactTouchEvent<HTMLDivElement>) => void;
  clearStageSwipe: () => void;
  onPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => void;
  finishPointer: (event: ReactPointerEvent<SVGSVGElement>) => void;
  cancelPointer: (event: ReactPointerEvent<SVGSVGElement>) => void;
  textEditing: { id: string; draft: string; original: string } | null;
  setTextEditing: React.Dispatch<React.SetStateAction<{ id: string; draft: string; original: string } | null>>;
  selectedTextId: string | null;
  selectedImageId: string | null;
  renderedStrokes: RenderedStrokePath[];
  activeStroke: InkStroke | null;
  activePath: string | null;
  pointFromClient: (clientX: number, clientY: number, pointerType: string, pressure: number, rect: DOMRect, page: InkPage) => InkPoint;
  startTextEditing: (id: string) => void;
  commitPageText: () => void;
  startTextResize: (event: ReactPointerEvent<HTMLElement>, id: string) => void;
  bumpTextFontSize: (id: string, delta: number) => void;
  removeText: (id: string) => void;
  deleteSelectedImage: () => void;
  startImageResize: (event: ReactPointerEvent<HTMLElement>) => void;
}

/** 背景图片 → SVG preserveAspectRatio（contain 整图可见 / cover 裁切铺满 / stretch 拉伸）。 */
function backgroundImageAspect(image: InkBackgroundImage): string {
  if (image.fit === "cover") return "xMidYMid slice";
  if (image.fit === "stretch") return "none";
  return "xMidYMid meet";
}

/** 静态笔迹层：只在页面内容变化时重渲染；正在书写时不会 reconcile 全部历史路径。 */
const StaticStrokeLayer = memo(function StaticStrokeLayer({ strokes }: { strokes: RenderedStrokePath[] }) {
  return (
    <>
      {strokes.map((stroke) => {
        const style = inkStrokeStyle(stroke.highlighter ? "highlighter" : "pen");
        return (
          <path
            key={stroke.id}
            d={stroke.d}
            fill={stroke.color}
            opacity={style.opacity}
            style={style.blend ? { mixBlendMode: style.blend } : undefined}
          />
        );
      })}
    </>
  );
});

export function InkCanvas({ page, pageIndex, readOnly, zoom, fitSize, stageRef, onStageTouchStart, onStageTouchEnd, clearStageSwipe, onPointerDown, onPointerMove, finishPointer, cancelPointer, textEditing, setTextEditing, selectedTextId, selectedImageId, renderedStrokes, activeStroke, activePath, pointFromClient, startTextEditing, commitPageText, startTextResize, bumpTextFontSize, removeText, deleteSelectedImage, startImageResize }: InkCanvasProps) {
  return (
      <div
        className="ink-page-stage"
        ref={stageRef}
        onTouchStart={onStageTouchStart}
        onTouchEnd={onStageTouchEnd}
        onTouchCancel={clearStageSwipe}
      >
        <div
          className="ink-page-frame"
          data-background={page.background}
          style={fitSize ? ({ width: fitSize.width * zoom, height: fitSize.height * zoom } as CSSProperties) : undefined}
        >
          <svg
            className="ink-page-svg"
            viewBox={`0 0 ${page.width} ${page.height}`}
            preserveAspectRatio="xMidYMid meet"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={finishPointer}
            onPointerCancel={cancelPointer}
            onLostPointerCapture={cancelPointer}
            onDoubleClick={(event) => {
              if (!page || readOnly) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const point = pointFromClient(event.clientX, event.clientY, "mouse", 0.5, rect, page);
              const hitTextId = hitTestPageText(page, point);
              if (hitTextId) startTextEditing(hitTextId);
            }}
            aria-label={`手写板第 ${pageIndex + 1} 页`}
          >
            {/* 纸张底纹永远在最底层：纯矢量页直接可见；图片页在图片未铺满整页时从留白处透出
                （261103 十五批：此前「有图就不画底纹」⇒ 用户切网格/点阵毫无反应，图片页只能永远是白纸）。 */}
            <InkPaper width={page.width} height={page.height} background={page.background} />
            {/* v2 图片页：背景图按页面逻辑坐标铺在笔迹层下面 */}
            {page.backgroundImage ? (
              <image
                href={page.backgroundImage.url}
                x={0}
                y={0}
                width={page.width}
                height={page.height}
                preserveAspectRatio={backgroundImageAspect(page.backgroundImage)}
                opacity={page.backgroundImage.opacity ?? 1}
                pointerEvents="none"
              />
            ) : null}
            {/* v4 页内贴图：按页逻辑坐标画（rotation 绕自身中心）；笔迹永远在最上层 */}
            {(page.images ?? []).map((image) => (
              <image
                key={image.id}
                data-page-image={image.id}
                href={image.url}
                x={image.x}
                y={image.y}
                width={image.width}
                height={image.height}
                transform={image.rotation
                  ? `rotate(${image.rotation} ${image.x + image.width / 2} ${image.y + image.height / 2})`
                  : undefined}
              />
            ))}
            {/* v4 页内文字块：逐行 <tspan>（换行用 inkPageTexts 的同一份估算，导出与屏幕一致） */}
            {(page.texts ?? []).map((item) => {
              // 正在编辑的这一块由输入框接管（同一几何 = 不叠字、提交瞬间不跳）
              if (textEditing?.id === item.id) return null;
              const lines = wrapInkTextLines(item.text, item.width, item.fontSize);
              if (lines.length === 0) return null;
              const lineHeight = item.fontSize * INK_TEXT_LINE_HEIGHT;
              const anchor = item.align === "center" ? "middle" : item.align === "right" ? "end" : "start";
              const x = item.align === "center" ? item.x + item.width / 2 : item.align === "right" ? item.x + item.width : item.x;
              return (
                <text
                  key={item.id}
                  data-page-text={item.id}
                  x={x}
                  y={item.y + inkTextBaselineOffset(item.fontSize)}
                  fill={item.color}
                  fontSize={item.fontSize}
                  textAnchor={anchor}
                  xmlSpace="preserve"
                >
                  {lines.map((line, index) => (
                    <tspan key={index} x={x} dy={index === 0 ? 0 : lineHeight}>{line || " "}</tspan>
                  ))}
                </text>
              );
            })}
            {/* 选中的文字块才画虚线框（用户澄清：选中时出现，失去焦点就消失）；编辑中同一条框 = 输入区边界 */}
            {!readOnly && (selectedTextId || textEditing) && (page.texts ?? []).some((item) => item.id === (selectedTextId ?? textEditing?.id)) ? (() => {
              const item = (page.texts ?? []).find((entry) => entry.id === (selectedTextId ?? textEditing?.id))!;
              return <InkSelectionRect image={{ x: item.x, y: item.y, width: item.width, height: Math.max(item.fontSize * INK_TEXT_LINE_HEIGHT, inkTextHeight(item)) }} />;
            })() : null}
            {/* 选中贴图：虚线框（pointer-events:none，不挡画线；点图本身负责选中） */}
            {selectedImageId && (page.images ?? []).some((image) => image.id === selectedImageId) ? (
              <InkSelectionRect image={(page.images ?? []).find((image) => image.id === selectedImageId)!} />
            ) : null}
            <StaticStrokeLayer strokes={renderedStrokes} />
            {activeStroke && activePath && (
              <path
                d={activePath}
                fill={activeStroke.color}
                opacity={inkStrokeStyle(activeStroke.tool).opacity}
                style={inkStrokeStyle(activeStroke.tool).blend ? { mixBlendMode: inkStrokeStyle(activeStroke.tool).blend } : undefined}
              />
            )}
          </svg>
          {/* 选中贴图的删除按钮：HTML 浮层（在 SVG 之上，只有按钮接事件），避免抢画布 pointerdown */}
          {textEditing ? (() => {
            const item = (page.texts ?? []).find((entry) => entry.id === textEditing.id);
            if (!item) return null;
            const frameWidth = (fitSize?.width ?? page.width) * zoom;
            return (
              <InkPageTextEditor
                text={item}
                scale={frameWidth / page.width}
                value={textEditing.draft}
                onChange={(value) => setTextEditing((current) => (current ? { ...current, draft: value } : current))}
                onCommit={commitPageText}
                onCancel={() => setTextEditing(null)}
              />
            );
          })() : null}
          {!readOnly && selectedTextId && (page.texts ?? []).some((item) => item.id === selectedTextId) ? (() => {
            const item = (page.texts ?? []).find((entry) => entry.id === selectedTextId)!;
            return (
              <InkTextSelectionControls
                text={item}
                page={page}
                onResizeStart={(event) => startTextResize(event, item.id)}
                onBumpFontSize={(delta) => bumpTextFontSize(item.id, delta)}
                onRemove={() => removeText(item.id)}
              />
            );
          })() : null}
          {!readOnly && selectedImageId && (page.images ?? []).some((image) => image.id === selectedImageId) ? (
            <>
              <InkImageRemoveButton
                image={(page.images ?? []).find((image) => image.id === selectedImageId)!}
                page={page}
                onRemove={deleteSelectedImage}
              />
              <InkImageResizeHandle
                image={(page.images ?? []).find((image) => image.id === selectedImageId)!}
                page={page}
                onStart={startImageResize}
              />
            </>
          ) : null}
        </div>
      </div>
  );
}
