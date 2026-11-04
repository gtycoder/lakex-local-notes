/**
 * 移动端表格「手写签名」浮层（261104，仅移动端）。
 *
 * 入口 = 插入面板「手写签名」；产物 = 裁到笔迹包围盒（留少量 padding）的**透明 PNG**，
 * 由宿主走与「单元格图片」同一条链路：bridge.uploadResource → insertCellImageAsync → 现有 onChange 自动保存。
 *
 * 为什么单独一层：
 * - 透明背景不能靠「白底整图」：单元格背景可能是主题色/填充色，白底会把整格盖掉；
 *   ⇒ canvas 只画笔迹，导出时按笔迹 bbox + padding 裁剪（signatureInkBounds 单一判据）。
 * - 触摸手写必须 touch-action:none + pointer events；笔画出界仍要连续 ⇒ 叶子 canvas 上用
 *   setPointerCapture（AGENTS §7#20 说的是容器级手势别捕获，这里是叶子画布，不承载子按钮）。
 * - 底部 Sheet 必须 dismissible=false：右滑关闭会和横向笔画冲突；关闭走「取消」/安卓返回键。
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Trash2, Undo2 } from "lucide-react";
import { MobileSheet } from "../ui/MobileSheet";
import { pushBackHandler } from "../ui/backStack";
import { showToast } from "../ui/toastBus";

/** 笔迹颜色兜底（正常走 canvas 上 color 的计算值 ⇒ 跟随浅/深色主题）。 */
const FALLBACK_INK = "#1f2329";
const INK_WIDTH = 2.4;
/** 导出裁剪在笔迹包围盒外留的 padding（CSS px）。 */
const INK_PADDING = 12;
const MAX_DPR = 3;

export interface SignaturePoint {
  x: number;
  y: number;
}

export interface SignatureBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 笔迹包围盒 + padding，并夹在画布内；没有有效笔迹时返回 null。
 * 单一判据：导出裁剪与「确认」可用态都读它，避免两处各算一套边界。
 */
export function signatureInkBounds(
  points: readonly SignaturePoint[],
  width: number,
  height: number,
  padding = INK_PADDING,
): SignatureBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  const left = Math.max(0, Math.floor(minX - padding));
  const top = Math.max(0, Math.floor(minY - padding));
  const right = Math.min(width, Math.ceil(maxX + padding));
  const bottom = Math.min(height, Math.ceil(maxY + padding));
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}

function inkColor(canvas: HTMLCanvasElement): string {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return FALLBACK_INK;
  const color = window.getComputedStyle(canvas).color;
  if (!color || color === "transparent" || color === "rgba(0, 0, 0, 0)") return FALLBACK_INK;
  return color;
}

function drawStroke(ctx: CanvasRenderingContext2D, points: readonly SignaturePoint[]): void {
  if (points.length === 0) return;
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, INK_WIDTH / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

/** 把画布按 bounds 裁成透明 PNG；裁剪用 device px（CSS px × dpr），不放大不缩水。 */
function canvasToPng(
  canvas: HTMLCanvasElement,
  bounds: SignatureBounds,
  dpr: number,
): Promise<Uint8Array | null> {
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(bounds.width * dpr));
  out.height = Math.max(1, Math.round(bounds.height * dpr));
  const ctx = out.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(
    canvas,
    Math.round(bounds.left * dpr),
    Math.round(bounds.top * dpr),
    Math.max(1, Math.round(bounds.width * dpr)),
    Math.max(1, Math.round(bounds.height * dpr)),
    0,
    0,
    out.width,
    out.height,
  );
  if (typeof out.toBlob !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    out.toBlob((blob) => {
      if (!blob) {
        resolve(null);
        return;
      }
      void blob
        .arrayBuffer()
        .then((buffer) => resolve(new Uint8Array(buffer)))
        .catch(() => resolve(null));
    }, "image/png");
  });
}

export interface MobileSignaturePadProps {
  open: boolean;
  /** 宿主正在上传/写单元格：禁用画布与所有动作。 */
  busy?: boolean;
  /** 取消（未插入任何内容）。 */
  onCancel: () => void;
  /** 确认：返回裁好的透明 PNG 字节；上传与写单元格由宿主负责。 */
  onConfirm: (png: Uint8Array) => void | Promise<void>;
}

