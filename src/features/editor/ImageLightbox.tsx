/**
 * 图片放大预览 Lightbox（共享组件：桌面 + 移动端复用）。
 * - 订阅 imagePreview 控制器，有状态才渲染（portal 到 body）。
 * - 交互：滚轮缩放（以光标为中心）、拖拽平移（缩放 >1 时）、←/→ 画廊切换、
 *   Esc / 点击背景 / 关闭按钮退出；右上角缩放与重置按钮。
 * - 图片用 <img src> 直接渲染（桌面/移动端统一 canonical URL）。
 * - 原图档位（用户裁决 Q02）：调用方可以给原图 src（PreviewImage.originalSrc）。打开时**先渲染
 *   档位图**（通常已在列表缓存里，首帧即出），在隐藏的 Image 里预加载原图，加载完成再替换 ——
 *   既不白屏、也不让用户停在糊图；原图失败（权限/文件缺失/网络）保持档位图，不报错。
 *   只传 src 的旧调用点行为完全不变。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { lockPageScroll } from "../../lib/pageScrollLock";
import { dismissImmersivePreview } from "../../lib/immersivePreview";
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
  /** 已预加载完成的原图（按画廊索引记录）：就绪后替换档位图，切换图片/关闭即失效。 */
  const [originalReady, setOriginalReady] = useState<{ index: number; src: string } | null>(null);

  useEffect(() => subscribeImagePreview((s) => {
    setState(s);
    setScale(1);
    setPan({ x: 0, y: 0 });
  }), []);

  const resetView = useCallback(() => { setScale(1); setPan({ x: 0, y: 0 }); }, []);

  // 原图档位（Q02）：档位图先上屏，原图在后台预加载，完成后再替换。
  // 不阻塞打开、失败静默保持档位图；切换画廊时用 index 对齐，避免把上一张的原图错配到当前张。
  useEffect(() => {
    if (!state) return;
    const { index, images } = state;
    const image = images[index];
    const original = typeof image?.originalSrc === "string" ? image.originalSrc : "";
    if (!original || original === image.src) return;
    let alive = true;
    const preload = new Image();
    preload.onload = () => { if (alive) setOriginalReady({ index, src: original }); };
    preload.onerror = () => { /* 原图取不到（权限/文件缺失/弱网）：保持档位图，不打扰用户 */ };
    preload.src = original;
    return () => {
      alive = false;
      preload.onload = null;
      preload.onerror = null;
    };
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissImmersivePreview()) { e.preventDefault(); e.stopImmediatePropagation(); }
      else if (e.key === "ArrowLeft") navigateImagePreview(-1);
      else if (e.key === "ArrowRight") navigateImagePreview(1);
      else if (e.key === "=" || e.key === "+") setScale((s) => Math.min(MAX_SCALE, s * 1.25));
      else if (e.key === "-") setScale((s) => Math.max(MIN_SCALE, s / 1.25));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [state]);

  useEffect(() => {
    if (!state) return;
    return lockPageScroll();
  }, [state]);

  if (!state) return null;
  const image = state.images[state.index];
  /** 当前展示的 src：原图就绪且索引仍是当前张 ⇒ 用原图，否则用调用方给的档位图。 */
  const shownSrc = originalReady && originalReady.index === state.index ? originalReady.src : image.src;

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
        <img src={shownSrc} alt="" draggable={false} style={imgStyle}
          onClick={() => { if (scale > 1) resetView(); }} />
      </div>
      <div className="image-lightbox__toolbar">
        <button className="image-lightbox__btn" onClick={() => navigateImagePreview(-1)} disabled={state.index <= 0} aria-label="上一张"><ChevronLeft size={20} /></button>
        <span className="image-lightbox__count">{state.index + 1} / {state.images.length}</span>
        <button className="image-lightbox__btn" onClick={() => navigateImagePreview(1)} disabled={state.index >= state.images.length - 1} aria-label="下一张"><ChevronRight size={20} /></button>
        <span className="image-lightbox__divider" />
        <button className="image-lightbox__btn" onClick={() => setScale((s) => Math.min(MAX_SCALE, s * 1.25))} aria-label="放大"><Plus size={18} /></button>
        <button className="image-lightbox__btn" onClick={() => setScale((s) => Math.max(MIN_SCALE, s / 1.25))} aria-label="缩小"><Minus size={18} /></button>
        <button className="image-lightbox__btn" onClick={resetView} aria-label="重置"><Maximize2 size={16} /></button>
        <span className="image-lightbox__divider" />
        <button className="image-lightbox__btn image-lightbox__close" onClick={closeImagePreview} aria-label="关闭"><X size={20} /></button>
      </div>
    </div>,
    document.body,
  );
}
