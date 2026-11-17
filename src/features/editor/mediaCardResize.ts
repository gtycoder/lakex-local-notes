import {
  previewImageWidth,
  readImageResizeState,
  restoreImageWidthPreview,
  writeImageDisplayWidth,
} from "./selectionToolbar/imageCardOps";
import { applyVideoLayout, readVideoLayout, writeVideoLayout } from "./videoCardOps";

const MEDIA_CARD_SELECTOR = 'ne-card[data-card-name="video"], ne-card[data-card-name="image"]';
const HANDLE_CLASS = "lake-media-resize-handle";
const HANDLE_SELECTOR = "." + HANDLE_CLASS;
type ResizeSide = "left" | "right";

interface ResizeState { value: number; min: number; max: number; step: number; label: string; }
interface ResizeAdapter {
  mediaName: "视频" | "图片";
  sides: readonly ResizeSide[];
  pointerFactor: number;
  ready(cardEl: HTMLElement): boolean;
  read(cardEl: HTMLElement): ResizeState | null;
  valuePerPixel(cardEl: HTMLElement, state: ResizeState): number;
  preview(cardEl: HTMLElement, value: number): void;
  commit(cardEl: HTMLElement, value: number): boolean;
  snapshot(cardEl: HTMLElement): unknown;
  restore(cardEl: HTMLElement, snapshot: unknown, startValue: number): void;
}

function clearVideoPreview(cardEl: HTMLElement): void {
  cardEl.style.removeProperty("transform");
  cardEl.style.removeProperty("transform-origin");
  cardEl.style.removeProperty("will-change");
  cardEl.querySelectorAll<HTMLElement>(HANDLE_SELECTOR).forEach((handle) => handle.style.removeProperty("transform"));
}

function previewVideoResize(cardEl: HTMLElement, value: number): void {
  const current = readVideoLayout(cardEl);
  const scale = Math.max(0.1, value / Math.max(current.widthPercent, 1));
  cardEl.style.transform = `scale(${scale})`;
  cardEl.style.transformOrigin = current.alignment === "right" ? "right center" : current.alignment === "center" ? "center center" : "left center";
  cardEl.style.willChange = "transform";
  cardEl.querySelectorAll<HTMLElement>(HANDLE_SELECTOR).forEach((handle) => {
    handle.style.transform = `scale(${1 / scale})`;
  });
}

const VIDEO_ADAPTER: ResizeAdapter = {
  mediaName: "视频",
  sides: ["left", "right"],
  pointerFactor: 2,
  ready: (cardEl) => Boolean(cardEl.querySelector(".ne-card-video-done")),
  read: (cardEl) => {
    const layout = readVideoLayout(cardEl);
    return { value: layout.widthPercent, min: 10, max: 100, step: 5, label: `正文宽度 ${layout.widthPercent}%` };
  },
  valuePerPixel: (cardEl, state) => {
    const width = cardEl.getBoundingClientRect().width;
    return width > 0 ? state.value / width : 0.2;
  },
  preview: previewVideoResize,
  commit: (cardEl, value) => {
    const result = writeVideoLayout(cardEl, { widthPercent: value });
    clearVideoPreview(cardEl);
    return result;
  },
  snapshot: () => null,
  restore: (cardEl, _snapshot, startValue) => {
    clearVideoPreview(cardEl);
    applyVideoLayout(cardEl, { ...readVideoLayout(cardEl), widthPercent: startValue });
  },
};

const IMAGE_ADAPTER: ResizeAdapter = {
  mediaName: "图片",
  sides: ["right"],
  pointerFactor: 1,
  ready: (cardEl) => Boolean(cardEl.querySelector("img")),
  read: (cardEl) => {
    const state = readImageResizeState(cardEl);
    return state ? { ...state, value: state.width, label: `${state.width} px` } : null;
  },
  valuePerPixel: (cardEl, state) => {
    const width = cardEl.getBoundingClientRect().width;
    return width > 0 ? state.value / width : 1;
  },
  preview: previewImageWidth,
  commit: writeImageDisplayWidth,
  snapshot: (cardEl) => cardEl.querySelector("img")?.getAttribute("style") ?? null,
  restore: (cardEl, snapshot) => restoreImageWidthPreview(cardEl, typeof snapshot === "string" ? snapshot : null),
};

function adapterFor(cardEl: HTMLElement): ResizeAdapter | null {
  const name = cardEl.getAttribute("data-card-name");
  return name === "video" ? VIDEO_ADAPTER : name === "image" ? IMAGE_ADAPTER : null;
}

function normalized(state: ResizeState, value: number): number {
  return Math.round(Math.min(state.max, Math.max(state.min, value)));
}

function updateHandles(cardEl: HTMLElement, state: ResizeState): void {
  cardEl.querySelectorAll<HTMLElement>(HANDLE_SELECTOR).forEach((handle) => {
    handle.setAttribute("aria-valuenow", String(state.value));
    handle.setAttribute("aria-valuemin", String(state.min));
    handle.setAttribute("aria-valuemax", String(state.max));
    handle.setAttribute("aria-valuetext", state.label);
    handle.dataset.value = state.label;
  });
}

