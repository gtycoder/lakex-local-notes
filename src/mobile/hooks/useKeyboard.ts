/**
 * 移动端输入法（软键盘）探测（编辑态 dock 键盘适配）。
 * Android Capacitor 无 keyboard 插件，故用 window/visualViewport 双通道判断两种键盘模式：
 *   - adjustResize：WebView 自缩，keyboard 弹出时 window.innerHeight 变小（vv.height==innerHeight），
 *                    bottom:0 的 fixed 元素天然在键盘上方。此时 offset=0，无需上移。
 *   - edge-to-edge：WebView 不缩，visualViewport.height 变小，需把 fixed 元素 bottom 上移（offset）。
 * 返回：
 *   base         —— 键盘收起时的满高度（max(innerHeight)），用于让工具栏在键盘收起/面板展开中屏幕 Y 恒定
 *   innerHeight  —— 当前 innerHeight（实时跟随 resize）
 *   offset       —— 需把 dock/toolbar 的 bottom 上移的量（adjustResize=0；edge-to-edge=键盘高度）
 *   height       —— 键盘实际高度（两种模式统一：adjustResize 用基准回落、edge-to-edge 用 vv 差）
 *   keyboardOpen —— 键盘是否弹出（height>8）
 *
 * 261103 六批 A6：**改成进程内单例 store**（useSyncExternalStore）。
 * 此前每个调用点各挂一份 window/visualViewport resize 监听（工作区 chrome 一份、每个编辑面一份），
 * 同一帧里同一套计算跑多遍；现在只有一份监听 + 一份状态，所有订阅者共享。
 */
import { useEffect, useSyncExternalStore } from "react";
import { noteViewport, resetShellHeight, shellHeight, widthChanged } from "./viewportShell";

export interface KeyboardState {
  base: number;
  innerHeight: number;
  offset: number;
  height: number;
  keyboardOpen: boolean;
}

function emptyState(): KeyboardState {
  return { base: 0, innerHeight: 0, offset: 0, height: 0, keyboardOpen: false };
}

/** ⚠️ base 初值直接取当前视口高，**不要给 0**：`base` 被 EditorDock 用来写 `--mb-app-h`（外壳高度），
 *  而那个写操作在 useLayoutEffect（绘制前）里、比本 store 的首次测量更早 ⇒ 初值 0 会让首帧外壳高度变成 0px（闪一下）。
 *  innerHeight 仍保持 0（= 「还没测量」，与旧实现的 useState 语义一致）。 */
let current: KeyboardState = {
  base: typeof window === "undefined" ? 0 : window.innerHeight,
  innerHeight: 0,
  offset: 0,
  height: 0,
  keyboardOpen: false,
};
const listeners = new Set<() => void>();
let stopWatching: (() => void) | null = null;
let lastWidth = 0;

function measure(): KeyboardState {
  if (typeof window === "undefined") return emptyState();
  const iw = window.innerWidth;
  // 261102：先按宽度变化重置基准（IME 不会改宽度；否则拖窄窗口后 keyboardOpen 永久为真）。
  if (widthChanged(lastWidth, iw)) lastWidth = iw, resetShellHeight();
  const ih = window.innerHeight;
  const vv = window.visualViewport;
  const vvH = Math.round(vv ? vv.height : ih);
  const vvTop = vv ? Math.max(0, vv.offsetTop) : 0;
  const base = noteViewport(ih, vvH);
  const off = Math.max(0, Math.round(ih - vvH - vvTop));
  const shrunk = Math.max(0, Math.round(shellHeight() - ih));
  const height = Math.max(off, shrunk);
  return { base, innerHeight: ih, offset: off, height, keyboardOpen: height > 8 };
}

function emit(): void {
  const next = measure();
  const prev = current;
  if (prev.innerHeight === next.innerHeight && prev.offset === next.offset && prev.height === next.height
    && prev.base === next.base && prev.keyboardOpen === next.keyboardOpen) return;
  current = next;
  for (const listener of listeners) listener();
}

function startWatching(): void {
  if (stopWatching || typeof window === "undefined") return;
  lastWidth = window.innerWidth;
  /* 261111 流畅性：IME 动画期间 window/visualViewport 会连发多次 resize（同一帧内也可能有多条），
     每次 emit 都会让所有订阅者重渲染 + 写 --mb-app-h。这里合并成**每帧最多一次**（rAF）：
     键盘开合/面板收放最多晚一帧，但省掉成串的同步 reflow。
     ⚠️ 不是"隐藏窗口不调度"的 rAF 门控：本 store 只服务可见编辑面，可见窗口 rAF 恒有回调。 */
  let frame = 0;
  const schedule = (): void => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => { frame = 0; emit(); });
  };
  const onOrient = (): void => { resetShellHeight(); schedule(); };
  window.addEventListener("orientationchange", onOrient);
  window.visualViewport?.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  stopWatching = () => {
    window.removeEventListener("orientationchange", onOrient);
    window.visualViewport?.removeEventListener("resize", schedule);
    window.visualViewport?.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
    stopWatching = null;
  };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  startWatching();
  if (current.innerHeight === 0) emit(); // 首个订阅者：把 innerHeight 从 0 补成真实值（保持旧的"挂载后一帧才有"语义）
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stopWatching) stopWatching();
  };
}

function getSnapshot(): KeyboardState {
  return current;
}

function getServerSnapshot(): KeyboardState {
  return emptyState();
}

export function useKeyboard(): KeyboardState {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // 保持与旧实现一致的挂载期初始化：确保监听在挂载后已经挂上（subscribe 里已做，这里兜底一次）。
  useEffect(() => { startWatching(); }, []);
  return state;
}
