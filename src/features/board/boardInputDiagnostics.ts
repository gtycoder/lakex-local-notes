/**
 * 画板输入诊断（261103 八批）：为「快速落笔 / 快速擦除不生效」提供**可复现的证据**。
 *
 * 只读观测，默认关（生产零开销）：在宿主根节点上以 capture 阶段挂 pointerdown/move/up/cancel/
 * lostpointercapture，按「一次落笔」聚合后：
 *   · 写环形缓冲（最近 60 笔）+ console.info 一行摘要；
 *   · 通过 window.__lakeBoardInputStats() 取结构化数据（含 mouseAfterPen 标记）；
 *   · 通过 window.__lakeBoardInputReset() 清空。
 *
 * 开启方式（桌面 devtools / 移动端 CDP 均可）：
 *   localStorage.setItem("lakex-local-notes-v3.board-input-debug", "1")  → 重开画板标签生效
 *   或 window.__lakeBoardInputDebug = true 后重开画板标签
 * 关闭：删掉该 key（或置 0）后重开画板标签。
 *
 * 判读口径：
 *   · moves 很少（<2）且 ups=1：事件压根没进来（宿主/浏览器层面被吃掉）；
 *   · moves 很多但画面无笔迹：事件进来了、plait 没消费（输入状态机问题）；
 *   · cancels > 0：被 pointercancel 打断（滚动/手势竞争或系统手势）；
 *   · mouseAfterPen=true 且随后鼠标笔画 moves>0 但无效果：笔→鼠标输入类型切换卡住（已知可疑点）。
 */
export interface BoardStrokeDiag {
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
  /** 本笔是否属于「已经出现过 pen 笔画之后的鼠标笔画」（识别笔→鼠标切换卡住）。 */
  mouseAfterPen: boolean;
}

const MAX_STROKES = 60;
const STORAGE_KEY = "lakex-local-notes-v3.board-input-debug";

let strokes: BoardStrokeDiag[] = [];
let sawPenStroke = false;
const installedRoots = new WeakSet<Element>();
let windowHooksInstalled = false;

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

let pending: PendingStroke | null = null;

export function boardInputDiagEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if ((window as { __lakeBoardInputDebug?: boolean }).__lakeBoardInputDebug === true) return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function pushStroke(stroke: BoardStrokeDiag): void {
  strokes.push(stroke);
  if (strokes.length > MAX_STROKES) strokes = strokes.slice(-MAX_STROKES);
  if (stroke.pointerType === "pen") sawPenStroke = true;
  console.info(
    "[board-input] " + stroke.pointerType
      + " downs=" + stroke.downs + " moves=" + stroke.moves + " ups=" + stroke.ups
      + " cancel=" + stroke.cancels + " lost=" + stroke.lostCaptures
      + " coalesced=" + stroke.coalesced + " " + stroke.ms + "ms"
      + (stroke.mouseAfterPen ? " (mouse-after-pen)" : ""),
  );
}

function finalize(): void {
  if (!pending) return;
  const endedAt = Date.now();
  const stroke: BoardStrokeDiag = {
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
    mouseAfterPen: pending.pointerType === "mouse" && sawPenStroke,
  };
  pending = null;
  pushStroke(stroke);
}

/** 挂诊断（幂等；同一根节点只挂一次）。未开启时直接返回 noop。 */
export function installBoardInputDiagnostics(root: HTMLElement | null): () => void {
  if (!root || !boardInputDiagEnabled() || installedRoots.has(root)) return () => {};
  installedRoots.add(root);
  /** 只统计画布上的落笔：宿主根节点里还有工具栏/浮层，它们的点击会污染统计（根为 canvas 时不设限）。 */
  const isCanvasEvent = (event: Event): boolean => {
    const target = event.target as Element | null;
    if (!target) return false;
    if (target === root) return true;
    return !!target.closest?.(".plait-board-container");
  };
  const coalescedCount = (event: PointerEvent): number => {
    try {
      return event.getCoalescedEvents?.().length ?? 0;
    } catch {
      return 0;
    }
  };
  const onDown = (event: PointerEvent): void => {
    if (!isCanvasEvent(event)) return;
    finalize(); // 上一笔没有正常抬手时先结掉，避免计数串台
    pending = {
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
    if (!pending || !isCanvasEvent(event)) return;
    pending.moves += 1;
    pending.coalesced += coalescedCount(event);
  };
  const onUp = (event: PointerEvent): void => {
    if (!pending || !isCanvasEvent(event)) return;
    pending.ups += 1;
    finalize();
  };
  const onCancel = (event: PointerEvent): void => {
    if (!pending || !isCanvasEvent(event)) return;
    pending.cancels += 1;
    finalize();
  };
  const onLost = (): void => {
    if (pending) pending.lostCaptures += 1;
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
    finalize();
  };
}

export function boardInputStats(): { enabled: boolean; strokes: BoardStrokeDiag[] } {
  return { enabled: boardInputDiagEnabled(), strokes: strokes.slice() };
}

export function boardInputReset(): void {
  strokes = [];
  sawPenStroke = false;
  pending = null;
}

/** 装 window 取数钩子（幂等；生产环境也只是挂两个函数，不产生监听）。 */
export function installBoardInputDebugHooks(): void {
  if (typeof window === "undefined" || windowHooksInstalled) return;
  windowHooksInstalled = true;
  const w = window as {
    __lakeBoardInputStats?: () => unknown;
    __lakeBoardInputReset?: () => void;
  };
  w.__lakeBoardInputStats = () => boardInputStats();
  w.__lakeBoardInputReset = () => boardInputReset();
}
