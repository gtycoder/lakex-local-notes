/**
 * 启动恢复窗口（P1-5）：最小独立 BrowserWindow + 内联 HTML，**不挂 preload、不走 IPC**。
 *
 * 动作通道 = 同文档 hash 跳转（页内 `location.hash = "action=<name>&t=<nonce>"`）：
 * 主进程监听 `did-navigate-in-page`，用 `parseRecoveryActionHash` 解析后执行动作；
 * 结果通过 `executeJavaScript` 回填 `window.__recoveryStatus`。这样：
 * - 不新增 preload 文件（安装包 files 只列 electron/preload.cjs，改 package.json 不在写作用域）；
 * - 不把恢复通道暴露给正常渲染页面（无 IPC 通道可调）；
 * - 页面不依赖渲染层/内核资源，坏库时也能渲染。
 *
 * 数据目录/日志路径只做展示，动作全部在主进程（备份/重试/隔离恢复/退出）。
 */
import { BrowserWindow, dialog, nativeTheme } from "electron";
import { buildRecoveryPageHtml, parseRecoveryActionHash, type RecoveryAction, type RecoveryPageInfo } from "./startupRecovery.js";

export interface RecoveryActionResult {
  ok: boolean;
  /** 展示在恢复页状态区（失败要明说原因）。 */
  message: string;
  /** true = 动作成功且需要重启进入正常启动（窗口模块会先展示消息再调用 restart）。 */
  restart?: boolean;
}

export interface RecoveryActions {
  /** 先备份（VACUUM INTO，失败降级文件拷贝）再重试打开；失败必须返回 ok=false + 原因。 */
  backupAndRetry(): Promise<RecoveryActionResult>;
  /** 复用 A2 prepareCloudRestore：隔离旧 workspace → 空库重启（重启后需重新配置云同步）。 */
  cloudRestore(): Promise<RecoveryActionResult>;
  /** 用系统文件管理器打开 userData。 */
  openDataFolder(): Promise<RecoveryActionResult>;
  /** relaunch + exit（窗口模块在展示结果后调用）。 */
  restart(): void;
  quit(): void;
}

const RESTART_DELAY_MS = 1_200;

/** 打开恢复窗口并返回（调用方负责不再继续普通启动）。 */
export function showRecoveryWindow(info: RecoveryPageInfo, actions: RecoveryActions): BrowserWindow {
  const win = new BrowserWindow({
    width: 760,
    height: 660,
    minWidth: 560,
    minHeight: 420,
    show: false,
    title: "LakexLocalNotes 启动恢复",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1e2126" : "#f6f7f9",
    webPreferences: {
      // 恢复页 = 静态内联页，不需要任何渲染层能力（也不挂 preload）。
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  let exiting = false;
  let busy = false;
  let restartTimer: NodeJS.Timeout | null = null;

  const postStatus = (payload: { ok: boolean; message: string }): void => {
    if (win.isDestroyed()) return;
    const script = `window.__recoveryStatus && window.__recoveryStatus(${JSON.stringify(payload)});`;
    void win.webContents.executeJavaScript(script, true).catch(() => undefined);
  };

  const runAction = async (action: RecoveryAction): Promise<void> => {
    if (busy || exiting) return;
    if (action === "quit") {
      exiting = true;
      actions.quit();
      return;
    }
    busy = true;
    try {
      const result = action === "backup"
        ? await actions.backupAndRetry()
        : action === "cloud-restore"
          ? await actions.cloudRestore()
          : await actions.openDataFolder();
      postStatus({ ok: result.ok, message: result.message });
      if (result.ok && result.restart) {
        exiting = true;
        restartTimer = setTimeout(() => actions.restart(), RESTART_DELAY_MS);
      }
    } catch (error) {
      // 动作实现内部应自行兜错；这里兜最后一层，绝不静默。
      postStatus({ ok: false, message: "操作失败：" + (error instanceof Error ? error.message : String(error)) });
    } finally {
      busy = false;
    }
  };

  win.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (!isMainFrame) return;
    let hash = "";
    try { hash = new URL(url).hash; } catch { return; }
    const action = parseRecoveryActionHash(hash);
    if (action) void runAction(action);
  });
  // 恢复页不应导航到任何外部地址（只允许同文档 hash）；拦截全部 main-frame 导航。
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.show();
  });
  win.on("closed", () => {
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    // 关掉恢复窗口 = 用户放弃恢复：直接退出（macOS 上否则会留一个没有窗口的进程）。
    if (!exiting) actions.quit();
  });

  const html = buildRecoveryPageHtml(info);
  void win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html)).catch((error) => {
    // 连恢复页都加载不出来时退到原生错误框（把路径留给用户，别让他猜）。
    dialog.showErrorBox(
      "LakexLocalNotes 启动恢复",
      info.reason + "\n\n" + info.detail + "\n\n数据目录：" + info.dataDir + "\n日志：" + info.logPath,
    );
    if (!win.isDestroyed()) win.destroy();
    exiting = true;
    actions.quit();
    void error;
  });
  return win;
}
