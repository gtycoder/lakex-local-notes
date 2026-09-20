/**
 * 长按桌面图标 →「闪念速记」静态快捷方式（Android App Shortcuts）的深链处理。
 *
 * 链路：`res/xml/shortcuts.xml` 的快捷方式发 `ACTION_VIEW` + `lakenotes://quick-note` ⇒
 * MainActivity（singleTask）⇒ `@capacitor/app` 的 `getLaunchUrl()`（冷启动）/ `appUrlOpen`（已在运行）。
 * 两边都收敛到 `subscribeQuickNoteShortcut`：命中即回调，让上层切到「小记」标签并直接打开新建写作区。
 *
 * 为什么要单开一个模块：深链可能在**冷启动**（插件尚未 ready，需要 getLaunchUrl 补读）也可能在
 * **热启动**（onNewIntent ⇒ appUrlOpen）；两处都要接，且必须防重复（冷启动时两条路径可能都触发一次）。
 */
import { App } from "@capacitor/app";
import { registerPlugin } from "@capacitor/core";

const QUICK_NOTE_URL = "lakenotes://quick-note";

/**
 * 是否 Capacitor 原生平台（Android/iOS）。
 *
 * ⚠️ **不要用 `hasNativeBridge()`**：它判的是 `window.lakeNative`，而移动端这个调试契约是在
 * MobileApp 的启动流程里**之后**才注入的。冷启动瞬间判据为假 ⇒ 订阅被跳过、长按图标的深链永远不生效
 * （实测踩过）。这里直接看 Capacitor 平台标志，与启动顺序无关。
 */
function isNativePlatform(): boolean {
  return (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() === true;
}

/** 原生「固定到桌面」插件（Android：ShortcutManager.requestPinShortcut；见 PinShortcutPlugin.java）。 */
interface PinShortcutPluginApi {
  isAvailable(): Promise<{ available: boolean }>;
  isPinned(): Promise<{ pinned: boolean }>;
  requestPin(): Promise<{ requested: boolean; reason?: string }>;
}
const PinShortcut = registerPlugin<PinShortcutPluginApi>("PinShortcut");

/** 深链 URL 是否是「闪念速记」（容错尾斜杠 / query / host 大小写）。 */
export function isQuickNoteShortcutUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const normalized = url.trim().toLowerCase();
  return normalized.startsWith("lakenotes://quick-note") || normalized.startsWith("lakenotes://quicknote");
}

/**
 * 订阅「闪念速记」快捷方式。返回取消订阅函数。
 * `onTrigger` 可能被调用多次（冷启动补读 + appUrlOpen），调用方自行幂等。
 */
export function subscribeQuickNoteShortcut(onTrigger: () => void): () => void {
  if (!isNativePlatform()) return () => undefined;
  let disposed = false;
  /** 冷启动轮询是否已拿到 launch url（拿到就停；不影响之后的热启动 appUrlOpen）。 */
  let launchConsumed = false;
  /** 上一次触发时刻：只对"同一次点击被两条路径各触发一次"做短去重，**不能永久去重**。 */
  let lastTriggerAt = 0;
  let retryTimer: number | null = null;
  /** 冷启动的双触发窗口：getLaunchUrl 与 appUrlOpen 通常在同一两秒内各来一次。 */
  const DEDUP_MS = 1500;

  const handle = (url: string | null | undefined) => {
    if (disposed) return;
    if (!isQuickNoteShortcutUrl(url)) return;
    const now = Date.now();
    // ⚠️ 这里**不能**用一个永久布尔量：那样一次冷启动触发之后，进程存活期间
    // 再长按图标（热启动 appUrlOpen）就永远被忽略（260920 CDP 实测复现）。
    if (now - lastTriggerAt < DEDUP_MS) return;
    lastTriggerAt = now;
    onTrigger();
  };

  /**
   * 冷启动：Activity 是用深链拉起来的（getLaunchUrl 只在有 launch intent 时返回 url）。
   * 启动瞬间插件/桥可能还没就绪（实测偶发返回空）⇒ 前几秒做几次短轮询重试，拿到就停。
   */
  let attempts = 0;
  const readLaunchUrl = () => {
    if (disposed || launchConsumed) return;
    void App.getLaunchUrl()
      .then((result) => {
        if (result?.url) {
          launchConsumed = true;
          handle(result.url);
          return;
        }
        attempts += 1;
        if (attempts >= 10) return; // 约 3s 内没有深链 ⇒ 视为普通启动
        retryTimer = window.setTimeout(readLaunchUrl, 300);
      })
      .catch(() => {
        attempts += 1;
        if (attempts >= 10) return;
        retryTimer = window.setTimeout(readLaunchUrl, 300);
      });
  };
  readLaunchUrl();

  // 热启动 / 已在后台：onNewIntent ⇒ appUrlOpen
  const listener = App.addListener("appUrlOpen", (event) => handle(event?.url));

  return () => {
    disposed = true;
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    void listener.then((handle_) => handle_.remove()).catch(() => undefined);
  };
}

/**
 * 「添加到桌面」的能力探测（对齐思源）：
 * 部分机型/launcher 不支持固定快捷方式或不展示静态快捷方式 ⇒ 需要这个兜底入口。
 * 返回 `null` 表示当前平台没有原生桥（纯浏览器/桌面）。
 */
export async function probePinShortcut(): Promise<{ available: boolean; pinned: boolean } | null> {
  if (!isNativePlatform()) return null;
  try {
    const supported = await PinShortcut.isAvailable();
    if (!supported?.available) return { available: false, pinned: false };
    const pinned = await PinShortcut.isPinned();
    return { available: true, pinned: !!pinned?.pinned };
  } catch {
    return null;
  }
}

/** 发起固定（系统会弹确认框）；返回是否已发起。 */
export async function requestPinQuickNoteShortcut(): Promise<boolean> {
  if (!isNativePlatform()) return false;
  try {
    const result = await PinShortcut.requestPin();
    return !!result?.requested;
  } catch {
    return false;
  }
}
