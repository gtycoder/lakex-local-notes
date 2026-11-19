/**
 * 图片/视频媒体卡缩放（图片/视频 × 边缘/角点，一套几何、一套手感）。
 *
 * 手感对齐思源（docs/LAKEX-CONTRACT.md §5.58；公式源 = mediaResizeGeometry.ts）：
 *  - 线性跟手：值 = 起点快照 + 光标总位移 × 符号 × 对齐系数；拖动中**零布局读取**，
 *    每帧只写一个宽度（图片 = img.style.width；视频 = --lake-video-max-width），预览即最终几何；
 *  - 松手一次写回（内核 updateImageData / resetCardValue+sync），无变化不写；取消/Esc 精确还原；
 *  - 把手只出现在「宽度变化时会移动的边」（左对齐 = 右侧；右对齐 = 左侧；居中 = 两侧），
 *    角点随边走 —— 锚定边不给把手（无法跟手）。
 *
 * 内核原生 .ne-ui-image-resizer 四角 resizer 已由本模块接管（feature.css 隐藏其点与命中区，
 * 保留 selection box 描边）：旧把手是「画框预览 + 松手跳变」且右缘把手会盖住右上/右下命中区
 * （261117 用户反馈「四角不能用」的主因），继续共存只会是两套手感。
 *
 * 261119 用户裁决：**移动端禁用图片/视频的拖拽缩放**（移动场景用得少；桌面拖拽缩放保持不变）——
 * 禁的是拖拽缩放手柄/边缘拖拽（本模块的把手/盒/拖拽/键盘交互与扫描器），挂载点按平台短路整链不装
 * （见 mediaCardResizeEnabled / mountMediaCardResize）；尺寸菜单类调整（桌面浮层）不受影响。
 */
import {
  previewImageWidth,
  readImageMeta,
  readImageResizeState,
  restoreImageWidthPreview,
  writeImageDisplayWidth,
} from "./selectionToolbar/imageCardOps";
import {
  alignmentFactor,
  computeResizeValue,
  handlesFor,
  type MediaAlignment,
  type MediaHandleId,
  type MediaSide,
} from "./mediaResizeGeometry";
import {
  applyVideoLayout,
  lockVideoLayout,
  readVideoLayout,
  writeVideoLayout,
} from "./videoCardOps";

const MEDIA_CARD_SELECTOR = 'ne-card[data-card-name="video"], ne-card[data-card-name="image"]';
const BOX_CLASS = "lake-media-resize-box";
const HANDLE_CLASS = "lake-media-resize-handle";
const HANDLE_SELECTOR = `.${HANDLE_CLASS}`;
const BOX_SELECTOR = `.${BOX_CLASS}`;

type MediaKind = "image" | "video";

interface ResizeSnapshot {
  /** 图片 = 拖前 img 内联 style 原文；视频 = null（值域还原即可）。 */
  imageStyle: string | null;
}

interface BoxTrack {
  left: number;
  top: number;
  width: number;
  height: number;
  /** 对齐位移系数：宽度变化 w0→w 时盒左边补 (w0−w)×kShift（左 0 / 中 0.5 / 右 1；卡片贴身包裹媒体时恒 0）。 */
  kShift: number;
  /** 高 = 宽 × invAspect（invAspect = h/w）。 */
  invAspect: number;
}

interface ResizeSession {
  cardEl: HTMLElement;
  kind: MediaKind;
  handleEl: HTMLElement;
  cursor: string;
  side: MediaSide;
  startX: number;
  startValue: number;
  currentValue: number;
  factor: 1 | 2;
  unitPerPixel: number;
  min: number;
  max: number;
  step: number;
  decimals: number;
  box: HTMLElement | null;
  track: BoxTrack | null;
  snapshot: ResizeSnapshot;
  moved: boolean;
}

interface ResizeState {
  value: number;
  min: number;
  max: number;
  step: number;
  alignment: MediaAlignment;
}

