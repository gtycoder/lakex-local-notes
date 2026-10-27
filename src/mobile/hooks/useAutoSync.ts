/**
 * 移动端自动同步（261012 建；261013 扩「开/关应用」口径 + 进后台 best-effort）。
 *
 * 对应关系（判据在 src/core/syncModes.ts，纯函数、有单测）：
 *   · interval    → 起一个 setInterval，每 autoIntervalMinutes 分钟触发一次 bridge.syncNow()；
 *                   **并且**在开/关应用时各补一次（261013 起与桌面同口径）；
 *   · onOpenClose → 只在开/关应用时各补一次；
 *   · manual      → 什么都不做（「完全手动」不自动出网，只有手动同步/恢复补拉才联网）。
 * 「开/关应用」在移动端的等价实现 = **冷启动就绪 + 回到前台 + 进入后台**：
 *   Android 上"退出前同步"不可靠（进程可能被系统直接杀，没有 before-quit 那样的时机），
 *   所以不假装能"关闭时同步"；**进入后台**这一次是典型的"离开设备前最后一次推送"（对齐思源
 *   安卓壳的 onBackground → performSync{mobileSwitch}），但它是 **best-effort** ——
 *   WebView 可能随即被系统冻结/杀掉，请求不保证跑完（本地是真相，跑不完下次冷启动/回前台必补）。
 *
 * 去重：在途时不再叠加（对齐思源壳侧的 AtomicBoolean syncing）；手动「立即同步」不走这里、不受影响。
 * 失败静默：后台那次失败不弹提示（用户已经离开界面，弹了也看不到、只会攒一堆错误）；
 *   冷启动/回前台那两次仍走 reportNativeActionError 如实上报。
 * 出网与否不在这里判：bridge.syncNow 自己挂 canTouchNetwork(cloudStateOf(...))（AGENTS §3#20）。
 */
import { useEffect, useRef } from "react";
import { autoSyncIntervalMs, shouldSyncOnOpenClose } from "../../core/syncModes";
import { bridge } from "../bridge";
import { readSyncSettings, subscribeSyncSettings } from "../sync/syncSettingsStore";
import { whenQuickNoteLaunchResolved } from "../native/quickNoteShortcut";
import { reportNativeActionError } from "../../lib/nativeErrors";
import { hasInterruptedSync } from "../sync/syncResumeMarker";
import { ensureDb } from "../bridge/context";

/**
 * @param ready 应用是否已就绪（MobileApp 的 `phase` 离开 booting，即 bridge.init + refreshAll 之后）。
 *   **就绪后再跑"开启应用对齐一次"**（用户 261013 定稿）——不再猜 `setTimeout(…, 3000)`：
 *   快设备白等 3s，慢设备还可能在桥没就绪时就触发（那次会走"未配置/密钥缺失"的假失败路径）。
 */
