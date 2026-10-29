/** 移动端设置页（§6：同步设置 S3 / 清理缓存 / 回收站 / 关于）。
 * 版式：竖向菜单列表（设置项一行一行），点某项进入新页面（带返回）；子页内容用移动端自有骨架 .mb-set-*。
 * P4（261012）：版式原语已换成 src/mobile/ui/settingsPrimitives（mb-set-*），data-set-id 契约不变
 * （settingsSearch.ts 的 SETTING_ITEMS 继续生效）。
 * 注意：全部 App 设置为竖向（无横向 tab）；「回收站」并入总回收站（见 TrashList）。 */
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, Cloud, HardDrive, History, Images, Info, List, Palette, Pencil, RefreshCw, Sparkles, Trash, TriangleAlert, X } from "lucide-react";
import { loadSettings, saveSettings, fontSizeOptions, MAX_ATTACHMENT_MB_OPTIONS_SETTINGS, type AppSettings } from "../../lib/settings";
import { Group, Item, Seg, Block, NumField, Switch, TextField, Field } from "../ui/settingsPrimitives";
import { bridge } from "../bridge";
import { loadAiEnabled, saveAiEnabled } from "../ai/aiSettings";
import { clearAllConversations } from "../ai/aiChatStore";
import { confirmMobile } from "../ui/ConfirmDialog";
import { aiErrorInfoFromCode } from "../../core/aiErrors";
import { PickerSheet } from "../ui/PickerSheet";
import { SYNC_AUTO_MODE_OPTIONS, SYNC_OPEN_CLOSE_NOTE, syncIntervalOptions } from "../../core/syncModes";
import { S3V3_POINTER_VERSION } from "../../core/s3v3/protocol/s3v3Types";
import { usePanelDrag } from "../hooks/usePanelDrag";
import { pushBackHandler } from "../ui/backStack";
import { TrashList } from "./TrashList";
import { formatBytes } from "../../lib/formatBytes";
import { probePinShortcut, requestPinQuickNoteShortcut } from "../native/quickNoteShortcut";
import { CLOUD_PRIVACY_NOTICE, canTouchNetwork, cloudStateOf } from "../../core/cloudState";
import { useS3SettingsForm } from "./useS3SettingsForm";
import { S3ConfigImportSheet } from "./S3ConfigImportSheet";
import { aiConnectionFingerprint, getVerifiedAiFingerprint, invalidateAiConnectionVerified, markAiConnectionVerified } from "./aiTestState";
import { useSettingsSectionData } from "./useSettingsSectionData";
import { useSyncSettingsForm } from "./useSyncSettingsForm";
import { formatS3v3Diagnostics } from "../../core/s3v3Report";

/** Lake 内核版本（AGENTS §2 已 pin v1.99.0，勿随意升级；升级内核时同步改这里与关于页）。 */
const LAKEX_KERNEL_VERSION = "1.99.0";

/** 回收站只读预览（内含 Lake 内核编辑器）：**按需加载**——设置页/首屏都不需要内核。 */
const TrashPreviewPage = lazy(() => import("../trash/TrashPreviewPage").then((m) => ({ default: m.TrashPreviewPage })));

export interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  /** 点击同步告警：打开对应文档。 */
  onOpenNote?: (noteId: string) => void;
}

type View = "menu" | "editor" | "appearance" | "history" | "resources" | "s3" | "ai" | "cache" | "trash" | "about";

const MENU: { key: Exclude<View, "menu">; label: string; icon: typeof Cloud }[] = [
  // 261029 P6 重排：高频/跨设备项在前（同步、AI），个人偏好居中，本机数据维护，低频与元信息收尾。
  { key: "s3", label: "同步设置", icon: Cloud },
  { key: "ai", label: "AI 助手", icon: Sparkles },
  { key: "editor", label: "编辑器", icon: List },
  { key: "appearance", label: "外观", icon: Palette },
  { key: "history", label: "历史", icon: History },
  { key: "resources", label: "资源管理", icon: Images },
  { key: "cache", label: "清理缓存", icon: HardDrive },
  { key: "trash", label: "回收站", icon: Trash },
  { key: "about", label: "关于", icon: Info },
];

