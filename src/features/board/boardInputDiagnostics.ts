/**
 * 指针落笔诊断（261103 八/九批）：为「快速落笔 / 快速擦除不生效」提供可复现的证据。
 * 目前两处接入：**画板（Drawnix）** 与 **手写板（ink）** —— 两者都是自绘指针管线。
 *
 * 只读观测，默认关（生产零开销）：capture 阶段挂 pointerdown/move/up/cancel/lostpointercapture，
 * 只统计落在指定画布选择器内的落笔，按「一次落笔」聚合：
 *   · 环形缓冲（最近 60 笔）+ 一行 console.info 摘要；
 *   · window.__lakeBoardInputStats() / __lakeInkInputStats() 取结构化数据；
 *   · __lakeBoardInputReset() / __lakeInkInputReset() 清空。
 *
 * 开启方式（桌面 devtools / 移动端 CDP）：
 *   localStorage.setItem("lakex-local-notes-v3.board-input-debug", "1")   // 画板
 *   localStorage.setItem("lakex-local-notes-v3.ink-input-debug", "1")     // 手写板
 *   （或 window.__lakePointerInputDebug = true 一开全开；旧的 __lakeBoardInputDebug 仍有效）
 * 改完**重开对应文档标签**生效；删 key 关闭。
 *
 * 判读口径：
 *   · moves 很少（<2）且 ups=1：事件压根没进来（宿主/浏览器层面被吃掉）；
 *   · moves 很多但画面无笔迹：事件进来了、引擎没消费（输入状态机问题）；
 *   · cancels > 0：被 pointercancel 打断（滚动/手势竞争、系统手势）；
 *   · mouseAfterPen=true 且随后鼠标笔画 moves>0 但无效果：笔→鼠标输入类型切换卡住。
 */
export interface PointerStrokeDiag {
  /** 来源：board（画板）/ ink（手写板）。 */
  label: string;
  pointerType: string;
  downs: number;
  moves: number;
  ups: number;
  cancels: number;
  lostCaptures: number;
  /** 合并事件（getCoalescedEvents）累计条数；老浏览器没有该 API 时为 0。 */
  coalesced: number;
  startedAt: number;
  endedAt: number;
  ms: number;
  /** 本笔是否属于「已经出现过 pen 笔画之后的鼠标笔画」。 */
  mouseAfterPen: boolean;
}

/** 兼容旧名（画板侧读的是同一个结构）。 */
export type BoardStrokeDiag = PointerStrokeDiag;

const MAX_STROKES = 60;
const BOARD_KEY = "lakex-local-notes-v3.board-input-debug";
const INK_KEY = "lakex-local-notes-v3.ink-input-debug";

export type PointerDiagLabel = "board" | "ink";

interface DiagConfig {
  label: PointerDiagLabel;
  storageKey: string;
  /** 只统计命中该选择器的落笔（null = 根节点本身也算）。 */
  selector: string;
}

const CONFIGS: Record<PointerDiagLabel, DiagConfig> = {
  board: { label: "board", storageKey: BOARD_KEY, selector: ".plait-board-container" },
  ink: { label: "ink", storageKey: INK_KEY, selector: ".ink-page-svg" },
};

interface DiagBucket {
  strokes: PointerStrokeDiag[];
  sawPenStroke: boolean;
  pending: PendingStroke | null;
}

interface PendingStroke {
  pointerType: string;
  downs: number;
  moves: number;
  ups: number;
  cancels: number;
  lostCaptures: number;
  coalesced: number;
  startedAt: number;
}

const buckets: Record<PointerDiagLabel, DiagBucket> = {
  board: { strokes: [], sawPenStroke: false, pending: null },
  ink: { strokes: [], sawPenStroke: false, pending: null },
};
const installedRoots = new WeakSet<Element>();
let windowHooksInstalled = false;

function enabled(config: DiagConfig): boolean {
  if (typeof window === "undefined") return false;
  const w = window as { __lakePointerInputDebug?: boolean; __lakeBoardInputDebug?: boolean };
  if (w.__lakePointerInputDebug === true || w.__lakeBoardInputDebug === true) return true;
  try {
    return window.localStorage.getItem(config.storageKey) === "1";
  } catch {
    return false;
  }
}

export function boardInputDiagEnabled(): boolean {
  return enabled(CONFIGS.board);
}

export function inkInputDiagEnabled(): boolean {
  return enabled(CONFIGS.ink);
}

function pushStroke(config: DiagConfig, stroke: PointerStrokeDiag): void {
  const bucket = buckets[config.label];
  bucket.strokes.push(stroke);
  if (bucket.strokes.length > MAX_STROKES) bucket.strokes = bucket.strokes.slice(-MAX_STROKES);
  if (stroke.pointerType === "pen") bucket.sawPenStroke = true;
  console.info(
    "[pointer-input:" + config.label + "] " + stroke.pointerType
      + " downs=" + stroke.downs + " moves=" + stroke.moves + " ups=" + stroke.ups
      + " cancel=" + stroke.cancels + " lost=" + stroke.lostCaptures
      + " coalesced=" + stroke.coalesced + " " + stroke.ms + "ms"
      + (stroke.mouseAfterPen ? " (mouse-after-pen)" : ""),
  );
}

