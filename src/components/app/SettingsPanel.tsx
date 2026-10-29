import { useEffect, useMemo, useRef, useState } from "react";
import { Cloud, Coffee, ExternalLink, Files, Globe, History, Image as Info, Keyboard, Monitor, Moon, Palette, Paperclip, Terminal, TriangleAlert, Archive, HardDrive, Search, Settings, Sun, Trash, Type, X } from "lucide-react";
import { Sparkles, Eye, EyeOff } from "lucide-react";
import { fontSizeOptions, type AppSettings } from "../../lib/settings";
import { AI_PROVIDERS, AI_REASONING_EFFORTS, AI_THINKING_MODES, type AiReasoningEffort, type AiSettingsPatch, type AiSettingsView, type AiThinkingMode } from "../../core/aiProviders";
import { Select } from "../ui/Select";
import { canTouchNetwork, cloudStateHint, cloudStateOf, CLOUD_PRIVACY_NOTICE } from "../../core/cloudState";
import { S3V3_POINTER_VERSION } from "../../core/s3v3/protocol/s3v3Types";

/** 把归类后的中文错误贴到对应字段：Key 类 → apiKey；端点/模型类 → baseUrl+model；其余整条。 */
function fieldErrorFor(message: string, retryable?: boolean): Record<string, string> {
  // 先判可重试：断网/限流的文案里也可能出现 "Base URL" 字样，若先按文案匹配会误贴到字段上。
  if (retryable) return {};
  if (/API Key|无权访问|额度/.test(message)) return { apiKey: message };
  if (/模型名不被支持/.test(message)) return { model: message };
  if (/模型不存在|Base URL/.test(message)) return { baseUrl: message, model: message };
  return message ? { all: message } : {};
}

/** 关于页「技术身份」：vendored Lake 内核与 React wrapper 是固定 pin。
 *  机器可读版本未进 sysInfo（wrapper 在 package.json 里是 file: 依赖），内核升级时同步
 *  vendor/lakex-doc-react/package.json 与 docs/LAKEX-CONTRACT.md。 */
const LAKE_KERNEL_VERSION = "1.99.0";
const LAKE_WRAPPER_VERSION = "0.1.3";
/** sysInfo.deps 的版本值可能带 ^/~；file: 依赖不是版本号，按本地 vendor 显示。 */
function depVersion(deps: Record<string, string> | undefined, name: string): string {
  const raw = deps?.[name];
  if (!raw) return "—";
  return raw.startsWith("file:") ? "本地 vendor" : raw.replace(/^[~^>=<\s]+/, "");
}
import { LAKE_THEMES } from "../../lib/themes";
import { native } from "../../lib/native";
import { hostCapabilities } from "../../lib/hostCapabilities";
import type { DataHealthReport, S3Settings, SyncSettings } from "../../lib/types";
import { SYNC_AUTO_MODE_OPTIONS, SYNC_OPEN_CLOSE_NOTE } from "../../core/syncModes";
import { useFloatingDialog } from "../hooks/useFloatingDialog";
import { useConfirm } from "../../hooks/useConfirm";
// DT-13：异步动作的 busy/提示统一走共用原语（不再逐组手写 setBusy/setMsg/try/catch/finally）
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { DialogResizeHandles } from "../ui/DialogResizeHandles";
import { filterSettingsNav, searchSettingItems, type SettingItemEntry } from "../model/settingsSearch";
import { getNativeErrorMessage, reportNativeActionError } from "../../lib/nativeErrors";
import { S3ConfigImportDialog } from "./S3ConfigImportDialog";
import { formatBytes } from "../../lib/formatBytes";
import { formatDateTime } from "../../core/dateFormat";
import { formatS3v3Diagnostics, type S3v3DiagnosticReport } from "../../core/s3v3Report";
import { effectiveS3Settings, isQiniuEndpoint, s3ConfigFingerprint } from "../../lib/s3FormState";
import { loadAiEnabled, saveAiEnabled } from "../../lib/aiEnabled";

export type SettingsCategory = "editor" | "appearance" | "shortcuts" | "history" | "sync" | "ai" | "trash" | "browser" | "logs" | "about";

interface SettingsPanelProps {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onChange: (patch: Partial<AppSettings>) => void;
  /** 打开设置时默认定位的分类，适合从具体功能的引导入口跳转。 */
  openCategory?: SettingsCategory;
  onS3SettingsChanged?: (settings: S3Settings) => void;
  onSyncSettingsChanged?: (settings: SyncSettings) => void;
  /** 云端是否已配置 / 是否启用（与顶栏状态灯同一来源，判"离线"用）。 */
  cloudConfigured?: boolean;
  cloudEnabled?: boolean;
}

const S3_DEFAULTS: S3Settings = { endpoint: "", region: "cn-east-1", bucket: "", prefix: "lakex-local-notes", accessKeyId: "", secretAccessKey: "", forcePathStyle: false };

/** 让浏览器先把 data URL 解码好再上屏：<img> 换 src 的那一帧若未解码完会画空白（闪烁的另一半来源）。 */


import { Group, Section, Item, Field, Block, Switch, Shortcut, Seg, NumField, TextField } from "../ui/settingsPrimitives";

