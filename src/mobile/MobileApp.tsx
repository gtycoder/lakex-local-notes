/**
 * 移动端产品壳（Phase 1：替代 MobilePocApp 组装入口，§3.2 结构）。
 * - 路由栈：home（小记/知识库）→ notebook → document（viewer/editor）；Sheet/Drawer 作 overlay。
 * - 数据：直接走 bridge 真实端口（folders CRUD/notes/搜索/同步已就绪），不做 fixture。
 * - 复杂卡片（画板/思维导图/流程图）：viewer 只读渲染（§19.1），编辑入口置灰。
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bridge } from "./bridge";
import { resetAssetPerf, snapshotAssetPerf } from "./assetPerf";
import type { LocalNoteSummary } from "./noteRepository";
import { isGoneNote } from "../core/syncDecisions";
import { setNoteRefHost } from "../features/editor/noteRef";
import type { TreeNode } from "../lib/types";
import { HomePage } from "./home/HomePage";
import { consumeSharedContent, sharedContentToSeed, subscribeSharedContent, type QuickNoteSeed } from "./sharedContent";
import { sha256Sync } from "../core/sha256Sync.js";
import { scheduleKernelPrewarm } from "./kernelPrewarm";
import { quickNoteBodyFromTextAndImages, type StoredQuickNoteImage } from "../core/quickNoteModel.js";
import { localAssetHttpUrl } from "../core/assetUrl.js";

/**
 * 小记写作区（懒加载）：261010 起 **深链/长按那条 capture 路径与工作台共用同一个内核卡片**
 * （桌面同款未展开版式：图片/待办/有序/无序/分割线 + 右上角展开）。
 * 此前 capture 走不挂内核的 `QuickNoteFlashComposer`（秒开但不可展开、无富编辑），已按用户 261010 决定统一并删除。
 * 懒加载保持入口 chunk 不含内核。
 */
const QuickNoteComposer = lazy(() => import("./home/QuickNoteComposer").then((m) => ({ default: m.QuickNoteComposer })));
import { CreateNotebookSheet } from "./settings/CreateNotebookSheet";
import { SearchSheet } from "./settings/SearchSheet";
import { SettingsDrawer } from "./settings/SettingsDrawer";
import { useBackHandler } from "./useBackHandler";
import { useAutoSync } from "./useAutoSync";
import { Toasts } from "./ui/Toasts";
import { AttachmentPreview } from "../features/attachment/AttachmentPreview";
import { ImageLightbox } from "../features/editor/ImageLightbox";
import { subscribeQuickNoteShortcut } from "./quickNoteShortcut";
import { ConfirmHost } from "./ui/ConfirmDialog";
import { showToast } from "./ui/toastBus";
import { reportNativeActionError } from "../lib/nativeErrors";
import { successFeedback, warnFeedback } from "./ui/haptics";
import { runNativeSqliteSpike } from "./nativeSqlite";
import { buildLakeNative } from "./lakeNativeContract";
import { migrateSnapshotToNativeSqlite } from "./nativeSqliteMigration";
import "./mobile.css";

/** 第二层工作区（内含 Lake 内核编辑器）：**按需加载**。
 * 冷启动不需要内核；静态引入会把整个内核打进入口 chunk（实测 6.7MB），拖慢所有启动路径。 */
const NotebookWorkspace = lazy(() => import("./notebook/NotebookWorkspace").then((m) => ({ default: m.NotebookWorkspace })));

export type Route =
  | { kind: "home"; tab: "quick" | "library" }
  | { kind: "notebook"; notebookId: string; initialNoteId?: string | null; initialMode?: "viewer" | "editor" };