function finalize(config: DiagConfig): void {
  const bucket = buckets[config.label];
  const pending = bucket.pending;
  if (!pending) return;
  const endedAt = Date.now();
  bucket.pending = null;
  pushStroke(config, {
    label: config.label,
    pointerType: pending.pointerType,
    downs: pending.downs,
    moves: pending.moves,
    ups: pending.ups,
    cancels: pending.cancels,
    lostCaptures: pending.lostCaptures,
    coalesced: pending.coalesced,
    startedAt: pending.startedAt,
    endedAt,
    ms: endedAt - pending.startedAt,
    mouseAfterPen: pending.pointerType === "mouse" && bucket.sawPenStroke,
  });
}

function install(root: HTMLElement | null, config: DiagConfig): () => void {
  if (!root || !enabled(config) || installedRoots.has(root)) return () => {};
  installedRoots.add(root);
  const bucket = buckets[config.label];
  const isTarget = (event: Event): boolean => {
    const target = event.target as Element | null;
    if (!target) return false;
    if (target === root) return true;
    return !!target.closest?.(config.selector);
  };
  const coalescedCount = (event: PointerEvent): number => {
    try {
      return event.getCoalescedEvents?.().length ?? 0;
    } catch {
      return 0;
    }
  };
  const onDown = (event: PointerEvent): void => {
    if (!isTarget(event)) return;
    finalize(config); // 上一笔没有正常抬手时先结掉，避免计数串台
    bucket.pending = {
      pointerType: event.pointerType || "unknown",
      downs: 1,
      moves: 0,
      ups: 0,
      cancels: 0,
      lostCaptures: 0,
      coalesced: coalescedCount(event),
      startedAt: Date.now(),
    };
  };
  const onMove = (event: PointerEvent): void => {
    if (!bucket.pending || !isTarget(event)) return;
    bucket.pending.moves += 1;
    bucket.pending.coalesced += coalescedCount(event);
  };
  const onUp = (event: PointerEvent): void => {
    if (!bucket.pending || !isTarget(event)) return;
    bucket.pending.ups += 1;
    finalize(config);
  };
  const onCancel = (event: PointerEvent): void => {
    if (!bucket.pending || !isTarget(event)) return;
    bucket.pending.cancels += 1;
    finalize(config);
  };
  const onLost = (event: PointerEvent): void => {
    if (bucket.pending && isTarget(event)) bucket.pending.lostCaptures += 1;
    // 不立即 finalize：Chrome 里丢失捕获后仍可能来 pointerup，由 onUp/onDown 收口。
  };
  root.addEventListener("pointerdown", onDown, true);
  root.addEventListener("pointermove", onMove, true);
  root.addEventListener("pointerup", onUp, true);
  root.addEventListener("pointercancel", onCancel, true);
  root.addEventListener("lostpointercapture", onLost, true);
  return () => {
    root.removeEventListener("pointerdown", onDown, true);
    root.removeEventListener("pointermove", onMove, true);
    root.removeEventListener("pointerup", onUp, true);
    root.removeEventListener("pointercancel", onCancel, true);
    root.removeEventListener("lostpointercapture", onLost, true);
    installedRoots.delete(root);
    finalize(config);
  };
}

/** 画板诊断（根节点 = board-editor / mobile-board-viewer）。 */
export function installBoardInputDiagnostics(root: HTMLElement | null): () => void {
  return install(root, CONFIGS.board);
}

/** 手写板诊断（根节点 = .ink-pad）。 */
export function installInkInputDiagnostics(root: HTMLElement | null): () => void {
  return install(root, CONFIGS.ink);
}

function statsFor(label: PointerDiagLabel): { enabled: boolean; strokes: PointerStrokeDiag[] } {
  return { enabled: enabled(CONFIGS[label]), strokes: buckets[label].strokes.slice() };
}

function resetFor(label: PointerDiagLabel): void {
  buckets[label] = { strokes: [], sawPenStroke: false, pending: null };
}

export function boardInputStats(): { enabled: boolean; strokes: PointerStrokeDiag[] } {
  return statsFor("board");
}

export function inkInputStats(): { enabled: boolean; strokes: PointerStrokeDiag[] } {
  return statsFor("ink");
}

export function boardInputReset(): void {
  resetFor("board");
  resetFor("ink");
}

/** 装 window 取数钩子（幂等；生产环境也只是挂几个函数，不产生监听）。 */
export function installBoardInputDebugHooks(): void {
  if (typeof window === "undefined" || windowHooksInstalled) return;
  windowHooksInstalled = true;
  const w = window as {
    __lakeBoardInputStats?: () => unknown;
    __lakeBoardInputReset?: () => void;
    __lakeInkInputStats?: () => unknown;
    __lakeInkInputReset?: () => void;
  };
  w.__lakeBoardInputStats = () => statsFor("board");
  w.__lakeInkInputStats = () => statsFor("ink");
  w.__lakeBoardInputReset = () => resetFor("board");
  w.__lakeInkInputReset = () => resetFor("ink");
}

/** 手写板侧只需要 window 钩子时用（与画板同一个实现）。 */
export const installPointerInputDebugHooks = installBoardInputDebugHooks;
