// 261112 R2-S7：SettingsPanel 的状态/副作用/事件处理（纯搬移；JSX 已按 11 分组拆到 ./sections/*）。
// 本文件只做「取数 + 动作」，不渲染；SettingsPanel 只留导航/搜索/布局。
import { useState, useRef, useMemo, useEffect } from "react";
import { useFloatingDialog } from "../../hooks/useFloatingDialog";
import { useConfirm } from "../../../hooks/useConfirm";
import type { DataHealthReport, S3Settings, SyncSettings, BackupSettingsShape, BackupStateShape, BackupUsageShape } from "../../../lib/types";
import { s3ConfigFingerprint, effectiveS3Settings } from "../../../lib/s3FormState";
import { AI_PROVIDERS, type AiSettingsView, type AiReasoningEffort, type AiThinkingMode, type AiSettingsPatch } from "../../../core/aiProviders";
import { loadAiEnabled } from "../../../lib/aiEnabled";
import { loadDefaultSpace } from "../../model/defaultSpace";
import { native } from "../../../lib/native";
import { getNativeErrorMessage, reportNativeActionError } from "../../../lib/nativeErrors";
import { cloudStateOf, canTouchNetwork } from "../../../core/cloudState";
import { formatS3v3Diagnostics, type S3v3DiagnosticReport } from "../../../core/s3v3Report";
import type { PortableExportStatus, PortableExportProgress } from "../../../core/portable/portableFormat";
import { formatBytes } from "../../../lib/formatBytes";
import { useAsyncAction } from "../../../hooks/useAsyncAction";
import { hostCapabilities } from "../../../lib/hostCapabilities";
import { searchSettingItems, filterSettingsNav, type SettingItemEntry } from "../../model/settingsSearch";
import { Type, Palette, Keyboard, Cloud, Archive, History, HardDrive, Globe, Sparkles, RefreshCw, Image as Info } from "lucide-react";
import { backupUsageView, backupResultView } from "../settingsBackupObservability";
import { formatDateTime } from "../../../core/dateFormat";
import type { SettingsCategory, SettingsPanelProps } from "./settingsPanelTypes";
import { S3_DEFAULTS, LAKE_KERNEL_VERSION, LAKE_WRAPPER_VERSION, depVersion, fieldErrorFor } from "./settingsPanelTypes";

export type SettingsPanelContext = ReturnType<typeof useSettingsPanelScope>;

