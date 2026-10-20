/**
 * 移动端产品壳（Phase 1：替代 MobilePocApp 组装入口，§3.2 结构）。
 * - 路由栈：home（小记/知识库）→ notebook → document（viewer/editor）；Sheet/Drawer 作 overlay。
 * - 数据：直接走 bridge 真实端口（folders CRUD/notes/搜索/同步已就绪），不做 fixture。
 * - 复杂卡片（画板/思维导图/流程图）：viewer 只读渲染（§19.1），编辑入口置灰。
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bridge } from "./bridge";
import { resetAssetPerf, snapshotAssetPerf } from "./native/assetPerf";
import type { LocalNoteSummary } from "./data/noteRepository";
import { isGoneNote } from "../core/syncDecisions";
import { setNoteRefHost } from "../features/editor/noteRef";
import type { TreeNode } from "../lib/types";
import { HomePage, type MobileQuickNote } from "./home/HomePage";
import { consumeSharedContent, sharedContentToSeed, subscribeSharedContent, type QuickNoteSeed } from "./native/sharedContent";
import { sha256Sync } from "../core/sha256Sync.js";
import { scheduleComposerPrewarm, scheduleKernelPrewarm } from "./native/kernelPrewarm";
import { QuickNoteComposerLazy } from "./home/quickNoteComposerLazy";
import { quickNoteBodyFromTextAndImages, type StoredQuickNoteImage } from "../core/quickNoteModel.js";
import { localAssetHttpUrl } from "../core/assetUrl.js";

/**
 * 小记写作区（懒加载）：261010 起 **深链/长按那条 capture 路径与工作台共用同一个内核卡片**
 * （桌面同款未展开版式：图片/待办/有序/无序/分割线 + 右上角展开）。
 * 此前 capture 走不挂内核的 `QuickNoteFlashComposer`（秒开但不可展开、无富编辑），已按用户 261010 决定统一并删除。
 * 懒加载保持入口 chunk 不含内核。
 */
// 小记编辑器 = 按需加载壳（预取过则同步渲染；未预取先骨架）——见 home/quickNoteComposerLazy.tsx
import { CreateNotebookSheet } from "./settings/CreateNotebookSheet";
import { SearchSheet } from "./settings/SearchSheet";
import { SettingsDrawer } from "./settings/SettingsDrawer";
import { useBackHandler } from "./hooks/useBackHandler";
import { useRouteTransition } from "./hooks/useRouteTransition";
import { useAutoSync } from "./hooks/useAutoSync";
import { Toasts } from "./ui/Toasts";
import { AttachmentPreview } from "../features/attachment/AttachmentPreview";
import { ImageLightbox } from "../features/editor/ImageLightbox";
import { subscribeQuickNoteShortcut } from "./native/quickNoteShortcut";
import { ConfirmHost } from "./ui/ConfirmDialog";
import { showToast } from "./ui/toastBus";
import { reportNativeActionError } from "../lib/nativeErrors";
import { successFeedback, warnFeedback } from "./ui/haptics";
import { runNativeSqliteSpike } from "./native/nativeSqlite";
import { buildLakeNative } from "./native/lakeNativeContract";
import { migrateSnapshotToNativeSqlite } from "./native/nativeSqliteMigration";
import "./mobile.css";

/** 第二层工作区（内含 Lake 内核编辑器）：**按需加载**。
 * 冷启动不需要内核；静态引入会把整个内核打进入口 chunk（实测 6.7MB），拖慢所有启动路径。 */
const NotebookWorkspace = lazy(() => import("./notebook/NotebookWorkspace").then((m) => ({ default: m.NotebookWorkspace })));

/**
 * 退出 App（Android：结束任务）。
 * 两个调用点共用同一实现：① 首页返回键（原有）；② **快捷入口「保存后退出」**（用户 261013 定稿）。
 */
function exitApp(): void {
  // @capacitor/app 动态引入：本模块被静态引，这里也静态引会让其它模块对它的懒加载分包失效。
  void import("@capacitor/app").then(({ App }) => App.exitApp?.()).catch(() => undefined);
}

export type Route =
  | { kind: "home"; tab: "quick" | "library" }
  | { kind: "notebook"; notebookId: string; initialNoteId?: string | null; initialMode?: "viewer" | "editor" };

