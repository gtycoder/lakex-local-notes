/** 移动端设置页（§6：同步设置 S3 / 清理缓存 / 回收站 / 关于）。
 * 版式：竖向菜单列表（设置项一行一行），点某项进入新页面（带返回）；子页内容用移动端自有骨架 .mb-set-*。
 * P4（261012）：版式原语已换成 src/mobile/ui/settingsPrimitives（mb-set-*），data-set-id 契约不变
 * （settingsSearch.ts 的 SETTING_ITEMS 继续生效）。
 * 注意：全部 App 设置为竖向（无横向 tab）；「回收站」并入总回收站（见 TrashList）。 */
import { Suspense, lazy, useEffect, useRef, useState, type CSSProperties } from "react";
import { Archive, ArrowLeft, ChevronRight, Cloud, Download, HardDrive, Images, List, Pencil, RefreshCw, TriangleAlert, X } from "lucide-react";
import { loadSettings, saveSettings, fontSizeOptions, MAX_ATTACHMENT_MB_OPTIONS_SETTINGS, MAX_OPEN_TAB_OPTIONS, type AppSettings } from "../../lib/settings";
import { Group, Item, Block, Switch, TextField, Field } from "../ui/settingsPrimitives";
import { bridge } from "../bridge";
import { confirmMobile } from "../ui/ConfirmDialog";
import { PickerSheet } from "../ui/PickerSheet";
import { SYNC_AUTO_MODE_OPTIONS, SYNC_OPEN_CLOSE_NOTE, syncIntervalOptions } from "../../core/syncModes";
import { usePanelDrag } from "../hooks/usePanelDrag";
import { pushBackHandler } from "../ui/backStack";
import { useSwipeDownDismiss } from "../ui/useSwipeDownDismiss";
import { TrashList } from "./TrashList";
import { formatBytes } from "../../lib/formatBytes";
import { probePinShortcut, requestPinQuickNoteShortcut } from "../native/quickNoteShortcut";
import { CLOUD_PRIVACY_NOTICE, canTouchNetwork, cloudStateOf } from "../../core/cloudState";
import { AppearanceSettingsSection, HistorySettingsSection, AboutSettingsSection } from "./BasicSettingsSections";
import { UpdateCenterSection } from "./UpdateCenterSection";
import { useAiSettingsForm } from "./useAiSettingsForm";
import { AiSettingsSection } from "./AiSettingsSection";
import { useS3SettingsForm } from "./useS3SettingsForm";
import { S3ConfigImportSheet } from "./S3ConfigImportSheet";
import { useSettingsSectionData } from "./useSettingsSectionData";
import { useSyncSettingsForm } from "./useSyncSettingsForm";
import { useMissingBodies } from "./useMissingBodies";
import { MissingBodiesSheet, type MissingBodiesMode } from "./MissingBodiesSheet";
import { ResourceCleanupSheet, type ResourceCleanupMode } from "./ResourceCleanupSheet";
import { SyncConflictsEntry, SyncConflictsSheet } from "./SyncConflictsSheet";
import type { OrphanAsset } from "./useSettingsSectionData";
import { showToast } from "../ui/toastBus";
import { formatS3v3Diagnostics } from "../../core/s3v3Report";
import { readImportDefaultNotebook, writeImportDefaultNotebook } from "./importSettings";
import { DEFAULT_SPACE_OPTIONS, readDefaultHomeTab, writeDefaultHomeTab } from "./defaultSpace";
import type { HomeTab } from "../home/tabPager";
import { DefaultNotebookPickerSheet, type DefaultNotebookOption } from "./DefaultNotebookPickerSheet";
import { EmptyState } from "../ui/EmptyState";
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
  const [view, setView] = useState<View>("menu");

  /** 小记桌面快捷方式：部分机型不展示静态快捷方式，这里给「添加到桌面」兜底（对齐思源）。 */
  const [pinState, setPinState] = useState<{ available: boolean; pinned: boolean } | null>(null);
  const [pinMsg, setPinMsg] = useState("");
  useEffect(() => { void probePinShortcut().then(setPinState); }, []);
  const [previewNoteId, setPreviewNoteId] = useState<string | null>(null);
  const [listKey, setListKey] = useState(0);
  const {
    settings: s3,
    form: s3Form,
    updateForm: updateS3Form,
    testText: s3Test,
    exportState: s3Export,
    transferRef,
    save: saveS3,
    testConnection: testS3,
    openExport: openS3Export,
    copyExport: copyS3Transfer,
    importFromFile: importS3ConfigFromFile,
    importFromCode: importS3ConfigFromCode,
    closeExport: closeS3Export,
  } = useS3SettingsForm(open);
  /** 「粘贴迁移码」导入面板（与桌面 S3ConfigImportDialog 同形同构）。 */
  const [s3ImportOpen, setS3ImportOpen] = useState(false);
  const {
    history: hist,
    updateHistory: updateHist,
    orphans,
    orphanBusy,
    gcMsg,
    cleanOrphans,
    deleteOrphan,
    cleanCloud,
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
    supersededNotes: syncSuperseded,
    lastSyncText,
    syncReports,
    reloadSyncReports,
    conflictUnacked,
    reloadConflicts,
    runSync,
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
  /** 云端清理保留二次确认（删的是云端对象，不可撤销）。 */
  const requestCleanCloud = () => {
    void confirmMobile({
      title: "清理云端未引用文件？",
      body: "将删除云端 7 天以上、没有任何文档或历史版本引用的文件，删除后无法撤销。本机笔记与附件不受影响。",
      confirmText: "清理云端",
      danger: true,
    }).then((ok) => { if (ok) void cleanCloud(); });
  };
  // SD-13：同步诊断文本（最近 3 轮；只存本机，复制给维护者排障）。
  const syncDiagText = formatS3v3Diagnostics(syncReports);
  const [syncDiagMsg, setSyncDiagMsg] = useState("");
  const copySyncDiagnostics = async (): Promise<void> => {
    if (!syncDiagText) { setSyncDiagMsg("本机还没有同步诊断记录"); return; }
    try {
      await navigator.clipboard.writeText(syncDiagText);
      setSyncDiagMsg("同步诊断已复制到剪贴板");
    } catch {
      setSyncDiagMsg("无法写入剪贴板，请长按下方文本手动复制");
    }
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
      <header className="mobile-settings-head">
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
            <Group title="常规" icon={<Pencil size={16} />}>
              <Item itemId="editor-font-size" name="正文字号" desc="作用于当前文档正文。" icon={<List size={16} />} tone="#6b5bd6">
                <PickerSheet
                  label="正文字号"
                  value={settings.fontSize}
                  options={fontSizeOptions().map((fs) => ({ value: fs, label: fs + " px" }))}
                  onChange={(v) => update({ fontSize: v })}
                />
              </Item>
              <Item itemId="editor-max-open-tabs" name="最大同时打开标签数" desc="每个空间（文档、日记）各自独立计算，超过上限自动关闭该空间最旧的标签；最多 16 个。">
                <PickerSheet
                  label="最大同时打开标签数"
                  value={settings.maxOpenTabs}
                  options={MAX_OPEN_TAB_OPTIONS.map((n) => ({ value: n, label: n + " 个" }))}
                  onChange={(v) => update({ maxOpenTabs: v })}
                />
              </Item>
              <Switch itemId="editor-clear-tabs-on-exit" name="退出时关闭全部标签" desc="开启后下次启动不恢复上次打开的标签；关闭（默认）则恢复。仅本机偏好，不同步。" checked={settings.clearTabsOnExit} onChange={(checked) => update({ clearTabsOnExit: checked })} />
              {/* 261110：默认空间 = 打开 App 落在哪个一级页（小记 / 知识库 / 日记 / 标签）。仅本机，不进 S3。 */}
              <Item itemId="editor-default-space" name="默认空间" desc="打开 App 时落在哪个一级页。仅本机设置，不参与同步。">
                <PickerSheet
                  label="默认空间"
                  value={defaultHomeTab}
                  options={DEFAULT_SPACE_OPTIONS}
                  onChange={(next) => { writeDefaultHomeTab(next); setDefaultHomeTab(next); showToast("已设为默认空间：" + (DEFAULT_SPACE_OPTIONS.find((o) => o.value === next)?.label ?? "")); }}
                />
              </Item>
              <Item itemId="editor-max-attachment" name="附件大小上限" desc="仅影响本机上传校验。">
                <PickerSheet
                  label="附件大小上限"
                  value={Math.round(settings.maxAttachmentBytes / (1024 * 1024))}
                  options={MAX_ATTACHMENT_MB_OPTIONS_SETTINGS.map((mb) => ({ value: mb, label: mb + " MiB" }))}
                  onChange={(v) => update({ maxAttachmentBytes: v * 1024 * 1024 })}
                />
              </Item>
              {pinState?.available && !pinState.pinned && (
                <Item itemId="editor-pin-quick-note" name="新建小记" desc="添加到桌面。">
                  <button
                    className="mb-btn mb-btn--settings"
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
            <Group title="导入" icon={<Download size={16} />}>
              <Block
                itemId="import-default-notebook"
                name="默认笔记本"
                desc="通过系统分享导入的 Markdown 会在这个笔记本下新建文档（仅本机设置，不参与同步）。未设置时首次分享会先让你选一次。"
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
                    className="mb-btn mb-btn--settings"
                    disabled={importNotebookBusy}
                    onClick={() => setImportPickerOpen(true)}
                  >选择笔记本</button>
                </div>
              </Block>
            </Group>
          )}

          {view === "resources" && (
            <Group title="资源管理" icon={<Images size={16} />}>
              <Block itemId="resources-usage" name="本地资源占用" desc="正文引用的图片与附件实际占用（含手写板 / PDF 页图与表格图片；不含历史快照与数据库）。">
                <span className="mb-row__meta">
                  {assetUsage ? assetUsage.files + " 个文件，" + formatBytes(assetUsage.bytes) : "统计中…"}
                </span>
              </Block>
              {/* 261105 用户点单：删除入口不再外露在资源管理首页，必须先点「查看」进入明细面板。 */}
              <Block itemId="resources-clean" name="未引用的本地文件" desc="删除正文图片后残留的本地文件（不会被上传，可安全清理）。">
                <button className="mb-btn mb-btn--settings" disabled={orphans.length === 0 || orphanBusy} onClick={() => setCleanupSheet("orphans")}>查看（{orphans.length}）</button>
              </Block>
              <Block itemId="resources-gc" name="云端未引用文件" desc="删除云端 7 天以上、没有被任何文档或历史版本引用的文件。">
                <button className="mb-btn mb-btn--settings" disabled={orphanBusy || !canTouchNetwork(cloudState)} onClick={() => setCleanupSheet("cloudGc")}>查看</button>
                {(gcMsg || cloudBlockReason) && <div className="mb-form__desc">{gcMsg || cloudBlockReason}</div>}
              </Block>
              {missingBodies.docs.length > 0 && (
                <Block itemId="resources-missing-bodies" name="缺正文" desc="文档还在，但正文文件已经不在了。可以从云端拉回、恢复历史版本，或彻底删除。">
                  <button className="mb-btn mb-btn--settings" onClick={() => setMissingSheet("docs")}>查看（{missingBodies.docs.length}）</button>
                </Block>
              )}
              {missingBodies.quickNotes.length > 0 && (
                <Block itemId="resources-missing-quicknotes" name="缺小记" desc="小记还在列表里，但正文文件已经不在了。可以从云端拉回，或用搜索缓存重建纯文本。">
                  <button className="mb-btn mb-btn--settings" onClick={() => setMissingSheet("quickNotes")}>查看（{missingBodies.quickNotes.length}）</button>
                </Block>
              )}
              {orphans.length === 0 && missingBodies.docs.length === 0 && missingBodies.quickNotes.length === 0 && (
                <EmptyState inset>暂无冗余资源</EmptyState>
              )}
            </Group>
          )}

          {view === "s3" && (
            <>
              <Group title="连接信息" icon={<Cloud size={16} />}>
                  {/* 261102 用户点单 3b：S3 连接信息是内容输入类 ⇒ 一律 Field（标签在上、输入框占满下一行），
                      与桌面设置页同一形态；此前是裸 .mb-set-item + <input class="mb-input">（第二套输入外观，
                      且窄屏上输入框被标签挤到只剩几十像素，Endpoint/AK/SK 长值看不全）。
                      data-set-id 与桌面 settingsSearch 的 SETTING_ITEMS 对齐（s3-endpoint…s3-secret-key）。 */}
                  <Field itemId="s3-endpoint" name="Endpoint">
                    <TextField label="Endpoint" value={s3Form.endpoint} onSave={(v) => updateS3Form({ endpoint: v })} />
                  </Field>
                  <Field itemId="s3-region" name="Region">
                    <TextField label="Region" value={s3Form.region} onSave={(v) => updateS3Form({ region: v })} />
                  </Field>
                  <Field itemId="s3-bucket" name="Bucket">
                    <TextField label="Bucket" value={s3Form.bucket} onSave={(v) => updateS3Form({ bucket: v })} />
                  </Field>
                  <Field itemId="s3-prefix" name="Object prefix">
                    <TextField label="Object prefix" value={s3Form.prefix} onSave={(v) => updateS3Form({ prefix: v })} />
                  </Field>
                  <Field itemId="s3-access-key" name="Access Key">
                    <TextField label="Access Key" value={s3Form.accessKeyId} onSave={(v) => updateS3Form({ accessKeyId: v })} />
                  </Field>
                  <Field itemId="s3-secret-key" name="Secret Key">
                    <TextField label="Secret Key" type="password" value={s3Form.secretAccessKey} onSave={(v) => updateS3Form({ secretAccessKey: v })} />
                  </Field>
              </Group>

              <Group title="连接与同步" icon={<RefreshCw size={16} />}>
                  <Switch
                    name="启用云同步"
                    desc="关闭后本机按纯本地空间工作：不连 S3、不自动同步，回收站恢复/预览也不会去云端补拉缺失资源；重新开启后下次同步会自动补拉。"
                    note={<><span className="mb-tag mb-tag--pending">{CLOUD_PRIVACY_NOTICE.badge}</span>{" "}{CLOUD_PRIVACY_NOTICE.text}</>}
                    checked={syncCfg?.enabled !== false}
                    onChange={(next) => {
                      // 261029 FIX-M：开启前先判「本机是否有 S3 配置」——没有就只给可见提示（仍然允许开，但不会出网）。
                      setSyncEnableHint(next && cloudState === "unconfigured"
                        ? "还没有配置 S3：开启后也不会同步。请先在上方填写连接信息，并点「测试连接」。"
                        : "");
                      // 单一写入口：同步策略改了 → 自动同步定时器立刻重挂（useAutoSync）
                      updateSyncSettings({ enabled: next });
                    }}
                  />
                  {syncEnableHint && <div className="mb-set-item__desc mb-set-item__desc--warn" role="status">{syncEnableHint}</div>}
                  <div className="mb-set-block">
                    <div className="mb-set-block__name">保存并测试连接</div>
                    <div className="mb-set-item__desc">配置保存在本机；S3 只用于同步。</div>
                    <div className="mb-set-block__actions">
                      <button className="mb-btn mb-btn--settings" onClick={() => { void saveS3().then((ok) => { if (ok) setSyncEnableHint(""); }); }}>保存</button>
                      <button className="mb-btn mb-btn--settings" onClick={() => void testS3()}>测试连接</button>
                      <button className="mb-btn mb-btn--settings" disabled={syncCfg?.enabled === false} title={syncCfg?.enabled === false ? "云同步已关闭：不会联网" : undefined} onClick={() => void runSync()}><RefreshCw size={14} />立即同步</button>
                    </div>
                    {s3Test && <div className="mb-set-item__desc">{s3Test}</div>}
                    {syncMsg && <div className="mb-set-item__desc">{syncMsg}</div>}
                    {syncProgressText && <div className="mb-set-item__desc" aria-live="polite">{syncProgressText}</div>}
                    {/* 常驻：上次同步的时间/结果/失败原因（自动同步的失败也在这里看得到；云同步关闭时另加一句说明） */}
                    <div className="mb-set-item__desc">
                      上次同步：{lastSyncText}
                      {syncCfg?.enabled === false ? "（云同步当前已关闭，不会联网）" : ""}
                    </div>
                    {lastSyncBreakdown && <div className="mb-set-item__desc">{lastSyncBreakdown}</div>}
                    {/* 261105 P1 第 4 项：有未读同步记录（覆盖/删除）时给列表入口；没有就不占位。 */}
                    <SyncConflictsEntry count={conflictUnacked} onOpen={() => setConflictsOpen(true)} />
                  </div>
                  {syncCfg?.enabled !== false && (
                    <>
                      <Item itemId="sync-auto-mode" name="自动同步模式" desc={`${SYNC_OPEN_CLOSE_NOTE}移动端可能被系统直接结束，关闭时来不及同步，因此改为回到前台时同步（冷启动和回到前台各一次）。`}>
                        <PickerSheet
                          label="自动同步模式"
                          value={syncCfg?.autoMode ?? "manual"}
                          options={SYNC_AUTO_MODE_OPTIONS}
                          onChange={(v) => {
                            updateSyncSettings({ autoMode: v });
                          }}
                        />
                      </Item>
                      <Switch
                        name="按需下载附件"
                        desc="开启后首次同步只下载文档和附件列表，图片与附件在打开或预览时再下载（更快、省流量）；关闭则首次同步全部下载（离线更完整）。新设备默认开启。"
                        checked={syncCfg?.deferAssets === true}
                        onChange={(next) => updateSyncSettings({ deferAssets: next })}
                      />
                      {syncCfg?.autoMode === "interval" && (
                        <Item itemId="sync-auto-interval" name="自动同步间隔" desc="按固定间隔自动同步，到点触发一次；离线或未配置时不会联网。App 没在运行时不会触发，下次打开或回到前台会补一次。">
                          <PickerSheet
                            label="自动同步间隔"
                            value={syncCfg?.autoIntervalMinutes ?? 15}
                            options={syncIntervalOptions(syncCfg?.autoIntervalMinutes ?? 15).map((m) => ({ value: m, label: m + " 分钟" }))}
                            onChange={(v) => {
                              updateSyncSettings({ autoIntervalMinutes: v });
                            }}
                          />
                        </Item>
                      )}
                    </>
                  )}
                  {/* 261105 晚：恢复动作迁到独立的「备份与恢复」子页（与桌面分组对齐）；
                      本页只保留联网配置与同步本身。 */}
                  {/* SD-13：同步诊断（最近 3 轮；阶段耗时/对象数/字节/失败对象），可一键复制 */}
                  <div className="mb-set-block">
                    <div className="mb-set-block__name">同步诊断</div>
                    <div className="mb-set-item__desc">最近 3 轮同步的耗时、文件数量与失败项（只存本机，不上传）。同步变慢或失败时复制给维护者。</div>
                    {syncDiagText ? (
                      <div className="mb-input mb-input--multiline">
                        <textarea rows={5} readOnly spellCheck={false} value={syncDiagText} aria-label="最近 3 轮同步诊断" />
                      </div>
                    ) : (
                      <div className="mb-set-item__desc">本机还没有同步记录。</div>
                    )}
                    <div className="mb-set-block__actions">
                      <button className="mb-btn mb-btn--settings" disabled={!syncDiagText} onClick={() => void copySyncDiagnostics()}>复制同步诊断</button>
                    </div>
                    {syncDiagMsg && <div className="mb-set-item__desc">{syncDiagMsg}</div>}
                  </div>
                  {syncSuperseded.length > 0 && (
                    <div className="mb-set-block">
                      <div className="mb-set-block__name">同步有 {syncSuperseded.length} 篇被云端版本覆盖</div>
                      <div className="mb-set-item__desc">本地版本已自动留历史（可在此条目历史里找回），云端版本为准。</div>
                      <div className="mb-list" role="list">
                        {syncSuperseded.map((n) => (
                          <button key={n.id} type="button" className="mb-list-item" disabled={!onOpenNote} onClick={() => onOpenNote?.(n.id)}>
                            <span className="mb-list-item__text mb-ellipsis">{n.title || n.id}</span>
                            <span className="mb-list-item__meta">已留历史</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {syncWarnings.length > 0 && (
                    <div className="mb-set-block">
                      <div className="mb-set-block__name">同步有 {syncWarnings.length} 项被跳过</div>
                      <div className="mb-set-item__desc">远端缺少对象/资源或文件名不合法的条目已跳过；本地内容未改动。可重试类会在下次同步重试，文件名不合法需改名后再同步。</div>
                      <div className="mb-list" role="list">
                        {syncWarnings.map((w, i) => {
                          // 只有「正文缺失」类警告才给「去恢复」入口；资源类（asset_missing / asset_kept_remote /
                          // asset_invalid_name 等）一律按附件行展示，别把文件名问题误报成正文缺失。
                          const missingBody = w.kind === "local_body_missing" || w.kind === "local_body_restored";
                          const title = w.title || w.noteId || "未命名文档";
                          // 缺正文行给「去恢复」入口：正文文件不在，点开文档只会被拦，直接跳资源管理的清单。
                          if (missingBody) {
                            return (
                              <div key={`${w.kind}-${w.noteId ?? i}`} className="mb-row">
                                <span className="mb-row__title mb-ellipsis">{title}</span>
                                <span className="mb-row__meta">正文缺失</span>
                                <button className="mb-btn mb-btn--settings" onClick={() => { setView("resources"); void missingBodies.reload(); }}>去恢复</button>
                              </div>
                            );
                          }
                          return (
                            <button
                              key={`${w.kind}-${w.noteId ?? i}-${w.filename ?? ""}`}
                              type="button"
                              className="mb-list-item"
                              disabled={!w.noteId || !onOpenNote}
                              onClick={() => { if (w.noteId) onOpenNote?.(w.noteId); }}
                            >
                              <span className="mb-list-item__text mb-ellipsis">{title}</span>
                              <span className="mb-list-item__meta">
                                {w.kind === "asset_invalid_name" ? `${w.filename ?? "附件"}（文件名不支持同步）` : w.filename ?? "资源缺失"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
              </Group>

              <Group title="配置迁移" icon={<Download size={16} />}>
                  <Block itemId="s3-transfer" name="导入 / 导出迁移码" desc="在桌面端「设置 → 云端与同步 → S3 对象存储 → 配置迁移 → 导出到文件…」生成 .json 文件，发到手机后在这里导入；也可以粘贴另一台设备的迁移码（LLN1. 开头）。迁移码含 S3 密钥（已加密封装），请只在自己的设备间传递。">
                    <div className="mb-set-block__actions">
                      <button className="mb-btn mb-btn--settings" onClick={() => void importS3ConfigFromFile()}>从文件导入</button>
                      <button className="mb-btn mb-btn--settings" onClick={() => setS3ImportOpen(true)}>粘贴迁移码</button>
                      <button className="mb-btn mb-btn--settings" onClick={() => void openS3Export()}>导出迁移码</button>
                    </div>
                  </Block>
              </Group>

              <Group title="服务说明" icon={<TriangleAlert size={16} />}>
                  <div className="mb-s3-notice" role="note">
                    <div className="mb-s3-notice__title">第三方 S3 服务说明</div>
                    <p>当前使用的是 Amazon S3 协议兼容的第三方云端存储服务（如七牛云 Kodo、阿里云 OSS、Cloudflare R2）。</p>
                    <p>S3 的存储空间、流量与接口请求由服务商单独计费；本应用不收取费用、也不包含任何存储套餐，请自行确认计费项目与价格。</p>
                    <p>使用前请注意第三方服务的技术限制、计费与条款：</p>
                    <ul>
                      <li>接口调用频率、带宽等技术限制；</li>
                      <li>存储空间、流量、请求次数等计费项目；</li>
                      <li>服务条款、可用性保障与数据安全责任。</li>
                    </ul>
                    <p className="mb-s3-notice__warn"><TriangleAlert size={14} aria-hidden="true" /><span>注意：笔记正文与附件会按原样上传到你的 S3，云端不做加密；请务必确认该桶为私有、未开放公开读。</span></p>
                    <p className="mb-s3-notice__disclaimer">免责声明：本应用仅通过公开的 S3 兼容 API 访问你自己配置的桶，不对第三方服务的可用性、计费或数据安全负责；请确认桶为私有，且凭据只由你保管。</p>
                  </div>
              </Group>
              {s3Export && (
                <Group title="导出配置迁移码" icon={<Cloud size={16} />}>
                    <div className="mb-set-item">
                      <div className="mb-set-item__main">
                        <div className="mb-input mb-input--multiline">
                          <textarea ref={transferRef} rows={6} readOnly spellCheck={false} value={s3Export.code} />
                        </div>
                        <div className="mb-set-item__desc">迁移码含 S3 密钥（已加密封装），用于在桌面端导入。请只在自己的设备间传递。</div>
                        {s3Export.msg && <div className="mb-set-item__desc">{s3Export.msg}</div>}
                      </div>
                    </div>
                    <div className="mb-set-block">
                      <div className="mb-set-block__actions">
                        <button className="mb-btn mb-btn--settings" onClick={() => void copyS3Transfer()}>复制迁移码</button>
                        <button className="mb-btn mb-btn--settings" onClick={closeS3Export}>关闭</button>
                      </div>
                    </div>
                </Group>
              )}
              <S3ConfigImportSheet
                open={s3ImportOpen}
                onClose={() => setS3ImportOpen(false)}
                onImport={importS3ConfigFromCode}
              />
            </>
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
                      className="mb-btn mb-btn--settings mb-btn--danger"
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
                      className="mb-btn mb-btn--settings"
                      onClick={() => { setView("resources"); void missingBodies.reload(); }}
                    >去资源管理查看</button>
                  </div>
                  <div className="mb-set-item__desc">
                    文档或小记还在，但正文文件已经不在了。可以从云端拉回、恢复历史版本，或用搜索缓存重建纯文本。
                  </div>
                </div>
            </Group>

            <Group title="从桌面迁移" icon={<Download size={16} />}>
                {/* 261109：从便携包导入（覆盖本机；桌面导出 zip.lln → 手机导入，不需要先配 S3）。 */}
                <PortableImportSection onImported={() => void onRefresh()} />
            </Group>
            </>
          )}

          {view === "cache" && (
            <Group title="清理缓存" icon={<HardDrive size={16} />}>
                <div className="mb-set-block">
                  <div className="mb-set-item__desc">清理派生搜索索引（FTS + 账本，清完在后台自动重建）与 PDF 渲染临时文件。不会删除正文、附件、历史快照、回收站内容或未同步的修改。</div>
                  {cacheSummary && (
                    <div className="mb-set-stats">
                      <span>已下载资源（保留）：{cacheSummary.downloadableAssetBytes} 项</span>
                      <span>待上传（保留）：{cacheSummary.pendingUploadBytes} 项</span>
                    </div>
                  )}
                  <div className="mb-set-block__actions">
                    <button className="mb-btn mb-btn--settings" onClick={() => void clearCache()}>清理缓存</button>
                  </div>
                  {cacheMsg && <div className="mb-set-item__desc">{cacheMsg}</div>}
                </div>
            </Group>
          )}

          {view === "update" && <UpdateCenterSection appInfo={appInfo} />}

          {view === "about" && <AboutSettingsSection appInfo={appInfo} diag={diag} />}

          {view === "trash" && (
            <TrashList key={listKey} title="回收站" onChanged={onRefresh} onPreview={(noteId) => setPreviewNoteId(noteId)} />
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
        cloudReady={canTouchNetwork(cloudState)}
        cloudHint={cloudBlockReason ?? undefined}
        gcMessage={gcMsg}
        onClose={() => setCleanupSheet(null)}
        onPreviewOrphan={previewOrphan}
        onDeleteOrphan={(id) => void deleteOrphan(id)}
        onCleanOrphans={() => void cleanOrphans()}
        onCleanCloud={requestCleanCloud}
      />

      {previewNoteId && (
        <div className="mobile-settings-preview">
          <Suspense fallback={<EmptyState>正在加载预览…</EmptyState>}>
            <TrashPreviewPage
              noteId={previewNoteId}
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
