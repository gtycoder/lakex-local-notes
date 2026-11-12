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
import { diaryEntries, diaryNotebooks } from "../core/diary.js";
import { diaryNodesFrom } from "./diary/diaryNodes.js";
import { libraryNotebooks } from "./notebook/libraryNotebooks";
import { setNoteRefHost } from "../features/editor/noteRef";
import type { TreeNode } from "../lib/types";
import { HomePage, type MobileQuickNote } from "./home/HomePage";
import type { HomeTab } from "./home/tabPager";
import { consumeSharedContent, readSharedContentBytes, sharedContentKind, sharedContentToSeed, sharedContentUnsupportedHint, sharedMarkdownFiles, subscribeSharedContent, type QuickNoteSeed, type SharedContent, type SharedMarkdownFile } from "./native/sharedContent";
import { readImportDefaultNotebook, writeImportDefaultNotebook } from "./settings/importSettings";
import { readDefaultHomeTab } from "./settings/defaultSpace";
import { DefaultNotebookPickerSheet, type DefaultNotebookOption } from "./settings/DefaultNotebookPickerSheet";
import { SHARE_QUEUE_FULL_HINT, ShareQueue } from "./ink/shareQueue";
import { sha256Sync } from "../core/sha256Sync.js";
import { scheduleComposerPrewarm, scheduleKernelPrewarm } from "./native/kernelPrewarm";
import { QuickNoteComposerLazy } from "./home/quickNoteComposerLazy";
import { quickNoteBodyFromTextAndImages, type StoredQuickNoteImage } from "../core/quickNoteModel.js";
import { localAssetHttpUrl } from "../core/assetUrl.js";
import { buildQuickNoteTagIndex, buildQuickNoteTagOptions, type QuickNoteTag } from "../core/quickNoteTags.js";
import { installMissingAssetPlaceholders } from "./editor/missingAssetPlaceholder";
import { subscribeHistorySettings } from "./lib/historySettingsSync";
import { useFormFactor } from "./pad/useFormFactor";
import { usePadShortcuts } from "./pad/usePadShortcuts";

/**
 * 小记写作区（懒加载）：261010 起 **深链/长按那条 capture 路径与工作台共用同一个内核卡片**
 * （桌面同款未展开版式：图片/待办/有序/无序/分割线 + 右上角展开）。
 * 此前 capture 走不挂内核的 `QuickNoteFlashComposer`（秒开但不可展开、无富编辑），已按用户 261010 决定统一并删除。
 * 懒加载保持入口 chunk 不含内核。
 */
// 小记编辑器 = 按需加载壳（预取过则同步渲染；未预取先骨架）——见 home/quickNoteComposerLazy.tsx
import { CreateNotebookSheet } from "./settings/CreateNotebookSheet";
import { useBackHandler } from "./hooks/useBackHandler";
import { useDoubleBackExit } from "./hooks/useDoubleBackExit";
import { useRouteTransition } from "./hooks/useRouteTransition";
import { useAutoSync } from "./hooks/useAutoSync";
import { useUpdateAutoCheck } from "./hooks/useUpdateAutoCheck";
import { readSyncProgress, subscribeSyncProgress } from "./sync/syncProgressStore";
import { Toasts } from "./ui/Toasts";
import { AttachmentPreview } from "../features/attachment/AttachmentPreview";
import { ImageLightbox } from "../features/editor/ImageLightbox";
import { MobileBrandLaunchMark } from "./ui/BrandLaunchMark";
import { subscribeQuickNoteShortcut } from "./native/quickNoteShortcut";
import { ConfirmHost, confirmMobile } from "./ui/ConfirmDialog";
import { MobileErrorBoundary } from "./ui/MobileErrorBoundary";
import { formatCrashEntries, readCrashLog } from "./lib/crashLog";
import { checkMobileDbHealth, classifyDbOpenError, describeDbHealth } from "./data/dbHealth";
import { ensureDb } from "./bridge/context";
import { showToast } from "./ui/toastBus";
import { getNativeErrorMessage, reportNativeActionError } from "../lib/nativeErrors";
import { successFeedback, warnFeedback } from "./ui/haptics";
// 261111 首屏瘦身：原生调试契约（lakeNativeContract / nativeSqlite）与缓存清理（cachePort）都是
// 「启动后/出错时才会用到」的重依赖 —— 改成用时动态 import，不进入口静态图。
import "./mobile.css";
import "./brand-launch.css";

/**
 * 启动链路里「不能进首屏静态图、但 boot 第一段就要用」的模块：**模块求值即预取**（与 React 首帧并行），
 * boot 里再 await —— 这样首屏不多付字节，也不为动态 import 多等一轮往返（261111 首屏瘦身）。
 * 预取失败收敛成 null（不抛未处理拒绝）：退化为「该步不可用」，与原先各处的 try/catch 同语义。
 */
const bootPortableModule = import("./portable/importPortable").catch((error) => {
  console.warn("[portable] 编排模块加载失败", error);
  return null;
});
const bootDebugModules = Promise.all([import("./native/lakeNativeContract"), import("./native/nativeSqlite")]).catch((error) => {
  console.warn("[boot] 调试契约模块加载失败（不影响启动）", error);
  return null;
});

/** 第二层工作区（内含 Lake 内核编辑器）：**按需加载**。
 * 冷启动不需要内核；静态引入会把整个内核打进入口 chunk（实测 6.7MB），拖慢所有启动路径。 */
import { EmptyState } from "./ui/EmptyState";
import { PanelLoading } from "./ui/PanelLoading";
import { consumeBack, pushBackHandler } from "./ui/backStack";
import { DeferredPanel } from "./ui/DeferredPanel";
import { toastActionError } from "./lib/actionError";
const NotebookWorkspace = lazy(() => import("./notebook/NotebookWorkspace").then((m) => ({ default: m.NotebookWorkspace })));
/** AI 全屏页按需加载：不进首页首屏（与内核/表格一样不加重入口）。 */
/** 搜索 Sheet 按需加载（MOB-15 首屏预算）：只在点「搜索」时打开，静态引入会把它的依赖链
 *  （reportMobileActionError → toastBus/nativeErrors）拆成入口预加载 chunk（261028 实测 +3）。 */
const SearchSheet = lazy(() => import("./settings/SearchSheet").then((m) => ({ default: m.SearchSheet })));
/** 设置抽屉按需加载（261103 P10）：它是入口图里最后一块大依赖（含 core/s3v3Report 诊断格式化、S3 表单等），
 *  打开设置才需要；懒加载后首屏不用付这份解析成本。Suspense 由渲染处兜底（短暂空抽屉）。 */
