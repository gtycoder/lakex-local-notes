/** 移动端设置页（§6：同步设置 S3 / 清理缓存 / 回收站 / 关于）。
 * 版式：竖向菜单列表（设置项一行一行），点某项进入新页面（带返回）；子页内容用移动端自有骨架 .mb-set-*。
 * P4（261012）：版式原语已换成 src/mobile/ui/settingsPrimitives（mb-set-*），data-set-id 契约不变
 * （settingsSearch.ts 的 SETTING_ITEMS 继续生效）。
 * 注意：全部 App 设置为竖向（无横向 tab）；「回收站」并入总回收站（见 TrashList）。
 * M-05（261125 纯搬移）：「云端与同步」视图整块 = settings/S3SettingsSection.tsx（与 AiSettingsSection 同形）；
 * 本文件留【视图状态机】+ 各分节编排 + 保存闸。 */
import { Suspense, lazy, useEffect, useRef, useState, type CSSProperties } from "react";
import { Archive, ArrowLeft, ChevronRight, Download, List, TriangleAlert, X } from "lucide-react";
import { loadSettings, saveSettings, fontSizeOptions, MAX_ATTACHMENT_MB_OPTIONS_SETTINGS, MAX_OPEN_TAB_OPTIONS, type AppSettings } from "../../lib/settings";
import { Group, Item, Block, Switch } from "../ui/settingsPrimitives";
import { bridge } from "../bridge";
import { confirmMobile } from "../ui/ConfirmDialog";
import { PickerSheet } from "../ui/PickerSheet";
import { usePanelDrag } from "../hooks/usePanelDrag";
import { pushBackHandler } from "../ui/backStack";
import { useSwipeDownDismiss } from "../ui/useSwipeDownDismiss";
import { TrashList } from "./TrashList";
import { formatBytes } from "../../lib/formatBytes";
import { probePinShortcut, requestPinQuickNoteShortcut } from "../native/pinShortcut";
import { canTouchNetwork, cloudStateOf } from "../../core/cloudState";
import { CLOUD_SYNC_ENABLE_NEED_UNCONFIGURED, cloudSyncEnableGate } from "../../core/cloudSyncGate";
import { AppearanceSettingsSection, HistorySettingsSection, AboutSettingsSection } from "./BasicSettingsSections";
import { UpdateCenterSection } from "./UpdateCenterSection";
import { useAiSettingsForm } from "./useAiSettingsForm";
import { AiSettingsSection } from "./AiSettingsSection";
import { useS3SettingsForm } from "./useS3SettingsForm";
// 「云端与同步」整块视图（M-05 拆出；data-set-id 契约见其头注释）。
import { S3SettingsSection } from "./S3SettingsSection";
import { useSettingsSectionData } from "./useSettingsSectionData";
import { useSyncSettingsForm } from "./useSyncSettingsForm";
import { useMissingBodies } from "./useMissingBodies";
import { MissingBodiesSheet, type MissingBodiesMode } from "./MissingBodiesSheet";
import { ResourceCleanupSheet, type ResourceCleanupMode } from "./ResourceCleanupSheet";
import { SyncConflictsSheet } from "./SyncConflictsSheet";
import type { OrphanAsset } from "./useSettingsSectionData";
import { showToast } from "../ui/toastBus";
import { readImportDefaultNotebook, writeImportDefaultNotebook } from "./importSettings";
import { DEFAULT_HOME_TAB, DEFAULT_SPACE_OPTIONS, readDefaultHomeTab, writeDefaultHomeTab } from "./defaultSpace";
import { useHiddenHomeTabs } from "./useHiddenHomeTabs";
import type { HomeTab } from "../home/tabPager";
import { DefaultNotebookPickerSheet, type DefaultNotebookOption } from "./DefaultNotebookPickerSheet";
import { EmptyState } from "../ui/EmptyState";
import { DelayedLoading } from "../ui/delayedLoading";
import { PortableExportBlock } from "./PortableExportBlock";
import { PortableImportSection } from "./PortableImportSection";

/** 回收站只读预览（内含 Lake 内核编辑器）：**按需加载**——设置页/首屏都不需要内核。 */
const TrashPreviewPage = lazy(() => import("../trash/TrashPreviewPage").then((m) => ({ default: m.TrashPreviewPage })));

export interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  /** 点击同步告警：打开对应文档。 */
  onOpenNote?: (noteId: string) => void;
}

import { SETTINGS_MENU as MENU, SETTINGS_MENU_GROUPS as MENU_GROUPS, settingsMenuLabel as MENU_LABEL, type SettingsView as View } from "./settingsMenu";

export function SettingsDrawer(props: SettingsDrawerProps) {
  const { open, onClose, onRefresh, onOpenNote } = props;
  // 【视图状态机】view 单一来源（View 联合 = settingsMenu.ts）："menu" = 根菜单，其余 = 子页（互斥、同一时刻只渲染一个）。
  // 预览页（previewNoteId）叠在子页之上，返回键先关预览再回菜单；新增子页先在 settingsMenu 登记 key。
  const [view, setView] = useState<View>("menu");

  /** 小记桌面快捷方式：部分机型不展示静态快捷方式，这里给「添加到桌面」兜底（对齐思源）。 */
  const [pinState, setPinState] = useState<{ available: boolean; pinned: boolean } | null>(null);
  const [pinMsg, setPinMsg] = useState("");
  useEffect(() => { void probePinShortcut().then(setPinState); }, []);
  const [previewNoteId, setPreviewNoteId] = useState<string | null>(null);
  /** 预览条目类型（261124：小记与文档同一预览页）。与 previewNoteId 成对写入，只在 id 非空时读。 */
  const [previewKind, setPreviewKind] = useState<"note" | "quick">("note");
  const [listKey, setListKey] = useState(0);
  // 「云端与同步」状态面（M-05 起整块渲染在 S3SettingsSection；表单水合仍在抽屉层 = 页面级一次）。
  const s3State = useS3SettingsForm(open && view === "s3"); // 页面级水合（261123 E2E：只按抽屉 open 拉一次 ⇒ 进页面不重拉，表单停在空值）
  const { settings: s3, settingsLoaded: s3SettingsLoaded, s3Verified } = s3State;
  const {
    history: hist,
    updateHistory: updateHist,
    orphans,
    orphanBusy,
    gcMsg,
    cleanOrphans,
    deleteOrphan,
    gcPreview,
    gcBusy,
    previewCloud,
    cleanCloud,
    clearGcPreview,
    cacheMsg,
    cacheSummary,
    clearCache,
    appInfo,
    diagnostics: diag,
    assetUsage,
  } = useSettingsSectionData({
    historyOpen: open && view === "history",
    resourcesOpen: open && view === "resources",
    cacheOpen: open && view === "cache",
    aboutOpen: open && view === "about",
  });
  /** 云同步开关（与桌面同语义：关闭 = 纯离线本地空间，任何路径都不出网） */
  const {
    syncSettings: syncCfg,
    updateSyncSettings,
    syncMsg,
    syncProgressText,
    lastSyncBreakdown,
    warnings: syncWarnings,
    warningSummary: syncWarningDigest,
    supersededNotes: syncSuperseded,
    lastSyncText,
    syncReports,
    reloadSyncReports,
    conflictUnacked,
    reloadConflicts,
    runSync,
    encounterFacts, chooseEncounter, cancelEncounter,
  } = useSyncSettingsForm(open, onRefresh);
  /** 「同步记录」列表页（261105 P1 第 4 项）：入口在「上次同步」下方。 */
  const [conflictsOpen, setConflictsOpen] = useState(false);
  /** 「导入」分组（261106 task-86）：默认笔记本（设备本地）。笔记本清单在进入该页时读一次快照。 */
  const [importNotebooks, setImportNotebooks] = useState<DefaultNotebookOption[]>([]);
  const [importNotebookBusy, setImportNotebookBusy] = useState(false);
  const [importPickerOpen, setImportPickerOpen] = useState(false);
  const [importNotebookId, setImportNotebookId] = useState<string | null>(() => readImportDefaultNotebook());
  useEffect(() => {
    if (!open || view !== "import") return;
    let alive = true;
    setImportNotebookBusy(true);
    void bridge.getHomeSnapshot().then((snapshot) => {
      if (!alive) return;
      setImportNotebooks(snapshot.treeNodes
        .filter((node) => node.nodeType === "notebook")
        .map((node) => ({ id: node.id, title: node.title || "未命名" })));
    }).catch(() => { if (alive) setImportNotebooks([]); }).finally(() => { if (alive) setImportNotebookBusy(false); });
    return () => { alive = false; };
  }, [open, view]);
  // 缺正文/缺小记（261104 B-lite）：进「资源管理」时扫一次，恢复动作后 reload 刷新计数。
  const missingBodies = useMissingBodies(open && view === "resources");
  const [missingSheet, setMissingSheet] = useState<MissingBodiesMode | null>(null);
  /** 资源管理里的清理明细（261105）：删除入口只在这里出现，首页不暴露。 */
  const [cleanupSheet, setCleanupSheet] = useState<ResourceCleanupMode | null>(null);
  /** 点击「未引用」行预览内容：图片走共享 Lightbox，其它附件交系统应用；文件缺失则明确提示、不预览。 */
  const previewOrphan = (item: OrphanAsset): void => {
    void (async () => {
      try {
        const preview = await bridge.readAssetPreview(item.noteId, item.filename);
        if (preview.supported && preview.dataUrl) {
          // 共享 Lightbox 控制器按需加载：静态 import 会把「features/editor」拉进设置页懒 chunk，
          // 触发 kernelStyleBootstrap 的内核样式启发式（该模块只做 pub/sub，不是内核）；点开时才需要它。
          const { openImagePreview } = await import("../../features/editor/imagePreview");
          // Q02 的"放大换原图"在这里天然成立：native.readAssetPreview 读回的是**原文件**的 data URL
          // （不是资产服务的 ?w=1024 显示档）⇒ 无需 originalSrc，也不需要再走 previewAsset 档位。
          openImagePreview([{ src: preview.dataUrl }], 0);
          return;
        }
      } catch { /* 读不到图片内容 ⇒ 回落到系统应用打开（可能是大图/损坏/已删除） */ }
      try {
        const opened = await bridge.openAttachment(item.noteId, item.filename);
        if (!opened.ok) showToast("无法打开这个文件", { type: "error" });
      } catch (error) {
        showToast(error instanceof Error && error.message ? error.message : "文件已不存在或无法打开", { type: "error" });
      }
    })();
  };
  /**
   * 云端清理保留二次确认（删的是云端对象，不可撤销）。
   * 只有「预览」过且有命中时才会走到这里（面板按钮本身也是这么门控的）；确认文案复用预览数字，
   * 让用户看到的数量和真删的目标一致。
   */
  const requestCleanCloud = () => {
    const preview = gcPreview;
    if (!preview || preview.count === 0) return;
    void confirmMobile({
      title: "清理云端未引用文件？",
      body: "将删除云端 " + preview.count + " 个对象" +
        (preview.bytes === null ? "" : "（共 " + formatBytes(preview.bytes) + "）") +
        "：超过 7 天、没有任何文档或历史版本引用的文件，删除后无法撤销。本机笔记与附件不受影响。",
      confirmText: "清理",
      danger: true,
    }).then((ok) => { if (ok) void cleanCloud(); });
  };
  /** 「从云端恢复（换机/坏库）」（261028 用户批准）：清空本机同步基线 → 立即整轮只拉不打。 */
  const [restoreMsg, setRestoreMsg] = useState("");
  const [restoreBusy, setRestoreBusy] = useState(false);
  const restoreFromCloud = async (): Promise<void> => {
    if (restoreBusy) return;
    const ok = await confirmMobile({
      title: "从云端恢复？",
      body: "本机同步记录会被清空，然后以云端为准全部重新下载。云端没有的本机文档会移入回收站（可恢复）；本机附件不会被删除，也不会向云端上传任何内容。",
      confirmText: "开始恢复",
      danger: true,
    });
    if (!ok) return;
    setRestoreBusy(true);
    setRestoreMsg("正在从云端恢复…");
    try {
      const result = await bridge.restoreFromCloud();
      setRestoreMsg(result.message);
      // 与「立即同步」之后同口径：刷新首页/工作区数据（同步状态行由 syncStatusStore 自己广播）。
      if (result.ok) await onRefresh();
    } catch (error) {
      setRestoreMsg("恢复失败：" + (error as Error).message);
    } finally {
      setRestoreBusy(false);
    }
    // 成功/失败都读一次诊断（失败也会由 syncNow 落一轮，同 runSync 口径）。
    await reloadSyncReports();
  };
  const cloudState = cloudStateOf(Boolean(s3), syncCfg);
  // 【保存闸】云同步开启闸门（261114 用户裁决，两端统一）：没有配置 / 没有通过连接测试 ⇒ 不能开启云同步；
  // 判据与文案单一来源 core/cloudSyncGate；点击开启只给提示、不下发 enabled（enabled 写入口唯一 = updateSyncSettings）。
  // 旧版本遗留「未配置却已开启」的自动关也在这条闸上（syncAutoOffRef effect）。
  const syncEnableGate = cloudSyncEnableGate({ configured: Boolean(s3), verified: s3Verified });
  const syncEnableGateMessage = syncEnableGate.allowed ? null : syncEnableGate.message;
  /** 旧版本遗留「未配置却已开启」：读到设置后自动关掉一次并说明原因（新逻辑下不会再产生）。 */
  const syncAutoOffRef = useRef(false);
  useEffect(() => {
    if (!open) { syncAutoOffRef.current = false; return; }
    if (!syncCfg || !s3SettingsLoaded || syncAutoOffRef.current) return;
    if (!syncCfg.enabled || s3) return;
    syncAutoOffRef.current = true;
    updateSyncSettings({ enabled: false });
    setSyncEnableHint(CLOUD_SYNC_ENABLE_NEED_UNCONFIGURED);
  }, [open, syncCfg, s3SettingsLoaded, s3, updateSyncSettings]);
  useEffect(() => { if (syncEnableGate.allowed) setSyncEnableHint(""); }, [syncEnableGate.allowed]);
  /** 261029 FIX-M：「启用云同步」点击开启但本机还没有 S3 配置时，行内给一条可见提示；不改「关=不出网」判据。 */
  const [syncEnableHint, setSyncEnableHint] = useState("");
  // 一旦补上 S3 配置（手填保存 / 从文件或迁移码导入），提示自动消失，不留过时信息。
  useEffect(() => { if (cloudState !== "unconfigured") setSyncEnableHint(""); }, [cloudState]);
  const cloudBlockReason = canTouchNetwork(cloudState)
    ? null
    : cloudState === "unconfigured"
      ? "未配置云同步：按纯本地空间处理，不能清理云端。"
      : "云同步已关闭：按纯本地空间处理，不能清理云端。";
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const update = (patch: Partial<AppSettings>) => setSettings(saveSettings(patch));
  /** 默认空间（261110）：设备本地偏好，决定**下次冷启动**落在哪个一级页；只存 localStorage，不进 S3。 */
  const [defaultHomeTab, setDefaultHomeTab] = useState<HomeTab>(() => readDefaultHomeTab());
  // 261114 用户点单：仅日记 / AI 可关闭（隐藏底部 Dock 入口与默认空间选项；数据保留）。
  const { hidden: hiddenHomeTabs, tabs: visibleHomeTabs, toggle: toggleHomeTab } = useHiddenHomeTabs();
  useEffect(() => {
    if (visibleHomeTabs.includes(defaultHomeTab)) return;
    // 默认空间被关闭 ⇒ 落点回小记，避免下次冷启动指向不可进入的页。
    writeDefaultHomeTab(DEFAULT_HOME_TAB);
    setDefaultHomeTab(DEFAULT_HOME_TAB);
  }, [visibleHomeTabs, defaultHomeTab]);

  const aiFormState = useAiSettingsForm(open && view === "ai");

  const pageRef = useRef<HTMLDivElement>(null);
  const maskRef = useRef<HTMLDivElement>(null);
  const isSub = view !== "menu";
  /** 261110 用户点单：设置抽屉也支持**下滑关闭**（与底部 Sheet 同一套手势判据）；子页不启用（子页用返回）。 */
  useSwipeDownDismiss(pageRef, onClose, { enabled: open && !isSub, scrollSelector: ".mobile-settings-list" });
  // 左滑跟手关闭（仅根菜单；子页全屏，用左上返回）。复用思源 usePanelDrag。
  usePanelDrag({
    getPanel: (side) => (side === "left" ? pageRef.current : null),
    getMask: (side) => (side === "left" ? maskRef.current : null),
    isOpen: (side) => side === "left" && open && !isSub,
    commit: (side, next) => { if (side === "left" && !next) onClose(); },
  });

  // 返回键（MOB-01）：子页（含回收站预览）只回菜单 / 上一层，不把整个抽屉关掉
  // （父层 useBackHandler 的 drawerOpen 分支会直接 onClose 回首页，用户得重新开设置）。
  useEffect(() => {
    if (!open || (!isSub && !previewNoteId)) return;
    return pushBackHandler(() => {
      if (previewNoteId) { setPreviewNoteId(null); return true; }
      setView("menu");
      return true;
    });
  }, [open, isSub, previewNoteId]);

  if (!open) return null;

  return (
    <>
      {!isSub && <div ref={maskRef} className="mobile-settings-mask" onClick={onClose} />}
      <div ref={pageRef} className={`mobile-settings-page${isSub ? " mobile-settings-page--full" : ""}`}>
      <header className="mobile-settings-head" data-mb-topbar data-edge="overlay">
        {isSub ? (
          <button className="mobile-settings-close" onClick={() => { setView("menu"); setPreviewNoteId(null); }} aria-label="返回"><ArrowLeft size={22} /></button>
        ) : (
          <div className="mobile-settings-spacer" />
        )}
        <h1 className="mobile-settings-title">{isSub ? MENU_LABEL(view) : "设置"}</h1>
        {/* 右槽与左槽等宽（40）⇒ 标题落在页中线上。根页右槽 = 可见「关闭」（261029 FIX-M2）；子页保留空槽。 */}
        {isSub ? <div className="mobile-settings-spacer" /> : (
          <button className="mobile-settings-close" onClick={onClose} aria-label="关闭设置"><X size={22} /></button>
        )}
      </header>

      {isSub ? (
        <div className="mobile-settings-content">
          {view === "editor" && (
            <Group>
              <Item itemId="editor-font-size" name="正文字号" desc="作用于当前文档正文。" icon={<List size={16} />} tone="#6b5bd6">
                <PickerSheet
                  label="正文字号"
                  value={settings.fontSize}
                  options={fontSizeOptions().map((fs) => ({ value: fs, label: fs + " px" }))}
                  onChange={(v) => update({ fontSize: v })}
                />
              </Item>
              <Item itemId="editor-max-open-tabs" name="最大同时打开标签数" desc="超出上限自动关闭该空间最旧的标签；最多 16 个。" stacked>
                <PickerSheet
                  label="最大同时打开标签数"
                  value={settings.maxOpenTabs}
                  options={MAX_OPEN_TAB_OPTIONS.map((n) => ({ value: n, label: n + " 个" }))}
                  onChange={(v) => update({ maxOpenTabs: v })}
                />
              </Item>
              <Switch itemId="editor-clear-tabs-on-exit" name="退出时关闭全部标签" desc="下次启动不恢复打开的标签；仅本机偏好。" checked={settings.clearTabsOnExit} onChange={(checked) => update({ clearTabsOnExit: checked })} />
              {/* 261113 用户点单：常规页顺序对齐桌面 EditorSection（… 标签页 → 附件 → 启动/默认空间）。 */}
              <Item itemId="editor-max-attachment" name="附件大小上限" desc="图片、视频、PDF 等附件的本机上限；同步与下载按协议上限 100 MiB。">
                <PickerSheet
                  label="附件大小上限"
                  value={Math.round(settings.maxAttachmentBytes / (1024 * 1024))}
                  options={MAX_ATTACHMENT_MB_OPTIONS_SETTINGS.map((mb) => ({ value: mb, label: mb + " MiB" }))}
                  onChange={(v) => update({ maxAttachmentBytes: v * 1024 * 1024 })}
                />
              </Item>
              {/* 261110：默认空间 = 打开 App 落在哪个一级页（小记 / 知识库 / 日记 / 标签）。仅本机，不进 S3。 */}
              <Item itemId="editor-default-space" name="默认空间" desc="打开 App 时落在哪个一级页；仅本机。" stacked>
                <PickerSheet
                  label="默认空间"
                  value={defaultHomeTab}
                  options={DEFAULT_SPACE_OPTIONS.filter((option) => visibleHomeTabs.includes(option.value))}
                  onChange={(next) => { writeDefaultHomeTab(next); setDefaultHomeTab(next); showToast("已设为默认空间：" + (DEFAULT_SPACE_OPTIONS.find((o) => o.value === next)?.label ?? "")); }}
                />
              </Item>
              <Switch itemId="space-ai" name="AI 空间" desc="关闭 = 从 Dock 与「默认空间」隐藏；会话保留，可随时开启。" checked={!hiddenHomeTabs.includes("ai")} onChange={(checked) => toggleHomeTab("ai", checked)} />
              <Switch itemId="space-diary" name="日记空间" desc="关闭 = 从 Dock 与「默认空间」隐藏；日记保留，可随时开启。小记 / 知识库 / 标签固定显示。" checked={!hiddenHomeTabs.includes("diary")} onChange={(checked) => toggleHomeTab("diary", checked)} />
              {pinState?.available && !pinState.pinned && (
                <Item itemId="editor-pin-quick-note" name="新建小记" desc="添加到桌面。">
                  <button
                    className="mb-btn mb-btn--outlined"
                    onClick={() => {
                      void requestPinQuickNoteShortcut().then((requested) => {
                        setPinMsg(requested ? "已请求，请在系统弹窗中确认" : "该机型不支持固定快捷方式");
                        // 系统弹窗确认后会有延迟，稍后复查一次固定状态
                        setTimeout(() => { void probePinShortcut().then(setPinState); }, 2500);
                      });
                    }}
                  >添加到桌面</button>
                </Item>
              )}
              {pinMsg && <div className="mb-form__desc">{pinMsg}</div>}
            </Group>
          )}

          {view === "appearance" && <AppearanceSettingsSection settings={settings} update={update} />}

          {view === "ai" && <AiSettingsSection form={aiFormState} />}

          {view === "history" && hist && <HistorySettingsSection hist={hist} updateHist={updateHist} />}

          {view === "import" && (
            <Group>
              <Block
                itemId="import-default-notebook"
                name="默认笔记本"
                desc="系统分享导入的 Markdown 在此笔记本新建文档（仅本机）；未设置时首次分享会让你选一次。"
              >
                <div className="mb-set-block__actions">
                  <span className="mb-row__meta">
                    {importNotebookBusy
                      ? "读取中…"
                      : importNotebookId
                        ? (importNotebooks.find((nb) => nb.id === importNotebookId)?.title ?? "（笔记本已不存在）")
                        : "未设置"}
                  </span>
                  <button
                    type="button"
                    className="mb-btn mb-btn--outlined"
                    disabled={importNotebookBusy}
                    onClick={() => setImportPickerOpen(true)}
                  >选择笔记本</button>
                </div>
              </Block>
            </Group>
          )}

          {view === "resources" && (
            <Group>
              <Block itemId="resources-usage" name="本地资源占用" desc="正文引用的图片与附件占用（不含历史快照与数据库）。">
                <span className="mb-row__meta">
                  {assetUsage ? assetUsage.files + " 个文件，" + formatBytes(assetUsage.bytes) : "统计中…"}
                </span>
              </Block>
              {/* 261105 用户点单：删除入口不再外露在资源管理首页，必须先点「查看」进入明细面板。 */}
              <Block itemId="resources-clean" name="未引用的本地文件" desc="删除正文图片后的残留文件，可安全清理。">
                <button className="mb-btn mb-btn--outlined" disabled={orphans.length === 0 || orphanBusy} onClick={() => setCleanupSheet("orphans")}>查看（{orphans.length}）</button>
              </Block>
              <Block itemId="resources-gc" name="云端未引用文件" desc="删除云端 7 天以上、没有被任何文档或历史版本引用的文件。">
                <button className="mb-btn mb-btn--outlined" disabled={orphanBusy || !canTouchNetwork(cloudState)} onClick={() => setCleanupSheet("cloudGc")}>查看</button>
                {(gcMsg || cloudBlockReason) && <div className="mb-form__desc">{gcMsg || cloudBlockReason}</div>}
              </Block>
              {missingBodies.docs.length > 0 && (
                <Block itemId="resources-missing-bodies" name="缺正文" desc="正文文件缺失的文档：可从云端拉回、恢复历史版本或彻底删除。">
                  <button className="mb-btn mb-btn--outlined" onClick={() => setMissingSheet("docs")}>查看（{missingBodies.docs.length}）</button>
                </Block>
              )}
              {missingBodies.quickNotes.length > 0 && (
                <Block itemId="resources-missing-quicknotes" name="缺小记" desc="正文文件缺失的小记：可从云端拉回或用搜索缓存重建。">
                  <button className="mb-btn mb-btn--outlined" onClick={() => setMissingSheet("quickNotes")}>查看（{missingBodies.quickNotes.length}）</button>
                </Block>
              )}
              {orphans.length === 0 && missingBodies.docs.length === 0 && missingBodies.quickNotes.length === 0 && (
                <EmptyState inset>暂无冗余资源</EmptyState>
              )}
            </Group>
          )}

          {view === "s3" && (
            <S3SettingsSection
              form={s3State}
              syncCfg={syncCfg}
              updateSyncSettings={updateSyncSettings}
              runSync={runSync}
              syncMsg={syncMsg}
              syncProgressText={syncProgressText}
              lastSyncText={lastSyncText}
              lastSyncBreakdown={lastSyncBreakdown}
              conflictUnacked={conflictUnacked}
              syncSuperseded={syncSuperseded}
              syncWarnings={syncWarnings}
              syncWarningDigest={syncWarningDigest}
              syncReports={syncReports}
              encounterFacts={encounterFacts}
              chooseEncounter={chooseEncounter}
              cancelEncounter={cancelEncounter}
              syncEnableGate={syncEnableGate}
              syncEnableGateMessage={syncEnableGateMessage}
              syncEnableHint={syncEnableHint}
              setSyncEnableHint={setSyncEnableHint}
              onOpenConflicts={() => setConflictsOpen(true)}
              onOpenNote={onOpenNote}
              onOpenResourcesRestore={() => { setView("resources"); void missingBodies.reload(); }}
            />
          )}

          {view === "backup" && (
            <>
            <Group title="恢复" icon={<Archive size={16} />}>
                {/* 261028（用户批准）：从云端恢复（换机/坏库）——清本机同步基线后整轮只拉不打；
                    不照抄桌面的「整库改名隔离 + 重启」（移动端附件可能 1.6GB，隔离整库代价过高）。 */}
                <div className="mb-set-block">
                  <div className="mb-set-block__name">从云端恢复（换机或数据损坏）</div>
                  {/* 261109 用户定稿：能点的放前面，说明/状态放后面。 */}
                  <div className="mb-set-block__actions">
                    <button
                      type="button"
                      className="mb-btn mb-btn--danger"
                      disabled={syncCfg?.enabled === false || restoreBusy}
                      title={syncCfg?.enabled === false ? "云同步已关闭：不会联网" : undefined}
                      onClick={() => void restoreFromCloud()}
                    >{restoreBusy ? "正在恢复…" : "从云端恢复…"}</button>
                  </div>
                  <div className="mb-set-item__desc">
                    以云端为准重建本机：清空同步记录后全部重新下载（只下载、不上传本机）。用于换机或本机数据损坏；需要先配置并开启云同步。
                  </div>
                  {restoreMsg && <div className="mb-set-item__desc" aria-live="polite">{restoreMsg}</div>}
                </div>
            </Group>

            <Group title="修复缺失数据" icon={<TriangleAlert size={16} />}>
                {/* 缺正文/缺小记：只在资源管理里扫描/恢复；这里给引用入口（不重复扫描逻辑）。 */}
                <div className="mb-set-block">
                  <div className="mb-set-block__name">缺正文 / 缺小记</div>
                  <div className="mb-set-block__actions">
                    <button
                      type="button"
                      className="mb-btn mb-btn--outlined"
                      onClick={() => { setView("resources"); void missingBodies.reload(); }}
                    >去资源管理查看</button>
                  </div>
                  <div className="mb-set-item__desc">
                    文档或小记还在，但正文文件已经不在了。可以从云端拉回、恢复历史版本，或用搜索缓存重建纯文本。
                  </div>
                </div>
            </Group>

            <Group title="迁入迁出（便携包）" icon={<Download size={16} />}>
                {/* 261122 大统一：便携包是跨端迁移的**唯一出入口**（迁出 = 导出到「下载」目录 / 迁入 = 覆盖式导入），
                    与桌面「备份与恢复 → 迁入迁出」同构；不再散落在「关于 → 卸载与换机」。 */}
                <PortableExportBlock />
                <PortableImportSection onImported={() => void onRefresh()} />
            </Group>
            </>
          )}

          {view === "cache" && (
            <Group>
                <div className="mb-set-block">
                  <div className="mb-set-item__desc">清理派生搜索索引（FTS + 账本，清完在后台自动重建）与 PDF 渲染临时文件。不会删除正文、附件、历史快照、回收站内容或未同步的修改。</div>
                  {cacheSummary && (
                    <div className="mb-set-stats">
                      <span>已下载资源（保留）：{cacheSummary.downloadableAssetBytes} 项</span>
                      <span>待上传（保留）：{cacheSummary.pendingUploadBytes} 项</span>
                    </div>
                  )}
                  <div className="mb-set-block__actions">
                    <button className="mb-btn mb-btn--outlined" onClick={() => void clearCache()}>清理缓存</button>
                  </div>
                  {cacheMsg && <div className="mb-set-item__desc">{cacheMsg}</div>}
                </div>
            </Group>
          )}

          {view === "update" && <UpdateCenterSection appInfo={appInfo} />}

          {view === "about" && <AboutSettingsSection appInfo={appInfo} diag={diag} onOpenBackup={() => setView("backup")} />}

          {view === "trash" && (
            <TrashList key={listKey} title="回收站" onChanged={onRefresh} onPreview={(id, kind) => { setPreviewNoteId(id); setPreviewKind(kind); }} />
          )}
        </div>
      ) : (
        <div className="mobile-settings-list">
          {MENU_GROUPS.map((group, gi) => (
            <div key={gi} className="mobile-settings-card">
              {group.map((key) => {
                const m = MENU.find((item) => item.key === key);
                if (!m) return null;
                const Icon = m.icon;
                const value = key === "appearance"
                  ? (settings.theme === "light" ? "浅色" : settings.theme === "dark" ? "深色" : "暖色")
                  : null;
                return (
                  <button
                    key={m.key}
                    className="mobile-settings-row"
                    data-set-id={m.key}
                    onClick={() => { setView(m.key); setPreviewNoteId(null); }}
                  >
                    <span className="mb-set-item__icon" style={{ "--c": m.tone } as CSSProperties}><Icon size={19} /></span>
                    <span className="mb-set-name">{m.label}</span>
                    {value ? <span className="mb-set-item__val">{value}</span> : null}
                    <ChevronRight size={18} className="mb-row__chevron mobile-settings-chevron" />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <DefaultNotebookPickerSheet
        open={importPickerOpen}
        notebooks={importNotebooks}
        currentId={importNotebookId}
        busy={importNotebookBusy}
        title="默认笔记本"
        onClose={() => setImportPickerOpen(false)}
        onPick={(id) => {
          writeImportDefaultNotebook(id);
          setImportNotebookId(id);
          setImportPickerOpen(false);
          showToast("已设为默认笔记本");
        }}
      />

      <SyncConflictsSheet
        open={conflictsOpen}
        onClose={() => setConflictsOpen(false)}
        onOpenNote={onOpenNote}
        onChanged={() => void reloadConflicts()}
      />
      <MissingBodiesSheet
        open={missingSheet !== null}
        mode={missingSheet ?? "docs"}
        cloudConfigured={missingBodies.cloudConfigured}
        docs={missingBodies.docs}
        quickNotes={missingBodies.quickNotes}
        onClose={() => setMissingSheet(null)}
        onChanged={missingBodies.reload}
      />
      <ResourceCleanupSheet
        open={cleanupSheet !== null}
        mode={cleanupSheet ?? "orphans"}
        orphans={orphans}
        busy={orphanBusy}
        cloudBusy={gcBusy}
        cloudReady={canTouchNetwork(cloudState)}
        cloudHint={cloudBlockReason ?? undefined}
        gcMessage={gcMsg}
        gcPreview={gcPreview}
        onClose={() => { setCleanupSheet(null); clearGcPreview(); }}
        onPreviewOrphan={previewOrphan}
        onDeleteOrphan={(id) => void deleteOrphan(id)}
        onCleanOrphans={() => void cleanOrphans()}
        onPreviewCloud={() => void previewCloud()}
        onCleanCloud={requestCleanCloud}
      />

      {previewNoteId && (
        <div className="mobile-settings-preview">
          <Suspense fallback={<DelayedLoading><EmptyState>正在加载预览…</EmptyState></DelayedLoading>}>
            <TrashPreviewPage
              noteId={previewNoteId}
              itemKind={previewKind}
              onBack={() => setPreviewNoteId(null)}
              onRestored={() => { setPreviewNoteId(null); setListKey((k) => k + 1); void onRefresh(); }}
            />
          </Suspense>
        </div>
      )}
      </div>
    </>
  );
}