export function useSettingsPanelScope({ open, settings, onClose, onChange, openCategory = "editor", onS3SettingsChanged, onSyncSettingsChanged, cloudConfigured = false, cloudEnabled = false }: SettingsPanelProps) {
  const [category, setCategory] = useState<SettingsCategory>(openCategory);
/** 模块级：本次会话内「测试通过」的配置指纹（面板关闭/重开不丢；改字段即失效）。 */
let verifiedS3Fingerprint: string | null = null;

  const [navQuery, setNavQuery] = useState("");
  const navSearchRef = useRef<HTMLInputElement>(null);
  const floating = useFloatingDialog({ id: "settings", initialSize: { w: 1000, h: 660 }, minSize: { w: 620, h: 420 } });
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
  /** 默认空间（设备本地偏好）：只决定**启动时**进哪个空间，之后照常用 ⌘1–5 切换；不进 S3。 */
  const [defaultSpace, setDefaultSpace] = useState(() => loadDefaultSpace());
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
  const [sysInfo, setSysInfo] = useState<import("../../../lib/types").SystemInfo | null>(null);
  const [pendingHit, setPendingHit] = useState<string | null>(null);
  const [diagMsg, setDiagMsg] = useState<string | null>(null);
  // SD-13：最近 3 轮 v3 同步诊断（device_state，经 get_sync_status 带出；不新增 IPC 通道）。
  const [syncReports, setSyncReports] = useState<S3v3DiagnosticReport[]>([]);
  const [syncDiagMsg, setSyncDiagMsg] = useState<string | null>(null);
  // 261105：文件↔元数据后台扫描间隔（小时，0 = 关闭；手动「重建数据 → 扫描」不受影响）。
  const [scanIntervalHours, setScanIntervalHours] = useState<number | null>(null);
  // 261105 Batch4-E：自动备份配置 + 上次备份状态（本机 settings；不进云端）。
  const [backupCfg, setBackupCfg] = useState<BackupSettingsShape | null>(null);
  const [backupSnapshot, setBackupSnapshot] = useState<BackupStateShape | null>(null);
  // 261105 task-68：备份目录占用（只读 stat IPC；独立 busy，不占用备份动作的 busy/状态栏）。
  const [backupUsage, setBackupUsage] = useState<BackupUsageShape | null>(null);
  const [backupUsageBusy, setBackupUsageBusy] = useState(false);
  // 261109 便携包（桌面 → 手机全量搬运）：入口可用性由主进程判定（云开启 + 上轮同步成功 + 无待同步）。
  const [portableStatus, setPortableStatus] = useState<PortableExportStatus | null>(null);
  const [portableProgress, setPortableProgress] = useState<PortableExportProgress | null>(null);
  const portableStatusText = !portableStatus
    ? "读取便携包状态…"
    : portableStatus.cloudActive === true
      ? "可用：云同步已启用，导出前会自动同步一次，包内带云端基线。"
      : "可用：当前未启用云同步，按离线包导出（不带云端基线；之后配置 S3 可再同步）。";
  const portablePhaseText: Record<PortableExportProgress["phase"], string> = { snapshot: "生成数据库快照", collect: "收集文件", write: "写入 zip" };
  const portableProgressText = portableProgress
    ? portablePhaseText[portableProgress.phase] + "，已写入 " + formatBytes(portableProgress.bytesWritten) + "（" + portableProgress.filesDone + "/" + portableProgress.filesTotal + " 个条目）"
    : null;

  // DT-13（261028）：十组手写 busy/msg（历史清理 / 数据体检 / 搜索索引 / 备份恢复 / 深度清理 / 同步策略 /
  // 日志读取 / 浏览器端 / AI 测试 / AI 拉模型）改走 useAsyncAction —— 成功/失败文案仍由调用方给，UI 结构与文案不变。
  // gc 与「同步策略」历史上共用状态栏那一条 syncMsg（谁最后写谁显示）⇒ 用 channel 保持这条语义。
  // AI 的「测试」与「拉模型列表」历史上也共用一条 aiMsg ⇒ 两个实例传同一条 channel（busy 仍各自独立）。
  const hist = useAsyncAction();
  const healthCheck = useAsyncAction();
  const searchIndex = useAsyncAction();
  const backup = useAsyncAction();
  const portable = useAsyncAction();
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

  /** Batch4-A 从备份恢复（整库导入）：选 metadata*.sqlite3 → 主进程校验/隔离/替换 → 重启生效。 */
  const runRestoreFromBackup = async () => {
    if (!hostCapabilities().localFileSystem) { backup.setMessage("浏览器端不支持从备份恢复（需重启本机应用，请在桌面端操作）"); return; }
    // 先选文件（取消 ⇒ 什么都不做；选择框抛错由 backup.run 显示）。
    const picked = await backup.run(async () => native.pickBackupDatabase());
    if (!picked) return;
    if (!(await confirm({
      title: "从备份恢复？",
      body: `将用备份「${picked.name}」替换当前主库：① 备份先校验（完整性/关键表）；② 当前库改名隔离到 corrupt/（不删除、可找回）；③ 备份复制到位后需要重启应用生效。小记库、正文与附件不受影响。`,
      confirmText: "继续",
      danger: true,
    }))) return;
    await backup.run(async () => {
      const result = await native.restoreWorkspaceFromBackup(picked.path);
      await notice({
        title: "已从备份恢复主库",
        body: <>原库已隔离保留在：<div className="note-info-path">{result.quarantinePath ?? "（见日志）"}</div>应用即将重启后生效。</>,
      });
      await native.confirmRelaunch();
      return "已从备份恢复，正在重启…";
    });
  };

  /** 261105：保存后台扫描间隔（小时，0 = 关闭）；成功后刷新体检数据（显示新间隔/启用状态）。 */
  const saveScanInterval = (intervalHours: number) => {
    setScanIntervalHours(intervalHours);
    void native.saveFileScanSettings({ intervalHours })
      .then(() => native.runDataHealthCheck().then(setHealth))
      .catch((reason) => {
        hist.setMessage("扫描间隔保存失败：" + getNativeErrorMessage(reason));
        void native.getFileScanSettings().then((v) => setScanIntervalHours(v.intervalHours)).catch(() => undefined);
      });
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

  /** 261105 Batch4-E：保存自动备份配置（乐观更新；失败回读并提示）。 */
  const saveBackupCfg = (patch: Partial<BackupSettingsShape>) => {
    if (!backupCfg) return;
    const next = { ...backupCfg, ...patch };
    setBackupCfg(next);
    void native.saveBackupSettings(next).catch((reason) => {
      backup.setMessage("自动备份设置保存失败：" + getNativeErrorMessage(reason));
      void native.getBackupSettings().then((info) => setBackupCfg(info.settings)).catch(() => undefined);
    });
  };

  /** 261105 task-68：读备份目录占用（只读 stat；失败只提示一条，不影响设置页其它内容）。 */
  const loadBackupUsage = async () => {
    if (backupUsageBusy) return;
    setBackupUsageBusy(true);
    try {
      setBackupUsage(await native.getBackupUsage());
    } catch (error) {
      reportNativeActionError("备份占用读取", error);
    } finally {
      setBackupUsageBusy(false);
    }
  };

  /** 261105 Batch4-E：立即备份（主进程单飞；失败也会返回可读 message，不抛）。 */
  const runBackupNow = async () => {
    await backup.run(async () => {
      const result = await native.runBackupNow();
      setBackupSnapshot(result.state);
      // 备份刚写过目录 ⇒ 份数/占用顺带刷新（失败也刷新：轮转可能已删掉旧备份）。
      void loadBackupUsage();
      return result.message;
    }, { success: (text) => text });
  };

  /** 261109 便携包：读入口可用性（主进程判据；失败只提示，不影响设置页其它内容）。 */
  const loadPortableStatus = async () => {
    try {
      setPortableStatus(await native.portableExportStatus());
    } catch (error) {
      reportNativeActionError("读取便携包状态", error);
    }
  };

  /** 261109 便携包导出：选目录 → 主进程打包（进度事件驱动文案）。 */
  const runPortableExport = async () => {
    if (!hostCapabilities().localFileSystem) { portable.setMessage("浏览器端不支持导出便携包（请在桌面端操作）"); return; }
    await portable.run(async () => {
      const dir = await native.portableExportPickDir();
      if (!dir) return null;
      const result = await native.portableExportRun();
      void loadPortableStatus();
      return "便携包已导出：" + result.path + "（" + formatBytes(result.bytes) + "，" + result.entries + " 个条目）";
    }, { success: (text) => text, errorPrefix: "导出失败：" });
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
    void native.getFileScanSettings().then((v) => setScanIntervalHours(v.intervalHours)).catch((error) => reportNativeActionError("设置页读取", error));
    void native.getBackupSettings().then((info) => { setBackupCfg(info.settings); setBackupSnapshot(info.state); }).catch((error) => reportNativeActionError("设置页读取", error));
  }, [open, openCategory]);

  // 备份占用：每次进入「备份与恢复」分类都重新只读统计（自动备份/外部清理都会改动目录）。
  useEffect(() => {
    if (!open || category !== "backup") return;
    let alive = true;
    native.getBackupUsage().then((value) => { if (alive) setBackupUsage(value); }).catch(() => { /* 读不到就保持上一次读数（不打扰） */ });
    return () => { alive = false; };
  }, [open, category]);

  // 便携包：每次进入「备份与恢复」都重判可用性（同步刚完成/关闭云同步都会改变它）。
  useEffect(() => {
    if (!open || category !== "backup") return;
    let alive = true;
    native.portableExportStatus().then((value) => { if (alive) setPortableStatus(value); }).catch(() => { /* 读不到就保持上一次状态 */ });
    return () => { alive = false; };
  }, [open, category]);

  // 便携包进度（主进程事件；离开分类即退订并清空）。
  useEffect(() => {
    if (!open || category !== "backup") return;
    const off = native.onPortableExportProgress((progress) => setPortableProgress(progress));
    return () => { off(); setPortableProgress(null); };
  }, [open, category]);

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

  const revealFolder = (kind: import("../../../lib/types").DataFolderKind) => {
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
      `生成于 ${formatDateTime(new Date())}`,
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

  // 分组顺序按使用频率：常规 → 外观 → 快捷键 → 云端与同步 → 备份与恢复 → 数据与历史 → 数据维护 → AI → 关于
  const nav = [
    { id: "editor" as const, label: "常规", keywords: "编辑器 字号 大纲 工具栏 标签页 附件 上限", icon: <Type size={15} /> },
    { id: "appearance" as const, label: "外观", keywords: "浅色 深色 主题", icon: <Palette size={15} /> },
    { id: "shortcuts" as const, label: "快捷键", keywords: "快捷键 搜索 专注模式 键盘", icon: <Keyboard size={15} /> },
    { id: "sync" as const, label: "云端与同步", keywords: "S3 上传 下载 资源 云端 回收 同步策略 诊断", icon: <Cloud size={15} /> },
    { id: "backup" as const, label: "备份与恢复", keywords: "备份 整库 恢复 云端恢复 自动备份 迁移", icon: <Archive size={15} /> },
    { id: "history" as const, label: "数据与历史", keywords: "快照 保留 清理 文档历史", icon: <History size={15} /> },
    { id: "maintenance" as const, label: "数据维护", keywords: "体检 一致性 重建 恢复 回收站 搜索 日志 浏览器 扫描", icon: <HardDrive size={15} /> },
    { id: "browser" as const, label: "浏览器端", keywords: "浏览器 网页 web 端口 局域网 browser 127.0.0.1", icon: <Globe size={15} /> },
    { id: "ai" as const, label: "AI 助手", keywords: "AI 供应商 模型 key api openai deepseek 密钥", icon: <Sparkles size={15} /> },
    { id: "update" as const, label: "更新", keywords: "更新 升级 检查更新 自动更新 下载 安装 版本 release latest", icon: <RefreshCw size={15} /> },
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
  // 261105 task-68：备份可观测 —— 占用/结果/失败引导的文案由纯函数给（单测覆盖三态），这里只摆放。
  const backupUsageInfo = backupUsageView(backupUsage, { maxTotalBytes: backupCfg?.maxTotalBytes });
  const backupResult = backupResultView(backupSnapshot);
  const backupText = backup.error ?? backup.message;
  const logText = logLoad.error ?? logLoad.message;
  const webText = webRun.error ?? webRun.message;


  return {
    open, settings, onClose, onChange, openCategory, onS3SettingsChanged, onSyncSettingsChanged, cloudConfigured, cloudEnabled, category, setCategory, navQuery, setNavQuery, navSearchRef, floating, confirm, notice, confirmElement, stats, setStats, histCfg, setHistCfg, lastCleanup, setLastCleanup, health, setHealth, logRows, setLogRows, logKeyword, setLogKeyword, s3, setS3, s3VerifiedFp, setS3VerifiedFp, s3Verified, syncGateAlert, setSyncGateAlert, markS3Verified, invalidateS3Verified, s3ImportOpen, setS3ImportOpen, aiView, setAiView, aiMsg, setAiMsg, aiEnabled, setAiEnabled, defaultSpace, setDefaultSpace, aiEnableAlert, setAiEnableAlert, aiErr, setAiErr, aiDraft, setAiDraft, aiKeyVisible, setAiKeyVisible, aiModels, setAiModels, aiManualModel, setAiManualModel, aiForceSave, setAiForceSave, activeAi, aiProviderId, activeDef, aiPending, resetAiDraft, saveAi, aiPendingPatch, switchAiProvider, fetchAiModels, testAi, testAndSaveAi, forceSaveAi, gcCfg, setGcCfg, gcLog, setGcLog, syncMsg, setSyncMsg, webStatus, setWebStatus, syncCfg, setSyncCfg, cloudState, cloudOffline, sysInfo, setSysInfo, pendingHit, setPendingHit, diagMsg, setDiagMsg, syncReports, setSyncReports, syncDiagMsg, setSyncDiagMsg, scanIntervalHours, setScanIntervalHours, backupCfg, setBackupCfg, backupSnapshot, setBackupSnapshot, backupUsage, setBackupUsage, backupUsageBusy, setBackupUsageBusy, portableStatus, setPortableStatus, portableProgress, setPortableProgress, portableStatusText, portablePhaseText, portableProgressText, hist, healthCheck, searchIndex, backup, portable, gcRun, syncCfgRun, logLoad, webRun, aiRun, aiModelsRun, runBackup, runCloudRestore, runRestoreFromBackup, saveScanInterval, runLogLoad, saveBackupCfg, loadBackupUsage, runBackupNow, loadPortableStatus, runPortableExport, runHealth, itemHits, jumpToItem, revealFolder, copyDiagnostics, syncDiagText, copySyncDiagnostics, nav, filteredNav, visibleNav, saveHistCfg, runCleanup, setS3Field, saveS3, testS3, exportS3ConfigFile, importS3ConfigFile, importS3Config, saveSyncCfg, setWeb, openWeb, saveGcCfg, runGcAction, rebuildSearchIndex, histText, searchText, backupUsageInfo, backupResult, backupText, logText, webText,
    S3_DEFAULTS, LAKE_KERNEL_VERSION, LAKE_WRAPPER_VERSION, depVersion, fieldErrorFor,
  };
}