const MENU_LABEL = (key: Exclude<View, "menu">) => MENU.find((m) => m.key === key)?.label ?? "";

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
    runSync,
  } = useSyncSettingsForm(open, onRefresh);
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

  // ── AI 助手（261023 P1）：开关与接入配置；Key 只在原生（Android Keystore），这里只显示尾号 ──
  const [aiEnabled, setAiEnabled] = useState(() => loadAiEnabled());
  const [aiMeta, setAiMeta] = useState<{ baseUrl: string; model: string; hasKey: boolean; keyTail: string; temperature: number } | null>(null);
  const [aiForm, setAiForm] = useState({ baseUrl: "", model: "", apiKey: "", temperature: "" });
  const [aiMsg, setAiMsg] = useState("");
  /** 防御开启（261029）：只有**当前已保存的 AI 连接配置**测试通过过，才允许把开关打开。 */
  const [aiVerifiedFp, setAiVerifiedFp] = useState<string | null>(() => getVerifiedAiFingerprint());
  const aiIdentity = {
    baseUrl: aiMeta?.baseUrl ?? "",
    model: aiMeta?.model ?? "",
    hasKey: !!aiMeta?.hasKey,
    keyTail: aiMeta?.keyTail ?? "",
  };
  const aiVerified = aiVerifiedFp !== null && aiMeta !== null && aiVerifiedFp === aiConnectionFingerprint(aiIdentity);
  useEffect(() => {
    if (!open || view !== "ai") return;
    void bridge.aiGetSettings().then((settings) => {
      setAiMeta(settings);
      setAiForm({ baseUrl: settings.baseUrl, model: settings.model, apiKey: "", temperature: String(settings.temperature) });
    }).catch((error) => setAiMsg("读取 AI 设置失败：" + (error as Error).message));
  }, [open, view]);
  const saveAiSettingsForm = async (): Promise<void> => {
    try {
      const temperature = Number(aiForm.temperature);
      await bridge.aiSaveSettings({
        baseUrl: aiForm.baseUrl.trim(),
        model: aiForm.model.trim(),
        ...(aiForm.apiKey.trim() ? { apiKey: aiForm.apiKey.trim() } : {}),
        ...(Number.isFinite(temperature) ? { temperature } : {}),
      });
      const settings = await bridge.aiGetSettings();
      setAiMeta(settings);
      setAiForm({ baseUrl: settings.baseUrl, model: settings.model, apiKey: "", temperature: String(settings.temperature) });
      setAiMsg("已保存");
    } catch (error) {
      setAiMsg("保存失败：" + (error as Error).message);
    }
  };
  const testAiConnection = async (): Promise<void> => {
    setAiMsg("正在测试…");
    const result = await bridge.aiTestConnection();
    if (!result.ok) {
      // 失败即视为未验证（防止"以前测通过过"继续放行）。
      invalidateAiConnectionVerified();
      setAiVerifiedFp(null);
      setAiMsg(aiErrorInfoFromCode({ code: result.code, status: result.status, detail: result.detail }).message);
      return;
    }
    // 通过：按「当时实际的已保存配置」的指纹记账；之后只有改动连接字段/换 Key 才会失效。
    const settings = await bridge.aiGetSettings().catch(() => null);
    if (settings) setAiMeta(settings);
    const fp = aiConnectionFingerprint({
      baseUrl: settings?.baseUrl ?? aiIdentity.baseUrl,
      model: settings?.model ?? aiIdentity.model,
      hasKey: settings ? settings.hasKey : aiIdentity.hasKey,
      keyTail: settings ? settings.keyTail : aiIdentity.keyTail,
    });
    markAiConnectionVerified(fp);
    setAiVerifiedFp(fp);
    setAiMsg("连通性正常");
  };


  const pageRef = useRef<HTMLDivElement>(null);
  const maskRef = useRef<HTMLDivElement>(null);
  const isSub = view !== "menu";
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
        <div className="mobile-settings-title">{isSub ? MENU_LABEL(view) : "设置"}</div>
        {/* 右槽与左槽等宽（40）⇒ 标题落在页中线上。根页右槽 = 可见「关闭」（261029 FIX-M2）；子页保留空槽。 */}
        {isSub ? <div className="mobile-settings-spacer" /> : (
          <button className="mobile-settings-close" onClick={onClose} aria-label="关闭设置"><X size={22} /></button>
        )}
      </header>

      {isSub ? (
        <div className="mobile-settings-content">
          {view === "editor" && (
            <Group title="编辑器" icon={<Pencil size={16} />}>
              <Item itemId="editor-font-size" name="正文字号" desc="作用于当前文档正文。">
                <PickerSheet
                  label="正文字号"
                  value={settings.fontSize}
                  options={fontSizeOptions().map((fs) => ({ value: fs, label: fs + " px" }))}
                  onChange={(v) => update({ fontSize: v })}
                />
              </Item>
              <Item itemId="editor-max-open-tabs" name="最大同时打开标签数" desc="超过上限自动关闭最旧的标签。">
                <PickerSheet
                  label="最大同时打开标签数"
                  value={settings.maxOpenTabs}
                  options={[{ value: 0, label: "不限" }, ...[4, 6, 8, 12, 16, 24].map((n) => ({ value: n, label: n + " 个" }))]}
                  onChange={(v) => update({ maxOpenTabs: v })}
                />
              </Item>
              <Switch itemId="editor-clear-tabs-on-exit" name="退出时关闭全部标签" desc="开启后下次启动不恢复上次打开的标签；关闭（默认）则恢复。仅本机偏好，不同步。" checked={settings.clearTabsOnExit} onChange={(checked) => update({ clearTabsOnExit: checked })} />
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
                    className="mb-btn mb-btn--secondary"
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

          {view === "appearance" && (
            <Group title="外观" icon={<Palette size={16} />}>
              {/* 用户 261012：说明文案去掉，只留「浅色 / 深色」两个选项（名字即语义）。 */}
              <Item itemId="appearance-theme" name="主题">
                <Seg ariaLabel="主题">
                  <button className={"mb-btn mb-btn--secondary mb-segment__item" + (settings.theme === "light" ? " is-active" : "")} onClick={() => update({ theme: "light" })}>浅色</button>
                  <button className={"mb-btn mb-btn--secondary mb-segment__item" + (settings.theme === "dark" ? " is-active" : "")} onClick={() => update({ theme: "dark" })}>深色</button>
                </Seg>
              </Item>
            </Group>
          )}

          {view === "ai" && (
            <Group title="AI 助手" icon={<Sparkles size={16} />}>
              {/* 带说明的表单行用 Field：ctl 占整行（flex 1 1 100%）⇒ 换行后的输入框与
                  模型 / API Key / 温度 的输入框同一右缘（261029 实测 Item 换行后 ctl 取固有宽：右缘 278.9 vs 379.4）。 */}
              <Field itemId="ai-base-url" name="接口地址" desc="OpenAI 兼容端点（默认 DeepSeek）。">
                <TextField label="接口地址" value={aiForm.baseUrl} placeholder="https://api.deepseek.com/v1" onSave={(v) => setAiForm((form) => ({ ...form, baseUrl: v }))} />
              </Field>
              <Item itemId="ai-model" name="模型">
                <TextField label="模型" value={aiForm.model} placeholder="deepseek-chat" onSave={(v) => setAiForm((form) => ({ ...form, model: v }))} />
              </Item>
              <Item itemId="ai-api-key" name="API Key" desc="只保存在本机安全存储，页面里看不到明文；这里只显示尾号。">
                <TextField label="API Key" type="password" value={aiForm.apiKey} placeholder={aiMeta?.hasKey ? aiMeta.keyTail + "（留空＝不改）" : "sk-…"} onSave={(v) => setAiForm((form) => ({ ...form, apiKey: v }))} />
              </Item>
              <Item itemId="ai-temperature" name="温度">
                <TextField label="温度" value={aiForm.temperature} placeholder="0.7" onSave={(v) => setAiForm((form) => ({ ...form, temperature: v }))} />
              </Item>
              <Block itemId="ai-actions" name="保存与连通性">
                <div className="ai-settings__actions">
                  <button type="button" className="mb-btn mb-btn--primary" onClick={() => void saveAiSettingsForm()}>保存</button>
                  <button type="button" className="mb-btn mb-btn--secondary" onClick={() => void testAiConnection()}>测试连通性</button>
                </div>
                {aiMsg && <div className="mb-form__desc">{aiMsg}</div>}
              </Block>
              {/* 261029 用户点单：AI 必须先配置好接口/模型/Key 才能开启 ⇒ 开关放在配置区下方（原在 Group 最上面）。 */}
              <Switch
                itemId="ai-enabled"
                name="AI 助手"
                desc={aiVerified
                  ? "开启后 AI 才会联网；请先在上面填好接口、模型与 API Key 并保存。与云同步无关，关掉同步也能用 AI。"
                  : aiEnabled
                    ? "当前配置还没通过测试；改动接口、模型或 Key 后需要重新测试。可随时关闭，但再次开启前必须测试通过。"
                    : "先填好接口、模型与 API Key 并保存，点「测试连通性」通过后才能开启；未通过时点击开关只提示、不会打开。"}
                checked={aiEnabled}
                onChange={(checked) => {
                  // 261029 FIX-M：不再禁灰；未验证时点击开启只给提示、保持关闭（实质仍是「测试通过才能开」）。
                  if (checked && !aiVerified) {
                    setAiMsg("先填好接口、模型与 API Key，点「测试连通性」通过后才能开启 AI。");
                    return;
                  }
                  saveAiEnabled(checked);
                  setAiEnabled(checked);
                  setAiMsg("");
                }}
              />
              <Block itemId="ai-history" name="已保存的对话" desc="最多保留 50 条、30 天；保存在本机，含资料快照，不含 API Key，也不参与云同步。">
                <div className="ai-settings__actions">
                  <button type="button" className="mb-btn mb-btn--secondary" onClick={() => {
                    void confirmMobile({ title: "清空全部历史对话？", body: "只影响本机保存的 AI 对话，不影响笔记与同步。", confirmText: "清空", danger: true })
                      .then((ok) => { if (!ok) return; void clearAllConversations().then(() => setAiMsg("已清空本机保存的 AI 历史对话")); });
                  }}>清空全部对话</button>
                </div>
              </Block>
              <Block itemId="ai-key-clear" name="API Key" desc={aiMeta?.hasKey ? "当前已配置（" + aiMeta.keyTail + "）；清除后需要重新填写才能使用。" : "尚未配置。"}>
                <div className="ai-settings__actions">
                  <button type="button" className="mb-btn mb-btn--secondary mb-btn--danger" disabled={!aiMeta?.hasKey} onClick={() => {
                    void confirmMobile({ title: "清除 API Key？", body: "清除后 AI 将无法联网，直到重新填写。", confirmText: "清除", danger: true })
                      .then(async (ok) => {
                        if (!ok) return;
                        try {
                          await bridge.aiSaveSettings({ apiKey: "" });
                          const settings = await bridge.aiGetSettings();
                          setAiMeta(settings);
                          setAiMsg("已清除 API Key");
                        } catch (error) { setAiMsg("清除失败：" + (error as Error).message); }
                      });
                  }}>清除 API Key</button>
                </div>
              </Block>
            </Group>
          )}

          {view === "history" && hist && (
            <Group title="历史" icon={<History size={16} />}>
              <Item itemId="history-max-snapshots" name="每文档快照上限" desc="超过后只保留最新 N 份。">
                <NumField label="每文档快照上限" value={hist.maxSnapshots} min={1} max={500} floor={1} fallback={100} onSave={(n) => updateHist({ maxSnapshots: n })} />
              </Item>
              <Item itemId="history-retention-days" name="保留天数" desc="超过该天数的快照会被清理。">
                <NumField label="保留天数" value={hist.retentionDays} min={1} max={365} floor={1} fallback={30} onSave={(n) => updateHist({ retentionDays: n })} />
              </Item>
              <Item itemId="history-snapshot-interval" name="自动快照间隔（分钟）" desc="0 = 关闭定时自动快照。">
                <NumField label="自动快照间隔" value={hist.snapshotIntervalMinutes} min={0} max={1440} floor={0} fallback={15} onSave={(n) => updateHist({ snapshotIntervalMinutes: n })} />
              </Item>
              <Item itemId="history-cleanup-interval" name="定期清理间隔（小时）" desc="0 = 关闭定期巡检清理。">
                <NumField label="定期清理间隔" value={hist.cleanupIntervalHours} min={0} max={168} floor={0} fallback={24} onSave={(n) => updateHist({ cleanupIntervalHours: n })} />
              </Item>
            </Group>
          )}

          {view === "resources" && (
            <Group title="资源管理" icon={<Images size={16} />}>
              <Block itemId="resources-clean" name="未引用的本地文件" desc="删除正文图片后残留的本地文件（不会被上传，可安全清理）。">
                <button className="mb-btn mb-btn--primary" disabled={orphans.length === 0 || orphanBusy} onClick={() => void cleanOrphans()}>清理全部（{orphans.length}）</button>
              </Block>
              <Block itemId="resources-gc" name="云端未引用文件" desc="删除云端 7 天以上、没有被任何文档或历史版本引用的文件。">
                <button className="mb-btn mb-btn--primary" disabled={orphanBusy || !canTouchNetwork(cloudState)} onClick={() => {
                  void confirmMobile({
                    title: "清理云端未引用文件？",
                    body: "将删除云端 7 天以上、没有任何文档或历史版本引用的文件，删除后无法撤销。本机笔记与附件不受影响。",
                    confirmText: "清理云端",
                    danger: true,
                  }).then((ok) => { if (ok) void cleanCloud(); });
                }}>清理云端</button>
                {(gcMsg || cloudBlockReason) && <div className="mb-form__desc">{gcMsg || cloudBlockReason}</div>}
              </Block>
              {orphans.length === 0 && <div className="mb-empty mb-empty--inset">暂无冗余资源</div>}
              {orphans.map((o) => (
                <div key={o.id} className="mb-row">
                  <span className="mb-row__title">{o.filename}</span>
                  <span className="mb-row__meta">{formatBytes(o.size)}</span>
                  <button className="mb-iconbtn mb-row__action" onClick={() => void deleteOrphan(o.id)} aria-label="删除"><Trash size={16} /></button>
                </div>
              ))}
            </Group>
          )}

          {view === "s3" && (
            <>
              <div className="mb-set-group">
                <div className="mb-set-title"><Cloud size={16} />同步设置（七牛 S3）</div>
                <div className="mb-set-items">
                  <div className="mb-set-item">
                    <div className="mb-set-item__main"><div className="mb-set-name">Endpoint</div></div>
                    <div className="mb-set-item__ctl"><input className="mb-input" value={s3Form.endpoint} onChange={(e) => updateS3Form({ endpoint: e.target.value })} /></div>
                  </div>
                  <div className="mb-set-item">
                    <div className="mb-set-item__main"><div className="mb-set-name">Region</div></div>
                    <div className="mb-set-item__ctl"><input className="mb-input" value={s3Form.region} onChange={(e) => updateS3Form({ region: e.target.value })} /></div>
                  </div>
                  <div className="mb-set-item">
                    <div className="mb-set-item__main"><div className="mb-set-name">Bucket</div></div>
                    <div className="mb-set-item__ctl"><input className="mb-input" value={s3Form.bucket} onChange={(e) => updateS3Form({ bucket: e.target.value })} /></div>
                  </div>
                  <div className="mb-set-item">
                    <div className="mb-set-item__main"><div className="mb-set-name">Object prefix</div></div>
                    <div className="mb-set-item__ctl"><input className="mb-input" value={s3Form.prefix} onChange={(e) => updateS3Form({ prefix: e.target.value })} /></div>
                  </div>
                  <div className="mb-set-item">
                    <div className="mb-set-item__main"><div className="mb-set-name">Access Key</div></div>
                    <div className="mb-set-item__ctl"><input className="mb-input" value={s3Form.accessKeyId} onChange={(e) => updateS3Form({ accessKeyId: e.target.value })} /></div>
                  </div>
                  <div className="mb-set-item">
                    <div className="mb-set-item__main"><div className="mb-set-name">Secret Key</div></div>
                    <div className="mb-set-item__ctl"><input className="mb-input" type="password" value={s3Form.secretAccessKey} onChange={(e) => updateS3Form({ secretAccessKey: e.target.value })} /></div>
                  </div>
                  <Block itemId="s3-transfer" name="配置迁移" desc="在桌面端「设置 → 云端与同步 → S3 对象存储 → 配置迁移 → 导出到文件…」生成 .json 文件，发到手机后在这里导入；也可以粘贴另一台设备的迁移码（LLN1. 开头）。迁移码含 S3 密钥（已加密封装），请只在自己的设备间传递。">
                    <div className="mb-set-block__actions">
                      <button className="mb-btn mb-btn--secondary" onClick={() => void importS3ConfigFromFile()}>从文件导入</button>
                      <button className="mb-btn mb-btn--secondary" onClick={() => setS3ImportOpen(true)}>粘贴迁移码</button>
                      <button className="mb-btn mb-btn--secondary" onClick={() => void openS3Export()}>导出迁移码</button>
                    </div>
                  </Block>
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
                </div>
              </div>
              {s3Export && (
                <div className="mb-set-group">
                  <div className="mb-set-title"><Cloud size={16} />导出配置迁移码</div>
                  <div className="mb-set-items">
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
                        <button className="mb-btn mb-btn--primary" onClick={() => void copyS3Transfer()}>复制迁移码</button>
                        <button className="mb-btn mb-btn--ghost" onClick={closeS3Export}>关闭</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div className="mb-set-group">
                <div className="mb-set-title"><RefreshCw size={16} />连接与同步</div>
                <div className="mb-set-items">
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
                      <button className="mb-btn mb-btn--primary" onClick={() => { void saveS3().then((ok) => { if (ok) setSyncEnableHint(""); }); }}>保存</button>
                      <button className="mb-btn mb-btn--primary" onClick={() => void testS3()}>测试连接</button>
                      <button className="mb-btn mb-btn--secondary" disabled={syncCfg?.enabled === false} title={syncCfg?.enabled === false ? "云同步已关闭：不会联网" : undefined} onClick={() => void runSync()}><RefreshCw size={14} />立即同步</button>
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
                  {/* 261028（用户批准）：移动端补「从云端恢复（换机/坏库）」——
                      清本机同步基线后整轮只拉不打；不照抄桌面的「整库改名隔离 + 重启」（移动端附件可能 1.6GB，隔离整库代价过高）。 */}
                  <div className="mb-set-block">
                    <div className="mb-set-block__name">从云端恢复（换机或数据损坏）</div>
                    <div className="mb-set-item__desc">
                      以云端为准重建本机：清空本机同步记录后全部重新下载（只下载，不上传本机内容）。
                      云端没有的本机文档/小记会移入回收站并标「云端已删除（仅本地）」，正文与历史保留可恢复。
                      用于换机、本机数据损坏，或提示「云端是另一套数据」时。
                    </div>
                    <div className="mb-set-block__actions">
                      <button
                        type="button"
                        className="mb-btn mb-btn--secondary mb-btn--danger"
                        disabled={syncCfg?.enabled === false || restoreBusy}
                        title={syncCfg?.enabled === false ? "云同步已关闭：不会联网" : undefined}
                        onClick={() => void restoreFromCloud()}
                      >{restoreBusy ? "正在恢复…" : "从云端恢复…"}</button>
                    </div>
                    {restoreMsg && <div className="mb-set-item__desc" aria-live="polite">{restoreMsg}</div>}
                  </div>
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
                      <button className="mb-btn mb-btn--secondary" disabled={!syncDiagText} onClick={() => void copySyncDiagnostics()}>复制同步诊断</button>
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
                      <div className="mb-set-item__desc">远端缺少对象/资源，已跳过受影响条目；本地内容未改动，下次同步会重试。</div>
                      <div className="mb-list" role="list">
                        {syncWarnings.map((w, i) => (
                          <button
                            key={`${w.kind}-${w.noteId ?? i}-${w.filename ?? ""}`}
                            type="button"
                            className="mb-list-item"
                            disabled={!w.noteId || !onOpenNote}
                            onClick={() => { if (w.noteId) onOpenNote?.(w.noteId); }}
                          >
                            <span className="mb-list-item__text mb-ellipsis">{w.title || w.noteId || "未命名文档"}</span>
                            <span className="mb-list-item__meta">{w.kind === "asset_missing" ? (w.filename ?? "资源缺失") : "正文缺失"}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <S3ConfigImportSheet
                open={s3ImportOpen}
                onClose={() => setS3ImportOpen(false)}
                onImport={importS3ConfigFromCode}
              />
            </>
          )}

          {view === "cache" && (
            <div className="mb-set-group">
              <div className="mb-set-title"><HardDrive size={16} />清理缓存</div>
              <div className="mb-set-items">
                <div className="mb-set-block">
                  <div className="mb-set-item__desc">只清理可重建的缓存，不会删除正文、未同步的修改或已下载的资源。</div>
                  {cacheSummary && (
                    <div className="mb-set-stats">
                      <span><strong>运行时缓存</strong>：{cacheSummary.runtimeBlobBytes} 项</span>
                      <span>已下载资源（保留）：{cacheSummary.downloadableAssetBytes} 项</span>
                      <span>待上传（保留）：{cacheSummary.pendingUploadBytes} 项</span>
                    </div>
                  )}
                  <div className="mb-set-block__actions">
                    <button className="mb-btn mb-btn--primary" onClick={() => void clearCache()}>清理缓存</button>
                  </div>
                  {cacheMsg && <div className="mb-set-item__desc">{cacheMsg}</div>}
                </div>
              </div>
            </div>
          )}

          {view === "about" && (
            <div className="mb-set-group">
              <div className="mb-set-title"><Info size={16} />关于</div>
              <div className="mb-set-items">
                <div className="mb-set-block">
                  <div className="mb-set-block__name">{appInfo?.name ?? "LakexLocalNotes"}</div>
                  <div className="mb-set-item__desc">版本 {appInfo?.version ?? "…"}（构建 {appInfo?.build ?? "…"}）</div>
                  <div className="mb-set-item__desc">平台：{appInfo?.platform === "web" ? "Web 预览（原生能力未就绪）" : "Android，Capacitor 8 + 原生 SQLite"}</div>
                  <div className="mb-set-item__desc">编辑器：Lake 内核 v{LAKEX_KERNEL_VERSION}</div>
                  <div className="mb-set-item__desc">同步：内核 v4，协议 v{String(S3V3_POINTER_VERSION)}（内容寻址）；本地是真相，S3 只做同步镜像</div>
                  <div className="mb-set-item__desc">本地优先：正文、附件与索引都保存在本机。</div>
                  <div className="mb-set-item__desc">字体：内置 MiSans（小米科技，依《MiSans 字体知识产权许可协议》免费商用并注明）+ JetBrains Mono（SIL OFL 1.1）</div>
                </div>
                {diag && (
                  <div className="mb-set-block">
                    <div className="mb-set-block__name">数据诊断</div>
                    <div className="mb-set-stats">
                      <span><strong>文档</strong> {diag.noteCount}</span>
                      <span><strong>分组</strong> {diag.folderCount}</span>
                      <span><strong>小记</strong> {diag.quickNoteCount}</span>
                      <span><strong>资源</strong> {diag.resourceCount}</span>
                      <span><strong>孤儿</strong> {diag.orphanCount}</span>
                      <span><strong>待回收</strong> {diag.gcPendingCount}</span>
                      <span><strong>快照</strong> {diag.snapshotCount}</span>
                      <span><strong>库大小</strong> {formatBytes(diag.dbBytes)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {view === "trash" && (
            <TrashList key={listKey} title="回收站" onChanged={onRefresh} onPreview={(noteId) => setPreviewNoteId(noteId)} />
          )}
        </div>
      ) : (
        <div className="mobile-settings-list">
          {MENU.map((m) => {
            const Icon = m.icon;
            return (
              <button key={m.key} className="mb-row mobile-settings-row" onClick={() => { setView(m.key); setPreviewNoteId(null); }}>
                <Icon size={20} className="mb-row__icon" />
                <span className="mb-row__title">{m.label}</span>
                <ChevronRight size={18} className="mb-row__chevron" />
              </button>
            );
          })}
        </div>
      )}

      {previewNoteId && (
        <div className="mobile-settings-preview">
          <Suspense fallback={<div className="mb-empty">正在加载预览…</div>}>
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