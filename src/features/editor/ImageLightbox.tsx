/**
 * 图片放大预览 Lightbox（共享组件：桌面 + 移动端复用）。
 * - 订阅 imagePreview 控制器，有状态才渲染（portal 到 body）。
 * - 交互：滚轮缩放（以光标为中心）、拖拽平移（缩放 >1 时）、←/→ 画廊切换、
 *   Esc / 点击背景 / 关闭按钮退出；右上角缩放与重置按钮。
 * - 图片用 <img src> 直接渲染（桌面 canonical URL / 移动端 blob URL 均可）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Maximize2, Minus, Plus, X } from "lucide-react";
import { closeImagePreview, navigateImagePreview, subscribeImagePreview, type ImagePreviewState } from "./imagePreview";

const MIN_SCALE = 0.25;
const MAX_SCALE = 8;

export function ImageLightbox() {
  const [state, setState] = useState<ImagePreviewState | null>(null);
  // 缩放/平移（每次切换图片或打开时重置）
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number; moved: boolean } | null>(null);
  const wheelLockRef = useRef(false);

  useEffect(() => subscribeImagePreview((s) => {
    setState(s);
    setScale(1);
    setPan({ x: 0, y: 0 });
  }), []);

  const resetView = useCallback(() => { setScale(1); setPan({ x: 0, y: 0 }); }, []);

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeImagePreview();
      else if (e.key === "ArrowLeft") navigateImagePreview(-1);
      else if (e.key === "ArrowRight") navigateImagePreview(1);
      else if (e.key === "=" || e.key === "+") setScale((s) => Math.min(MAX_SCALE, s * 1.25));
      else if (e.key === "-") setScale((s) => Math.max(MIN_SCALE, s / 1.25));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);

  useEffect(() => {
    if (!state) return;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [state]);

  if (!state) return null;
  const image = state.images[state.index];

  const onWheel = (e: React.WheelEvent) => {
    if (wheelLockRef.current) return;
    wheelLockRef.current = true;
    setTimeout(() => { wheelLockRef.current = false; }, 40);
    // 以光标为缩放中心：先按比例平移再缩放（保持光标下像素不动）
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left - rect.width / 2) / rect.width;
    const py = (e.clientY - rect.top - rect.height / 2) / rect.height;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setScale((prev) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * factor));
      setPan((p) => ({ x: p.x - px * rect.width * (next - prev), y: p.y - py * rect.height * (next - prev) }));
      return next;
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (scale <= 1) return; // 未缩放不拖拽
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y, moved: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
    setPan({ x: d.panX + dx, y: d.panY + dy });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.moved) e.stopPropagation(); // 拖拽过不触发背景关闭
  };

  const imgStyle: React.CSSProperties = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
    transition: scale > 1 ? "none" : "transform .18s ease",
    maxWidth: "92vw",
    maxHeight: "88vh",
    objectFit: "contain",
    cursor: scale > 1 ? "grab" : "zoom-out",
    userSelect: "none",
  };

  return createPortal(
    <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="图片预览"
      onClick={(e) => {
        // 点击非图片/非工具栏位置 → 关闭预览（模糊背景区域即关闭热区）
        const t = e.target as HTMLElement | null;
        if (!t || typeof t.closest !== "function") return;
        if (t.closest(".image-lightbox__toolbar") || t.closest("img")) return;
        closeImagePreview();
      }}
      onWheel={onWheel}>
      <div className="image-lightbox__stage" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <img src={image.src} alt="" draggable={false} style={imgStyle}
          onClick={() => { if (scale > 1) resetView(); }} />
      </div>
      <div className="image-lightbox__toolbar">
        <button className="image-lightbox__btn" onClick={() => navigateImagePreview(-1)} disabled={state.index <= 0} aria-label="上一张"><ChevronLeft size={20} /></button>
        <span className="image-lightbox__count">{state.index + 1} / {state.images.length}</span>
        <button className="image-lightbox__btn" onClick={() => navigateImagePreview(1)} disabled={state.index >= state.images.length - 1} aria-label="下一张"><ChevronRight size={20} /></button>
        <span className="image-lightbox__divider" />
        <button className="image-lightbox__btn" onClick={() => setScale((s) => Math.min(MAX_SCALE, s * 1.25))} aria-label="放大"><Plus size={18} /></button>
        <button className="image-lightbox__btn" onClick={() => setScale((s) => Math.max(MIN_SCALE, s / 1.25))} aria-label="缩小"><Minus size={18} /></button>
        <button className="image-lightbox__btn" onClick={resetView} aria-label="重置"><Maximize2 size={17} /></button>
        <span className="image-lightbox__divider" />
        <button className="image-lightbox__btn image-lightbox__close" onClick={closeImagePreview} aria-label="关闭"><X size={20} /></button>
      </div>
    </div>,
    document.body,
  );
}