export function SettingsPanel({ open, settings, onClose, onChange, openCategory = "editor", onS3SettingsChanged, onSyncSettingsChanged, cloudConfigured = false, cloudEnabled = false }: SettingsPanelProps) {
  const [category, setCategory] = useState<SettingsCategory>(openCategory);
/** 模块级：本次会话内「测试通过」的配置指纹（面板关闭/重开不丢；改字段即失效）。 */
let verifiedS3Fingerprint: string | null = null;

  const [navQuery, setNavQuery] = useState("");
  const navSearchRef = useRef<HTMLInputElement>(null);
  const floating = useFloatingDialog({ id: "settings", initialSize: { w: 840, h: 600 }, minSize: { w: 620, h: 420 } });
  /** 确认/提示浮层（DT-02）：替代 window.confirm / window.alert（云端恢复这类不可逆动作走它）。 */
  const { confirm, notice, confirmElement } = useConfirm();

  const [stats, setStats] = useState<{ snapshotCount: number; totalBytes: number } | null>(null);
  const [histCfg, setHistCfg] = useState<{ maxSnapshots: number; retentionDays: number; cleanupIntervalHours: number; snapshotIntervalMinutes: number } | null>(null);
  const [lastCleanup, setLastCleanup] = useState<{ at: string; deletedSnapshots: number; freedBytes: number } | null>(null);
  // A3 数据体检：只读三查报告
  const [health, setHealth] = useState<DataHealthReport | null>(null);
  // A1/A2 备份与恢复
  // F1 日志查看（busy/提示走 useAsyncAction，见下方 DT-13 段）
  const [logRows, setLogRows] = useState<Array<{ line: string; hit: boolean }>>([]);
  const [logKeyword, setLogKeyword] = useState("");

  const [s3, setS3] = useState<S3Settings>(S3_DEFAULTS);
  /**
   * 连接测试通过的状态按**配置指纹**绑定（261028 验收修复）：
   *  - 测试通过 ⇒ 记住当时的指纹；「保存配置」不改变指纹 ⇒ 不会让测试结果失效（旧实现靠一个 boolean，
   *    面板重挂/重读设置就丢了，用户必须先保存再测一次才能开云同步）；
   *  - 改动任一连接字段 ⇒ 指纹变化 ⇒ 自动失效（必须重新测试）。
   * 指纹模块级缓存：面板关闭再打开仍保留（同一份配置就是同一次测试结果）。
   */
  const [s3VerifiedFp, setS3VerifiedFp] = useState<string | null>(verifiedS3Fingerprint);
  const s3Verified = s3VerifiedFp !== null && s3VerifiedFp === s3ConfigFingerprint(s3);
  /** 261029 FIX-D：未验证时点「启用云同步」的行内提示（只提示，不改变开关状态）。 */
  const [syncGateAlert, setSyncGateAlert] = useState<string | null>(null);
  const markS3Verified = () => { verifiedS3Fingerprint = s3ConfigFingerprint(s3); setS3VerifiedFp(verifiedS3Fingerprint); setSyncGateAlert(null); };
  const invalidateS3Verified = () => { verifiedS3Fingerprint = null; setS3VerifiedFp(null); setSyncGateAlert(null); };
  /** S3 配置文件迁移：粘贴迁移码弹窗（备用路径）。 */
  const [s3ImportOpen, setS3ImportOpen] = useState(false);
  // AI：设置只在打开该分类时读取（Key 已脱敏，永不进渲染层）。
  // 采用**草稿式**：编辑不落盘，先「拉模型 / 测试」验证草稿，通过（或用户选择仍要保存）才写回。
  const [aiView, setAiView] = useState<AiSettingsView | null>(null);
  /** AI 动作的结果提示（保存 / 测试 / 拉模型列表共用这一条通道，谁最后写谁显示）。 */
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  /** AI 总开关（设备本地；关闭后任何路径不出网，配置与 Key 保留）。 */
  const [aiEnabled, setAiEnabled] = useState(() => loadAiEnabled());
  /** 尝试在未配置 Key 时开启 AI 的行内提示。 */
  const [aiEnableAlert, setAiEnableAlert] = useState<string | null>(null);
  /** 字段级错误（键：apiKey / baseUrl / model / all）——比一个笼统提示好用。 */
  const [aiErr, setAiErr] = useState<Record<string, string>>({});
  /** 未保存的编辑值；apiKey 只在本组件内存里，测通后才落盘。 */
  const [aiDraft, setAiDraft] = useState<{ baseUrl?: string; model?: string; apiKey?: string; temperature?: number; reasoningEffort?: AiReasoningEffort; thinking?: AiThinkingMode }>({});
  /** API Key 是否明文显示（眼睛按钮）。仅影响当前输入框，不改变任何存储语义。 */
  const [aiKeyVisible, setAiKeyVisible] = useState(false);
  const [aiModels, setAiModels] = useState<string[] | null>(null);
  /** 模型列表存在时仍强制手填（select 里选「手填…」）。 */
  const [aiManualModel, setAiManualModel] = useState(false);
  /** 连通测试失败但可重试（网络/限流）⇒ 允许「仍要保存」。 */
  const [aiForceSave, setAiForceSave] = useState(false);
  const activeAi = useMemo(() => aiView?.providers.find((p) => p.id === aiView.activeProviderId) ?? null, [aiView]);
  const aiProviderId = aiView?.activeProviderId ?? AI_PROVIDERS[0].id;
  const activeDef = AI_PROVIDERS.find((p) => p.id === aiProviderId) ?? AI_PROVIDERS[0];
  /** 草稿 + 已存值合成的「待保存配置」，给拉列表/测试用。 */
  const aiPending = useMemo(() => ({
    id: aiProviderId,
    baseUrl: aiDraft.baseUrl ?? activeAi?.baseUrl ?? activeDef.defaultBaseUrl,
    model: aiDraft.model ?? activeAi?.model ?? activeDef.defaultModel,
    apiKey: aiDraft.apiKey || undefined,
    temperature: aiDraft.temperature ?? activeAi?.temperature ?? 0.7,
    reasoningEffort: aiDraft.reasoningEffort ?? activeAi?.reasoningEffort,
    thinking: aiDraft.thinking ?? activeAi?.thinking,
  }), [aiDraft, activeAi, aiProviderId, activeDef]);
  const resetAiDraft = () => { setAiDraft({}); setAiKeyVisible(false); setAiErr({}); setAiForceSave(false); };
  useEffect(() => {
    if (!open || category !== "ai") return;
    let alive = true;
    void native.aiGetSettings().then((v) => { if (alive) { setAiView(v); setAiDraft({}); setAiKeyVisible(false); setAiErr({}); setAiForceSave(false); } }).catch(() => {});
    return () => { alive = false; };
  }, [open, category]);
  // 保存不是 busy 动作（「测试并保存」要在 aiRun 的忙碌窗口内调用它，走 run 会被重入守卫吞掉）；
  // 成功清空、失败写错误，都落在同一条 aiMsg 通道上（与原实现一致）。
  const saveAi = async (patch: AiSettingsPatch) => {
    try { setAiView(await native.aiSaveSettings(patch)); aiRun.setMessage(null); }
    catch (e) { aiRun.setMessage(getNativeErrorMessage(e)); }
  };
  /** 待保存字段的补丁（Key 只在编辑态才带上）。 */
  const aiPendingPatch = () => ({
    id: aiProviderId, baseUrl: aiPending.baseUrl, model: aiPending.model, temperature: aiPending.temperature,
    reasoningEffort: aiPending.reasoningEffort, thinking: aiPending.thinking,
    ...(aiDraft.apiKey ? { apiKey: aiDraft.apiKey } : {}),
  });
  /** 切供应商：按该家默认初始化，并清空草稿与模型列表。 */
  const switchAiProvider = async (id: string) => {
    resetAiDraft(); setAiModels(null); aiRun.setMessage(null);
    await saveAi({ activeProviderId: id, providers: [{ id }] });
  };
  /** 拉模型列表：本身就是一次轻量连通验证；失败按字段贴错、回落手填。 */
  const fetchAiModels = async () => {
    // 没有已存 Key、草稿里也没填 → 先把 Key 输入框打开并明确提示，别发一次注定失败的请求
    // （用户实测坑：配完 Key 但没走「测试并保存」，Key 未落盘，点拉列表只看到"未配置 API Key"）。
    if (!activeAi?.hasApiKey && !aiDraft.apiKey) {
      setAiErr({ apiKey: "请先填写 API Key（拉取模型列表需要它）" });
      aiModelsRun.setMessage("请先填写 API Key，再获取模型列表");
      return;
    }
    setAiErr({}); setAiForceSave(false);
    await aiModelsRun.run(async () => {
      const r = await native.aiListModels(aiPending);
      if (r.ok) {
        const ms = r.models ?? [];
        setAiModels(ms); setAiManualModel(false);
        // 还没选模型（如「自定义」默认模型为空）→ 自动选第一个，省得用户对着空下拉
        setAiDraft((d) => (d.model ?? activeAi?.model) ? d : { ...d, model: ms[0] ?? "" });
      } else {
        setAiModels(null);
        setAiErr(fieldErrorFor(r.error ?? "未知错误", r.retryable));
      }
      return r;
    }, {
      success: (r) => r.ok
        ? "已获取模型列表：" + (r.models ?? []).length + " 个"
        : "拉取模型列表失败：" + (r.error ?? "未知错误"),
      errorPrefix: "拉取模型列表失败：",
    });
  };
  const testAi = async () => {
    await aiRun.run(async () => {
      setAiErr({});
      const r = await native.aiTestConnection(aiPending);
      if (!r.ok) setAiErr(fieldErrorFor(r.error ?? "", r.retryable));
      return r;
    }, {
      success: (r) => r.ok ? "连接成功 ✓" : "失败：" + (r.error ?? "未知错误"),
      errorPrefix: "失败：",
    });
  };
  /** 保存前 gate：先测草稿。鉴权/模型类硬拦；网络/限流给「仍要保存」。 */
  const testAndSaveAi = async () => {
    await aiRun.run(async () => {
      setAiErr({}); setAiForceSave(false);
      const r = await native.aiTestConnection(aiPending);
      if (!r.ok) {
        setAiErr(fieldErrorFor(r.error ?? "未知错误", r.retryable));
        setAiForceSave(Boolean(r.retryable));
        return r;
      }
      await saveAi({ providers: [aiPendingPatch()] });
      resetAiDraft();
      // 连通已证明可用：顺手拉一次列表（用**已保存**配置），让模型下拉马上能选
      void native.aiListModels().then((lr) => { if (lr.ok && lr.models?.length) { setAiModels(lr.models); setAiManualModel(false); } }).catch(() => {});
      return r;
    }, {
      success: (r) => r.ok ? "连接成功，已保存 ✓" : "连接失败：" + (r.error ?? "未知错误"),
      errorPrefix: "连接失败：",
    });
  };
  /** 仅保存不测试（只在「仍要保存」路径出现）。原实现不置 busy、也不禁用按钮 ⇒ 这里只把文案写进同一通道。 */
  const forceSaveAi = async () => {
    await saveAi({ providers: [aiPendingPatch()] });
    resetAiDraft(); setAiForceSave(false); aiRun.setMessage("已保存（未通过连通测试）");
  };
  const [gcCfg, setGcCfg] = useState<{ gcRetentionDays: number; gcIntervalHours: number; trashAutoPurgeDays: number } | null>(null);
  const [gcLog, setGcLog] = useState<Array<{ id: number; ts: string; action: string; key: string; reason: string; ok: boolean }>>([]);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [webStatus, setWebStatus] = useState<{ enabled: boolean; port: number; url: string } | null>(null);
  const [syncCfg, setSyncCfg] = useState<SyncSettings | null>(null);
  // 云同步状态（单一判据）：App 的 cloudConfigured（与顶栏同一来源）+ 面板里的真实 syncCfg。
  // ⚠️ 不要用本面板的 s3 —— 它只是表单初值、永远是对象（判"已配置"会永远为真）。
  // enabled 用 App 的 cloudEnabled（与顶栏同一来源），autoMode 用面板里的真实 syncCfg。
  const cloudState = cloudStateOf(cloudConfigured, syncCfg && { enabled: cloudEnabled, autoMode: syncCfg.autoMode });
  const cloudOffline = !canTouchNetwork(cloudState);
  const [sysInfo, setSysInfo] = useState<import("../../lib/types").SystemInfo | null>(null);
  const [pendingHit, setPendingHit] = useState<string | null>(null);
  const [diagMsg, setDiagMsg] = useState<string | null>(null);
  // SD-13：最近 3 轮 v3 同步诊断（device_state，经 get_sync_status 带出；不新增 IPC 通道）。
  const [syncReports, setSyncReports] = useState<S3v3DiagnosticReport[]>([]);
  const [syncDiagMsg, setSyncDiagMsg] = useState<string | null>(null);

  // DT-13（261028）：十组手写 busy/msg（历史清理 / 数据体检 / 搜索索引 / 备份恢复 / 深度清理 / 同步策略 /
  // 日志读取 / 浏览器端 / AI 测试 / AI 拉模型）改走 useAsyncAction —— 成功/失败文案仍由调用方给，UI 结构与文案不变。
  // gc 与「同步策略」历史上共用状态栏那一条 syncMsg（谁最后写谁显示）⇒ 用 channel 保持这条语义。
  // AI 的「测试」与「拉模型列表」历史上也共用一条 aiMsg ⇒ 两个实例传同一条 channel（busy 仍各自独立）。
  const hist = useAsyncAction();
  const healthCheck = useAsyncAction();
  const searchIndex = useAsyncAction();
  const backup = useAsyncAction();
  const gcRun = useAsyncAction({ channel: { message: syncMsg, setMessage: setSyncMsg } });
  const syncCfgRun = useAsyncAction({ channel: { message: syncMsg, setMessage: setSyncMsg } });
  const logLoad = useAsyncAction();
  const webRun = useAsyncAction();
  const aiRun = useAsyncAction({ channel: { message: aiMsg, setMessage: setAiMsg } });
  const aiModelsRun = useAsyncAction({ channel: { message: aiMsg, setMessage: setAiMsg } });

  /** A1 整库备份：选目录 → 备份到 <dir>/lakex-local-notes-backup-<ts>/。 */
  const runBackup = async () => {
    // 整库备份需要本机文件系统（浏览器端没有）——判据归一到宿主能力矩阵。
    if (!hostCapabilities().localFileSystem) { backup.setMessage("浏览器端暂不支持整库备份（请在桌面端操作）"); return; }
    await backup.run(async () => {
      const dir = await native.pickBackupDir();
      // 用户在系统框里取消：不写任何提示（与原实现早退一致）。
      if (!dir) return null;
      const r = await native.runWorkspaceBackup(dir);
      return `备份完成：${r.backupPath}（目录 ${r.copiedDirs.length} 个）`;
    }, { success: (text) => text, errorPrefix: "备份失败：" });
  };

  /** A2 云端恢复（换机/坏库）：隔离备份当前数据 → 全新空库 → 重启后首次同步全量拉取。 */
  const runCloudRestore = async () => {
    // 云端恢复要隔离本机数据并重启应用，同样依赖本机文件系统/进程（浏览器端没有）。
    if (!hostCapabilities().localFileSystem) { backup.setMessage("浏览器端不支持云端恢复（需重启本机应用，请在桌面端操作）"); return; }
    if (!(await confirm({
      title: "从云端恢复？",
      body: "将：① 把当前全部本地数据改名隔离保存（可手动找回）；② 清空工作区为全新空库；③ 重启后首次同步从云端全量拉取（只拉不传）。",
      confirmText: "继续",
      danger: true,
    }))) return;
    await backup.run(async () => {
      const { quarantinePath } = await native.prepareCloudRestore();
      await notice({
        title: "本地数据已隔离备份",
        body: <>当前数据已隔离备份到：<div className="note-info-path">{quarantinePath}</div>应用即将重启并从云端恢复。</>,
      });
      await native.confirmRelaunch();
    }, { errorPrefix: "云端恢复失败：" });
  };

  /** F1 日志查看：尾部关键字过滤（GC/sync/trash 等），纯读。 */
  const runLogLoad = async (keyword: string) => {
    await logLoad.run(async () => {
      try {
        const r = await native.readAppLog({ keyword: keyword.trim() || undefined, maxLines: 200, context: 1 });
        setLogRows(r.matches);
        return r;
      } catch (e) {
        // 与原实现一致：读取失败清掉上一次的列表，避免把旧结果显示成这次的结果。
        setLogRows([]);
        throw e;
      }
    }, {
      success: (r) => (r.matches.length === 0 ? "无匹配日志" : r.truncated ? `显示最近 ${r.matches.length} 行（已截断）` : `共 ${r.matches.length} 行`),
      errorPrefix: "日志读取失败：",
      // 原实现读取期间保留上一条提示，结果回来再覆盖。
      clearOnStart: false,
    });
  };

  /** A3 数据体检：只读三查（notes↔文件/hash、history↔文件、orphan 登记↔文件）。 */
  const runHealth = async () => {
    await healthCheck.run(async () => {
      try {
        setHealth(await native.runDataHealthCheck());
      } catch (reason) {
        // 体检失败一直显示在「文档历史」那条状态行里（迁移前就是写 histMsg），这里仍走 hist 的提示通道。
        hist.setMessage("数据体检失败：" + getNativeErrorMessage(reason));
        throw reason;
      }
    });
  };

  useEffect(() => {
    if (!open) return;
    setCategory(openCategory);
    void native.getHistoryStats().then(setStats).catch((error) => reportNativeActionError("设置页读取", error));
    void native.getHistorySettings().then(setHistCfg).catch((error) => reportNativeActionError("设置页读取", error));
    void native.getLastHistoryCleanup().then(setLastCleanup).catch((error) => reportNativeActionError("设置页读取", error));
    void native.getS3Settings().then((v) => v && setS3(v)).catch((error) => reportNativeActionError("设置页读取", error));
    void native.getS3GcSettings().then(setGcCfg).catch((error) => reportNativeActionError("设置页读取", error));
    void native.getSyncSettings().then(setSyncCfg).catch((error) => reportNativeActionError("设置页读取", error));
    void native.getWebStatus().then(setWebStatus).catch((error) => reportNativeActionError("设置页读取", error));
    void native.listS3GcLog().then(setGcLog).catch((error) => reportNativeActionError("设置页读取", error));
  }, [open, openCategory]);

  // 关于页：只读概览（版本/环境/存储）。每次进入分类都刷新，保证计数与磁盘一致。
  useEffect(() => {
    if (!open || category !== "about") return;
    let alive = true;
    setSysInfo(null);
    setDiagMsg(null);
    native.getSystemInfo().then((r) => { if (alive) setSysInfo(r); }).catch(() => { if (alive) setDiagMsg("读取系统信息失败"); });
    return () => { alive = false; };
  }, [open, category]);

  const itemHits = useMemo<SettingItemEntry[]>(() => (navQuery.trim() ? searchSettingItems(navQuery) : []), [navQuery]);

  /** 跳到条目所在分类，渲染完成后滚动到该行并闪一下（思源是隐藏非命中项；我们只标注，避免用户以为设置被删了）。 */
  const jumpToItem = (hit: SettingItemEntry) => {
    if (category !== hit.category) setCategory(hit.category);
    setPendingHit(hit.id);
  };

  useEffect(() => {
    if (!pendingHit) return;
    const el = document.querySelector<HTMLElement>(`.settings-content [data-set-id="${pendingHit}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("is-hit");
    const timer = window.setTimeout(() => { el.classList.remove("is-hit"); setPendingHit(null); }, 1600);
    return () => { window.clearTimeout(timer); el.classList.remove("is-hit"); };
  }, [pendingHit, category]);

  // 同步诊断：只在「云端与同步」分类打开时读取（失败静默为「无记录」）。
  useEffect(() => {
    if (!open || category !== "sync") return;
    let alive = true;
    setSyncDiagMsg(null);
    native.getSyncStatus()
      .then((info) => { if (alive) setSyncReports(info.v3Reports ?? []); })
      .catch(() => { if (alive) setSyncReports([]); });
    return () => { alive = false; };
  }, [open, category]);

  useEffect(() => {
    const ids = new Set(itemHits.map((h) => h.id));
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(".settings-content [data-set-id]"))) {
      el.classList.toggle("is-match", ids.has(el.dataset.setId ?? ""));
    }
  }, [itemHits, category]);

  const revealFolder = (kind: import("../../lib/types").DataFolderKind) => {
    void native.revealDataFolder(kind).then((r) => setDiagMsg(r.ok ? `已在 Finder 中显示：${r.path}` : `目录尚不存在：${r.path}`)).catch((e) => setDiagMsg(getNativeErrorMessage(e)));
  };

  const copyDiagnostics = async () => {
    if (!sysInfo) return;
    const st = sysInfo.storage;
    const lines = [
      `LakexLocalNotes ${sysInfo.app.version}${sysInfo.packaged ? "" : "（开发实例）"}`,
      `Electron ${sysInfo.runtime.electron}，Chromium ${sysInfo.runtime.chromium}，Node ${sysInfo.runtime.node}，${sysInfo.runtime.platform}/${sysInfo.runtime.arch}`,
      `依赖：${Object.entries(sysInfo.deps).map(([k, v]) => `${k}@${v}`).join(", ")}`,
      `数据目录：${st.root}`,
      `日志目录：${sysInfo.paths.logs}`,
      `笔记 ${st.notes}，笔记本 ${st.notebooks}，分组 ${st.groups}，小记 ${sysInfo.quickNotes}`,
      `资源 ${st.assetFiles} 个 / ${formatBytes(st.assetBytes)}，历史快照 ${st.historySnapshots} 份 / ${formatBytes(st.historyBytes)}`,
      `回收站节点 ${st.trashedNodes}，删除标记 ${st.tombstones}，未归属记录 ${st.orphanRows}，库文件 ${formatBytes(st.dbBytes)}`,
      `生成于 ${new Date().toLocaleString()}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setDiagMsg("诊断信息已复制到剪贴板");
    } catch { setDiagMsg("复制失败（剪贴板不可用）"); }
  };

  const syncDiagText = useMemo(() => formatS3v3Diagnostics(syncReports), [syncReports]);

  const copySyncDiagnostics = async () => {
    if (!syncDiagText) { setSyncDiagMsg("本机还没有 v3 同步记录"); return; }
    try {
      await navigator.clipboard.writeText(syncDiagText);
      setSyncDiagMsg("同步诊断已复制到剪贴板");
    } catch { setSyncDiagMsg("复制失败（剪贴板不可用）"); }
  };

  const nav = [
    { id: "editor" as const, label: "编辑器", keywords: "字号 大纲 工具栏 标签页" , icon: <Type size={15} /> },
    { id: "appearance" as const, label: "外观", keywords: "浅色 深色 主题", icon: <Palette size={15} /> },
    { id: "shortcuts" as const, label: "快捷键", keywords: "快捷键 搜索 专注模式 键盘", icon: <Keyboard size={15} /> },
    { id: "history" as const, label: "文档与历史", keywords: "快照 保留 清理", icon: <History size={15} /> },
    { id: "trash" as const, label: "回收站", keywords: "删除 恢复 清空", icon: <Trash size={15} /> },
    { id: "sync" as const, label: "云端与同步", keywords: "S3 上传 下载 资源 云端 回收", icon: <Cloud size={15} /> },
    { id: "ai" as const, label: "AI", keywords: "AI 助手 供应商 模型 key api openai deepseek 密钥", icon: <Sparkles size={15} /> },
    { id: "browser" as const, label: "浏览器端", keywords: "浏览器 网页 web 附属窗口 端口 局域网 伺服", icon: <Globe size={15} /> },
    { id: "logs" as const, label: "日志", keywords: "日志 诊断 GC 同步 调试", icon: <Terminal size={15} /> },
    { id: "about" as const, label: "关于", keywords: "版本", icon: <Info size={15} /> },
  ];
  const filteredNav = filterSettingsNav(nav, navQuery);
  // 跳到命中条目后，当前分类未必匹配查询词 → 分类列表会被过滤空，看不出自己在哪：把当前分类补回导航。
  // 注意「唯一命中就自动切分类」的判断只看 filteredNav（不含补回的当前项），否则永远凑不出 length===1。
  const visibleNav = (() => {
    const current = nav.find((item) => item.id === category);
    return current && !filteredNav.some((item) => item.id === current.id) ? [...filteredNav, current] : filteredNav;
  })();
  useEffect(() => {
    if (!navQuery.trim() || filteredNav.length !== 1 || filteredNav[0].id === category) return;
    setCategory(filteredNav[0].id);
  }, [navQuery, category, filteredNav.map((item) => item.id).join("|")]);



  if (!open) return null;

  const saveHistCfg = (patch: Partial<NonNullable<typeof histCfg>>) => {
    if (!histCfg) return;
    const next = { ...histCfg, ...patch };
    setHistCfg(next);
    void native.saveHistorySettings(next).catch((reason) => {
      hist.setMessage("历史设置保存失败：" + getNativeErrorMessage(reason));
      void native.getHistorySettings().then(setHistCfg).catch((error) => reportNativeActionError("重读历史设置", error));
    });
  };

  const runCleanup = async () => {
    await hist.run(async () => {
      const r = await native.cleanupHistory();
      setStats(await native.getHistoryStats());
      return r.deletedSnapshots > 0 ? `已清理 ${r.deletedSnapshots} 份过期快照` : "无过期快照";
    }, { success: (text) => text });
  };

  const setS3Field = (key: keyof S3Settings, value: string | boolean) => { setS3((c) => ({ ...c, [key]: value })); invalidateS3Verified(); };
  const saveS3 = async () => {
    setSyncMsg(null);
    // 七牛 Kodo 不支持 Path-style：保存时强制纠正（旧配置里误开的开关也一起纠正）。
    const effective = effectiveS3Settings(s3);
    try {
      await native.saveS3Settings(effective);
      if (effective !== s3) setS3(effective);
      onS3SettingsChanged?.(effective);
      setSyncMsg("S3 配置已保存在当前设备");
    } catch (e) { setSyncMsg(getNativeErrorMessage(e)); }
  };
  const testS3 = async () => {
    setSyncMsg("正在连接...");
    const effective = effectiveS3Settings(s3);
    try {
      await native.saveS3Settings(effective);
      if (effective !== s3) setS3(effective);
      onS3SettingsChanged?.(effective);
      setSyncMsg(await native.testS3Connection());
      markS3Verified();
    } catch (e) { invalidateS3Verified(); setSyncMsg(getNativeErrorMessage(e)); }
  };
  /** 导出到文件：系统保存框 + 加密封装都在主进程（渲染层不接触明文 Secret）。 */
  const exportS3ConfigFile = async () => {
    setSyncMsg(null);
    try {
      const result = await native.exportS3ConfigFile();
      if (result.canceled) return;
      setSyncMsg(result.path ? `已导出 S3 配置：${result.path}` : "S3 配置已导出");
    } catch (e) { setSyncMsg(getNativeErrorMessage(e)); }
  };
  /** 从文件导入：系统选择框 + 解码/校验/落库都在主进程；成功后就地刷新表单。 */
  const importS3ConfigFile = async () => {
    setSyncMsg(null);
    try {
      const result = await native.importS3ConfigFile();
      if (result.canceled) return;
      const saved = await native.getS3Settings();
      if (saved) { setS3(saved); onS3SettingsChanged?.(saved); }
      invalidateS3Verified();
      setSyncMsg("S3 配置已从文件导入，请点「测试连接」确认后再使用云同步");
    } catch (e) { setSyncMsg(getNativeErrorMessage(e)); }
  };
  /** 备用：粘贴手机端导出的迁移码。 */
  const importS3Config = async (code: string): Promise<void> => {
    await native.importS3Config(code);
    const saved = await native.getS3Settings();
    if (saved) { setS3(saved); onS3SettingsChanged?.(saved); }
    invalidateS3Verified();
    setSyncMsg("S3 配置已导入，请点「测试连接」确认后再使用云同步");
  };

  const saveSyncCfg = async (patch: Partial<SyncSettings>) => {
    if (!syncCfg) return;
    const next = { ...syncCfg, ...patch };
    await syncCfgRun.run(async () => {
      try {
        // 只有 S3 配置可保存且连通测试通过，才允许开启云同步；测试失败则保持关闭、不写 enabled。
        if (patch.enabled === true) {
          setSyncMsg("正在测试 S3 连接...");
          try {
            await native.saveS3Settings(effectiveS3Settings(s3));
            onS3SettingsChanged?.(s3);
            setSyncMsg(await native.testS3Connection());
            markS3Verified();
          } catch (e) {
            invalidateS3Verified();
            setSyncMsg(getNativeErrorMessage(e) + "（未通过测试，云同步保持关闭）");
            return;
          }
        }
        const saved = await native.saveSyncSettings(next);
        setSyncCfg(saved);
        onSyncSettingsChanged?.(saved);
        setSyncMsg(saved.enabled
          ? "同步策略已保存"
          : saved.alignWarning
            ? "云同步已关闭（未能完成最后对齐，下次开启同步时会继续）"
            : "云同步已关闭（已完成最后一次对齐）");
      } catch (e) {
        // 失败后把面板里的策略读回真实值（与原来 catch 里同一条重读路径）；错误文案由 hook 落到状态栏。
        void native.getSyncSettings().then(setSyncCfg).catch((error) => reportNativeActionError("设置页读取", error));
        throw e;
      }
    });
  };

  const setWeb = async (enabled: boolean) => {
    // 重入由 useAsyncAction 兜住（替代迁移前的 `if (webBusy) return`）。
    await webRun.run(async () => {
      try {
        const st = await native.setWebEnabled(enabled);
        setWebStatus(st);
        return st;
      } catch (e) {
        // 失败后读回真实状态（与原 catch 里同一条重读路径）；错误文案由 hook 落到同一条提示。
        void native.getWebStatus().then(setWebStatus).catch((error) => reportNativeActionError("设置页读取", error));
        throw e;
      }
    }, { success: (st) => (st.enabled ? null : "已关闭") });
  };

  const openWeb = async () => {
    try {
      const r = await native.openWebClient();
      if (!r.ok) webRun.setMessage(r.reason ?? "打开失败");
    } catch (e) {
      webRun.setMessage(getNativeErrorMessage(e));
    }
  };

  const saveGcCfg = (patch: Partial<NonNullable<typeof gcCfg>>) => {
    if (!gcCfg) return;
    const next = { ...gcCfg, ...patch };
    setGcCfg(next);
    void native.saveS3GcSettings(next).catch((reason) => {
      setSyncMsg("回收设置保存失败：" + getNativeErrorMessage(reason));
      void native.getS3GcSettings().then(setGcCfg).catch((error) => reportNativeActionError("重读回收设置", error));
    });
  };
  const runGcAction = async (dryRun: boolean) => {
    if (!dryRun) {
      // 261029 FIX-D：手动深度清理会真删云端对象且不可恢复 ⇒ 二次确认（与其它销毁性动作同一套 confirm 原语）。
      const ok = await confirm({
        title: "执行深度清理？",
        body: "将立即删除云端已不再被任何文档或历史引用的对象，删除后无法恢复。建议先点「深度清理预览」确认可清理数量。",
        confirmText: "执行清理",
        danger: true,
      });
      if (!ok) return;
    }
    await gcRun.run(async () => {
      // 手动清理 = 显式清云端：无视 7 天窗口，直接列出/删除当前全部未引用对象（自动定时仍按窗口）
      const r = await native.runS3DeepCleanup(dryRun, true);
      return dryRun ? `预览：可清理 ${r.deleted.length} 个对象` : `已清理 ${r.deleted.length} 个对象`;
    }, { success: (text) => text });
  };

  /** 重建全文搜索索引（成功后给一句提示，失败落同一处）。 */
  const rebuildSearchIndex = async () => {
    await searchIndex.run(() => native.rebuildSearchIndex(), { success: "已重建搜索索引" });
  };

  // 提示文案仍落在原来的位置（同一个元素、同一个类名）：只是数据源从手写 state 换成 useAsyncAction。
  const histText = hist.error ?? hist.message;
  const searchText = searchIndex.error ?? searchIndex.message;
  const backupText = backup.error ?? backup.message;
  const logText = logLoad.error ?? logLoad.message;
  const webText = webRun.error ?? webRun.message;

  return (
    <div className="settings-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !floating.interactionRef.current) onClose(); }}>
      <div ref={floating.panelRef} className="floating-dialog settings-panel settings-panel-large" style={floating.panelStyle} role="dialog" aria-modal="true" aria-labelledby="settings-panel-title" onClick={(e) => e.stopPropagation()}>
        <header id="settings-panel-title" className="settings-header floating-dialog-header" onPointerDown={floating.startDrag}>
          <Settings size={16} />
          <span>偏好设置</span>
          <button className="ln-close" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav ln-list-panel ln-list-panel--background">
            <label className="settings-nav-search"><Search size={14} /><input ref={navSearchRef} value={navQuery} onChange={(event) => setNavQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { navSearchRef.current?.blur(); return; } if (event.key === "Enter" && itemHits.length > 0) { event.preventDefault(); jumpToItem(itemHits[0]); } }} placeholder="搜索设置（分类与条目）" aria-label="搜索设置" /></label>
            {visibleNav.map((item) => (
              <button key={item.id} className={`ln-list-item settings-nav-item${category === item.id ? " active" : ""}`} onClick={() => setCategory(item.id)}>
                {item.icon}<span>{item.label}</span>
              </button>
            ))}
            {visibleNav.length === 0 && itemHits.length === 0 && <span className="settings-nav-empty">没有匹配的设置</span>}
            {navQuery.trim() && itemHits.length > 0 && (
              <div className="settings-nav-hits">
                <span className="settings-nav-hits__label">条目 {itemHits.length} 项</span>
                {itemHits.map((hit) => (
                  <button key={hit.id} className="ln-list-item settings-nav-hit" onClick={() => jumpToItem(hit)} title={hit.label}>
                    <span className="ln-list-item__text ln-ellipsis">{hit.label}</span>
                    <span className="ln-list-item__meta">{nav.find((item) => item.id === hit.category)?.label}</span>
                  </button>
                ))}
              </div>
            )}
          </nav>
          {/* 资源页：内容区交给浏览器自己排版（列表/预览铺满到底、各自滚动），见 feature.css 的 --fill 链 */}
          <div className="settings-content">
            {category === "editor" && (
              <>
                <Group title="编辑器" icon={<Type size={16} />}>
                  <Field itemId="editor-font-size" name="正文字号" desc="调整编辑器正文的字号，只影响显示，不改文档内容。">
                    <Select label="正文字号" value={String(settings.fontSize)} onChange={(v) => onChange({ fontSize: Number(v) })} options={fontSizeOptions().map((fs) => ({ value: String(fs), label: `${fs} px` }))} />
                  </Field>
                  <Switch itemId="editor-outline-enhance" name="大纲增强" desc="开启后在桌面右栏使用增强大纲（可筛选、折叠、显示级别徽标）；关闭则使用 Lake 原生大纲。移动端始终使用应用的大纲面板。" checked={settings.outlineEnhance} onChange={(checked) => onChange({ outlineEnhance: checked })} />
                  <Switch itemId="editor-toolbar" name="显示固定工具栏" desc="编辑器顶部的固定工具栏。关闭后界面更简洁，格式操作改用浮动工具栏。" checked={settings.showToolbar} onChange={(checked) => onChange({ showToolbar: checked })} />
                  <Switch itemId="editor-floating-toolbar" name="浮动工具栏" desc="选中文字或图片时在选区旁弹出格式工具条；与固定工具栏互不影响。" checked={settings.floatingToolbar} onChange={(checked) => onChange({ floatingToolbar: checked })} />
                </Group>
                <Group title="标签页" icon={<Files size={16} />}>
                  <Field itemId="editor-max-open-tabs" name="最大同时打开标签数" desc="超过上限时自动关闭最旧的标签（当前编辑的标签与钉住的标签除外），未保存内容会自动保存。">
                    <Select label="最大同时打开标签数" value={String(settings.maxOpenTabs)} onChange={(v) => onChange({ maxOpenTabs: Number(v) })} options={[
                      { value: "0", label: "不限" }, { value: "4", label: "4 个" }, { value: "6", label: "6 个" },
                      { value: "8", label: "8 个" }, { value: "12", label: "12 个" }, { value: "16", label: "16 个" },
                      { value: "24", label: "24 个" },
                    ]} />
                  </Field>
                  <Switch itemId="editor-clear-tabs-on-exit" name="退出时关闭全部标签" desc="开启后下次启动不恢复上次打开的标签；默认关闭。只保存在本机，不参与同步。" checked={settings.clearTabsOnExit} onChange={(checked) => onChange({ clearTabsOnExit: checked })} />
                </Group>
                <Group title="附件" icon={<Paperclip size={16} />}>
                  <Field itemId="editor-max-attachment" name="附件大小上限" desc="插入附件时的本机上限；同步与下载统一按协议上限（100 MiB），不受其他设备设置影响。">
                    <Select label="附件大小上限" value={String(settings.maxAttachmentBytes / (1024 * 1024))} onChange={(v) => onChange({ maxAttachmentBytes: Number(v) * 1024 * 1024 })} options={[
                      { value: "25", label: "25 MiB" }, { value: "50", label: "50 MiB" }, { value: "100", label: "100 MiB" },
                    ]} />
                  </Field>
                </Group>
              </>
            )}

            {category === "appearance" && (
              <Group title="外观" icon={<Monitor size={16} />}>
                <Item itemId="appearance-theme" name="主题">
                  <Seg ariaLabel="主题">
                    {LAKE_THEMES.map((t) => (
                      <button key={t.id} className={`ln-btn ln-btn--secondary seg__item ${settings.theme === t.id ? "is-active" : ""}`} onClick={() => onChange({ theme: t.id })}>
                        {t.id === "dark" ? <Moon size={14} /> : t.id === "warm" ? <Coffee size={14} /> : <Sun size={14} />} {t.label}
                      </button>
                    ))}
                  </Seg>
                </Item>
              </Group>
            )}

            {category === "shortcuts" && (
              <Group title="快捷键" icon={<Keyboard size={16} />}>
                <Block desc="当前版本先展示固定快捷键，暂不支持自定义。" />
                <Shortcut itemId="shortcut-search" name="打开全局搜索（标题和正文）" keys="⌘K" />
                <Shortcut itemId="shortcut-focus" name="进入或退出专注模式" keys="⌘⇧Enter" />
              <Shortcut itemId="shortcut-sidebar" name="收起或固定目录栏" keys="⌘]" />
                <Shortcut itemId="shortcut-move" name="在搜索结果中移动" keys="↑ / ↓" />
                <Shortcut itemId="shortcut-open" name="打开搜索结果并定位命中" keys="Enter" />
                <Shortcut itemId="shortcut-open-tab" name="在新标签打开并定位命中" keys="⌘Enter" />
                <Shortcut itemId="shortcut-esc" name="关闭当前菜单或浮层" keys="Esc" />
              </Group>
            )}

            {category === "history" && (
              <>
                <Group title="文档历史" icon={<History size={16} />}>
                  <Block itemId="history-stats" name="快照占用" desc="历史快照保存在本机，不参与同步。恢复前会自动保存当前版本。">
                    <div className="config-stats">
                      <span>快照 <strong>{stats ? stats.snapshotCount : "—"}</strong> 份</span>
                      <span>{stats ? formatBytes(stats.totalBytes) : "统计中…"}</span>
                      {lastCleanup && <span>上次清理 {formatDateTime(new Date(lastCleanup.at))}，{lastCleanup.deletedSnapshots} 份，{formatBytes(lastCleanup.freedBytes)}</span>}
                    </div>
                    <div className="config-block__actions">
                      <button className="ln-btn ln-btn--secondary" onClick={() => void runCleanup()} disabled={hist.busy}><Trash size={14} /> {hist.busy ? "清理中…" : "立即清理"}</button>
                    </div>
                    {histText && <div className="block__text">{histText}</div>}
                  </Block>
                  {histCfg && (
                    <>
                      <Item itemId="history-max-snapshots" name="每文档上限" desc="单篇文档最多保留的快照份数。"><NumField label="每文档上限" min={20} max={1000} value={histCfg.maxSnapshots} onSave={(v) => saveHistCfg({ maxSnapshots: v })}  floor={1} fallback={100} /></Item>
                      <Item itemId="history-retention-days" name="保留天数" desc="超期的自动快照会被定期清理；手动快照与冲突留档另计。"><NumField label="保留天数" min={1} max={365} value={histCfg.retentionDays} onSave={(v) => saveHistCfg({ retentionDays: v })}  floor={1} fallback={30} /></Item>
                      <Item itemId="history-cleanup-interval" name="定期清理（小时）" desc="0 = 不自动清理。"><NumField label="定期清理（小时）" min={0} max={720} value={histCfg.cleanupIntervalHours} onSave={(v) => saveHistCfg({ cleanupIntervalHours: v })}  floor={0} fallback={24} /></Item>
                      <Item itemId="history-snapshot-interval" name="自动快照（分钟）" desc="0 = 不自动快照。"><NumField label="自动快照（分钟）" min={0} max={1440} value={histCfg.snapshotIntervalMinutes} onSave={(v) => saveHistCfg({ snapshotIntervalMinutes: v })}  floor={0} fallback={15} /></Item>
                    </>
                  )}
                </Group>
                <Group title="数据体检（只读诊断）" icon={<Info size={16} />}>
                  <Block itemId="history-data-health" name="一致性检查" desc="只读检查正文文件、历史快照、未归属记录与引用资源，不会自动修复。发现问题请从备份或云端恢复。">
                    <div className="config-block__actions">
                      <button className="ln-btn ln-btn--secondary" onClick={() => void runHealth()} disabled={healthCheck.busy}><Search size={14} /> {healthCheck.busy ? "检查中…" : "运行检查"}</button>
                      {health && !healthCheck.busy && (
                        <span className="config-stats"><span>笔记 {health.notesChecked}，快照 {health.historyChecked}，未归属记录 {health.orphanRowsChecked}，树节点 {health.treeChecked}</span></span>
                      )}
                    </div>
                    {health && (
                      <div className="checks">
                        {health.notesMissingFile.length === 0 && health.notesHashMismatch.length === 0 && health.historyMissingFile === 0 && health.orphanRowsFileMissing.length === 0 && health.refsMissingResource.length === 0 && health.treeDanglingParent.length === 0 ? (
                          <div className="checks__row checks__row--ok">✓ 全部正常：正文文件、历史快照、未归属记录、引用资源与目录树均一致。</div>
                        ) : (
                          <>
                            {health.notesMissingFile.length > 0 && <div className="checks__row checks__row--error">✗ {health.notesMissingFile.length} 篇笔记正文文件缺失（首 3：{health.notesMissingFile.slice(0, 3).map((n) => n.title).join("、")}）</div>}
                            {health.notesHashMismatch.length > 0 && <div className="checks__row checks__row--error">✗ {health.notesHashMismatch.length} 篇正文与基线哈希不符（可能被外部改动）</div>}
                            {health.historyMissingFile > 0 && <div className="checks__row checks__row--warn">✗ {health.historyMissingFile} 份历史快照文件缺失（恢复对应版本时会失败）</div>}
                            {health.orphanRowsFileMissing.length > 0 && <div className="checks__row checks__row--warn">✗ {health.orphanRowsFileMissing.length} 条未归属记录的文件缺失（记录与文件不一致）</div>}
                            {health.refsMissingResource.length > 0 && <div className="checks__row checks__row--error">✗ 正文引用的 {health.refsMissingResource.length} 个资源文件缺失（首 3：{health.refsMissingResource.slice(0, 3).map((r) => r.filename).join("、")}）</div>}
                          {health.treeDanglingParent.length > 0 && <div className="checks__row checks__row--error">✗ {health.treeDanglingParent.length} 个节点的父目录不存在（侧栏与回收站都看不到它）：{health.treeDanglingParent.slice(0, 3).map((t) => `${t.title}→${t.parentId}`).join("、")}</div>}
                          </>
                        )}
                        <div className="checks__row">生成于 {formatDateTime(new Date(health.checkedAt))}。</div>
                      </div>
                    )}
                  </Block>
                </Group>
              </>
            )}

            {category === "sync" && (
              <>
                <Group title="S3 对象存储" icon={<Cloud size={16} />}>
                  <div className="s3-service-notice" role="note">
                    <div className="s3-service-notice__title">第三方 S3 服务说明</div>
                    <p>当前使用的是 Amazon S3 协议兼容的第三方云端存储服务（如七牛云 Kodo、阿里云 OSS、Cloudflare R2）。</p>
                    <p>S3 的存储空间、流量与接口请求由服务商单独计费；本应用不收取费用、也不包含任何存储套餐，请自行确认计费项目与价格。</p>
                    <p>使用前请注意第三方服务的技术限制、计费与条款：</p>
                    <ul>
                      <li>接口调用频率、带宽等技术限制；</li>
                      <li>存储空间、流量、请求次数等计费项目；</li>
                      <li>服务条款、可用性保障与数据安全责任。</li>
                    </ul>
                    <p className="s3-service-notice__warn"><TriangleAlert size={14} aria-hidden="true" /><span>注意：笔记正文与附件会按原样上传到你的 S3，云端不做加密；请务必确认该桶为私有、未开放公开读。</span></p>
                    <p className="s3-service-notice__disclaimer">免责声明：本应用仅通过公开的 S3 兼容 API 访问你自己配置的桶，不对第三方服务的可用性、计费或数据安全负责；请确认桶为私有，且凭据只由你保管。</p>
                  </div>
                  <Field itemId="s3-endpoint" name="Endpoint" desc="七牛 Kodo 形如 https://s3.cn-north-1.qiniucs.com。"><TextField label="Endpoint" value={s3.endpoint} placeholder="https://s3-cn-east-1.qiniucs.com" onSave={(v) => setS3Field("endpoint", v)} /></Field>
                  <Field itemId="s3-access-key" name="Access Key"><TextField label="Access Key" value={s3.accessKeyId} onSave={(v) => setS3Field("accessKeyId", v)} /></Field>
                  <Field itemId="s3-secret-key" name="Secret Key" desc="留空或保持 ******** 表示沿用已保存密钥（本机加密存储）。"><TextField label="Secret Key" type="password" placeholder="留空或保持 ******** 表示沿用已保存密钥" value={s3.secretAccessKey} onSave={(v) => setS3Field("secretAccessKey", v)} /></Field>
                  <Field itemId="s3-bucket" name="Bucket"><TextField label="Bucket" value={s3.bucket} onSave={(v) => setS3Field("bucket", v)} /></Field>
                  <Field itemId="s3-region" name="Region"><TextField label="Region" value={s3.region} onSave={(v) => setS3Field("region", v)} /></Field>
                  <Field itemId="s3-prefix" name="对象前缀"><TextField label="对象前缀" value={s3.prefix} onSave={(v) => setS3Field("prefix", v)} /></Field>
                  <Switch
                    itemId="s3-path-style"
                    name="使用 Path-style URL"
                    desc={isQiniuEndpoint(s3.endpoint)
                      ? "当前 Endpoint 是七牛 Kodo，必须关闭 Path-style（保存或测试时会自动关闭，此项可忽略）。"
                      : "自建 MinIO 等需要开启；七牛 Kodo 关闭即可。"}
                    checked={isQiniuEndpoint(s3.endpoint) ? false : s3.forcePathStyle}
                    disabled={isQiniuEndpoint(s3.endpoint)}
                    onChange={(checked) => setS3Field("forcePathStyle", checked)}
                  />
                  <Block itemId="s3-connection" name="连接" desc="测试仅探测桶可读性，不写入数据。">
                    <div className="config-block__actions">
                      <button className="ln-btn ln-btn--secondary" onClick={() => void testS3()}>测试连接</button>
                      <button className="ln-btn ln-btn--primary" onClick={() => void saveS3()}>保存配置</button>
                    </div>
                  </Block>
                  <Block itemId="s3-transfer" name="配置迁移" desc="导出配置文件后在手机「同步设置 → 配置迁移 → 从文件导入」选择它，免去逐项填写。只含 S3 配置，导入会覆盖本机 S3 配置；文件含密钥（已加密），请勿外传。">
                    <div className="config-block__actions">
                      <button className="ln-btn ln-btn--secondary" onClick={() => void exportS3ConfigFile()}>导出到文件…</button>
                      <button className="ln-btn ln-btn--primary" onClick={() => void importS3ConfigFile()}>从文件导入…</button>
                      <button className="ln-btn ln-btn--secondary" onClick={() => setS3ImportOpen(true)}>粘贴迁移码…</button>
                    </div>
                  </Block>
                </Group>
                <Group title="同步策略（仅保存在当前设备）" icon={<Cloud size={16} />}>
                  {syncCfg && (
                    <>
                      <Switch
                        itemId="sync-enabled"
                        name="启用云同步"
                        desc={s3Verified || syncCfg.enabled ? "关闭后按纯本地空间工作：不连 S3、不自动同步，也不会从云端补拉缺失资源；重新开启后下一次同步会自动补拉。S3 配置与同步策略只保存在本机。" : "先在上方「S3 对象存储」完成配置并点「测试连接」通过，才能开启云同步。"}
                        note={<><span className="ln-tag ln-tag--pending">{CLOUD_PRIVACY_NOTICE.badge}</span>{" "}{CLOUD_PRIVACY_NOTICE.text}</>}
                        alert={syncGateAlert}
                        checked={syncCfg.enabled}
                        onChange={(checked) => {
                          // 保留「未测通不能开」的实质，但不再禁用开关：点击给出可见提示，状态保持关闭。
                          if (checked && !syncCfg.enabled && !s3Verified) {
                            setSyncGateAlert("还没有通过连接测试：请先在上面填好 S3 配置并点「测试连接」。通过之前云同步保持关闭。");
                            setSyncMsg("云同步未开启：S3 连接尚未验证。请先点「测试连接」。");
                            return;
                          }
                          setSyncGateAlert(null);
                          void saveSyncCfg({ enabled: checked });
                        }}
                      />
                      {syncCfg.enabled && (
                        <>
                          <Field itemId="sync-auto-mode" name="自动同步模式" desc={SYNC_OPEN_CLOSE_NOTE}>
                            <Select label="自动同步模式" value={syncCfg.autoMode} onChange={(v) => void saveSyncCfg({ autoMode: v as SyncSettings["autoMode"] })} options={SYNC_AUTO_MODE_OPTIONS} />
                          </Field>
                          {syncCfg.autoMode === "interval" && (
                            <Item itemId="sync-auto-interval" name="自动同步间隔（分钟）" desc="到点触发一次；应用退出后不会在后台继续定时（下次启动时的对齐会补上）。"><NumField label="自动同步间隔（分钟）" min={1} max={1440} value={syncCfg.autoIntervalMinutes} onSave={(v) => void saveSyncCfg({ autoIntervalMinutes: v })}  floor={1} fallback={15} /></Item>
                          )}
                          <Switch itemId="sync-defer-assets" name="按需下载附件" desc="开启后首次同步只拉文档与附件清单，图片和附件在打开或预览时才下载（更快、省流量）；关闭则首次同步全量下载（离线最完整）。" checked={syncCfg.deferAssets === true} onChange={(checked) => void saveSyncCfg({ deferAssets: checked })} />
                        </>
                      )}
                    </>
                  )}
                </Group>
                <Group title="备份与恢复" icon={<Archive size={16} />}>
                  <Block itemId="backup-export" name="整库备份" desc="数据库 + 全部笔记/资源/历史快照 + 小记，导出到所选目录（不覆盖非空目录）。">
                    <div className="config-block__actions">
                      <button className="ln-btn ln-btn--secondary" onClick={() => void runBackup()} disabled={backup.busy}><Archive size={14} /> {backup.busy ? "备份中…" : "整库备份到…"}</button>
                    </div>
                  </Block>
                  <Block itemId="backup-restore" name="从云端恢复" desc="当前数据先改名隔离保存，再从云端全量拉取重建（不会上传本机数据）。用于换机或本地库损坏。">
                    <div className="config-block__actions">
                      <button className="ln-btn ln-btn--secondary ln-btn--danger-text" onClick={() => void runCloudRestore()} disabled={backup.busy || cloudOffline} title={cloudOffline ? "云同步未启用：不会联网" : undefined}>从云端恢复（换机/坏库）…</button>
                    </div>
                  </Block>
                  {backupText && <Block name={backupText} />}
                </Group>
                <Group title="云端回收" icon={<Trash size={16} />}>
                  {cloudOffline && (
                    <Block desc={cloudStateHint(cloudState) ?? "云同步未启用：按纯本地空间工作，云端相关操作一律不联网。"} />
                  )}
                  <Block itemId="gc-status" name="回收状态" desc="手动清理会立即删除云端已不再被文档或历史引用的对象；自动对账按回收窗口定期执行。清理数量偏少通常是被引用保护，不是漏删。">
                    <div className="config-block__actions">
                      <button className="ln-btn ln-btn--secondary" onClick={() => void runGcAction(true)} disabled={gcRun.busy || cloudOffline}>深度清理预览</button>
                      <button className="ln-btn ln-btn--secondary ln-btn--danger-text" onClick={() => void runGcAction(false)} disabled={gcRun.busy || cloudOffline}>执行深度清理</button>
                    </div>
                  </Block>
                  {gcCfg && (
                    <>
                      <Item itemId="gc-retention-days" name="回收窗口（天）" desc="对象被替换/移除后的保护期；0 = 立即到期。"><NumField label="回收窗口（天）" min={0} max={90} value={gcCfg.gcRetentionDays} onSave={(v) => saveGcCfg({ gcRetentionDays: v })}  floor={0} fallback={7} /></Item>
                      <Item itemId="gc-interval-hours" name="自动对账周期（小时）" desc="自动清理频率；0 = 仅手动。"><NumField label="自动对账周期（小时）" min={0} max={720} value={gcCfg.gcIntervalHours} onSave={(v) => saveGcCfg({ gcIntervalHours: v })}  floor={0} fallback={24} /></Item>
                    </>
                  )}
                  <Block itemId="gc-mirror" name="云端只是镜像" desc="删除云端冗余不影响本地正文/回收站/历史快照（“彻底删除/清空回收站”除外）。" />
                  <Block itemId="gc-log" name={`删除记录（最近 ${gcLog.length > 0 ? Math.min(gcLog.length, 30) : 0} 条，只读）`}>
                    {gcLog.length > 0 ? (
                      <div className="config-readonly">
                        {gcLog.slice(0, 30).map((l) => <div key={l.id}>{l.ts.slice(0, 19)}&nbsp;[{l.action}，{l.reason}] {l.key}</div>)}
                      </div>
                    ) : (
                      <div className="block__text">暂无删除记录。</div>
                    )}
                  </Block>
                </Group>
                <Group title="同步诊断" icon={<Terminal size={16} />}>
                  <Block itemId="sync-diagnostics" name="最近 3 轮同步" desc="每轮同步的耗时、对象数与失败项（只保存在本机，不上传）。反馈同步变慢或失败时，可复制后发给维护者。">
                    {syncDiagText ? (
                      <div className="config-readonly">
                        {syncDiagText.split("\n").map((line, i) => <div key={i}>{line.trim() ? line : "\u00a0"}</div>)}
                      </div>
                    ) : (
                      <div className="block__text">本机还没有同步记录。</div>
                    )}
                    <div className="config-block__actions">
                      <button className="ln-btn ln-btn--secondary" onClick={() => void copySyncDiagnostics()} disabled={!syncDiagText}>复制同步诊断</button>
                    </div>
                    {syncDiagMsg && <div className="block__text">{syncDiagMsg}</div>}
                  </Block>
                </Group>
              </>
            )}

            {category === "trash" && (
              <Group title="回收站" icon={<Trash size={16} />}>
                {gcCfg && (
                  <Item itemId="trash-auto-purge-days" name="回收站自动过期（天）" desc="0 = 关闭。到期后自动彻底删除（含云端），不可撤销；需要保留请在到期前恢复。">
                    <NumField label="回收站自动过期（天）" min={0} max={365} value={gcCfg.trashAutoPurgeDays} onSave={(v) => saveGcCfg({ trashAutoPurgeDays: v })}  floor={0} fallback={0} />
                  </Item>
                )}
                <Block desc="回收站内容随云同步到所有设备；彻底删除会同时删除云端数据且不可撤销。" />
              </Group>
            )}

            {category === "browser" && (
              <Group title="浏览器端" icon={<Globe size={16} />}>
                <Switch itemId="browser-enabled" name="启用浏览器端" desc="在本机浏览器中打开 LakexLocalNotes（与桌面端同一份本地数据）。只监听 127.0.0.1，不向局域网开放；开关即时生效，应用重启后恢复为关闭。" checked={webStatus?.enabled ?? false} disabled={!webStatus || webRun.busy} onChange={(checked) => void setWeb(checked)} />
                <Block name="这是什么" desc="浏览器端不向局域网开放：它把桌面端的同一份本地库通过本机地址 http://127.0.0.1:19880/ 交给浏览器，数据不经过网络。打开开关后，用浏览器访问该地址即可。" />
                <Block name="现状" desc="读写的是本机同一份数据；同步进度与待办会实时刷新；图片「另存为」走浏览器下载，附件在新标签打开。需要系统目录框的操作（导出、整库备份）请仍在桌面端使用。开关不保存，每次启动都从关闭开始。" />
                {webStatus?.enabled && (
                  <Item itemId="browser-open" name="在本机浏览器打开" desc={webStatus.url}>
                    <button className="ln-btn ln-btn--secondary" onClick={() => void openWeb()}><ExternalLink size={14} /> 打开浏览器</button>
                  </Item>
                )}
                {webText && <Block desc={webText} />}
              </Group>
            )}

            {category === "logs" && (
              <>
              {/* 261006：索引重建从「资源」挪到「日志」（维护动作归一处，后续再整理） */}
              <Group title="全文搜索" icon={<Search size={16} />}>
                <Item itemId="search-rebuild" name="重建全文搜索索引" desc="标题与正文的全文索引（FTS5，中文单字分词），平时自动维护；索引异常或更换分词器后可手动重建。">
                  {searchText && <span className="ln-label__text">{searchText}</span>}
                  <button className="ln-btn ln-btn--secondary" disabled={searchIndex.busy} onClick={() => void rebuildSearchIndex()}>{searchIndex.busy ? "重建中…" : "重建"}</button>
                </Item>
              </Group>
              <Group title="应用日志（只读）" icon={<Terminal size={16} />}>
                <Block itemId="logs-main" name="主进程日志" desc="同步、回收站与历史清理过程写入 userData/logs/lakex-local-notes.log；按关键字过滤，每条命中附带上下文。">
                  <div className="config-block__actions">
                    <input
                      className="ln-text-field logs__filter"
                      type="text"
                      value={logKeyword}
                      onChange={(e) => setLogKeyword(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void runLogLoad(logKeyword); }}
                      placeholder="过滤（如 GC / sync / trash / purge / snapshot）"
                      aria-label="日志关键字过滤"
                    />
                    <button className="ln-btn ln-btn--secondary" onClick={() => void runLogLoad(logKeyword)} disabled={logLoad.busy}><Search size={14} /> {logLoad.busy ? "读取中…" : "读取"}</button>
                  </div>
                  {logText && <div className="block__text">{logText}</div>}
                </Block>
                <Block>
                  {logRows.length > 0 ? (
                    <div className="config-readonly readonly--tall">
                      {logRows.map((row, i) => <div key={i} className={row.hit ? "logs__hit" : undefined}>{row.line}</div>)}
                    </div>
                  ) : (
                    !logLoad.busy && <div className="config-empty">尚无日志或未读取。</div>
                  )}
                </Block>
              </Group>
              </>
            )}

            {category === "ai" && (
              <>
                <Group title="AI 助手" icon={<Sparkles size={16} />}>
                  <Section title="服务">
                    <Field itemId="ai-provider" name="供应商" desc="支持 OpenAI 兼容接口：内置 OpenAI、DeepSeek、通义千问、智谱、小米 MiMo，也可选「自定义」指向任意兼容端点（如 Ollama、vLLM）。切换供应商会重置为该家默认值。">
                      <Select label="AI 供应商" value={aiProviderId} onChange={(v) => void switchAiProvider(v)} options={AI_PROVIDERS.map((p) => ({ value: p.id, label: p.label }))} />
                    </Field>
                    <Field itemId="ai-base-url" name="Base URL" desc={"留空即用该家默认；可改成任意 OpenAI 兼容端点，例如 " + activeDef.defaultBaseUrl + "。"} error={aiErr.baseUrl}>
                      <span className="ln-input"><input className="ln-input__field" value={aiPending.baseUrl} placeholder={activeDef.defaultBaseUrl} spellCheck={false} onChange={(e) => setAiDraft((d) => ({ ...d, baseUrl: e.target.value }))} aria-label="Base URL" /></span>
                      <button className="ln-btn ln-btn--secondary" onClick={() => setAiDraft((d) => ({ ...d, baseUrl: activeDef.defaultBaseUrl }))}>恢复默认</button>
                    </Field>
                  </Section>

                  <Section title="凭据">
                    <Field
                      itemId="ai-api-key"
                      name={<>API Key <span className={"badge " + (activeAi?.hasApiKey ? "badge--accent" : "badge--muted")}>{activeAi?.hasApiKey ? "已保存" : "未配置"}</span></>}
                      desc="加密保存在本机（macOS Keychain），不同步、不上传；留空即沿用已保存的，输入新值即替换。"
                      error={aiErr.apiKey}
                    >
                      <span className="ln-input">
                        <input
                          className="ln-input__field"
                          type={aiKeyVisible ? "text" : "password"}
                          value={aiDraft.apiKey ?? ""}
                          placeholder={activeAi?.hasApiKey ? "留空沿用已保存的密钥" : "sk-..."}
                          autoComplete="off"
                          spellCheck={false}
                          onChange={(e) => setAiDraft((d) => ({ ...d, apiKey: e.target.value }))}
                          aria-label="API Key"
                        />
                        <button
                          type="button"
                          className="ln-iconbtn ln-iconbtn--compact"
                          aria-label={aiKeyVisible ? "隐藏 API Key" : "显示 API Key"}
                          aria-pressed={aiKeyVisible}
                          onClick={() => setAiKeyVisible((v) => !v)}
                        >{aiKeyVisible ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                      </span>
                      {/* 清除：只删本机的 Key（换机/共享设备时抹掉），不清其它配置项 */}
                      {activeAi?.hasApiKey && (
                        <button className="ln-btn ln-btn--secondary" onClick={() => void saveAi({ providers: [{ id: aiProviderId, clearApiKey: true }] })}>清除</button>
                      )}
                    </Field>
                  </Section>

                  <Section title="模型与参数">
                    <Field itemId="ai-model" name="模型" desc="从供应商拉取候选会同时验证连通性；端点不实现 /models 时可手填。" error={aiErr.model}>
                      {aiModels && aiModels.length > 0 && !aiManualModel ? (
                        <Select label="AI 模型" value={aiPending.model} onChange={(v) => { if (v === "__manual__") { setAiManualModel(true); return; } setAiDraft((d) => ({ ...d, model: v })); }} options={[
                          ...aiModels.map((m) => ({ value: m, label: m })),
                          ...(aiPending.model && aiModels.indexOf(aiPending.model) < 0 ? [{ value: aiPending.model, label: aiPending.model }] : []),
                          { value: "__manual__", label: "手填…" },
                        ]} />
                      ) : (
                        <>
                          <span className="ln-input"><input className="ln-input__field" value={aiPending.model} placeholder={activeDef.defaultModel || "模型名"} onChange={(e) => setAiDraft((d) => ({ ...d, model: e.target.value }))} aria-label="AI 模型" /></span>
                          {aiModels && aiModels.length > 0 && <button className="ln-btn ln-btn--secondary" onClick={() => setAiManualModel(false)}>用列表</button>}
                        </>
                      )}
                      <button className="ln-btn ln-btn--secondary" disabled={aiModelsRun.busy} onClick={() => void fetchAiModels()}>{aiModelsRun.busy ? "拉取中…" : "获取模型列表"}</button>
                    </Field>
                    {activeDef.supportsReasoning && (
                      <Item itemId="ai-reasoning" name="思考强度" desc="推理强度：越高思考越深入、耗时越长（默认 high）。思考模式下温度不生效。">
                        <Select label="思考强度" className="ln-w-200" value={aiPending.reasoningEffort ?? activeDef.defaultReasoningEffort ?? "high"} onChange={(v) => setAiDraft((d) => ({ ...d, reasoningEffort: v as AiReasoningEffort }))} options={AI_REASONING_EFFORTS.map((v) => ({ value: v, label: v }))} />
                      </Item>
                    )}
                    {activeDef.supportsThinking && (
                      <Item itemId="ai-thinking" name="思考模式" desc="关闭可减少 token 消耗与等待时间；开启时温度不生效。">
                        <Select label="思考模式" className="ln-w-200" value={aiPending.thinking ?? "enabled"} onChange={(v) => setAiDraft((d) => ({ ...d, thinking: v as AiThinkingMode }))} options={AI_THINKING_MODES.map((v) => ({ value: v, label: v === "enabled" ? "开启" : "关闭" }))} />
                      </Item>
                    )}
                    {(!activeDef.supportsThinking || aiPending.thinking === "disabled") && (
                      <Item itemId="ai-temperature" name="温度" desc="0 更稳定、2 更发散。">
                        <NumField label="温度" min={0} max={2} floor={0} fallback={0.7} value={aiPending.temperature} onSave={(n) => setAiDraft((d) => ({ ...d, temperature: n }))} />
                      </Item>
                    )}
                  </Section>

                  <Section title="连通性">
                    <Block itemId="ai-test" name="测试并保存" desc="保存前先发一次最小真实请求：密钥或模型错误会拦住保存，网络或限流错误可以选择仍要保存。">
                      <div className="config-block__actions">
                        <button className="ln-btn ln-btn--primary" disabled={aiRun.busy} onClick={() => void testAndSaveAi()}>{aiRun.busy ? "测试中…" : "测试并保存"}</button>
                        <button className="ln-btn ln-btn--secondary" disabled={aiRun.busy} onClick={() => void testAi()}>仅测试</button>
                        {aiForceSave && <button className="ln-btn ln-btn--secondary" onClick={() => void forceSaveAi()}>仍要保存</button>}
                      </div>
                      {aiErr.all && <div className="config-item__error">{aiErr.all}</div>}
                      {aiMsg && <div className="config-note">{aiMsg}</div>}
                    </Block>
                    <Switch
                      itemId="ai-enabled"
                      name="AI 助手"
                      desc="关闭后 AI 助手不出网，配置与 API Key 保留；重新打开即可继续使用。"
                      alert={aiEnableAlert}
                      checked={aiEnabled}
                      onChange={(checked) => {
                        // 与「启用云同步」同口径：没有可用配置就别让用户以为已经能用；配好后可随时关/开。
                        if (checked && !activeAi?.hasApiKey) {
                          setAiEnableAlert("先在上方填好供应商与 API Key 并保存，再开启 AI 助手。");
                          return;
                        }
                        setAiEnableAlert(null);
                        saveAiEnabled(checked);
                        setAiEnabled(checked);
                      }}
                    />
                  </Section>
                </Group>
                <Group title="说明">
                  <Block name="内容只在你主动触发时外发" desc="AI 只把你要处理的文本发给你配置的供应商；API Key 只保存在本机，不参与同步、S3 与备份。" />
                  <Block name="多轮对话只保留最近 40 条消息" desc="同一个 AI 面板内会记住上下文（把前面的问答一起发给模型），但最多只带最近 40 条消息（一问一答算 2 条），更早的不会再发送；关闭面板后记忆即清空，不做长期记忆。" />
                </Group>
              </>
            )}
            {category === "about" && (
              <>
                {!sysInfo && (
                  <Group title="关于" icon={<Info size={16} />}>
                    <Block><div className="config-empty">读取中…</div></Block>
                  </Group>
                )}
                {sysInfo && (
                  <>
                    <Group title="关于" icon={<Info size={16} />}>
                      <Block itemId="about-app" name={`LakexLocalNotes ${sysInfo.app.version}${sysInfo.packaged ? "" : "（开发实例）"}`} desc="本地优先、离线可用；数据保存在本机，S3 只作云端备份。" />
                      <Block itemId="about-fonts" name="字体" desc="界面与正文使用内置 MiSans（小米科技，依《MiSans 字体知识产权许可协议》免费商用；此处按协议注明使用）。代码块使用 JetBrains Mono（SIL OFL 1.1）。两者均随应用内置、离线可用。" />
                    </Group>

                    <Group title="版本与运行环境" icon={<Monitor size={16} />}>
                      <Item itemId="about-version" name="应用版本" desc={sysInfo.app.description || undefined}>
                        <span className="config-item__ctl"><code className="kv__v">v{sysInfo.app.version}</code></span>
                      </Item>
                      <Block itemId="about-tech-stack" name="技术身份" desc="桌面端运行框架、数据层与编辑器内核；框架版本取运行时与 package.json，内核为固定 pin。">
                        <div className="kv">
                          <div className="kv__row"><span className="kv__k">桌面框架</span><span className="kv__v">Electron {sysInfo.runtime.electron} / React {depVersion(sysInfo.deps, "react")} / better-sqlite3 {depVersion(sysInfo.deps, "better-sqlite3")}</span></div>
                          <div className="kv__row"><span className="kv__k">编辑器内核</span><span className="kv__v">Lake v{LAKE_KERNEL_VERSION}（@dlient/lakex-doc-react {LAKE_WRAPPER_VERSION}）</span></div>
                          <div className="kv__row"><span className="kv__k">同步协议</span><span className="kv__v">S3 v{S3V3_POINTER_VERSION}</span></div>
                        </div>
                      </Block>
                      <Block itemId="about-runtime" name="运行时" desc="Lake 内核运行在 Electron（Chromium）中；Node 版本决定本地数据库模块能否正常加载。实际版本见下表。">
                        <div className="kv">
                          <div className="kv__row"><span className="kv__k">Electron</span><span className="kv__v">{sysInfo.runtime.electron}</span></div>
                          <div className="kv__row"><span className="kv__k">Chromium</span><span className="kv__v">{sysInfo.runtime.chromium}</span></div>
                          <div className="kv__row"><span className="kv__k">Node</span><span className="kv__v">{sysInfo.runtime.node}</span></div>
                          <div className="kv__row"><span className="kv__k">平台</span><span className="kv__v">{sysInfo.runtime.platform} / {sysInfo.runtime.arch}</span></div>
                        </div>
                      </Block>
                      <Block itemId="about-deps" name="内核与关键依赖" desc="内核按 package.json 锁定版本，请勿随意升级。">
                        <div className="kv">
                          {Object.entries(sysInfo.deps).map(([name, ver]) => (
                            <div key={name} className="kv__row"><span className="kv__k">{name}</span><span className="kv__v">{ver}</span></div>
                          ))}
                        </div>
                      </Block>
                    </Group>

                    <Group title="数据与存储" icon={<HardDrive size={16} />}>
                      <Block itemId="about-storage-stats" name="内容统计" desc="计数来自本机库与资源目录（只读遍历资源目录两层，不做全盘扫描）。">
                        <div className="config-stats">
                          <span>笔记 <strong>{sysInfo.storage.notes}</strong></span>
                          <span>笔记本 <strong>{sysInfo.storage.notebooks}</strong></span>
                          <span>分组 {sysInfo.storage.groups}</span>
                          <span>小记 <strong>{sysInfo.quickNotes}</strong></span>
                        </div>
                        <div className="config-stats">
                          <span>资源 <strong>{sysInfo.storage.assetFiles}</strong> 个，{formatBytes(sysInfo.storage.assetBytes)}</span>
                          <span>历史快照 <strong>{sysInfo.storage.historySnapshots}</strong> 份，{formatBytes(sysInfo.storage.historyBytes)}</span>
                          <span>库文件 {formatBytes(sysInfo.storage.dbBytes)}</span>
                        </div>
                        <div className="config-stats">
                          <span>回收站节点 {sysInfo.storage.trashedNodes}</span>
                          <span>删除标记 {sysInfo.storage.tombstones}</span>
                          <span>未归属记录 {sysInfo.storage.orphanRows}</span>
                        </div>
                      </Block>
                      <Item itemId="about-data-dir" name="数据目录" pathDesc desc={sysInfo.storage.root}>
                        <button className="ln-btn ln-btn--secondary" onClick={() => revealFolder("data")}>在 Finder 中显示</button>
                      </Item>
                      <Item itemId="about-workspace-dir" name="工作空间" pathDesc desc={sysInfo.paths.workspace}>
                        <button className="ln-btn ln-btn--secondary" onClick={() => revealFolder("workspace")}>在 Finder 中显示</button>
                      </Item>
                      <Item itemId="about-assets-dir" name="资源目录" desc="图片与附件按笔记分目录存放（note-assets/{noteId}/）。">
                        <button className="ln-btn ln-btn--secondary" onClick={() => revealFolder("assets")}>在 Finder 中显示</button>
                      </Item>
                      <Item itemId="about-history-dir" name="历史快照目录" desc="快照与正文分离存放，恢复对应版本时从这里读。">
                        <button className="ln-btn ln-btn--secondary" onClick={() => revealFolder("history")}>在 Finder 中显示</button>
                      </Item>
                      <Item itemId="about-logs-dir" name="日志目录" pathDesc desc={sysInfo.paths.logs}>
                        <button className="ln-btn ln-btn--secondary" onClick={() => revealFolder("logs")}>在 Finder 中显示</button>
                      </Item>
                    </Group>

                    <Group title="诊断" icon={<Search size={16} />}>
                      <Block itemId="about-diagnostics" name="复制诊断信息" desc="把版本、运行环境、依赖与本机计数拼成一段纯文本，反馈问题时直接贴出来。">
                        <div className="config-block__actions">
                          <button className="ln-btn ln-btn--secondary" onClick={() => void copyDiagnostics()} disabled={!sysInfo}>复制诊断信息</button>
                        </div>
                      </Block>
                      <Block itemId="about-health-entry" name="一致性检查" desc="正文文件、历史快照、孤儿登记、引用资源与目录树父子链的只读体检在「文档与历史」页运行。" />
                    </Group>

                    <Group title="第三方与许可" icon={<Info size={16} />}>
                      <Block itemId="about-siyuan-license" name="思源笔记 SiYuan" desc="界面版式与主题令牌移植自 SiYuan（AGPL-3.0，https://github.com/siyuan-note/siyuan）：相关规则已收编到 src/styles/compat.css 与 kit.css（保留署名）；本项目不构成分发思源代码。" />
                      <Block itemId="about-lakex-license" name="语雀 Lake 内核" desc="Lake 内核为语雀闭源产物（随 @dlient/lakex-doc-react 的 MIT wrapper 源码一并 vendor、已 pin）；wrapper 与卡片层源码可改并保留署名，内核本体内核不修改、不再分发。" />
                      <Block itemId="about-third-party" name="开源依赖" desc="主要开源依赖：better-sqlite3（MIT）、sharp（Apache-2.0/MIT）、@aws-sdk/client-s3（Apache-2.0）、lucide-react（ISC）、react/react-dom（MIT）、electron-log（MIT）、TypeScript（Apache-2.0）、Vite（MIT）。完整清单以 package.json 与 lockfile 为准。" />
                    </Group>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        {(syncMsg ?? diagMsg) && <p className="settings-statusbar">{syncMsg ?? diagMsg}</p>}
        <DialogResizeHandles onResize={floating.startResize} />
        {s3ImportOpen && (
          <S3ConfigImportDialog
            onClose={() => setS3ImportOpen(false)}
            onImport={importS3Config}
          />
        )}
        {confirmElement}
      </div>
    </div>
  );
}