export function MobileApp() {
  const [route, setRoute] = useState<Route>({ kind: "home", tab: "library" });
  /** 小记（长按桌面图标的快捷方式）：独立入口，不等启动完成即可输入。 */
  const [captureOpen, setCaptureOpen] = useState(false);
  /** 系统分享带入的初始内容（文本 + 图片）；null = 空白/恢复草稿。 */
  const [captureSeed, setCaptureSeed] = useState<QuickNoteSeed | null>(null);
  /** 每次打开「小记」框递增：作为 key 强制重挂载，保证 seed/草稿各自生效。 */
  const [captureNonce, setCaptureNonce] = useState(0);
  /** 分享带入是否已落成草稿：落好再挂内核（composer 只在挂载时读 initialBody）。 */
  const [seedReady, setSeedReady] = useState(true);
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [notes, setNotes] = useState<LocalNoteSummary[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const [phase, setPhase] = useState<"booting" | "ready">("booting");
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createNbOpen, setCreateNbOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickNotes, setQuickNotes] = useState<Array<{ id: string; previewText: string; imageCount: number; updatedAt: string; firstImage: string | null }>>([]);

  const refreshAll = useCallback(async () => {
    const [nodes, ns, qn] = await Promise.all([bridge.listTreeNodes(), bridge.listNotes(), bridge.listQuickNotes()]);
    setTreeNodes(nodes);
    setNotes(ns);
    setQuickNotes(qn);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await bridge.init();
        // lakeNative 调试/测试契约（对齐桌面端）：供 CDP 驱动与真机调试直接调用 bridge 端口
        // lakeNative 调试/测试契约（对齐桌面端）：供 CDP 驱动与真机调试直接调用 bridge 端口。
        // 实现从 bridge / 附加入口**派生**（名字清单单一来源见 ./lakeNativeContract）。
        (window as unknown as Record<string, unknown>).lakeNative = buildLakeNative({
          bridge: bridge as unknown as Record<string, unknown>,
          extra: { runNativeSqliteSpike, migrateSnapshotToNativeSqlite },
        });
        // 资产传输性能观测（CDP 诊断：__lakePerf.reset() / __lakePerf.snapshot()）。
        (window as unknown as Record<string, unknown>).__lakePerf = {
          reset: resetAssetPerf,
          snapshot: snapshotAssetPerf,
        };
        await refreshAll();
        setPhase("ready");
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [refreshAll]);

  // 自动同步（261012）：autoMode=interval 起定时器；onOpenClose 在冷启动就绪 + 回到前台时补一次。
  useAutoSync();

  // 定时自动快照：按历史设置 snapshotIntervalMinutes（0=关）周期给当前打开笔记留档
  // （当前活动文档由工作区经 onActiveNoteChange 上报到 activeIdRef）
  useEffect(() => {
    let timer: number | null = null;
    void bridge.getHistorySettings().then((cfg) => {
      if (cfg.snapshotIntervalMinutes <= 0) return;
      timer = window.setInterval(() => {
        const id = activeIdRef.current;
        if (id) void bridge.snapshotNote(id).catch((error) => reportNativeActionError("自动快照", error));
      }, Math.max(1, cfg.snapshotIntervalMinutes) * 60 * 1000);
    }).catch((error) => reportNativeActionError("读取快照设置", error));
    return () => { if (timer != null) window.clearInterval(timer); };
  }, []);

  // 长按桌面图标 →「小记」：冷启动（getLaunchUrl）与热启动（appUrlOpen）都收敛到这里。
  // 直接打开**独立入口**（见下方 captureOpen 分支）——不等 bridge.init()/refreshAll()，做到最早可输入。
  useEffect(() => subscribeQuickNoteShortcut(() => {
    setRoute({ kind: "home", tab: "quick" });
    setCaptureSeed(null);
    setCaptureNonce((n) => n + 1);
    setCaptureOpen(true);
  }), []);

  // 系统分享（ACTION_SEND）→ 打开「小记」框并预填：冷启动读一次性内容，热启动订阅 "shared"。
  useEffect(() => {
    let alive = true;
    void (async () => {
      const content = await consumeSharedContent();
      if (!alive || !content) return;
      const seed = await sharedContentToSeed(content);
      if (alive && seed) { setCaptureSeed(seed); setCaptureNonce((n) => n + 1); setCaptureOpen(true); }
    })();
    return () => { alive = false; };
  }, []);
  useEffect(() => subscribeSharedContent((content) => {
    void (async () => {
      const seed = await sharedContentToSeed(content);
      if (seed) { setCaptureSeed(seed); setCaptureNonce((n) => n + 1); setCaptureOpen(true); }
    })();
  }), []);

  /**
   * 系统分享带入：先把 seed 落成一份**草稿**（图片落盘 + 正文由无内核写入通道合成），
   * 再让内核 composer 挂载时恢复它 —— 统一成内核卡片后仍支持分享带入，且不丢图/不丢文本。
   */
  useEffect(() => {
    if (!captureOpen || !captureSeed) { setSeedReady(true); return; }
    let alive = true;
    setSeedReady(false);
    void (async () => {
      try {
        const id = crypto.randomUUID();
        const images: StoredQuickNoteImage[] = [];
        for (const img of captureSeed.images) {
          try {
            const staged = await bridge.stageQuickNoteAsset(id, { filename: img.filename, bytes: img.bytes });
            images.push({
              id: crypto.randomUUID(),
              filename: staged.filename,
              mimeType: staged.mimeType,
              width: null,
              height: null,
              size: staged.size,
              hash: sha256Sync(img.bytes),
            });
          } catch { /* 坏图跳过，不阻断带入 */ }
        }
        const body = quickNoteBodyFromTextAndImages(
          captureSeed.text,
          images,
          (filename) => localAssetHttpUrl(id, filename, { space: "quick-notes" }),
          () => crypto.randomUUID(),
        );
        await bridge.saveQuickNoteDraft({ id, text: captureSeed.text, body, images });
      } catch (error) {
        reportNativeActionError("带入分享内容", error);
      } finally {
        if (alive) setSeedReady(true);
      }
    })();
    return () => { alive = false; };
  }, [captureOpen, captureSeed]);

  // 内核预热（261010）：bridge 就绪后**空闲**点燃一次内核 —— 本次会话首次打开文档/小记卡片从 334–928ms 降到热态量级。
  // 只点燃不保留实例（见 kernelPrewarm.ts 头注释：内核有模块级单例，不做实例池/移交）。
  useEffect(() => { if (phase === "ready") scheduleKernelPrewarm(); }, [phase]);

  const notebooks = useMemo(() => treeNodes.filter((n) => n.nodeType === "notebook"), [treeNodes]);
  // 笔记本 → 直接文档数（首页列表行 .counter；与 listNotebookTree 的归属口径一致：parent 为笔记本）
  const docCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const n of notes) { if (n.parentId) m[n.parentId] = (m[n.parentId] ?? 0) + 1; }
    return m;
  }, [notes]);

  // B1：Android 返回键（浮层返回栈 → Sheet→Drawer→笔记本→首页→系统；编辑态由工作区自己注册）
  useBackHandler({
    route,
    drawerOpen,
    createNbOpen,
    searchOpen,
    captureOpen,
    onCloseCapture: () => setCaptureOpen(false),
    onBackFromNotebook: () => setRoute({ kind: "home", tab: "library" }),
    onCloseDrawer: () => setDrawerOpen(false),
    onCloseSheets: () => { setCreateNbOpen(false); setSearchOpen(false); },
    onAppExit: () => {
      // 首页返回：交给系统退出（@capacitor/app 默认行为）
      void import("@capacitor/app").then(({ App }) => App.exitApp?.()).catch(() => undefined);
    },
  });

  /** 打开文档：一律进第二层工作区（此前"首页/搜索→DocumentPage、笔记本→NotebookWorkspace"两套壳，形态不一致）。
   *  ① 先按 AGENTS §3 #16 判定"已进回收站/被他端 purge"；② 再向上解析归属笔记本（note 的父可以是 note/group）。 */
  const openNote = useCallback(async (id: string, mode: "viewer" | "editor" = "viewer") => {
    const st = await bridge.noteGoneState(id);
    if (!st) { showToast("文档不存在", { type: "error" }); return; }
    if (isGoneNote({ parentId: st.parentId, syncState: st.syncState })) {
      showToast("该文档已在回收站，请到 设置-回收站 查看", { type: "error" });
      return;
    }
    const parentOfNote = new Map(notes.map((n) => [n.id, n.parentId] as const));
    const nodeById = new Map(treeNodes.map((n) => [n.id, n] as const));
    let cur: string | null = st.parentId;
    let notebookId: string | null = null;
    for (let hops = 0; cur && hops < 64; hops++) {
      const node = nodeById.get(cur);
      if (node) { if (node.nodeType === "notebook") { notebookId = node.id; break; } cur = node.parentId; continue; }
      cur = parentOfNote.get(cur) ?? null;
    }
    if (!notebookId) { showToast("未找到该文档所属笔记本（可在数据体检中修复）", { type: "error" }); return; }
    await refreshAll();
    setRoute({ kind: "notebook", notebookId, initialNoteId: id, initialMode: mode });
  }, [notes, treeNodes, refreshAll]);

  /** 「文档引用」卡（内核自定义卡）在移动端也要能选目标文档：注册宿主（与桌面 App.tsx 同一接口）。
   *  移动端摘要只有 id/title/parentId/updatedAt ⇒ 补默认 sortOrder/syncState/isConflict；
   *  成功态判定仍靠 parentId（回收站）兜底，不读 lake 正文。 */
  useEffect(() => {
    setNoteRefHost({
      listNotes: () => notes.map((n) => ({
        id: n.id, title: n.title, parentId: n.parentId, updatedAt: n.updatedAt,
        sortOrder: 0, syncState: "synced" as const, isConflict: false,
      })),
      openNote: (id) => { void openNote(id, "viewer"); },
    });
    return () => setNoteRefHost(null);
  }, [notes, openNote]);

  // 新建文档：归属指定父节点（home → 兜底笔记本；工作区 → 当前笔记本），随后进入工作区编辑态
  const createNoteInParent = useCallback(async (parentId: string | null) => {
    try {
      const n = await bridge.createNote("无标题文档", parentId);
      successFeedback(); // 新建文档确认
      await openNote(n.id, "editor");
    } catch { showToast("新建失败", { type: "error" }); warnFeedback(); }
  }, [openNote]);

  // 小记独立入口：在 bridge.init()/refreshAll() 之前就渲染轻量框（输入框最早出现）。
  // 保存时才按需打开 DB（saveQuickNoteWithImages → ensureDb()），所以不必等启动完成。
  if (captureOpen) {
    return (
      <div className="mobile-app">
        <div className="mobile-qn-composer-wrap">
          {seedReady ? (
            <Suspense fallback={<div className="mobile-qn-composer" />}>
              <QuickNoteComposer
                key={captureNonce}
                draft
                onSaved={async () => { setCaptureOpen(false); setCaptureSeed(null); void refreshAll(); }}
                onCancel={() => { setCaptureOpen(false); setCaptureSeed(null); }}
              />
            </Suspense>
          ) : (
            <div className="mobile-qn-composer" />
          )}
        </div>
      </div>
    );
  }

  if (phase === "booting") return <div className="poc-center">启动中…</div>;
  if (error) return <div className="poc-center poc-error">{error}</div>;

  return (
    <div className="mobile-app">
      <SettingsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onRefresh={refreshAll}
        onOpenNote={(id) => void openNote(id, "viewer")}
      />
      {route.kind === "home" && (
        <HomePage
          tab={route.tab}
          notebooks={notebooks}
          notes={notes}
          quickNotes={quickNotes}
          docCounts={docCounts}
          onTabChange={(tab) => setRoute({ kind: "home", tab })}
          onOpenNotebook={(id) => setRoute({ kind: "notebook", notebookId: id })}
          onOpenNote={(id) => void openNote(id, "viewer")}
          onOpenDrawer={() => setDrawerOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
          onCreateNotebook={() => setCreateNbOpen(true)}
          onQuickNotesChanged={refreshAll}
        />
      )}
      {route.kind === "notebook" && (
        <Suspense fallback={<div className="poc-center">加载中…</div>}>
        <NotebookWorkspace
          key={route.notebookId}
          notebookId={route.notebookId}
          initialNoteId={route.initialNoteId ?? null}
          initialMode={route.initialMode}
          onBack={() => setRoute({ kind: "home", tab: "library" })}
          notebooks={notebooks}
          onSwitchNotebook={(id) => setRoute({ kind: "notebook", notebookId: id })}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenSettings={() => setDrawerOpen(true)}
          onCreateNote={() => void createNoteInParent(route.notebookId)}
          onActiveNoteChange={(id) => { activeIdRef.current = id; }}
        />
        </Suspense>
      )}
      <CreateNotebookSheet
        open={createNbOpen}
        onClose={() => setCreateNbOpen(false)}
        onCreate={async (input) => {
          try {
            await bridge.createNotebook(input);
            successFeedback(); // 新建知识库确认
            await refreshAll();
            showToast("已新建知识库");
          } catch { showToast("新建失败", { type: "error" }); warnFeedback(); }
        }}
      />
      <SearchSheet
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpenNote={(id) => void openNote(id, "viewer")}
      />
      <Toasts />
      <ConfirmHost />
      {/* 共享图片预览浮层（桌面/移动同一套控制器）：小记卡片、文档内图片点开都是它。 */}
      <ImageLightbox />
      <AttachmentPreview />
    </div>
  );

}