function ensureHandles(cardEl: HTMLElement, adapter: ResizeAdapter): void {
  if (!adapter.ready(cardEl)) {
    cardEl.querySelectorAll(HANDLE_SELECTOR).forEach((el) => el.remove());
    return;
  }
  for (const handle of cardEl.querySelectorAll<HTMLElement>(HANDLE_SELECTOR)) {
    if (!adapter.sides.includes(handle.dataset.side as ResizeSide)) handle.remove();
  }
  for (const side of adapter.sides) {
    if (cardEl.querySelector(`${HANDLE_SELECTOR}[data-side="${side}"]`)) continue;
    const handle = document.createElement("div");
    handle.className = `${HANDLE_CLASS} ${HANDLE_CLASS}--${side}`;
    handle.dataset.side = side;
    handle.tabIndex = 0;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", `调整${adapter.mediaName}宽度`);
    cardEl.appendChild(handle);
  }
  const state = adapter.read(cardEl);
  if (state) updateHandles(cardEl, state);
}

/** 图片/视频共用边缘缩放器；视频用 transform 预览，图片实时预览像素宽度。 */
export function mountMediaCardResize(host: HTMLElement, interactive: boolean): () => void {
  let disposed = false;
  let timer: number | undefined;
  let drag: { cardEl: HTMLElement; adapter: ResizeAdapter; side: ResizeSide; startX: number; startValue: number; currentValue: number; state: ResizeState; snapshot: unknown; moved: boolean } | null = null;

  const scan = (): void => {
    timer = undefined;
    if (disposed) return;
    host.querySelectorAll<HTMLElement>(MEDIA_CARD_SELECTOR).forEach((cardEl) => {
      const adapter = adapterFor(cardEl);
      if (!adapter) return;
      if (interactive) ensureHandles(cardEl, adapter);
      else cardEl.querySelectorAll(HANDLE_SELECTOR).forEach((el) => el.remove());
    });
  };
  function schedule(): void {
    if (disposed || timer !== undefined) return;
    timer = window.setTimeout(scan, 0);
  }

  const finishResize = (commit: boolean): void => {
    const current = drag;
    drag = null;
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", onPointerCancel, true);
    window.removeEventListener("blur", onPointerCancel);
    window.removeEventListener("keydown", onResizeKeyDown, true);
    document.body.classList.remove("lake-media-resizing");
    if (!current) return;
    if (commit && current.moved) current.adapter.commit(current.cardEl, current.currentValue);
    else if (!commit && current.moved) current.adapter.restore(current.cardEl, current.snapshot, current.startValue);
    schedule();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!drag) return;
    const delta = (event.clientX - drag.startX) * (drag.side === "left" ? -1 : 1) * drag.adapter.pointerFactor;
    const next = normalized(drag.state, drag.startValue + delta * drag.adapter.valuePerPixel(drag.cardEl, drag.state));
    if (next !== drag.currentValue) {
      drag.currentValue = next;
      drag.moved = true;
      drag.adapter.preview(drag.cardEl, next);
      updateHandles(drag.cardEl, { ...drag.state, value: next, label: drag.adapter === IMAGE_ADAPTER ? `${next} px` : `正文宽度 ${next}%` });
    }
    event.preventDefault();
    event.stopPropagation();
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    finishResize(true);
  };
  const onPointerCancel = (): void => finishResize(false);
  const onPointerDown = (event: PointerEvent): void => {
    const target = event.target as HTMLElement | null;
    const handle = target?.closest?.(HANDLE_SELECTOR) as HTMLElement | null;
    if (!handle) return;
    const cardEl = handle.closest(MEDIA_CARD_SELECTOR) as HTMLElement | null;
    const adapter = cardEl ? adapterFor(cardEl) : null;
    const state = cardEl ? adapter?.read(cardEl) : null;
    const side = handle.dataset.side as ResizeSide | undefined;
    if (!cardEl || !adapter || !state || (side !== "left" && side !== "right")) return;
    event.preventDefault();
    event.stopPropagation();
    drag = { cardEl, adapter, side, startX: event.clientX, startValue: state.value, currentValue: state.value, state, snapshot: adapter.snapshot(cardEl), moved: false };
    document.body.classList.add("lake-media-resizing");
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    window.addEventListener("blur", onPointerCancel);
    window.addEventListener("keydown", onResizeKeyDown, true);
  };

  function onResizeKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && drag) {
      event.preventDefault();
      finishResize(false);
      return;
    }
    const target = event.target as HTMLElement | null;
    const handle = target?.closest?.(HANDLE_SELECTOR) as HTMLElement | null;
    const cardEl = handle?.closest(MEDIA_CARD_SELECTOR) as HTMLElement | null;
    const adapter = cardEl ? adapterFor(cardEl) : null;
    const state = cardEl ? adapter?.read(cardEl) : null;
    if (!cardEl || !adapter || !state) return;
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = state.value - state.step;
    else if (event.key === "ArrowRight") next = state.value + state.step;
    else if (event.key === "Home") next = state.min;
    else if (event.key === "End") next = state.max;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    adapter.commit(cardEl, normalized(state, next));
    schedule();
  }

  const observer = new MutationObserver(schedule);
  observer.observe(host, { childList: true, subtree: true });
  if (interactive) {
    host.addEventListener("pointerdown", onPointerDown, true);
    host.addEventListener("keydown", onResizeKeyDown, true);
  }
  scan();
  return () => {
    disposed = true;
    observer.disconnect();
    if (interactive) {
      host.removeEventListener("pointerdown", onPointerDown, true);
      host.removeEventListener("keydown", onResizeKeyDown, true);
    }
    if (drag) finishResize(false);
    if (timer !== undefined) window.clearTimeout(timer);
  };
}
