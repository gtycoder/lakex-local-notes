import { app, BrowserWindow, dialog, ipcMain, session, shell, type WebFrameMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MAX_IMAGE_BYTES, Store } from "./store.js";
import { MAX_QUICK_NOTE_IMAGE_BYTES, QuickNotesStore } from "./quickNotes.js";
import { convertQuickNoteToLake } from "./quickNoteConversion.js";
import { startAssetServer, ASSET_PORT } from "./assetServer.js";
import { exportNote, type ExportFormat } from "./export.js";
import { resolveMirroredCdnRedirect } from "./cdnRedirect.js";
import { testConnection, syncNow, runGcReconcile, runDeepCleanup, type SyncResult, type SyncProgress } from "./sync.js";
import { initLogger, log } from "./logger.js";
import { syncQuickNotes, runQuickNotesDeepCleanup } from "./quickNotesSync.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

// 开发版与打包版隔离 userData：dev 用 lake-notes-dev（空库+种子），打包版用
// lake-notes-electron（正式数据），避免测试数据互相污染。必须在 app ready 前设置。
// 本地多端测试：dev 下可用 LAKE_USER_DATA 覆盖 userData，模拟不同「设备」各自独立的本地库。
if (isDev) {
  const userDataOverride = process.env.LAKE_USER_DATA?.trim();
  app.setPath("userData", userDataOverride || path.join(app.getPath("appData"), "lake-notes-dev"));
}
const DEV_SERVER_URL = "http://127.0.0.1:1421";

let store: Store;
let quickNotes: QuickNotesStore;
/** 历史定时器重启函数（配置变更时调用，见 save_history_settings IPC） */
let restartHistoryTimers: (() => void) | null = null;
/** S3 GC 定时器重启函数（配置变更时调用，见 save_s3_gc_settings IPC） */
let restartGcTimers: (() => void) | null = null;
/** 自动同步定时器重启函数（配置变更时调用，见 save_sync_settings IPC） */
let restartSyncTimers: (() => void) | null = null;
/** 本机进程内串行队列：同步、GC、深度清理同一时刻只跑一个（v4.1 唯一必需互斥）。 */
let maintenanceQueue: Promise<unknown> = Promise.resolve();
function enqueueMaintenance<T>(task: () => Promise<T>): Promise<T> {
  const run = maintenanceQueue.then(task, task);
  maintenanceQueue = run.then(() => undefined, () => undefined);
  return run;
}

/** 同步单飞保护：同一时刻只允许一个完整同步（手动 / 自动 / 开关触发共用）。 */
let syncInFlight = false;

/** 执行完整同步（Lake → 小记），与 GC/深度清理共用串行队列。 */
/** 广播同步进度到本进程所有受信任窗口（自动同步/定时同步没有单一触发渲染层时用）。 */
function broadcastSyncProgress(p: SyncProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!trustedWebContents.has(win.webContents.id)) continue;
    try { win.webContents.send("sync-progress", p); } catch { /* 窗口已关闭 */ }
  }
}

async function runFullSync(onProgress?: (p: SyncProgress) => void): Promise<SyncResult> {
  if (syncInFlight) throw new Error("同步正在进行中，请等待本次同步完成");
  syncInFlight = true;
  const fullSyncStart = Date.now();
  log.sync.info("[perf] runFullSync start");
  try {
    return await enqueueMaintenance(async () => {
      // 手动同步：只发回触发它的渲染层；自动同步：广播给本进程所有窗口。
      const report = (p: SyncProgress) => {
        if (onProgress) { try { onProgress(p); } catch { /* 渲染层已关闭 */ } }
        else { broadcastSyncProgress(p); }
      };
      const result = await syncNow(store, report);
      quickNotes.markTargetNotesSynced();
      try {
        const settings = store.getS3Settings();
        if (!settings) throw new Error("请先保存 S3 配置");
        const quick = await syncQuickNotes(quickNotes, settings, report);
        result.quickNotes = quick;
      } catch (error) {
        result.quickNotes = { uploaded: 0, downloaded: 0, conflicts: 0, completedAt: new Date().toISOString(), error: String(error) };
        report({ phase: "quick-notes", message: `小记同步失败：${String(error)}` });
      }
      store.recordSyncResult(JSON.stringify(result));
      report({ phase: "done", message: "同步完成", supersededNotes: result.supersededNotes });
      log.sync.info(`[perf] runFullSync done ${Date.now() - fullSyncStart}ms (uploaded=${result.uploaded}, downloaded=${result.downloaded}, conflicts=${result.conflicts}, superseded=${result.supersededNotes.length}, quickNotes=${result.quickNotes?.error ? "error" : "ok"})`);
      return result;
    });
  } finally {
    syncInFlight = false;
  }
}

