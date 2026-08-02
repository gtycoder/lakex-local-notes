import { app, BrowserWindow, ipcMain, session, type WebFrameMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./store.js";
import { startAssetServer, ASSET_PORT } from "./assetServer.js";
import { testConnection, syncNow } from "./sync.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let store: Store;

function workspaceRoot(): string {
  return path.join(app.getPath("userData"), "workspace-default");
}

/** Lake 编辑器 CDN 资源本地镜像（public/vendor/cdn → dist/vendor/cdn） */
function vendorCdnDir(): string {
  return path.join(__dirname, "..", isDev ? "public" : "dist", "vendor", "cdn");
}

/** 资源本地化：把 Lake 编辑器运行时请求的 gw.alipayobjects.com CDN 重定向到本地 asset server */
function registerCdnRedirect() {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["*://gw.alipayobjects.com/*"] },
    (details, callback) => {
      try {
        const u = new URL(details.url);
        const rel = u.pathname.replace(/^\/+/, ""); // 保留原始编码，asset server 统一 decode 一次
        if (!rel) { callback({ cancel: true }); return; }
        callback({ redirectURL: "http://127.0.0.1:" + ASSET_PORT + "/vendor/cdn/" + rel });
      } catch {
        callback({ cancel: true });
      }
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

  if (isDev) {
    await win.loadURL("http://127.0.0.1:1421");
  } else {
    await win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

/** IPC 只接受本应用页面（dev server / 打包 file://）发来的调用 */
function isTrustedSenderFrame(frame: WebFrameMain | null): boolean {
  if (!frame) return false;
  try {
    const url = frame.url;
    if (url.startsWith("file://")) return true;
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) return true;
    if (url.startsWith("devtools://") || url === "about:blank") return true;
    return false;
  } catch { return false; }
}

function registerIpc() {
  let syncInFlight = false;
  const handle = (channel: string, fn: (...args: any[]) => any) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedSenderFrame(event.senderFrame)) throw new Error("IPC 调用来源不受信任");
      return fn(...args);
    });
  };

  handle("bootstrap_workspace", () => store.bootstrap());
  handle("read_note", (id: string) => store.readNote(id));
  handle("create_note", (title: string) => store.createNote(title));
  handle("save_note", (id: string, title: string, content: string) => store.saveNote(id, title, content));
  handle("delete_note", (id: string) => store.deleteNote(id));
  handle("list_tree_nodes", () => store.listTreeNodes());
  handle("create_notebook", (title: string) => store.createNotebook(title));
  handle("create_group", (parentId: string, title: string) => store.createGroup(parentId, title));
  handle("rename_tree_node", (id: string, title: string) => store.renameTreeNode(id, title));
  handle("create_note_in", (parentId: string | null, title: string) => store.createNoteIn(parentId, title));
  handle("move_tree_node", (id: string, parentId: string | null, sortOrder: number) => store.moveTreeNode(id, parentId, sortOrder));
  handle("reorder_tree_nodes", (parentId: string | null, orderedIds: string[]) => store.reorderTreeNodes(parentId, orderedIds));
  handle("delete_tree_node", (id: string) => store.deleteTreeNode(id));
  handle("upload_resource", (input: { bytes: number[]; filename: string }, noteId: string) => store.uploadResource(input, noteId));
  handle("download_remote_resource", (url: string, noteId: string) => store.downloadRemoteResource(url, noteId));
  handle("list_orphan_assets", () => store.listOrphanAssets());
  handle("clean_orphan_assets", () => store.cleanOrphanAssets());
  handle("get_s3_settings", () => store.getS3Settings());
  handle("save_s3_settings", (settings: unknown) => store.saveS3Settings(settings as Parameters<Store["saveS3Settings"]>[0]));
  handle("test_s3_connection", () => testConnection(store));
  // sync_now 需要携带进度事件（主进程 → 渲染进程）
  ipcMain.handle("sync_now", (event) => {
    if (!isTrustedSenderFrame(event.senderFrame)) throw new Error("IPC 调用来源不受信任");
    if (syncInFlight) throw new Error("同步正在进行中，请等待本次同步完成");
    syncInFlight = true;
    return syncNow(store, (progress) => { try { event.sender.send("sync-progress", progress); } catch { /* 窗口已关闭 */ } })
      .finally(() => { syncInFlight = false; });
  });
  handle("get_sync_status", () => store.getSyncStatus());
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
    registerCdnRedirect();
    startAssetServer(path.join(workspaceRoot(), "note-assets"), vendorCdnDir());
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