export function MobileApp() {
  /** 冷启动固定落在「小记」（用户 261014 定；快捷 capture 那条本来也落在小记）。 */
  const [route, setRoute] = useState<Route>({ kind: "home", tab: "quick" });
  /**
   * 路由转场（261019，对齐语雀 push；状态机见 hooks/useRouteTransition）：
   * 工作区按需挂载、播完出场才卸载；首页层常驻（页栈语义）⇒ 返回时列表滚动位置与数据都在。
   */
  const {
    mounted: wsMounted,
    open: wsOpen,
    settled: wsSettled,
    animating: routeAnimating,
    close: closeWorkspace,
    homeRef: routeHomeRef,
    wsRef: routeWsRef,
  } = useRouteTransition(route.kind, () => setRoute({ kind: "home", tab: "library" }));
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
  // 用 HomePage 导出的 MobileQuickNote：这条链（仓储 → bridge → 列表 → 卡片）字段必须一路一致，
  //  261015 加 createdAt 时就因为这里另写了一份内联类型而漏改（tsc 当场抓到）。
  const [quickNotes, setQuickNotes] = useState<MobileQuickNote[]>([]);

  const refreshAll = useCallback(async () => {
    const [nodes, ns, qn] = await Promise.all([bridge.listTreeNodes(), bridge.listNotes(), bridge.listQuickNotes()]);
    setTreeNodes(nodes);
    setNotes(ns);
    setQuickNotes(qn);
  }, []);

  /**
   * 从工作区回到首页时刷新列表（261020 实测）：首页是 keep-alive 常驻层，`refreshAll` 只在冷启动与
   * 首页自身操作时跑 ⇒ 在工作区新建/编辑后返回，笔记本计数与「最近文档」还是旧的（用户报的「计数不涨」）。
   * 只刷数据、不挡转场（与打开文档那条 refreshAll 同一姿势）。
   */
  const prevRouteKindRef = useRef<Route["kind"] | null>(null);
  useEffect(() => {
    const prev = prevRouteKindRef.current;
    prevRouteKindRef.current = route.kind;
    if (prev === "notebook" && route.kind === "home") void refreshAll().catch(() => undefined);
  }, [route.kind, refreshAll]);

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
  useAutoSync(phase === "ready");

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

  /**
   * 本次 capture 是否由**快捷入口**（长按桌面图标 / `lakenotes://quick-note` 深链）拉起 —— 决定两件事（用户 261013 定稿）：
   *  ① **手动退出时直接退 App 回桌面**（"假单独模块"，模仿思源的闪念速记；首页底栏「新建小记」那条不受影响）；
   *  ② 这次会话**不主动发起同步**（见 `useAutoSync` 的 capture 会话判定：入口 / 回前台 / 进后台三处都跳过）。
   */
  const captureLaunchedRef = useRef(false);

  /**
   * 手动退出 capture（系统返回键 / 「取消」按钮）：关界面 + 按需刷新小记列表；
   * **快捷入口这次会话 = 直接退 App 回桌面**（"记完就走"，不再落进 App 的小记列表页）。
   */
  function closeCapture() {
    setCaptureOpen(false);
    setCaptureSeed(null);
    if (captureLaunchedRef.current) { captureLaunchedRef.current = false; exitApp(); return; }
    void refreshAll();
  }

  // 长按桌面图标 →「小记」：冷启动（getLaunchUrl）与热启动（appUrlOpen）都收敛到这里。
  // 直接打开**独立入口**（见下方 captureOpen 分支）——不等 bridge.init()/refreshAll()，做到最早可输入。
  useEffect(() => subscribeQuickNoteShortcut(() => {
    captureLaunchedRef.current = true;
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
  useEffect(() => {
    if (phase !== "ready") return;
    // 快捷 capture 会话：composer 分包已在（写作卡就是内核卡片）、内核实例已由它创建 ⇒ 不再额外预热，
    // 否则就绪 4s 后会再跑一次 6.1MB 内核加载+实例化（实测 ~1.7s 长任务）来打断正在写作的用户。
    if (captureLaunchedRef.current) return;
    scheduleKernelPrewarm();
    // 小记编辑器分包提前预取（只拉分包/不实例化）：冷启动后很快点「编辑/新建小记」不再闪加载页
    scheduleComposerPrewarm();
  }, [phase]);

  const notebooks = useMemo(() => treeNodes.filter((n) => n.nodeType === "notebook"), [treeNodes]);
  /** 首页常驻渲染：工作区打开期间它只是被盖住（inert），tab 值取当前 home 路由或回退「知识库」（返回落点）。 */
  const homeTab = route.kind === "home" ? route.tab : "library";
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
    onCloseCapture: closeCapture,
    onBackFromNotebook: closeWorkspace,
    onCloseDrawer: () => setDrawerOpen(false),
    onCloseSheets: () => { setCreateNbOpen(false); setSearchOpen(false); },
    onAppExit: () => {
      // 首页返回：交给系统退出（@capacitor/app 默认行为）
      exitApp();
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
    // 先起转场：首页列表的 refreshAll 不必挡在路由前面（实测会把 push 延迟 ~700ms，观感像"点了没反应"）。
    setRoute({ kind: "notebook", notebookId, initialNoteId: id, initialMode: mode });
    void refreshAll().catch(() => undefined);
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
            <QuickNoteComposerLazy
              key={captureNonce}
              draft
              raiseKeyboard
              // 「假单独模块」（用户 261013 定稿，模仿思源的闪念速记）：**提交后不进入小记列表** ——
              // 重挂一条全新的空小记、停在写作界面，可以连着记好几条；退出只有当面的「返回键 / 取消」= 手动退出（直接回桌面）。
              // 列表刷新留到"手动退出且不退 App"时才做（不退 App 的情况列表才可见；退 App 时下次进来自然是最新的）。
              onSaved={async () => { setCaptureNonce((n) => n + 1); setCaptureSeed(null); }}
              onCancel={closeCapture}
            />
          ) : (
            <div className="mobile-qn-composer" />
          )}
        </div>
      </div>
    );
  }

  if (phase === "booting") return <MobileHomeSkeleton />;
  if (error) return <div className="poc-center poc-error">{error}</div>;

  return (
    <div className="mobile-app">
      <SettingsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onRefresh={refreshAll}
        onOpenNote={(id) => void openNote(id, "viewer")}
      />
      {/* 路由层（261019）：首页常驻 + 工作区按需挂载；push/pop 只动 transform（见 mobile.css） */}
      <div className={"mobile-route-stage" + (wsOpen ? " is-open" : "") + (routeAnimating ? " is-animating" : "")} aria-label="页面">
      <div className="mobile-route-layer mobile-route-layer--home" ref={routeHomeRef}>
        <HomePage
          tab={homeTab}
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
          onCreateNote={(notebookId) => void createNoteInParent(notebookId)}
          onTreeChanged={refreshAll}
          onQuickNotesChanged={refreshAll}
        />
      </div>
      {route.kind === "notebook" && wsMounted && (
        <div className={"mobile-route-layer mobile-route-layer--workspace" + (wsSettled ? " is-settled" : "")} ref={routeWsRef}>
        <Suspense fallback={
          <div className="mobile-route-skeleton" aria-busy="true" aria-label="正在打开">
            <span className="mb-skel mb-route-skeleton__title" />
            <span className="mb-skel mb-route-skeleton__line" />
            <span className="mb-skel mb-route-skeleton__line" />
            <span className="mb-skel mb-route-skeleton__line" />
          </div>
        }>
        <NotebookWorkspace
          key={route.notebookId}
          notebookId={route.notebookId}
          initialNoteId={route.initialNoteId ?? null}
          initialMode={route.initialMode}
          onBack={closeWorkspace}
          notebooks={notebooks}
          onSwitchNotebook={(id) => setRoute({ kind: "notebook", notebookId: id })}
          onActiveNoteChange={(id) => { activeIdRef.current = id; }}
        />
        </Suspense>
        </div>
      )}
      </div>
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

/**
 * 冷启动骨架（261013，6.9）：结构与真实首页同构、尺寸走同一批令牌 ⇒ 数据到达后原地填充、不整屏跳。
 * 纯静态、无内核、无数据依赖；容器 aria-busy，占位条 aria-hidden（读屏不会念出一堆无意义节点）。
 */
function MobileHomeSkeleton() {
  return (
    <div className="mobile-app">
      <div className="mobile-home" aria-busy="true">
        {/* 与真实顶栏同构：左 = 设置 + 等宽空槽，右 = 排序/视图 + 云同步（两枚）⇒ tab 居中、填充不跳。 */}
        <header className="toolbar toolbar--border mobile-topbar">
          <span className="mb-skel mb-skel--icon" aria-hidden="true" />
          <span className="mb-skel mb-skel--icon" aria-hidden="true" />
          <div className="mobile-home-tabs">
            <span className="mb-skel mb-skel--tab" aria-hidden="true" />
            <span className="mb-skel mb-skel--tab" aria-hidden="true" />
          </div>
          <span className="mb-skel mb-skel--icon" aria-hidden="true" />
          <span className="mb-skel mb-skel--icon" aria-hidden="true" />
        </header>
        <div className="mobile-tab-stage">
          <div className="mobile-scroll">
            <section className="home-section">
              <div className="home-section__head"><span className="mb-skel mb-skel--group" aria-hidden="true" /></div>
              <span className="mb-skel mb-skel--row" aria-hidden="true" />
              <span className="mb-skel mb-skel--row" aria-hidden="true" />
              <span className="mb-skel mb-skel--row" aria-hidden="true" />
            </section>
          </div>
        </div>
        {/* 骨架的胶囊槽数必须与真实胶囊一致（261014 起 3 项：搜索 / ＋ / AI），否则数据到达时宽度会跳一次。 */}
        <nav className="mobile-bottom-bar mobile-bottom-bar--home" aria-hidden="true">
          <span className="mb-skel mb-skel--baritem" />
          <span className="mb-skel mb-skel--baritem" />
          <span className="mb-skel mb-skel--baritem" />
        </nav>
      </div>
    </div>
  );
}