function mediaKind(cardEl: HTMLElement): MediaKind | null {
  const name = cardEl.getAttribute("data-card-name");
  return name === "video" ? "video" : name === "image" ? "image" : null;
}

function readState(cardEl: HTMLElement, kind: MediaKind): ResizeState | null {
  if (kind === "video") {
    const layout = readVideoLayout(cardEl);
    return { value: layout.widthPercent, min: 10, max: 100, step: 5, alignment: layout.alignment };
  }
  const state = readImageResizeState(cardEl);
  if (!state) return null;
  const raw = readImageMeta(cardEl).alignment;
  const alignment: MediaAlignment = raw === "center" || raw === "right" ? raw : "left";
  return { value: state.width, min: state.min, max: state.max, step: state.step, alignment };
}

function formatValue(kind: MediaKind, value: number): string {
  return kind === "video" ? `正文宽度 ${Math.round(value)}%` : `${Math.round(value)} px`;
}

function mediaElement(cardEl: HTMLElement): HTMLImageElement | null {
  return cardEl.querySelector<HTMLImageElement>("img");
}

function contentWidthOf(cardEl: HTMLElement): number {
  const body = cardEl.closest("ne-hole") ?? cardEl.parentElement;
  return Math.max(32, body?.getBoundingClientRect().width ?? 0);
}

function ensureBox(cardEl: HTMLElement): HTMLElement {
  let box = cardEl.querySelector<HTMLElement>(`${BOX_SELECTOR}.${BOX_CLASS}--${mediaKind(cardEl) ?? "image"}`);
  if (!box) {
    cardEl.querySelectorAll(BOX_SELECTOR).forEach((el) => el.remove());
    box = document.createElement("div");
    box.className = `${BOX_CLASS} ${BOX_CLASS}--${mediaKind(cardEl) ?? "image"}`;
    box.setAttribute("aria-hidden", "true");
    cardEl.appendChild(box);
  } else {
    // 未变才写（AGENTS I2）：复用现有盒时同值 className 不重写，静置扫描零 DOM 写。
    const wantClass = `${BOX_CLASS} ${BOX_CLASS}--${mediaKind(cardEl) ?? "image"}`;
    if (box.className !== wantClass) box.className = wantClass;
  }
  return box;
}

/** 图片盒 = img 实测盒（卡片常常比图宽，把手必须贴图，不能贴卡）；视频盒 = 卡片本身（fit-content）。 */
function measureBoxTrack(cardEl: HTMLElement): BoxTrack | null {
  const img = mediaElement(cardEl);
  if (!img) return null;
  const imgRect = img.getBoundingClientRect();
  const cardRect = cardEl.getBoundingClientRect();
  const hug = Math.abs(cardRect.width - imgRect.width) <= 2;
  const meta = readImageMeta(cardEl);
  const invAspect = meta.originalWidth > 0 && meta.originalHeight > 0
    ? meta.originalHeight / meta.originalWidth
    : imgRect.height / Math.max(1, imgRect.width);
  const kShift = hug ? 0 : meta.alignment === "center" ? 0.5 : meta.alignment === "right" ? 1 : 0;
  return { left: imgRect.left - cardRect.left, top: imgRect.top - cardRect.top, width: imgRect.width, height: imgRect.height, kShift, invAspect };
}



function applyBoxTrack(box: HTMLElement, track: BoxTrack, width: number): void {
  box.style.left = `${track.left + (track.width - width) * track.kShift}px`;
  box.style.top = `${track.top}px`;
  box.style.width = `${width}px`;
  box.style.height = `${width * track.invAspect}px`;
}