export function useAutoSync(ready = true): void {
  /** 就绪后要跑的那一次对齐（在主 effect 里装机、由下面的就绪 effect 触发）。 */
  const openHandlerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let timer: number | null = null;
    let disposed = false;
    /** 在途标记：自动触发（定时/开/关）合并去重，不在途时叠加第二次整轮同步。 */
    let inFlight = false;

    const runOnce = (reason: string, silent = false) => {
      if (inFlight) return;
      inFlight = true;
      void bridge.syncNow()
        .catch((error) => { if (!silent) reportNativeActionError(reason, error); })
        .finally(() => { inFlight = false; });
    };

    const readSettings = (): ReturnType<typeof readSyncSettings> | null => {
      try { return readSyncSettings(); } catch { return null; }
    };

    const arm = () => {
      if (disposed) return;
      if (timer != null) { window.clearInterval(timer); timer = null; }
      const ms = autoSyncIntervalMs(readSettings());
      if (ms != null) timer = window.setInterval(() => runOnce("自动同步"), ms);
    };

    /**
     * 「这次会话是不是快捷入口（长按小记 / 深链）拉起的」—— 判定一次、之后复用（用户 261013 定稿）。
     *
     * 语义：这条流程是**"假单独模块"** ⇒ **不主动发起任何同步**（入口 / 回前台 / 进后台三处全跳），
     * 只有用户点「保存并同步」才出网（高优先域单条推送，见 bridge.syncQuickNote）。
     * ⚠️ 用户自己配的「按固定间隔」定时器**不在此列**：那是他设的节奏，不是我们替他补的动作。
     */
    let captureSession: boolean | null = null;
    const isCaptureSession = async (): Promise<boolean> => {
      if (captureSession === null) captureSession = await whenQuickNoteLaunchResolved();
      return captureSession;
    };

    // 开/关应用补同步（261013：interval 也补，manual 不补；与桌面「应用就绪 + 退出前」对应）。
    let foregroundHandler: (() => void) | null = null;
    let backgroundHandler: (() => void) | null = null;
    const armAppState = () => {
      foregroundHandler = () => {
        void (async () => {
          if (await isCaptureSession()) return; // 「假单独模块」：这次会话不主动同步
          // 派生索引后台自愈（261026）：同步批量导入不再逐篇建 FTS，这里补齐；
          // 已完成时只是两次 COUNT，开销可忽略；后台补一半被杀，下次进来自动接着补。
          void bridge.ensureSearchIndex().catch(() => undefined);
          // 断点续传优先（261026）：上次同步没跑完（被杀/断网/切后台）⇒ 冷启动或回前台无条件续上，
          // 不看 autoMode —— 用户点过同步、退出再进来必须接着下（manual 也续）。
          if (await hasInterruptedSync(await ensureDb())) { runOnce("续传未完成的同步"); return; }
          if (shouldSyncOnOpenClose(readSettings())) runOnce("回到前台同步");
        })();
      };
      // 进后台 = 移动端唯一可靠的"离开设备"时机（桌面没有对应物，桌面是 before-quit 真等待）。
      // best-effort + 失败静默：不阻塞界面、也不为它做任何等待。
      backgroundHandler = () => {
        void (async () => {
          if (await isCaptureSession()) return; // 同上：长按小记这次会话，退出也不触发整轮同步
          if (shouldSyncOnOpenClose(readSettings())) runOnce("进入后台同步", true);
        })();
      };
    };

    arm();
    armAppState();
    // 交给"就绪 effect"触发（见函数头注释）；**capture 会话判定只保留在 handler 里这一处**（别在这里再判一次）。
    openHandlerRef.current = foregroundHandler;

    const unsubscribe = subscribeSyncSettings(arm);
    let removeAppListener: (() => void) | null = null;
    void (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) { foregroundHandler?.(); return; }
          backgroundHandler?.();
        });
        removeAppListener = () => { void handle.remove(); };
      } catch { /* Web 预览/测试环境没有 Capacitor：只保留冷启动那次 */ }
    })();

    return () => {
      disposed = true;
      if (timer != null) window.clearInterval(timer);
      unsubscribe();
      if (removeAppListener) removeAppListener();
      openHandlerRef.current = null;
    };
  }, []);

  /**
   * 「开启应用时对齐一次」：**显式就绪信号**驱动（替代旧的 3s 猜时间）；是否真同步由 handler 内部判据决定。
   *
   * 261014：就绪信号到了也**不立刻发**，而是等一次空闲（最多 2s 兜底）——
   * 理由（用户点单）：冷启动要**页面优先**，S3 这类后台工作不能跟首屏渲染/首批交互抢主线程
   * （实测首页 1447ms 就绪；此刻立刻开一轮同步，网络回调 + 清单 JSON + 写库都压在同一根线程上）。
   * 语义不变：仍然是"就绪后跑一次"，只是把起点挪到首次空闲；capture 会话判定仍在 handler 里。
   */
  useEffect(() => {
    if (!ready) return;
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    const fire = () => openHandlerRef.current?.();
    if (typeof ric === "function") {
      const id = ric(fire, { timeout: 2000 });
      return () => { (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(id); };
    }
    const t = window.setTimeout(fire, 800);
    return () => window.clearTimeout(t);
  }, [ready]);
}