const SettingsDrawer = lazy(() => import("./settings/SettingsDrawer").then((m) => ({ default: m.SettingsDrawer })));
/** 回收站文档只读打开（Q04B，261112 第二轮）：复用设置里那条预览页（自带内核样式 + 懒加载边界，
 *  与 SettingsDrawer → TrashPreviewPage 同一个分包；入口 chunk 不新增内核字节）。 */
const TrashPreviewPage = lazy(() => import("./trash/TrashPreviewPage").then((m) => ({ default: m.TrashPreviewPage })));

/**
 * 退出 App（Android：结束任务）。
 * 两个调用点共用同一实现：① 首页返回键（原有）；② **快捷入口「保存后退出」**（用户 261013 定稿）。
 */
function exitApp(): void {
  // @capacitor/app 动态引入：本模块被静态引，这里也静态引会让其它模块对它的懒加载分包失效。
  void import("@capacitor/app").then(({ App }) => App.exitApp?.()).catch(() => undefined);
}

export type Route =
  | { kind: "home"; tab: HomeTab }
  | { kind: "notebook"; notebookId: string; initialNoteId?: string | null; initialMode?: "viewer" | "editor" };

export function MobileApp({ initialCapture = false }: { initialCapture?: boolean } = {}) {
  /**
   * 冷启动落点 = **设置 → 常规 → 默认空间**（261110 用户点单）；默认「小记」（261014 定）。
   * 只读设备本地偏好（settings/defaultSpace，前缀 lakex-local-notes-mobile.，不进 S3）；
   * 快捷 capture 那条入口不受影响（它本来也落在小记）。
   */
  const [route, setRoute] = useState<Route>(() => ({ kind: "home", tab: readDefaultHomeTab() }));
  /**
   * 工作区打开来源的一级页（261110）：**从日记打开 ⇒ 关闭/返回时回「日记」**，其余保持既有「知识库」落点。
   * 两条返回路径（页面返回 = closeWorkspace；安卓返回键 = requestWorkspaceBack → 工作区 handler → closeWorkspace）
   * 都收敛到 useRouteTransition 的 onClosed 回调，所以只在这里记一次来源就够，不必各写一套。
   */
  const workspaceOriginTabRef = useRef<HomeTab | null>(null);
  /**
   * 261110（底部 Dock 五格）：AI 空间是**页面而不是浮层** ⇒ 返回键应先回上一个非 AI 空间。
   * 记录"最近一个非 AI 的首页 tab"，返回 AI 时回到它（默认小记）。
   */
  const lastNonAiTabRef = useRef<HomeTab>("quick");
  useEffect(() => {
    if (route.kind === "home" && route.tab !== "ai") lastNonAiTabRef.current = route.tab;
  }, [route]);
  useEffect(() => {
    if (route.kind !== "home" || route.tab !== "ai") return;
    return pushBackHandler(() => { setRoute({ kind: "home", tab: lastNonAiTabRef.current }); return true; });
  }, [route]);
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
  } = useRouteTransition(route.kind, () => {
    // 261110：回「打开它的那个一级页」（日记 → 日记页签），其余保持既有「知识库」落点；
    // 记完即清，下一次打开重新记（不会把上一次的来源带到别处）。
    const origin = workspaceOriginTabRef.current;
    workspaceOriginTabRef.current = null;
    setRoute({ kind: "home", tab: origin ?? "library" });
  });
  /** 回收站文档只读预览（Q04B）：非 null = 全屏预览页打开（打开已进回收站/被他端 purge 的文档时进入）。 */
  const [trashPreviewId, setTrashPreviewId] = useState<string | null>(null);
  /** Q04B：回收站只读预览是应用级全屏页 ⇒ 返回键先关它（与 AI 空间同一套返回栈机制）。 */
  useEffect(() => {
    if (!trashPreviewId) return;
    return pushBackHandler(() => { setTrashPreviewId(null); return true; });
  }, [trashPreviewId]);
  /** 小记（长按桌面图标的快捷方式）：独立入口，不等启动完成即可输入。
   *  261022：冷启动由原生同步 hint 在首帧前给出判定 ⇒ 首帧直接进 capture，不再先画首页骨架。 */
  const [captureOpen, setCaptureOpen] = useState(initialCapture);
  /** 系统分享带入的初始内容（文本 + 图片）；null = 空白/恢复草稿。 */
  const [captureSeed, setCaptureSeed] = useState<QuickNoteSeed | null>(null);
  /** 每次打开「小记」框递增：作为 key 强制重挂载，保证 seed/草稿各自生效。 */
  const [captureNonce, setCaptureNonce] = useState(0);
  /** 分享带入是否已落成草稿：落好再挂内核（composer 只在挂载时读 initialBody）。 */
  const [seedReady, setSeedReady] = useState(true);
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [notes, setNotes] = useState<LocalNoteSummary[]>([]);
  const activeIdRef = useRef<string | null>(null);
  /** 工作区注册的可等待返回动作；硬件返回键必须走它，不能直接卸载工作区。 */
  const workspaceBackRef = useRef<(() => Promise<void>) | null>(null);
  const [phase, setPhase] = useState<"booting" | "ready">("booting");
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createNbOpen, setCreateNbOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  /**
   * 搜索范围（261109）：null = 全库（首页胶囊那条）；"diary" = 日记内搜索（日记页入口）。
   * **只在显示层过滤结果**（按日记条目 id 集合），不动 FTS/索引/public 搜索逻辑（docs/DIARY.md §搜索）。
   */
  const [searchScope, setSearchScope] = useState<null | "diary">(null);
  // 平板外接键盘：⌘/Ctrl+K = 全局搜索（手机不挂；判据见 pad/usePadShortcuts）。
  const padShell = useFormFactor() === "expanded";
  // 平板：⌘/Ctrl+K 全局搜索；Esc 逐层收（本层没东西可关时返回 false，把 Esc 让给工作区那条监听）。
  usePadShortcuts(padShell, {
    // ⌘/Ctrl+K 恒为**全库搜索**：不能让上一次「日记内搜索」的范围残留到这里。
    search: () => { setSearchScope(null); setSearchOpen(true); },
    escape: () => {
      if (consumeBack()) return true;
      if (searchOpen) { setSearchOpen(false); return true; }
      if (drawerOpen) { setDrawerOpen(false); return true; }
      if (createNbOpen) { setCreateNbOpen(false); return true; }
      return false;
    },
  });
  /** 全局搜索命中「小记」后待首页打开的 id（首页常驻，交给 HomePage 的 effect 接力）。 */
  const [pendingQuickNoteId, setPendingQuickNoteId] = useState<string | null>(null);
  // 用 HomePage 导出的 MobileQuickNote：这条链（仓储 → bridge → 列表 → 卡片）字段必须一路一致，
  //  261015 加 createdAt 时就因为这里另写了一份内联类型而漏改（tsc 当场抓到）。
  const [quickNotes, setQuickNotes] = useState<MobileQuickNote[]>([]);
  const [tagDirectory, setTagDirectory] = useState<QuickNoteTag[]>([]);
  /** 写作区用完整目录（含 0 条小记的新标签）；列表标签条只用有计数的索引。 */
  const quickTagOptions = useMemo(
    () => buildQuickNoteTagOptions(tagDirectory, buildQuickNoteTagIndex(quickNotes, tagDirectory, (note) => note.tagIds).tags),
    [quickNotes, tagDirectory],
  );

  const refreshAll = useCallback(async () => {
    const [snapshot, tags] = await Promise.all([bridge.getHomeSnapshot(), bridge.listQuickNoteTags()]);
    setTreeNodes(snapshot.treeNodes);
    setNotes(snapshot.notes);
    setQuickNotes(snapshot.quickNotes.items);
    setTagDirectory(tags);
  }, []);

  /** 标签子系统独立刷新：建/改/删标签只动目录，不回读小记列表。 */
  const refreshQuickNoteTags = useCallback(async () => {
    setTagDirectory(await bridge.listQuickNoteTags());
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

  /**
   * P0-6 渐进展示（261026 用户点单「先让文档能够展示出来」）：首拉时引擎每 100 篇应用一次，
   * UI 也要跟着刷列表 —— 否则 DB 里已经有 1000 篇，首页还显示「0 篇」，要等整轮同步结束才出现。
   * 只在正文/应用阶段触发，节流 2s；同步结束（progress 清空）自然停止。
   */
  useEffect(() => {
    let lastRefreshAt = 0;
    return subscribeSyncProgress(() => {
      const p = readSyncProgress();
      if (!p || (p.phase !== "bodies" && p.phase !== "apply")) return;
      const now = Date.now();
      if (now - lastRefreshAt < 2000) return;
      lastRefreshAt = now;
      void refreshAll().catch(() => undefined);
    });
  }, [refreshAll]);

  /**
   * 启动失败（MOB-08）：错误对象只保留在 ref 里给「复制诊断」用；界面状态只存可读文案。
   * 之前 catch 里只 setError 不退出 booting ⇒ 失败后永远停在骨架 + 启动遮罩，用户没有任何出路。
   */
  const bootErrorRef = useRef<unknown>(null);
  /** 坏库（261105）：打开即报损坏消息，或启动后的 quick_check 不通过 ⇒ 渲染「坏库页」而不是普通启动错误页。 */
  const [dbUnhealthy, setDbUnhealthy] = useState<{ reason: string } | null>(null);
  const boot = useCallback(async () => {
    // 启动速度优先：不加人为最短展示；native splash + WebView overlay 只覆盖真实加载时间。
    setError(null);
    try {
      // 便携包导入中断恢复（docs/PORTABLE-TRANSFER.md §3.6）：**必须在打开数据库之前**按 pending 回滚，
      // 否则旧库已被替换、新库半成品会带进来。失败只记日志，不阻断启动。
      // 261111：编排模块（映射/回滚/原生包）只在启动这一步用 ⇒ 动态 import（模块求值已预取）；
      // **顺序契约不变**（仍在 init 前）。
      try {
        const portable = await bootPortableModule;
        if (portable) await portable.recoverInterruptedPortableImport();
      } catch (error) { console.warn("[portable] 中断导入恢复失败", error); }
      await bridge.init();
      // lakeNative 调试/测试契约（对齐桌面端）：供 CDP 驱动与真机调试直接调用 bridge 端口。
      // 实现从 bridge / 附加入口**派生**（名字清单单一来源见 ./lakeNativeContract）。
      // 261111：调试契约与原生 sqlite spike 均非首屏必需 ⇒ 动态 import（模块求值已预取）。
      // 加载失败只丢调试入口，**绝不让整个启动失败**。
      const debugModules = await bootDebugModules;
      if (debugModules) {
        const [{ buildLakeNative }, { runNativeSqliteSpike }] = debugModules;
        (window as unknown as Record<string, unknown>).lakeNative = buildLakeNative({
          bridge: bridge as unknown as Record<string, unknown>,
          extra: { runNativeSqliteSpike },
        });
      }
      // 资产传输性能观测（CDP 诊断：__lakePerf.reset() / __lakePerf.snapshot()）。
      (window as unknown as Record<string, unknown>).__lakePerf = {
        reset: resetAssetPerf,
        snapshot: snapshotAssetPerf,
      };
      await refreshAll();
      setPhase("ready");
      // 便携包恢复提示：复用启动时已预取的编排模块（失败 = 无提示，不影响就绪）。
      const portable = await bootPortableModule;
      if (portable) {
        const portableNotice = portable.consumePortableRecoveryNotice();
        if (portableNotice) showToast(portableNotice, { type: "info" });
      }
    } catch (e) {
      bootErrorRef.current = e;
      setError(getNativeErrorMessage(e));
      // 坏库与普通启动失败分开：坏库要立刻给「从云端恢复」出口，光重试没有意义。
      if (classifyDbOpenError(e) === "corrupt") setDbUnhealthy({ reason: getNativeErrorMessage(e) });
    }
  }, [refreshAll]);
  useEffect(() => { void boot(); }, [boot]);

  /** 「复制诊断」：错误 + 运行环境 + 现有 getDiagnostics 计数（DB 没打开时如实说明）。 */
  const copyBootDiagnostics = useCallback(async () => {
    const lines = [
      "时间：" + new Date().toISOString(),
      "错误：" + (error ?? "未知"),
      "环境：" + (typeof navigator === "undefined" ? "unknown" : navigator.userAgent),
    ];
    const raw = bootErrorRef.current;
    if (raw instanceof Error && raw.stack) lines.push("堆栈：\n" + raw.stack);
    try {
      const d = await bridge.getDiagnostics();
      lines.push(
        "诊断：文档 " + d.noteCount + " / 分组 " + d.folderCount + " / 小记 " + d.quickNoteCount
        + " / 资源 " + d.resourceCount + " / 孤儿 " + d.orphanCount + " / 待回收 " + d.gcPendingCount
        + " / 快照 " + d.snapshotCount + " / 库 " + d.dbBytes + " B",
      );
    } catch {
      lines.push("诊断：数据库未打开，读取失败");
    }
    // 261105：带上最近崩溃/异常记录（全局 handler + 错误边界 + 上一条原生崩溃都在同一份环形缓冲里）。
    const crashes = formatCrashEntries(readCrashLog(10));
    if (crashes.length > 0) lines.push("", "最近崩溃记录：", ...crashes);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      showToast("诊断信息已复制");
    } catch {
      showToast("复制失败，请记录屏幕上的错误信息", { type: "error" });
    }
  }, [error]);

  /** 「清派生缓存后重试」：只用现有 cachePort（只清可重建数据，不动正文/资源/未同步修改）。 */
  const clearCacheAndRetry = useCallback(async () => {
    try {
      // 261111：错误页动作才会用 ⇒ 动态 import（不进入口静态图）。
      const { mobileCachePort } = await import("./native/cachePort");
      await mobileCachePort.clearDerivedCaches();
    } catch (reason) {
      toastActionError("清理缓存", reason);
      return;
    }
    await boot();
  }, [boot]);

  /** 坏库页「从云端恢复（换机/坏库）」：复用 bridge.restoreFromCloud（清本机同步账本 → 只拉不打）。 */
  const restoreAfterDbProblem = useCallback(async (): Promise<void> => {
    const confirmed = await confirmMobile({
      title: "从云端恢复？",
      body: "会清空本机同步记录，然后以云端为准全部重新下载（只下载，不上传本机内容）。云端没有的本机文档会移入回收站（可恢复），本机附件不会被删除。",
      confirmText: "从云端恢复",
      danger: true,
    });
    if (!confirmed) return;
    try {
      const result = await bridge.restoreFromCloud();
      if (!result.ok) { showToast(result.message, { type: "error" }); return; }
      showToast(result.message);
      setDbUnhealthy(null);
      setError(null);
      await boot();
    } catch (reason) {
      toastActionError("从云端恢复", reason);
    }
  }, [boot]);

  /**
   * 坏库自检（261105）：启动成功后**延后**跑一次 PRAGMA quick_check（不挡首屏；大库也只是毫秒级读）。
   * 打开阶段就抛错的路径由 boot 的 catch 归类；这里兜「打得开但结构损坏」的静默情况。
   */
  useEffect(() => {
    if (phase !== "ready" || dbUnhealthy) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const health = await checkMobileDbHealth(await ensureDb());
          if (!cancelled && !health.ok) setDbUnhealthy({ reason: describeDbHealth(health) });
        } catch (error) {
          if (!cancelled && classifyDbOpenError(error) === "corrupt") setDbUnhealthy({ reason: getNativeErrorMessage(error) });
        }
      })();
    }, 2500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [phase, dbUnhealthy]);

  // 自动同步（261012）：autoMode=interval 起定时器；onOpenClose 在冷启动就绪 + 回到前台时补一次。
  useAutoSync(phase === "ready");
  // 应用内更新：就绪后检查一次 + 回前台按 24h 节流（设置里可关；仅 Android 原生）。
  useUpdateAutoCheck(phase === "ready");

  /**
   * 按需资产占位（261027）：按需下载时，还没打开过的文档/小记里的图片本地没有文件，AssetServer 404 →
   * 内核显示破图。这里统一接管为「图片未下载，点击下载」：点击补拉这一篇/这一条缺失的媒体（维护域，
   * 不阻塞其它操作），成功后就地把所有同 key 的图片恢复成真实地址；离线/未配置时给提示。
   */
  useEffect(() => installMissingAssetPlaceholders(document, {
    download: async (refs) => {
      const noteIds = [...new Set(refs.filter((r) => r.space === "note").map((r) => r.noteId))];
      const quickIds = [...new Set(refs.filter((r) => r.space === "quick-notes").map((r) => r.noteId))];
      let downloaded = 0;
      let failed = 0;
      try {
        if (noteIds.length > 0) { const got = await bridge.ensureNoteAssets(noteIds); downloaded += got.downloaded; failed += got.failed; }
        if (quickIds.length > 0) { const got = await bridge.ensureQuickNoteAssets(quickIds); downloaded += got.downloaded; failed += got.failed; }
      } catch (error) {
        console.warn("[asset] 占位图补拉失败", error);
      }
      return { downloaded, failed };
    },
    showToast: (message, type) => showToast(message, { type: type ?? "info" }),
  }), []);

  // 定时自动快照：按历史设置 snapshotIntervalMinutes（0=关）周期给当前打开笔记留档
  // （当前活动文档由工作区经 onActiveNoteChange 上报到 activeIdRef）。
  // MOB-17：设置页保存历史设置后经 subscribeHistorySettings 广播 ⇒ 这里先清旧定时器再按新间隔重挂，
  // 不再"挂载时读一次、改设置要重启才生效"。
  useEffect(() => {
    let timer: number | null = null;
    /** effect 已卸载（App 切 capture / StrictMode 双挂载）时不再起新定时器。 */
    let disposed = false;
    /** 首次读库返回前用户已经改过设置 ⇒ 丢弃这次旧值，避免把新间隔覆盖回去。 */
    let changedByUser = false;
    const apply = (cfg: { snapshotIntervalMinutes: number }) => {
      if (disposed) return;
      if (timer != null) { window.clearInterval(timer); timer = null; }
      if (cfg.snapshotIntervalMinutes <= 0) return;
      timer = window.setInterval(() => {
        const id = activeIdRef.current;
        if (id) void bridge.snapshotNote(id).catch((error) => reportNativeActionError("自动快照", error));
      }, Math.max(1, cfg.snapshotIntervalMinutes) * 60 * 1000);
    };
    void bridge.getHistorySettings()
      .then((cfg) => { if (!changedByUser) apply(cfg); })
      .catch((error) => reportNativeActionError("读取快照设置", error));
    const unsubscribe = subscribeHistorySettings((cfg) => { changedByUser = true; apply(cfg); });
    return () => {
      disposed = true;
      unsubscribe();
      if (timer != null) window.clearInterval(timer);
    };
  }, []);

  /**
   * 本次 capture 是否由**快捷入口**（长按桌面图标 / `lakexlocalnotes://quick-note` 深链）拉起 —— 决定两件事（用户 261013 定稿）：
   *  ① **手动退出时直接退 App 回桌面**（"假单独模块"，模仿思源的闪念速记；首页底栏「新建小记」那条不受影响）；
   *  ② 这次会话**不主动发起同步**（见 `useAutoSync` 的 capture 会话判定：入口 / 回前台 / 进后台三处都跳过）。
   */
  const captureLaunchedRef = useRef(initialCapture);

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
  }, { skipColdRead: initialCapture }), [initialCapture]);

  /**
   * 单个分享的实际处理（冷启动 consume / 热启动 subscribe 共用；由串行队列调用，不自己抢锁）：
   * · pdf：读 shared-inbox 字节 → 新建手写板（默认笔记本）→ 共享 PDF 导入适配器 → 打开新文档；
   *   失败把刚建的空文档移入回收站并给可见 toast（importSharedPdfAsInkNote 内部回滚）。
   * · image：保持原行为（落小记草稿 + 打开 capture）。
   * · file：保持「暂不支持该分享类型」可见提示。
   */
  /**
   * 分享 Markdown → 导入为文档（261106 task-86）：
   * 默认笔记本 → 读文本 → 共享 md→lake 管线 → createNote + saveNote；多文件逐个导入并报进度。
   * 失败逐条提示、不留半成品（服务层已把半成品软删回滚）；本地图片在分享场景不可达 ⇒ 管线降级为链接。
   */
  const [mdImportFiles, setMdImportFiles] = useState<SharedMarkdownFile[] | null>(null);
  const runMarkdownShareImport = useCallback(async (files: SharedMarkdownFile[], notebookId: string) => {
    const notebook = treeNodes.find((node) => node.id === notebookId && node.nodeType === "notebook");
    if (!notebook) {
      // 默认笔记本已不存在（可能被删/改名）：重新让用户选一次，不硬塞到未知父级。
      setMdImportFiles(files);
      return;
    }
    // 261111 首屏瘦身：Markdown 导入管线（含桌面共用 pipeline）只在真的分享导入时用 ⇒ 动态 import。
    const { importSharedMarkdown, markdownTitleOf } = await import("./import/markdownShareImport");
    const summary = await importSharedMarkdown({
      files,
      notebookId,
      onProgress: (index, total, file) => {
        showToast(total > 1 ? "正在导入 " + index + "/" + total + "：" + markdownTitleOf(file.filename, file.displayName) : "正在导入 " + markdownTitleOf(file.filename, file.displayName));
      },
    });
    await refreshAll().catch(() => undefined);
    if (summary.imported.length > 0) {
      const warn = summary.warnings.length > 0 ? "（" + summary.warnings.length + " 处图片已降级为链接）" : "";
      showToast("已导入 " + summary.imported.length + " 篇 Markdown 到「" + (notebook.title || "未命名") + "」" + warn);
      successFeedback();
    }
    if (summary.failed.length > 0) {
      const first = summary.failed[0];
      showToast("导入失败 " + summary.failed.length + " 个：" + first.reason, { type: "error" });
      warnFeedback();
    }
  }, [refreshAll, treeNodes]);

  const processSharedContent = useCallback(async (content: SharedContent) => {
    if (content.imageError) showToast(content.imageError, { type: "error" });
    // 261106：Markdown（单/多文件）→ 导入为文档；与 PDF（手写板）按类型分流。
    const markdownFiles = sharedMarkdownFiles(content);
    if (markdownFiles.length > 0) {
      const notebookId = readImportDefaultNotebook();
      if (!notebookId) { setMdImportFiles(markdownFiles); return; }
      await runMarkdownShareImport(markdownFiles, notebookId);
      return;
    }
    if (sharedContentKind(content) === "pdf") {
      const payload = await readSharedContentBytes(content);
      if (!payload) {
        // 读不到（文件损坏/权限/旧 APK）：保留提示，文件仍在 shared-inbox 可重试；不进小记
        showToast(sharedContentUnsupportedHint(content) ?? "PDF 读取失败，文件已保留可重试", { type: "error" });
        return;
      }
      showToast("正在导入 PDF…");
      try {
        // 261111 首屏瘦身：PDF→手写板导入链（pdfImport + 手写板历史）只在分享 PDF 时用 ⇒ 动态 import。
        const { importSharedPdfAsInkNote, sharedPdfImportToast } = await import("./ink/mobilePdfImport");
        const imported = await importSharedPdfAsInkNote(payload);
        workspaceOriginTabRef.current = null;
        setRoute({ kind: "notebook", notebookId: imported.notebookId, initialNoteId: imported.noteId });
        // 一句话说清三态（成功 / 截断 / 部分页失败），只弹一个 toast。
        showToast(sharedPdfImportToast(imported));
      } catch (reason) {
        toastActionError("PDF 导入", reason);
        warnFeedback();
      }
      return;
    }
    // 261102 T2-C：文件分享保持可见提示，不静默当图片；只有 image 才进小记 seed。
    const unsupported = sharedContentUnsupportedHint(content);
    if (unsupported) showToast(unsupported, { type: "error" });
    const seed = await sharedContentToSeed(content);
    if (seed) { setCaptureSeed(seed); setCaptureNonce((n) => n + 1); setCaptureOpen(true); }
  }, []);

  /**
   * 系统分享**串行队列**（261102 T2-E）：冷启动 consume 与热启动 shared 事件可能同时/连续到达，
   * 以前 busy 标志会「处理中直接忽略」（连点分享无声丢）；现在排队，上限 5，满了给可见提示。
   * 队列实现是纯类（ink/shareQueue.ts），这里只接线。
   */
  const shareQueueRef = useRef<ShareQueue<SharedContent> | null>(null);
  if (shareQueueRef.current === null) {
    shareQueueRef.current = new ShareQueue<SharedContent>({
      handle: processSharedContent,
      onOverflow: () => showToast(SHARE_QUEUE_FULL_HINT, { type: "error" }),
      onError: (_item, reason) => toastActionError("分享处理", reason),
    });
  }

  /** 分享入口：入队即返回，实际处理由队列串行执行。 */
  const handleSharedContent = useCallback((content: SharedContent) => {
    shareQueueRef.current?.enqueue(content);
  }, []);

  // 系统分享（ACTION_SEND）：冷启动读一次性内容 + 热启动订阅 shared 事件，两条都收敛到 handleSharedContent。
  useEffect(() => {
    let alive = true;
    void (async () => {
      const content = await consumeSharedContent();
      if (!alive || !content) return;
      handleSharedContent(content);
    })();
    return () => { alive = false; };
  }, [handleSharedContent]);
  useEffect(() => subscribeSharedContent((content) => { handleSharedContent(content); }), [handleSharedContent]);

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

  /**
   * 知识库列表 = **文档空间的笔记本**（261109，与桌面同口径：日记是独立空间，不是知识库里的一本）。
   * 判据已抽到 `./notebook/libraryNotebooks`（core 的 withoutDiaryNotebook + TRASH_NOTEBOOK_ID 组合；
   * 测试见 libraryNotebooks.test.ts）。只过滤渲染，不动存储/同步。
   */
  const notebooks = useMemo(() => libraryNotebooks(treeNodes), [treeNodes]);
  /**
   * 日记判据的输入 = **目录 + 文档混合视图**：treeNodes 只有 folders，日记条目在 notes 表里
   * （只喂 folders ⇒ 日记页空、日记内搜索恒 0 条、转文档找不到条目）。投影函数在 diary/diaryNodes.ts。
   */
  const diaryTreeNodes = useMemo(() => diaryNodesFrom(treeNodes, notes), [treeNodes, notes]);
  /** 日记条目 id 集合（日记内搜索的结果过滤；来自 core.diary.diaryEntries）。 */
  const diaryNoteIds = useMemo(() => new Set(diaryEntries(diaryTreeNodes, diaryNotebooks(diaryTreeNodes)[0]?.id ?? null).map((entry) => entry.noteId)), [diaryTreeNodes]);
  /** 默认笔记本选择器（设置与首次分享共用）：只是把 treeNodes 里的笔记本投影成选项。 */
  const notebookOptions: DefaultNotebookOption[] = useMemo(
    () => notebooks.map((node) => ({ id: node.id, title: node.title || "未命名" })),
    [notebooks],
  );
  /** 首页常驻渲染：工作区打开期间它只是被盖住（inert），tab 值取当前 home 路由或回退「知识库」（返回落点）。 */
  // 工作区打开期间首页被盖住：tab 取「来源页」（从日记进入 ⇒ 日记页留在下层，返回时不会先闪一下知识库）。
  const homeTab: HomeTab = route.kind === "home" ? route.tab : (workspaceOriginTabRef.current ?? "library");
  // 笔记本 → 直接文档数（首页列表行 .counter；与 getWorkspaceSnapshot 的树归属口径一致）
  const docCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const n of notes) { if (n.parentId) m[n.parentId] = (m[n.parentId] ?? 0) + 1; }
    return m;
  }, [notes]);

  const requestWorkspaceBack = useCallback(() => {
    const handler = workspaceBackRef.current;
    if (handler) void handler();
    else closeWorkspace();
  }, [closeWorkspace]);

  const registerWorkspaceBack = useCallback((handler: (() => Promise<void>) | null) => {
    workspaceBackRef.current = handler;
  }, []);

  /**
   * 首页最终兜底（261106 用户要求）：按一次不再直接退 App，先提示「再按一次退出应用」，2 秒内再按才退出。
   * 只改这一处兜底；浮层 → 小记 → Sheet → Drawer → 工作区 的优先级仍由 useBackHandler 原样给出。
   */
  const handleAppExit = useDoubleBackExit({ exit: exitApp });

  // B1：Android 返回键（浮层返回栈 → Sheet→Drawer→笔记本→首页→系统；编辑态由工作区自己注册）
  useBackHandler({
    route,
    drawerOpen,
    createNbOpen,
    searchOpen,
    captureOpen,
    onCloseCapture: closeCapture,
    onBackFromNotebook: requestWorkspaceBack,
    onCloseDrawer: () => setDrawerOpen(false),
    onCloseSheets: () => { setCreateNbOpen(false); setSearchOpen(false); },
    // 首页返回：两次确认才退出（第一次只提示）。
    onAppExit: handleAppExit,
  });

  /** 打开文档：一律进第二层工作区（此前"首页/搜索→DocumentPage、笔记本→NotebookWorkspace"两套壳，形态不一致）。
   *  ① 先按 AGENTS §3 #16 判定"已进回收站/被他端 purge"；② 再向上解析归属笔记本（note 的父可以是 note/group）。 */
  const openNote = useCallback(async (id: string, mode: "viewer" | "editor" = "viewer") => {
    const st = await bridge.noteGoneState(id);
    if (!st) { showToast("文档不存在", { type: "error" }); return; }
    if (isGoneNote({ parentId: st.parentId, syncState: st.syncState })) {
      // Q04B（261112 第二轮裁决）：**不拒绝打开**。已进回收站/被他端 purge 的文档一律进只读预览页
      // （横幅明说「编辑与保存会被拦」+ 显式「恢复」）——对齐 AGENTS §3#16，绝不静默丢弃编辑。
      setTrashPreviewId(id);
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
    // 来自首页/搜索/置顶等既有入口 ⇒ 返回落点保持原样（知识库）。
    workspaceOriginTabRef.current = null;
    // 先起转场：首页列表的 refreshAll 不必挡在路由前面（实测会把 push 延迟 ~700ms，观感像"点了没反应"）。
    setRoute({ kind: "notebook", notebookId, initialNoteId: id, initialMode: mode });
    void refreshAll().catch(() => undefined);
  }, [notes, treeNodes, refreshAll]);

  /** 全局搜索命中「小记」：回首页小记 tab，交给 HomePage 定位/高亮（不自动进编辑态）。 */
  const openQuickNoteFromSearch = useCallback((id: string) => {
    setSearchOpen(false);
    setRoute({ kind: "home", tab: "quick" });
    setPendingQuickNoteId(id);
  }, []);

  /**
   * 日记条目 → 现有工作区（261109）。**不新造编辑面**：正文输入仍走工作区 + dock。
   * 直接带 notebookId 进路由（不走 openNote 的祖先回溯）：当天日记刚被 ensure 建出来时，首页快照里还没有它。
   */
  const openDiaryEntry = useCallback(async (input: { noteId: string; notebookId: string; mode: "viewer" | "editor" }) => {
    // 261112 task-55（M1）：日记条目也是「打开文档」入口 ⇒ 必须先过 AGENTS §3#16 的 gone 判据
    // （本机回收站 / 被他端 purge）：进只读预览 + 横幅，绝不静默打开一条已删的陈旧条目。
    const state = await bridge.noteGoneState(input.noteId).catch(() => null);
    if (!state) {
      showToast("日记不存在（可能已被删除）", { type: "error" });
      void refreshAll().catch(() => undefined);
      return;
    }
    if (isGoneNote({ parentId: state.parentId, syncState: state.syncState })) {
      setTrashPreviewId(input.noteId);
      return;
    }
    // 记录来源页 = 日记 ⇒ 关闭/返回（页面返回或安卓返回键，两条都走 useRouteTransition.onClosed）回日记页签。
    workspaceOriginTabRef.current = "diary";
    setRoute({ kind: "notebook", notebookId: input.notebookId, initialNoteId: input.noteId, initialMode: input.mode });
    void refreshAll().catch(() => undefined);
  }, [refreshAll]);

  /** 打开搜索：首页胶囊 = 全库；日记页 = 日记内（结果按日记条目 id 过滤，见 SearchSheet.scopeNoteIds）。 */
  const openSearchAll = useCallback(() => { setSearchScope(null); setSearchOpen(true); }, []);
  const openDiarySearch = useCallback(() => { setSearchScope("diary"); setSearchOpen(true); }, []);

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
        <div className="mobile-qn-screen">
          {seedReady ? (
            <QuickNoteComposerLazy
              key={captureNonce}
              draft
              raiseKeyboard
              tagOptions={quickTagOptions}
              onCreateTag={async (name) => {
                const created = await bridge.createQuickNoteTag(name);
                await refreshQuickNoteTags();
                return created.id;
              }}
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

  // 坏库优先于普通启动失败（261105）：只重试没有意义，必须先给「从云端恢复」出口。
  if (dbUnhealthy) return (
    <MobileDatabaseProblemPage
      reason={dbUnhealthy.reason}
      onRetry={() => void boot()}
      onClearCacheAndRetry={() => void clearCacheAndRetry()}
      onRestoreFromCloud={() => void restoreAfterDbProblem()}
      onCopyDiagnostics={() => void copyBootDiagnostics()}
    />
  );
  // 启动失败优先于骨架：否则 catch 后 phase 仍停在 booting，用户只能看着永久骨架（MOB-08）。
  if (error) return (
    <MobileBootErrorPage
      message={error}
      onRetry={() => void boot()}
      onClearCacheAndRetry={() => void clearCacheAndRetry()}
      onCopyDiagnostics={() => void copyBootDiagnostics()}
    />
  );
  if (phase === "booting") return <MobileHomeSkeleton />;

  return (
    <div className="mobile-app">
      <DeferredPanel open={drawerOpen} fallback={<PanelLoading kind="settings" title="设置" onClose={() => setDrawerOpen(false)} />}>
        {/* 大面板各自一层隔离（261105）：设置崩了不连累首页/工作区。 */}
        <MobileErrorBoundary scope="settings" title="设置面板加载失败">
          <SettingsDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            onRefresh={refreshAll}
            onOpenNote={(id) => void openNote(id, "viewer")}
          />
        </MobileErrorBoundary>
      </DeferredPanel>
      {/* 路由层（261019）：首页常驻 + 工作区按需挂载；push/pop 只动 transform（见 mobile.css） */}
      <div className={"mobile-route-stage" + (wsOpen ? " is-open" : "") + (routeAnimating ? " is-animating" : "")} aria-label="页面">
      <div className="mobile-route-layer mobile-route-layer--home" ref={routeHomeRef}>
        <MobileErrorBoundary scope="home" title="首页加载失败">
        <HomePage
          tab={homeTab}
          notebooks={notebooks}
          notes={notes}
          quickNotes={quickNotes}
          tagDirectory={tagDirectory}
          docCounts={docCounts}
          // 首页在后台（工作区打开）时，分页器的 scroll/resize 回写**不得改路由**：
          // 否则 pad 窗口 resize 会让隐藏首页把 tab 回写上来 ⇒ route 变 home、工作区被卸载（261107 实测）。
          onTabChange={(tab) => { if (route.kind === "notebook") return; setRoute({ kind: "home", tab }); }}
          onOpenNotebook={(id) => { workspaceOriginTabRef.current = null; setRoute({ kind: "notebook", notebookId: id }); }}
          onOpenNote={(id) => void openNote(id, "viewer")}
          // 「标签」页点小记：与全局搜索同一条定位通路（回小记 tab + 高亮）。
          onOpenQuickNote={openQuickNoteFromSearch}
          onTagsChanged={refreshAll}
          pendingQuickNoteId={pendingQuickNoteId}
          onPendingQuickNoteConsumed={() => setPendingQuickNoteId(null)}
          onOpenDrawer={() => setDrawerOpen(true)}
          onOpenSearch={openSearchAll}
          // 日记页（261109）：全量树给判据、条目进现有工作区、搜索复用全库并按日记条目过滤。
          diaryNodes={diaryTreeNodes}
          onOpenDiaryEntry={openDiaryEntry}
          onOpenDiarySearch={openDiarySearch}
          onAiChanged={() => void refreshAll()}
          onCreateNotebook={() => setCreateNbOpen(true)}
          onCreateNote={(notebookId) => void createNoteInParent(notebookId)}
          onTreeChanged={refreshAll}
          onQuickNotesChanged={refreshAll}
          onQuickNoteTagsChanged={refreshQuickNoteTags}
        />
        </MobileErrorBoundary>
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
        <MobileErrorBoundary scope="workspace" key={route.notebookId} title="这个工作区加载失败">
        <NotebookWorkspace
          key={route.notebookId}
          notebookId={route.notebookId}
          initialNoteId={route.initialNoteId ?? null}
          initialMode={route.initialMode}
          onBack={closeWorkspace}
          notebooks={notebooks}
          onSwitchNotebook={(id) => setRoute({ kind: "notebook", notebookId: id })}
          onActiveNoteChange={(id) => { activeIdRef.current = id; }}
          onRegisterBackHandler={registerWorkspaceBack}
        />
        </MobileErrorBoundary>
        </Suspense>
        </div>
      )}
      </div>
      {/* Q04B：回收站文档只读预览（全屏层，层序沿用设置里同一个预览容器） */}
      {trashPreviewId && (
        <div className="mobile-settings-preview">
          <Suspense fallback={<EmptyState>正在加载预览…</EmptyState>}>
            <MobileErrorBoundary scope="trash-preview" title="回收站预览加载失败">
              <TrashPreviewPage
                noteId={trashPreviewId}
                onBack={() => setTrashPreviewId(null)}
                onRestored={() => { setTrashPreviewId(null); void refreshAll().catch(() => undefined); }}
              />
            </MobileErrorBoundary>
          </Suspense>
        </div>
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
      <DeferredPanel open={searchOpen} fallback={<PanelLoading kind="search" title="搜索" onClose={() => setSearchOpen(false)} />}>
        <MobileErrorBoundary scope="search" title="搜索面板加载失败">
          <SearchSheet
            open={searchOpen}
            onClose={() => setSearchOpen(false)}
            onOpenNote={(id) => void openNote(id, "viewer")}
            onOpenQuickNote={openQuickNoteFromSearch}
            // 日记内搜索 = 同一个搜索面板 + 显示层过滤（不动 FTS/索引/公共搜索逻辑）。
            scopeNoteIds={searchScope === "diary" ? diaryNoteIds : undefined}
            title={searchScope === "diary" ? "搜索日记" : undefined}
          />
        </MobileErrorBoundary>
      </DeferredPanel>
      {/* 首次分享 Markdown 且未设置默认笔记本：弹一次选择器，选完记住并继续导入。 */}
      <DefaultNotebookPickerSheet
        open={mdImportFiles !== null}
        notebooks={notebookOptions}
        currentId={readImportDefaultNotebook()}
        title="选择导入位置"
        onClose={() => setMdImportFiles(null)}
        onPick={(notebookId) => {
          const files = mdImportFiles;
          setMdImportFiles(null);
          writeImportDefaultNotebook(notebookId);
          if (files) void runMarkdownShareImport(files, notebookId);
        }}
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
 * 启动失败页（MOB-08）：可处置 —— 重试 / 清派生缓存后重试 / 复制诊断。
 * 只用现有原语（toolbar + mobile-settings-content + mb-card/mb-btn/mb-set-*），不写内联样式、不新增 CSS。
 */
function MobileBootErrorPage(props: {
  message: string;
  onRetry: () => void;
  onClearCacheAndRetry: () => void;
  onCopyDiagnostics: () => void;
}) {
  return (
    <div className="mobile-app">
      <div className="mobile-home">
        <header className="toolbar toolbar--border mobile-topbar">
          <span className="mobile-topbar-gap" aria-hidden="true" />
          <span className="mobile-topbar-title">启动失败</span>
          <span className="mobile-topbar-gap" aria-hidden="true" />
        </header>
        <div className="mobile-settings-content">
          <div className="mb-set-group">
            <div className="mb-set-title">本地知识库未能打开</div>
            <div className="mb-card">
              <div className="mb-card__head">错误信息</div>
              <div className="mb-card__body">
                <p className="mb-form__desc">{props.message}</p>
                <p className="mb-form__desc">数据仍在本机：重试不会改动正文、附件或未同步的修改。</p>
                <p className="mb-form__desc">最近崩溃记录：{readCrashLog(10).length} 条（「复制诊断信息」可导出，含上一条原生崩溃）。</p>
              </div>
            </div>
            <div className="mb-set-items">
              <button type="button" className="mb-btn mb-btn--primary mb-btn--block" onClick={props.onRetry}>重试</button>
              <button type="button" className="mb-btn mb-btn--block" onClick={props.onClearCacheAndRetry}>清理缓存后重试</button>
              <button type="button" className="mb-btn mb-btn--ghost mb-btn--block" onClick={props.onCopyDiagnostics}>复制诊断信息</button>
            </div>
            <p className="mb-form__desc">「清理缓存」只清可重建的派生数据（搜索索引/FTS 账本 + 渲染临时文件），不删除正文、历史快照和已下载资源。</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 坏库页（261105）：本地数据库打开报「损坏」或 `PRAGMA quick_check` 未通过时的出口。
 *
 * 与普通启动失败页的区别：只重试没有意义，必须先给「从云端恢复」。语义与设置页同名入口同源
 * （bridge/sync.ts:533 restoreFromCloud：清本机同步账本 → 只拉不打；云端没有的本机文档进回收站，可恢复）。
 * 本机库文件不做导出（移动端没有桌面那种文件选择器；先把能力限制在「诊断可复制 + 恢复可执行」）。
 */
function MobileDatabaseProblemPage(props: {
  reason: string;
  onRetry: () => void;
  onClearCacheAndRetry: () => void;
  onRestoreFromCloud: () => void;
  onCopyDiagnostics: () => void;
}) {
  return (
    <div className="mobile-app">
      <div className="mobile-home">
        <header className="toolbar toolbar--border mobile-topbar">
          <span className="mobile-topbar-gap" aria-hidden="true" />
          <span className="mobile-topbar-title">本地数据库需要处理</span>
          <span className="mobile-topbar-gap" aria-hidden="true" />
        </header>
        <div className="mobile-settings-content">
          <div className="mb-set-group">
            <div className="mb-set-title">本地库检查未通过</div>
            <div className="mb-card">
              <div className="mb-card__head">原因</div>
              <div className="mb-card__body">
                <p className="mb-form__desc">{props.reason}</p>
                <p className="mb-form__desc">正文、附件与历史快照都在本机文件里，不会被这一步删除。</p>
                <p className="mb-form__desc">最近崩溃记录：{readCrashLog(10).length} 条。本机数据库文件暂不支持导出，请先「复制诊断信息」留存。</p>
              </div>
            </div>
            <div className="mb-set-items">
              <button type="button" className="mb-btn mb-btn--primary mb-btn--block" onClick={props.onRestoreFromCloud}>从云端恢复（换机/坏库）</button>
              <button type="button" className="mb-btn mb-btn--block" onClick={props.onRetry}>重试</button>
              <button type="button" className="mb-btn mb-btn--block" onClick={props.onClearCacheAndRetry}>清理缓存后重试</button>
              <button type="button" className="mb-btn mb-btn--ghost mb-btn--block" onClick={props.onCopyDiagnostics}>复制诊断信息</button>
            </div>
            <p className="mb-form__desc">「从云端恢复」会清空本机同步记录并以云端为准重新下载：云端没有的本机文档会移入回收站（可恢复），不会上传本机内容，也不会删除本机附件。</p>
          </div>
        </div>
      </div>
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
        {/* 与真实顶栏同构（261110 底部 Dock 改版）：左 = 设置，中 = **当前空间标题**，右 = 空间内动作 + 搜索 + 云同步。 */}
        <header className="toolbar toolbar--border mobile-topbar mobile-topbar--home">
          <div className="mobile-topbar-group mobile-topbar-group--start">
            <span className="mb-skel mb-skel--icon" aria-hidden="true" />
          </div>
          <div className="mobile-topbar-group mobile-topbar-group--center">
            <span className="mb-skel mb-skel--tab" aria-hidden="true" />
          </div>
          <div className="mobile-topbar-group mobile-topbar-group--end">
            <span className="mb-skel mb-skel--icon" aria-hidden="true" />
            <span className="mb-skel mb-skel--icon" aria-hidden="true" />
            <span className="mb-skel mb-skel--icon" aria-hidden="true" />
          </div>
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
        {/* 骨架与真实底部同构（261110）：五格 Dock + 中央悬浮＋，否则数据到达时宽度/位置会跳一次。 */}
        <div className="mb-home-dockwrap" aria-hidden="true">
          <nav className="mb-home-dock">
            {[0, 1, 2, 3, 4].map((i) => <span key={i} className="mb-skel mb-skel--baritem" />)}
          </nav>
          <span className="mb-skel mb-skel--fab" />
        </div>
      </div>
      <div className="mb-launch-overlay">
        <MobileBrandLaunchMark label="正在打开本地知识库" />
      </div>
    </div>
  );
}