/** 本应用创建的窗口 webContents 白名单（防导航到其他页面后仍调用 IPC） */
const trustedWebContents = new Set<number>();

/** 应用自身页面的 URL 判定：dev = 固定 dev server；prod = 打包 dist/index.html */
function isAppPageUrl(url: string): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (isDev) return parsed.origin === DEV_SERVER_URL;
  if (parsed.protocol === "file:") {
    const expected = pathToFileURL(path.join(__dirname, "../dist/index.html"));
    return parsed.pathname === expected.pathname;
  }
  return false;
}

function workspaceRoot(): string {
  return path.join(app.getPath("userData"), "workspace-default");
}

/** Lake 编辑器 CDN 资源本地镜像（public/vendor/cdn → dist/vendor/cdn） */
function vendorCdnDir(): string {
  return path.join(__dirname, "..", isDev ? "public" : "dist", "vendor", "cdn");
}

/**
 * 资源本地化只接管已随应用镜像的 Lake 运行时资源。gw.alipayobjects.com 同时
 * 承载用户粘贴图片，若按 host 全量重定向，未镜像的 /zos/skylark/... 会变成本地 404。
 */
function registerCdnRedirect() {
  const mirrorRoot = vendorCdnDir();
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["*://gw.alipayobjects.com/*"] },
    (details, callback) => {
      const redirectURL = resolveMirroredCdnRedirect(details.url, ASSET_PORT, (relativePath) => {
        const file = path.join(mirrorRoot, relativePath);
        return fs.existsSync(file) && fs.statSync(file).isFile();
      });
      // 未镜像的资源保持原请求：例如用户粘贴的 gw /zos/skylark 图片。
      callback(redirectURL ? { redirectURL } : {});
    }
  );
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      // 打包版直接指向 app.asar.unpacked 里的真实文件（asar 内 preload 在 Electron 33 有解析 Bug）
      preload: app.isPackaged
        ? path.join(__dirname, "../../app.asar.unpacked/electron/preload.cjs")
        : path.join(__dirname, "../electron/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // 打包版必须关闭 preload 沙箱：Electron 沙箱化 preload 从 app.asar 加载会报 SyntaxError（已知问题）
      // dev 环境实际也是 --no-sandbox 运行的，行为一致；contextIsolation 仍开启
      sandbox: false,
    },
  });

  // 审计 #6：窗口导航与 window.open 全部受控——阻止导航到应用页之外的任何地址；
  // 外链（http/https）交给系统浏览器打开，绝不进入应用窗口
  trustedWebContents.add(win.webContents.id);
  // 渲染进程日志统一落盘：console-message 转发到主进程 logger（scope=renderer）。
  // Electron 33 事件签名：event 对象带 { level, message, lineNumber, sourceId }；
  // 同时兼容旧式 (event, level, message) 回调。
  win.webContents.on("console-message" as unknown as "console-message", (event: unknown, ...args: unknown[]) => {
    const e = event as { message?: unknown };
    const msg = typeof e?.message === "string"
      ? e.message
      : typeof args[1] === "string" ? args[1] : String(args[1] ?? "");
    if (!msg) return;
    // 过滤 DevTools 样式占位与空消息
    if (msg.includes("%c") || msg.length > 4000) return;
    log.renderer.info(msg);
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!isAppPageUrl(url)) event.preventDefault();
  });
  win.webContents.on("destroyed", () => { trustedWebContents.delete(win.webContents.id); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        void shell.openExternal(url);
      }
    } catch { /* 非法 URL 忽略 */ }
    return { action: "deny" };
  });

  if (isDev) {
    await win.loadURL(DEV_SERVER_URL);
  } else {
    await win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

/** IPC 只接受本应用窗口（精确 URL + webContents 白名单）发来的调用。
 * 审计 #6：不再信任任意 file://、任意 localhost 端口、devtools://、about:blank——
 * 页面被导航到恶意本地页后 preload 暴露的全量能力即失效。 */
function isTrustedSenderFrame(frame: WebFrameMain | null, sender: Electron.WebContents): boolean {
  if (!frame) return false;
  if (!trustedWebContents.has(sender.id)) return false;
  return isAppPageUrl(frame.url);
}

function registerIpc() {
  const handle = (channel: string, fn: (...args: any[]) => any) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedSenderFrame(event.senderFrame, event.sender)) throw new Error("IPC 调用来源不受信任");
      return fn(...args);
    });
  };

  handle("bootstrap_workspace", () => store.bootstrap());
  handle("read_note", (id: string) => store.readNote(id));
  handle("get_note_digest", (id: string) => store.getNoteDigest(id));
  handle("create_note", (title: string) => store.createNote(title));
  handle("save_note", (id: string, title: string, content: string, caches?: { markdown?: string | null; plain?: string | null }) => store.saveNote(id, title, content, caches));
  handle("update_note_caches", (id: string, markdown: string | null, plain: string | null) => {
    store.updateNoteCaches(id, markdown ?? null, plain ?? null);
  });
  handle("ensure_note_caches", (id: string, lakeContent?: string) => store.ensureNoteCaches(id, lakeContent));
  handle("read_note_caches", (id: string) => store.readNoteCaches(id));
  handle("get_note_paths", (id: string) => store.getNotePaths(id));
  handle("pick_export_dir", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win, {
      title: "选择导出位置",
      buttonLabel: "导出到此目录",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  handle("export_note", (id: string, format: ExportFormat, baseDir?: string) => exportNote(store, id, format, baseDir));
  handle("set_node_icon", (id: string, icon: string | null) => store.setNodeIcon(id, icon));
  handle("search_notes", (query: string, limit?: number) => store.searchNotes(query, limit));
  handle("delete_note", (id: string) => store.deleteNote(id));
  handle("set_note_locked", (id: string, locked: boolean) => { store.setNoteLocked(id, locked); return store.readNote(id); });
  handle("list_tree_nodes", () => store.listTreeNodes());
  handle("list_note_summaries", () => store.listNoteSummaries());
  handle("create_notebook", (title: string) => store.createNotebook(title));
  handle("create_group", (parentId: string, title: string) => store.createGroup(parentId, title));
  handle("rename_tree_node", (id: string, title: string) => store.renameTreeNode(id, title));
  handle("create_note_in", (parentId: string | null, title: string) => store.createNoteIn(parentId, title));
  handle("move_tree_node", (id: string, parentId: string | null, sortOrder: number) => store.moveTreeNode(id, parentId, sortOrder));
  handle("move_tree_node_ordered", (id: string, parentId: string | null, orderedIds: string[]) => store.moveTreeNodeOrdered(id, parentId, orderedIds));
  handle("reorder_tree_nodes", (parentId: string | null, orderedIds: string[]) => store.reorderTreeNodes(parentId, orderedIds));
  handle("delete_tree_node", (id: string) => store.deleteTreeNode(id));
  handle("list_trash", () => store.listTrash());
  handle("restore_trash", (id: string) => store.restoreTrashItem(id));
  handle("purge_trash", (id: string) => store.purgeTrashItem(id));
  handle("empty_trash", () => store.emptyTrash());
  handle("create_history_snapshot", (noteId: string, content?: string, force?: boolean) => store.createHistorySnapshot(noteId, content, force));
  handle("list_note_history", (noteId: string) => store.listNoteHistory(noteId));
  handle("restore_history", (historyId: number) => store.restoreHistory(historyId));
  handle("delete_history", (historyId: number) => store.deleteHistory(historyId));
  handle("cleanup_history", () => store.cleanupHistory());
  handle("get_history_settings", () => store.getHistorySettings());
  handle("save_history_settings", (settings: unknown) => {
    store.saveHistorySettings(settings as Parameters<Store["saveHistorySettings"]>[0]);
    restartHistoryTimers?.();
  });
  handle("get_history_stats", () => store.getHistoryStats());
  handle("list_note_orphans", (noteId: string) => store.listNoteOrphans(noteId));
  handle("preview_history_snapshot", (historyId: number) => store.previewHistorySnapshot(historyId));
  handle("preview_note_orphan", (noteId: string, filename: string) => store.previewNoteOrphan(noteId, filename));
  handle("clean_note_orphans", (noteId: string, filenames?: string[]) => store.cleanNoteOrphans(noteId, filenames));
  handle("upload_resource", (input: { bytes: number[]; filename: string }, noteId: string) => {
    // 审计 #21：IPC 输入侧预检（序列化已复制到主进程，先拦截超大数组再走 imageOutput）
    if (!input || !Array.isArray(input.bytes)) throw new Error("资源数据无效");
    if (input.bytes.length > MAX_IMAGE_BYTES) throw new Error("图片超过 25 MiB");
    return store.uploadResource(input, noteId);
  });
  handle("download_remote_resource", (url: string, noteId: string) => store.downloadRemoteResource(url, noteId));
  handle("list_orphan_assets", () => store.listOrphanAssets());
  handle("clean_orphan_assets", () => store.cleanOrphanAssets());
  handle("get_s3_settings", () => store.getS3Settings());
  handle("save_s3_settings", (settings: unknown) => store.saveS3Settings(settings as Parameters<Store["saveS3Settings"]>[0]));
  handle("test_s3_connection", () => testConnection(store));
  handle("get_s3_gc_settings", () => store.getS3GcSettings());
  handle("get_trash_reminder", () => store.listTrashReminder(store.getS3GcSettings().trashAutoPurgeDays));
  handle("save_s3_gc_settings", (settings: unknown) => {
    store.saveS3GcSettings(settings as Parameters<Store["saveS3GcSettings"]>[0]);
    restartGcTimers?.();
  });
  handle("get_sync_settings", () => store.getSyncSettings());
  handle("save_sync_settings", async (settings: unknown) => {
    const next = settings as Parameters<Store["saveSyncSettings"]>[0];
    const prev = store.getSyncSettings();
    if (prev.enabled && !next.enabled) {
      // 关闭云同步前做一次最后对齐；失败则保持开启并抛出，UI 可提示重试。
      try {
        await runFullSync();
      } catch (error) {
        throw new Error(`关闭云同步前的最后对齐失败：${String(error)}`);
      }
    }
    store.saveSyncSettings(next);
    restartSyncTimers?.();
    restartGcTimers?.();
    if (!prev.enabled && next.enabled) {
      // 重新开启后立即做一次对齐（后台执行，失败仅告警）。
      void runFullSync().catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn("[sync] 重新开启后的对齐失败:", msg);
        broadcastSyncProgress({ phase: "done", message: "同步失败", error: msg });
      });
    }
    return store.getSyncSettings();
  });
  handle("list_s3_gc_pending", () => store.listS3GcPending());
  handle("list_s3_gc_log", () => store.listS3GcLog());
  handle("run_s3_gc_reconcile", () => {
    if (!store.getSyncSettings().enabled) throw new Error("云同步已关闭");
    return enqueueMaintenance(() => runGcReconcile(store));
  });
  handle("run_s3_deep_cleanup", (dryRun: boolean) => {
    if (!store.getSyncSettings().enabled) throw new Error("云同步已关闭");
    return enqueueMaintenance(async () => {
      const settings = store.getS3Settings();
      if (!settings) throw new Error("请先保存 S3 配置");
      const gcCfg = store.getS3GcSettings();
      const lake = await runDeepCleanup(store, { dryRun: !!dryRun });
      const quick = await runQuickNotesDeepCleanup(quickNotes, settings, { dryRun: !!dryRun, gcRetentionDays: gcCfg.gcRetentionDays });
      return { dryRun: !!dryRun, lake, quickNotes: quick };
    });
  });
  // sync_now 需要携带进度事件（主进程 → 渲染进程）
  ipcMain.handle("sync_now", (event) => {
    if (!isTrustedSenderFrame(event.senderFrame, event.sender)) throw new Error("IPC 调用来源不受信任");
    if (!store.getSyncSettings().enabled) throw new Error("云同步已关闭，请先在偏好设置中开启");
    const send = (p: SyncProgress) => { try { event.sender.send("sync-progress", p); } catch { /* 窗口已关闭 */ } };
    return runFullSync(send);
  });
  handle("get_sync_status", () => store.getSyncStatus());

  // 小记 IPC：完全独立于 Lake 文档 IPC，图片只进入 quick-notes/staging / assets 空间。
  handle("list_quick_notes", () => quickNotes.listQuickNotes());
  handle("create_quick_note", (input: { text: string; draftId: string; stagedImageIds: string[] }) => quickNotes.createQuickNote(input));
  handle("update_quick_note", (id: string, input: { text: string; draftId: string; stagedImageIds: string[]; retainedImageIds?: string[] }) => quickNotes.updateQuickNote(id, input));
  handle("delete_quick_note", (id: string) => quickNotes.deleteQuickNote(id));
  handle("list_quick_note_trash", () => quickNotes.listQuickNoteTrash());
  handle("restore_quick_note", (id: string) => quickNotes.restoreQuickNote(id));
  handle("purge_quick_note", (id: string) => quickNotes.purgeQuickNote(id));
  handle("discard_quick_note_draft", (draftId: string) => quickNotes.discardDraft(draftId));
  handle("discard_staged_quick_note_image", (draftId: string, imageId: string) => quickNotes.discardStagedImage(draftId, imageId));
  handle("stage_quick_note_image", (draftId: string, input: { bytes: number[]; filename: string }) => {
    if (!input || !Array.isArray(input.bytes)) throw new Error("图片数据无效");
    if (input.bytes.length > MAX_QUICK_NOTE_IMAGE_BYTES) throw new Error("图片超过 25 MiB");
    return quickNotes.stageImage(draftId, input);
  });
  handle("convert_quick_note", (quickNoteId: string, notebookId: string) => convertQuickNoteToLake(quickNotes, store, quickNoteId, notebookId));
}

