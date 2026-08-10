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
import { testConnection, syncNow } from "./sync.js";
import { syncQuickNotes } from "./quickNotesSync.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

// 开发版与打包版隔离 userData：dev 用 lake-notes-dev（空库+种子），打包版用
// lake-notes-electron（正式数据），避免测试数据互相污染。必须在 app ready 前设置。
if (isDev) {
  app.setPath("userData", path.join(app.getPath("appData"), "lake-notes-dev"));
}
const DEV_SERVER_URL = "http://127.0.0.1:1421";

let store: Store;
let quickNotes: QuickNotesStore;

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
  let syncInFlight = false;
  const handle = (channel: string, fn: (...args: any[]) => any) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedSenderFrame(event.senderFrame, event.sender)) throw new Error("IPC 调用来源不受信任");
      return fn(...args);
    });
  };

  handle("bootstrap_workspace", () => store.bootstrap());
  handle("read_note", (id: string) => store.readNote(id));
  handle("create_note", (title: string) => store.createNote(title));
  handle("save_note", (id: string, title: string, content: string, caches?: { markdown?: string | null; plain?: string | null }) => store.saveNote(id, title, content, caches));
  handle("update_note_caches", (id: string, markdown: string | null, plain: string | null) => {
    store.updateNoteCaches(id, markdown ?? null, plain ?? null);
  });
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
  // sync_now 需要携带进度事件（主进程 → 渲染进程）
  ipcMain.handle("sync_now", (event) => {
    if (!isTrustedSenderFrame(event.senderFrame, event.sender)) throw new Error("IPC 调用来源不受信任");
    if (syncInFlight) throw new Error("同步正在进行中，请等待本次同步完成");
    syncInFlight = true;
    return (async () => {
      // 顺序是 Lake → 小记。Lake 成功后才允许转换源小记的删除 tombstone 同步出去；
      // 小记空间独立，即使其失败也不能把 Lake 的成功同步变成失败。
      const result = await syncNow(store, (progress) => { try { event.sender.send("sync-progress", progress); } catch { /* 窗口已关闭 */ } });
      quickNotes.markTargetNotesSynced();
      try {
        const settings = store.getS3Settings();
        if (!settings) throw new Error("请先保存 S3 配置");
        const quick = await syncQuickNotes(quickNotes, settings, (progress) => { try { event.sender.send("sync-progress", progress); } catch { /* 窗口已关闭 */ } });
        result.quickNotes = quick;
      } catch (error) {
        result.quickNotes = { uploaded: 0, downloaded: 0, conflicts: 0, completedAt: new Date().toISOString(), error: String(error) };
        try { event.sender.send("sync-progress", { phase: "quick-notes", message: `小记同步失败：${String(error)}` }); } catch { /* 窗口已关闭 */ }
      }
      // syncNow() 先持久化 Lake 结果；小记阶段完成后覆盖 lastResult，
      // 让下次打开同步面板仍能看到“小记失败但 Lake 已完成”等完整状态。
      store.recordSyncResult(JSON.stringify(result));
      try { event.sender.send("sync-progress", { phase: "done", message: "同步完成" }); } catch { /* 窗口已关闭 */ }
      return result;
    })().finally(() => { syncInFlight = false; });
  });
  handle("get_sync_status", () => store.getSyncStatus());

  // 小记 IPC：完全独立于 Lake 文档 IPC，图片只进入 quick-notes/staging / assets 空间。
  handle("list_quick_notes", () => quickNotes.listQuickNotes());
  handle("create_quick_note", (input: { text: string; draftId: string; stagedImageIds: string[] }) => quickNotes.createQuickNote(input));
  handle("update_quick_note", (id: string, input: { text: string; draftId: string; stagedImageIds: string[]; retainedImageIds?: string[] }) => quickNotes.updateQuickNote(id, input));
  handle("delete_quick_note", (id: string) => quickNotes.deleteQuickNote(id));
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
    store = new Store(workspaceRoot());
    quickNotes = new QuickNotesStore(workspaceRoot());
    quickNotes.recoverConversions((noteId) => store.hasNote(noteId), (noteId) => store.removeUntrackedNoteArtifacts(noteId));
    registerCdnRedirect();
    startAssetServer(path.join(workspaceRoot(), "note-assets"), vendorCdnDir(), path.join(workspaceRoot(), "quick-notes"));
    registerIpc();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