function ensureHandles(cardEl: HTMLElement, kind: MediaKind, state: ResizeState): void {
  const box = ensureBox(cardEl);
  const specs = handlesFor(state.alignment);
  const wanted = new Set(specs.map((s) => s.id));
  for (const handle of [...box.querySelectorAll<HTMLElement>(HANDLE_SELECTOR)]) {
    const id = handle.dataset.handle as MediaHandleId | undefined;
    if (!id || !wanted.has(id)) handle.remove();
  }
  for (const spec of specs) {
    if (box.querySelector(`${HANDLE_SELECTOR}[data-handle="${spec.id}"]`)) continue;
    const handle = document.createElement("div");
    handle.className = `${HANDLE_CLASS} ${HANDLE_CLASS}--${spec.id}`;
    handle.dataset.handle = spec.id;
    handle.dataset.side = spec.side;
    handle.tabIndex = 0;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", `调整${kind === "video" ? "视频" : "图片"}宽度`);
    box.appendChild(handle);
  }
  if (kind === "image") {
    const track = measureBoxTrack(cardEl);
    if (track) applyBoxTrack(box, track, track.width);
  } else {
    // 视频盒常态 = inset 0（CSS）；拖拽期间写过内联几何，重扫时清掉回位。
    box.removeAttribute("style");
  }
  for (const handle of box.querySelectorAll<HTMLElement>(HANDLE_SELECTOR)) {
    // 未变才写（AGENTS I2）：扫描重放同一状态时不写属性，静置场景 DOM 写次数 = 0。
    const valueText = formatValue(kind, state.value);
    const attrs: Array<[string, string]> = [
      ["aria-valuenow", String(Math.round(state.value))],
      ["aria-valuemin", String(state.min)],
      ["aria-valuemax", String(state.max)],
      ["aria-valuetext", valueText],
    ];
    for (const [name, value] of attrs) {
      if (handle.getAttribute(name) !== value) handle.setAttribute(name, value);
    }
    if (handle.dataset.value !== valueText) handle.dataset.value = valueText;
  }
}

/**
 * 拖拽缩放是否启用（261119 用户裁决：移动端禁用图片/视频拖拽缩放）。
 * 平台判据 = 既有 `body.lake-mobile` 口径（移动端入口模块求值时打标，AGENTS；桌面/测试环境无标记 = 照常）。
 * EditorTab / LakeEditor / createLakeDocument 面全部经此判据短路（lakeRuntime 挂载入口 + 本模块入口自卫）。
 */
export function mediaCardResizeEnabled(): boolean {
  return !document.body.classList.contains("lake-mobile");
}

/**
 * 图片/视频媒体缩放器。
 * interactive=false（阅读态）只清不建；editor 挂 interactive 手柄（lakeRuntime mode==="editor"）。
 * 移动端（mediaCardResizeEnabled()=false）挂载点直接短路：把手/盒/拖拽/键盘与扫描器
 * （ensureBox 周期写回）整链不安装、不运行。
 */