// Increase renderer memory limit for large documents with base64 images
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=8192");

// 单实例锁：双开应用会并发写同一 SQLite 与 .lake 文件，存在丢失更新风险
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    initLogger();
    log.app.info("app ready: initLogger done");
    store = new Store(workspaceRoot());
    // 开发版固定 S3 配置（多端联调用）：首次启动（尚无配置）时写入；之后仍可在设置中修改。
    if (isDev && !store.getS3Settings()) {
      store.saveS3Settings({
        endpoint: "https://s3.cn-north-1.qiniucs.com",
        region: "cn-north-1",
        bucket: "local-lake-hebei",
        prefix: "lake-notes",
        accessKeyId: "***REMOVED***",
        secretAccessKey: "***REMOVED***",
        forcePathStyle: false,
      });
    }
    quickNotes = new QuickNotesStore(workspaceRoot());
    quickNotes.recoverConversions((noteId) => store.hasNote(noteId), (noteId) => store.removeUntrackedNoteArtifacts(noteId));
    registerCdnRedirect();
    startAssetServer(path.join(workspaceRoot(), "note-assets"), vendorCdnDir(), path.join(workspaceRoot(), "quick-notes"));
    registerIpc();
    createWindow();

    // U1：自动快照（默认 15 分钟，间隔可配置）+ 启动兜底清理（P5 低频巡检）
    // 启动兜底：清理一次过期快照（惰性清理在创建快照后也会触发，这里是兜底）
    try {
      const r = store.cleanupHistory();
      store.recordHistoryCleanup(r);
      if (r.deletedSnapshots > 0) console.log(`[history] 启动兜底清理：删除 ${r.deletedSnapshots} 份过期快照`);
    } catch (error) { console.warn("[history] 启动兜底清理失败:", error); }
    // 定时器管理：配置变更（设置面板保存）后重启定时器
    let snapshotTimer: NodeJS.Timeout | null = null;
    let cleanupTimer: NodeJS.Timeout | null = null;
    const startHistoryTimers = () => {
      if (snapshotTimer) { clearInterval(snapshotTimer); snapshotTimer = null; }
      if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
      const cfg = store.getHistorySettings();
      if (cfg.snapshotIntervalMinutes > 0) {
        snapshotTimer = setInterval(() => {
          try {
            const n = store.flushHistorySnapshots();
            if (n > 0) console.log(`[history] 自动快照：创建 ${n} 份`);
          } catch (error) { console.warn("[history] 自动快照失败:", error); }
        }, cfg.snapshotIntervalMinutes * 60 * 1000);
      }
      if (cfg.cleanupIntervalHours > 0) {
        cleanupTimer = setInterval(() => {
          try {
            const r = store.cleanupHistory();
            store.recordHistoryCleanup(r);
            if (r.deletedSnapshots > 0) console.log(`[history] 定期清理：删除 ${r.deletedSnapshots} 份过期快照`);
          } catch (error) { console.warn("[history] 定期清理失败:", error); }
        }, cfg.cleanupIntervalHours * 3600 * 1000);
      }
    };
    startHistoryTimers();
    restartHistoryTimers = startHistoryTimers;

    // 自动同步（interval）定时器：仅在云同步开启且模式为 interval 时运行。
    let syncTimer: NodeJS.Timeout | null = null;
    const startSyncTimers = () => {
      if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
      const cfg = store.getSyncSettings();
      if (!cfg.enabled || cfg.autoMode !== "interval" || cfg.autoIntervalMinutes < 1) return;
      syncTimer = setInterval(() => {
        void runFullSync().catch((error) => {
          const msg = error instanceof Error ? error.message : String(error);
          console.warn("[sync] 自动同步失败:", msg);
          broadcastSyncProgress({ phase: "done", message: "同步失败", error: msg });
        });
      }, cfg.autoIntervalMinutes * 60 * 1000);
    };
    startSyncTimers();
    restartSyncTimers = startSyncTimers;

    // onOpenClose：应用就绪时对齐一次（失败仅告警）。
    const syncCfgOpen = store.getSyncSettings();
    if (syncCfgOpen.enabled && syncCfgOpen.autoMode === "onOpenClose") {
      void runFullSync().catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn("[sync] 开启同步失败:", msg);
        broadcastSyncProgress({ phase: "done", message: "同步失败", error: msg });
      });
    }

    // S3 GC 定期对账（gcIntervalHours 默认 24；0=关闭）。云同步关闭时不执行。
    let gcTimer: NodeJS.Timeout | null = null;
    const startGcTimer = () => {
      if (gcTimer) { clearInterval(gcTimer); gcTimer = null; }
      if (!store.getSyncSettings().enabled) return;
      const gcCfg = store.getS3GcSettings();
      if (gcCfg.gcIntervalHours > 0) {
        gcTimer = setInterval(() => {
          void enqueueMaintenance(async () => {
            try {
              const r = await runGcReconcile(store);
              if (r.deleted > 0) console.log(`[s3-gc] 定期对账删除 ${r.deleted} 个过期对象`);
            } catch (error) { console.warn("[s3-gc] 定期对账失败:", error); }
          });
        }, gcCfg.gcIntervalHours * 3600 * 1000);
      }
    };
    startGcTimer();
    restartGcTimers = startGcTimer;

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

// onOpenClose：退出前做一次同步（阻止退出 → 同步完成后真正退出）。
let quittingForSync = false;
app.on("before-quit", (event) => {
  if (quittingForSync || !store || !quickNotes) return;
  const cfg = store.getSyncSettings();
  if (!cfg.enabled || cfg.autoMode !== "onOpenClose" || syncInFlight) return;
  event.preventDefault();
  quittingForSync = true;
  void runFullSync().finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