export function MobileSignaturePad({ open, busy = false, onCancel, onConfirm }: MobileSignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<SignaturePoint[][]>([]);
  const activeRef = useRef<{ pointerId: number; points: SignaturePoint[] } | null>(null);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  /** 笔迹条数：只用来驱动「撤销/清空/确认」的可用态（不参与导出）。 */
  const [strokeCount, setStrokeCount] = useState(0);
  const [exporting, setExporting] = useState(false);
  /** 同步锁：确认是异步导出 + 上传，同一次点击在 state 落盘前连点两次会重复插入。 */
  const confirmingRef = useRef(false);

  const drawAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height, dpr } = sizeRef.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (width <= 0 || height <= 0) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = INK_WIDTH;
    const color = inkColor(canvas);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    const strokes = activeRef.current ? [...strokesRef.current, activeRef.current.points] : strokesRef.current;
    for (const stroke of strokes) drawStroke(ctx, stroke);
  }, []);

  /** 量一次画布尺寸（含 dpr）；尺寸没变时不重设，避免无谓清屏。 */
  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(0, Math.round(rect.width));
    const height = Math.max(0, Math.round(rect.height));
    if (width < 1 || height < 1) return;
    const dpr = Math.max(1, Math.min(MAX_DPR, window.devicePixelRatio || 1));
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    sizeRef.current = { width, height, dpr };
    drawAll();
  }, [drawAll]);

  // 打开 = 新的一张签名：清空笔迹、量画布、跟随视口/键盘变化重排。
  useEffect(() => {
    if (!open) return;
    strokesRef.current = [];
    activeRef.current = null;
    setStrokeCount(0);
    setExporting(false);
    const raf = window.requestAnimationFrame(() => setupCanvas());
    const onResize = () => setupCanvas();
    window.addEventListener("resize", onResize, { passive: true });
    window.visualViewport?.addEventListener("resize", onResize, { passive: true });
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [open, setupCanvas]);

  // 返回键 = 取消（Sheet dismissible=false 不会注册自己的返回处理器）。
  useEffect(() => {
    if (!open) return;
    return pushBackHandler(() => {
      onCancel();
      return true;
    });
  }, [open, onCancel]);

  const pointOf = (event: ReactPointerEvent<HTMLCanvasElement>): SignaturePoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (busy || exporting) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 捕获不可用（老 WebView/测试环境）时笔画仍可画，只是出界后会断线。
    }
    activeRef.current = { pointerId: event.pointerId, points: [pointOf(event)] };
    drawAll();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const active = activeRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    active.points.push(pointOf(event));
    drawAll();
  };

  const finishStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const active = activeRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    activeRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // 与捕获失败同口径：不影响已画好的笔迹。
    }
    strokesRef.current = [...strokesRef.current, active.points];
    setStrokeCount(strokesRef.current.length);
    drawAll();
  };

  const undo = () => {
    if (busy || exporting || strokesRef.current.length === 0) return;
    strokesRef.current = strokesRef.current.slice(0, -1);
    setStrokeCount(strokesRef.current.length);
    drawAll();
  };

  const clear = () => {
    if (busy || exporting || strokesRef.current.length === 0) return;
    strokesRef.current = [];
    setStrokeCount(0);
    drawAll();
  };

  const confirm = async () => {
    if (busy || exporting || confirmingRef.current || strokesRef.current.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = signatureInkBounds(strokesRef.current.flat(), sizeRef.current.width, sizeRef.current.height);
    if (!bounds) {
      showToast("签名内容为空，请先手写", { type: "error" });
      return;
    }
    confirmingRef.current = true;
    setExporting(true);
    try {
      const png = await canvasToPng(canvas, bounds, sizeRef.current.dpr);
      if (!png || png.length === 0) {
        showToast("签名导出失败，请重试", { type: "error" });
        return;
      }
      await onConfirm(png);
    } catch (error) {
      console.warn("[mobile-usheet] 手写签名导出失败", error);
      showToast("签名导出失败，请重试", { type: "error" });
    } finally {
      confirmingRef.current = false;
      setExporting(false);
    }
  };

  const pending = busy || exporting;
  const hasInk = strokeCount > 0;

  return (
    <MobileSheet
      open={open}
      title="手写签名"
      dismissible={false}
      onClose={onCancel}
      className="mb-usheet-sign-sheet"
      bodyClassName="mb-usheet-sign"
      footer={
        <div className="mb-sheet__foot mb-usheet-sign__foot">
          <button type="button" className="mb-btn mb-btn--secondary" onClick={onCancel} disabled={pending}>
            取消
          </button>
          <button
            type="button"
            className="mb-btn mb-btn--primary"
            onClick={() => void confirm()}
            disabled={!hasInk || pending}
          >
            {pending ? "插入中…" : "确认"}
          </button>
        </div>
      }
    >
      <div className="mb-usheet-sign__stage">
        <canvas
          ref={canvasRef}
          className="mb-usheet-sign__canvas"
          aria-label="签名画布"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
        />
        {!hasInk && <span className="mb-usheet-sign__hint">在此处手写签名</span>}
      </div>
      <div className="mb-usheet-sign__tools">
        <button
          type="button"
          className="mb-btn mb-btn--secondary mb-btn--sm"
          onClick={undo}
          disabled={!hasInk || pending}
        >
          <Undo2 size={18} aria-hidden="true" />
          撤销
        </button>
        <button
          type="button"
          className="mb-btn mb-btn--secondary mb-btn--sm"
          onClick={clear}
          disabled={!hasInk || pending}
        >
          <Trash2 size={18} aria-hidden="true" />
          清空
        </button>
      </div>
    </MobileSheet>
  );
}

export default MobileSignaturePad;