export function mountMediaCardResize(host: HTMLElement, interactive: boolean): () => void {
  if (!mediaCardResizeEnabled()) return () => {};
  let disposed = false;
  let timer: number | undefined;
  let session: ResizeSession | null = null;

  const scan = (): void => {
    timer = undefined;
    if (disposed) return;
    host.querySelectorAll<HTMLElement>(MEDIA_CARD_SELECTOR).forEach((cardEl) => {
      const kind = mediaKind(cardEl);
      if (!kind) return;
      // 拖动中的卡片由会话全权管理，扫描不得回写它的几何（否则把手/宽度被重置）。
      if (session && session.cardEl === cardEl) return;
      const ready = kind === "video" ? Boolean(cardEl.querySelector(".ne-card-video-done")) : Boolean(mediaElement(cardEl));
      if (!interactive || !ready) {
        cardEl.querySelectorAll(BOX_SELECTOR).forEach((el) => el.remove());
        return;
      }
      const state = readState(cardEl, kind);
      if (!state) return;
      ensureHandles(cardEl, kind, state);
    });
  };
  const schedule = (): void => {
    if (disposed || timer !== undefined) return;
    timer = window.setTimeout(scan, 0);
  };

  // 图片与视频的预览逻辑有意分开（261117 用户裁决：不强求公共方法）：
  //  - 图片：直写 img.style.width（真布局；用户复核「非常稳定」）；
  //  - 视频：直写 --lake-video-max-width（真布局 ⇒ 卡片/把手盒/下方间隔全部实时走位；
  //    拖动中零布局读取 ⇒ 浏览器把多次样式写入合并为每帧一次布局，暂停视频改尺寸与图片同级稳定）。
  // 261117 动图取证：旧「闪烁/突变」= 写回打架的尺寸跳变（拖动锁已治），不是视频重绘。
  const applyPreview = (target: ResizeSession, value: number): void => {
    if (target.kind === "video") {
      target.cardEl.style.setProperty("--lake-video-max-width", `${value}%`);
      return;
    }
    previewImageWidth(target.cardEl, value);
    if (target.box && target.track) applyBoxTrack(target.box, target.track, value);
  };

  const restoreVisual = (target: ResizeSession): void => {
    if (target.kind === "video") {
      applyVideoLayout(target.cardEl, { ...readVideoLayout(target.cardEl), widthPercent: target.startValue });
      return;
    }
    restoreImageWidthPreview(target.cardEl, target.snapshot.imageStyle);
  };

  const finishResize = (commit: boolean): void => {
    const current = session;
    session = null;
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", onPointerCancel, true);
    window.removeEventListener("blur", onPointerCancel);
    window.removeEventListener("keydown", onKeyDown, true);
    document.body.classList.remove("lake-media-resizing");
    document.body.removeAttribute("data-resize-cursor");
    if (!current) return;
    current.handleEl.classList.remove("is-active");
    const changed = current.moved && current.currentValue !== current.startValue;
    if (current.kind === "video") lockVideoLayout(current.cardEl, false);
    if (commit && changed) {
      // 提交值 = 预览值（真布局预览，松手零跳变）。
      // 提交失败也**不弹回**预览值（宁可留在视觉值上等下次对齐，也不给用户「白拖了」的突变）。
      if (current.kind === "image") previewImageWidth(current.cardEl, Math.round(current.currentValue));
      if (current.kind === "video") writeVideoLayout(current.cardEl, { widthPercent: current.currentValue });
      else writeImageDisplayWidth(current.cardEl, current.currentValue);
    } else if (current.moved) {
      restoreVisual(current);
    }
    schedule();
  };

  const onPointerMove = (event: PointerEvent): void => {
    const current = session;
    if (!current) return;
    const value = computeResizeValue({
      startValue: current.startValue,
      deltaPx: event.clientX - current.startX,
      side: current.side,
      factor: current.factor,
      unitPerPixel: current.unitPerPixel,
      min: current.min,
      max: current.max,
      decimals: current.decimals,
    });
    if (value !== current.currentValue) {
      current.currentValue = value;
      current.moved = true;
      applyPreview(current, value);
      current.handleEl.dataset.value = formatValue(current.kind, value);
      current.handleEl.setAttribute("aria-valuenow", String(Math.round(value)));
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!session) return;
    event.preventDefault();
    event.stopPropagation();
    finishResize(true);
  };
  // 中断（pointercancel / 窗口失焦）= 按当前值提交，不回退 —— 与「绝不静默丢弃编辑」同口径；
  // 显式取消只有 Esc / pointercancel 前未移动（261117 用户复核：松手回弹体感 = 白拖）。
  const onPointerCancel = (): void => finishResize(true);

  const onPointerDown = (event: PointerEvent): void => {
    const target = event.target as HTMLElement | null;
    const handle = target?.closest?.(HANDLE_SELECTOR) as HTMLElement | null;
    if (!handle) return;
    const cardEl = handle.closest(MEDIA_CARD_SELECTOR) as HTMLElement | null;
    const kind = cardEl ? mediaKind(cardEl) : null;
    const state = cardEl && kind ? readState(cardEl, kind) : null;
    const side = (handle.dataset.side === "left" || handle.dataset.side === "right" ? handle.dataset.side : null);
    if (!cardEl || !kind || !state || !side) return;
    event.preventDefault();
    event.stopPropagation();
    const box = handle.closest(BOX_SELECTOR) as HTMLElement | null;
    const track = kind === "image" && box ? measureBoxTrack(cardEl) : null;
    session = {
      cardEl,
      kind,
      handleEl: handle,
      cursor: window.getComputedStyle(handle).cursor || "ew-resize",
      side,
      startX: event.clientX,
      startValue: state.value,
      currentValue: state.value,
      factor: alignmentFactor(state.alignment),
      unitPerPixel: kind === "video" ? 100 / Math.max(1, contentWidthOf(cardEl)) : 1,
      min: state.min,
      max: state.max,
      step: state.step,
      decimals: kind === "video" ? 1 : 0,
      box,
      track,
      snapshot: { imageStyle: mediaElement(cardEl)?.getAttribute("style") ?? null },
      moved: false,
    };
    if (kind === "video") lockVideoLayout(cardEl, true);
    handle.classList.add("is-active");
    document.body.classList.add("lake-media-resizing");
    document.body.setAttribute("data-resize-cursor", session.cursor);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    window.addEventListener("blur", onPointerCancel);
    window.addEventListener("keydown", onKeyDown, true);
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && session) {
      event.preventDefault();
      event.stopPropagation();
      finishResize(false);
      return;
    }
    if (session) return; // 拖动中除 Esc 外不响应键盘步进（避免半途改值）
    const target = event.target as HTMLElement | null;
    const handle = target?.closest?.(HANDLE_SELECTOR) as HTMLElement | null;
    const cardEl = handle?.closest(MEDIA_CARD_SELECTOR) as HTMLElement | null;
    const kind = cardEl ? mediaKind(cardEl) : null;
    const state = cardEl && kind ? readState(cardEl, kind) : null;
    if (!cardEl || !kind || !state || !handle) return;
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = state.value - state.step;
    else if (event.key === "ArrowRight") next = state.value + state.step;
    else if (event.key === "Home") next = state.min;
    else if (event.key === "End") next = state.max;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    const value = Math.min(state.max, Math.max(state.min, Math.round(next * 10) / 10));
    const box = handle.closest(BOX_SELECTOR) as HTMLElement | null;
    const track = kind === "image" && box ? measureBoxTrack(cardEl) : null;
    if (kind === "video") cardEl.style.setProperty("--lake-video-max-width", `${value}%`);
    else previewImageWidth(cardEl, value);
    if (box && track) applyBoxTrack(box, track, value);
    void (kind === "video" ? writeVideoLayout(cardEl, { widthPercent: value }) : writeImageDisplayWidth(cardEl, value));
    handle.dataset.value = formatValue(kind, value);
    handle.setAttribute("aria-valuenow", String(Math.round(value)));
    schedule();
  }

  const observer = new MutationObserver(schedule);
  observer.observe(host, { childList: true, subtree: true });
  // 窗口/容器尺寸变化（分栏、侧栏收放）会挪动图片盒：host 尺寸变化即重扫（只观察 host，不进子树，避免自触发）。
  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
  resizeObserver?.observe(host);
  if (interactive) {
    host.addEventListener("pointerdown", onPointerDown, true);
    host.addEventListener("keydown", onKeyDown, true);
  }
  scan();
  return () => {
    disposed = true;
    observer.disconnect();
    resizeObserver?.disconnect();
    if (interactive) {
      host.removeEventListener("pointerdown", onPointerDown, true);
      host.removeEventListener("keydown", onKeyDown, true);
    }
    // 销毁 = 中断：按当前值提交（与 pointercancel/失焦同口径，绝不静默丢弃拖动）。
    if (session) finishResize(true);
    if (timer !== undefined) window.clearTimeout(timer);
  };
}
