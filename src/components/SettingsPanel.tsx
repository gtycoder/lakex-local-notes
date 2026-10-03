import { useEffect, useMemo, useRef, useState } from "react";
import { Cloud, Coffee, Copy, ExternalLink, Files, File, FolderOpen, Globe, History, Image as ImageIcon, Info, Keyboard, Monitor, Moon, Palette, Paperclip, Terminal, Archive, HardDrive, Search, Settings, Sun, Trash, Type, X } from "lucide-react";
import { Sparkles, Eye, EyeOff } from "lucide-react";
import { fontSizeOptions, type AppSettings } from "../lib/settings";
import { AI_PROVIDERS, AI_REASONING_EFFORTS, AI_THINKING_MODES, type AiReasoningEffort, type AiSettingsPatch, type AiSettingsView, type AiThinkingMode } from "../core/aiProviders";

/** 把归类后的中文错误贴到对应字段：Key 类 → apiKey；端点/模型类 → baseUrl+model；其余整条。 */
function fieldErrorFor(message: string, retryable?: boolean): Record<string, string> {
  // 先判可重试：断网/限流的文案里也可能出现 "Base URL" 字样，若先按文案匹配会误贴到字段上。
  if (retryable) return {};
  if (/API Key|无权访问|额度/.test(message)) return { apiKey: message };
  if (/模型名不被支持/.test(message)) return { model: message };
  if (/模型不存在|Base URL/.test(message)) return { baseUrl: message, model: message };
  return message ? { all: message } : {};
}
import { LAKE_THEMES } from "../lib/themes";
import { native } from "../lib/native";
import type { CleanOrphanResult, DataHealthReport, S3GcPendingItem, S3Settings, SyncSettings } from "../lib/types";
import type { GcDiagnostics } from "../core/gcDiagnostics";
import { gcCutoffMs, parseIsoMs, pendingKeyReason } from "../core/gcPolicy";
import { useFloatingDialog } from "./useFloatingDialog";
import { DialogResizeHandles } from "./DialogResizeHandles";
import { filterSettingsNav, searchSettingItems, type SettingItemEntry } from "./settingsSearch";
import { getNativeErrorMessage, reportNativeActionError } from "../lib/nativeErrors";

export type SettingsCategory = "editor" | "appearance" | "shortcuts" | "history" | "sync" | "ai" | "resources" | "trash" | "browser" | "logs" | "about";

interface SettingsPanelProps {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onChange: (patch: Partial<AppSettings>) => void;
  /** 打开设置时默认定位的分类，适合从具体功能的引导入口跳转。 */
  openCategory?: SettingsCategory;
  onS3SettingsChanged?: (settings: S3Settings) => void;
  onSyncSettingsChanged?: (settings: SyncSettings) => void;
}

const S3_DEFAULTS: S3Settings = { endpoint: "", region: "cn-east-1", bucket: "", prefix: "lake-notes", accessKeyId: "", secretAccessKey: "", forcePathStyle: false };

/** 2026-09-03 08:12 形式的本地短时间。 */
function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 让浏览器先把 data URL 解码好再上屏：<img> 换 src 的那一帧若未解码完会画空白（闪烁的另一半来源）。 */
async function decodeImage(dataUrl: string): Promise<void> {
  const img = new Image();
  img.src = dataUrl;
  try { await img.decode(); } catch { /* 解码失败交给 <img> 自己表现（不支持的类型会走 hint 分支） */ }
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/** 全局“被移除资源”条目：status=orphan 可删；history=历史引用保护（只读）。 */
interface RemovedAsset {
  noteId: string;
  filename: string;
  status: "orphan" | "history";
  orphanId?: number;
  size: number;
  mimeType: string;
  noteTitle?: string;
  noteState?: "active" | "trash" | "missing";
  detectedAt?: string;
}

import { Group, Section, Item, Field, Block, Switch, Shortcut, Seg, NumField, TextField } from "./settingsPrimitives";

export function SettingsPanel({ open, settings, onClose, onChange, openCategory = "editor", onS3SettingsChanged, onSyncSettingsChanged }: SettingsPanelProps) {
  const [category, setCategory] = useState<SettingsCategory>(openCategory);
  const [navQuery, setNavQuery] = useState("");
  const navSearchRef = useRef<HTMLInputElement>(null);
  const floating = useFloatingDialog({ id: "settings", initialSize: { w: 840, h: 600 }, minSize: { w: 620, h: 420 } });

  const [stats, setStats] = useState<{ snapshotCount: number; totalBytes: number } | null>(null);
  const [histCfg, setHistCfg] = useState<{ maxSnapshots: number; retentionDays: number; cleanupIntervalHours: number; snapshotIntervalMinutes: number } | null>(null);
  const [histMsg, setHistMsg] = useState<string | null>(null);
  const [histBusy, setHistBusy] = useState(false);
  const [lastCleanup, setLastCleanup] = useState<{ at: string; deletedSnapshots: number; freedBytes: number } | null>(null);
  // A3 数据体检：只读三查报告
  const [health, setHealth] = useState<DataHealthReport | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);
  // A1/A2 备份与恢复
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  // F1 日志查看
  const [logRows, setLogRows] = useState<Array<{ line: string; hit: boolean }>>([]);
  const [logKeyword, setLogKeyword] = useState("");
  const [logBusy, setLogBusy] = useState(false);
  const [logInfo, setLogInfo] = useState<string | null>(null);

  const [s3, setS3] = useState<S3Settings>(S3_DEFAULTS);
  // AI：设置只在打开该分类时读取（Key 已脱敏，永不进渲染层）。
  // 采用**草稿式**：编辑不落盘，先「拉模型 / 测试」验证草稿，通过（或用户选择仍要保存）才写回。
  const [aiView, setAiView] = useState<AiSettingsView | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  /** 字段级错误（键：apiKey / baseUrl / model / all）——比一个笼统提示好用。 */
  const [aiErr, setAiErr] = useState<Record<string, string>>({});
  /** 未保存的编辑值；apiKey 只在本组件内存里，测通后才落盘。 */
  const [aiDraft, setAiDraft] = useState<{ baseUrl?: string; model?: string; apiKey?: string; temperature?: number; reasoningEffort?: AiReasoningEffort; thinking?: AiThinkingMode }>({});
  /** API Key 是否明文显示（眼睛按钮）。仅影响当前输入框，不改变任何存储语义。 */
  const [aiKeyVisible, setAiKeyVisible] = useState(false);
  const [aiModels, setAiModels] = useState<string[] | null>(null);
  /** 模型列表存在时仍强制手填（select 里选「手填…」）。 */
  const [aiManualModel, setAiManualModel] = useState(false);
  const [aiModelsBusy, setAiModelsBusy] = useState(false);
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
  const saveAi = async (patch: AiSettingsPatch) => {
    try { setAiView(await native.aiSaveSettings(patch)); setAiMsg(null); }
    catch (e) { setAiMsg(getNativeErrorMessage(e)); }
  };
  /** 待保存字段的补丁（Key 只在编辑态才带上）。 */
  const aiPendingPatch = () => ({
    id: aiProviderId, baseUrl: aiPending.baseUrl, model: aiPending.model, temperature: aiPending.temperature,
    reasoningEffort: aiPending.reasoningEffort, thinking: aiPending.thinking,
    ...(aiDraft.apiKey ? { apiKey: aiDraft.apiKey } : {}),
  });
  /** 切供应商：按该家默认初始化，并清空草稿与模型列表。 */
  const switchAiProvider = async (id: string) => {
    resetAiDraft(); setAiModels(null); setAiMsg(null);
    await saveAi({ activeProviderId: id, providers: [{ id }] });
  };
  /** 拉模型列表：本身就是一次轻量连通验证；失败按字段贴错、回落手填。 */
  const fetchAiModels = async () => {
    // 没有已存 Key、草稿里也没填 → 先把 Key 输入框打开并明确提示，别发一次注定失败的请求
    // （用户实测坑：配完 Key 但没走「测试并保存」，Key 未落盘，点拉列表只看到"未配置 API Key"）。
    if (!activeAi?.hasApiKey && !aiDraft.apiKey) {
      setAiErr({ apiKey: "请先填写 API Key（拉取模型列表需要它）" });
      setAiMsg("请先填写 API Key，再获取模型列表");
      return;
    }
    setAiModelsBusy(true); setAiErr({}); setAiMsg(null); setAiForceSave(false);
    try {
      const r = await native.aiListModels(aiPending);
      if (r.ok) {
        const ms = r.models ?? [];
        setAiModels(ms); setAiManualModel(false);
        setAiMsg("已获取模型列表：" + ms.length + " 个");
        // 还没选模型（如「自定义」默认模型为空）→ 自动选第一个，省得用户对着空下拉
        setAiDraft((d) => (d.model ?? activeAi?.model) ? d : { ...d, model: ms[0] ?? "" });
      }
      else { setAiModels(null); setAiErr(fieldErrorFor(r.error ?? "未知错误", r.retryable)); setAiMsg("拉取模型列表失败：" + (r.error ?? "未知错误")); }
    } catch (e) { setAiMsg("拉取模型列表失败：" + getNativeErrorMessage(e)); }
    finally { setAiModelsBusy(false); }
  };
  const testAi = async () => {
    setAiBusy(true); setAiMsg(null); setAiErr({});
    try {
      const r = await native.aiTestConnection(aiPending);
      setAiMsg(r.ok ? "连接成功 ✓" : "失败：" + (r.error ?? "未知错误"));
      if (!r.ok) setAiErr(fieldErrorFor(r.error ?? "", r.retryable));
    } catch (e) { setAiMsg("失败：" + getNativeErrorMessage(e)); }
    finally { setAiBusy(false); }
  };
  /** 保存前 gate：先测草稿。鉴权/模型类硬拦；网络/限流给「仍要保存」。 */
  const testAndSaveAi = async () => {
    setAiBusy(true); setAiErr({}); setAiMsg(null); setAiForceSave(false);
    try {
      const r = await native.aiTestConnection(aiPending);
      if (r.ok) {
        await saveAi({ providers: [aiPendingPatch()] });
        resetAiDraft();
        setAiMsg("连接成功，已保存 ✓");
        // 连通已证明可用：顺手拉一次列表（用**已保存**配置），让模型下拉马上能选
        void native.aiListModels().then((lr) => { if (lr.ok && lr.models?.length) { setAiModels(lr.models); setAiManualModel(false); } }).catch(() => {});
      }
      else { setAiErr(fieldErrorFor(r.error ?? "未知错误", r.retryable)); setAiMsg("连接失败：" + (r.error ?? "未知错误")); setAiForceSave(Boolean(r.retryable)); }
    } catch (e) { setAiMsg("连接失败：" + getNativeErrorMessage(e)); }
    finally { setAiBusy(false); }
  };
  /** 仅保存不测试（只在「仍要保存」路径出现）。 */
  const forceSaveAi = async () => {
    await saveAi({ providers: [aiPendingPatch()] });
    resetAiDraft(); setAiForceSave(false); setAiMsg("已保存（未通过连通测试）");
  };
  const [gcCfg, setGcCfg] = useState<{ gcRetentionDays: number; gcIntervalHours: number; trashAutoPurgeDays: number } | null>(null);
  const [gcPending, setGcPending] = useState<number>(0);
  const [gcLog, setGcLog] = useState<Array<{ id: number; ts: string; action: string; key: string; reason: string; ok: boolean }>>([]);
  const [gcBusy, setGcBusy] = useState(false);
  const [gcDiag, setGcDiag] = useState<GcDiagnostics | null>(null);
  const [gcDiagBusy, setGcDiagBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [webStatus, setWebStatus] = useState<{ enabled: boolean; port: number; url: string } | null>(null);
  const [webBusy, setWebBusy] = useState(false);
  const [webMsg, setWebMsg] = useState<string | null>(null);
  const [syncCfg, setSyncCfg] = useState<SyncSettings | null>(null);
  const [syncCfgBusy, setSyncCfgBusy] = useState(false);
  const [gcPendingRows, setGcPendingRows] = useState<S3GcPendingItem[]>([]);
  const [orphans, setOrphans] = useState<RemovedAsset[]>([]);
  const [orphanBusy, setOrphanBusy] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [sel, setSel] = useState<RemovedAsset | null>(null);
  const [pv, setPv] = useState<{ filename: string; mimeType: string; supported: boolean; dataUrl?: string } | null>(null);
  const [sysInfo, setSysInfo] = useState<import("../lib/types").SystemInfo | null>(null);
  const [pendingHit, setPendingHit] = useState<string | null>(null);
  const [diagMsg, setDiagMsg] = useState<string | null>(null);
  const [pvLoading, setPvLoading] = useState(false);

  /** A1 整库备份：选目录 → 备份到 <dir>/lake-notes-backup-<ts>/。 */
  const runBackup = async () => {
    if (!native.capabilities.nativeDialog) { setBackupMsg("浏览器端暂不支持整库备份（请在桌面端操作）"); return; }
    if (backupBusy) return;
    setBackupBusy(true);
    setBackupMsg(null);
    try {
      const dir = await native.pickBackupDir();
      if (!dir) return;
      const r = await native.runWorkspaceBackup(dir);
      setBackupMsg(`备份完成：${r.backupPath}（目录 ${r.copiedDirs.length} 个）`);
    } catch (e) {
      setBackupMsg(`备份失败：${getNativeErrorMessage(e)}`);
    } finally {
      setBackupBusy(false);
    }
  };

  /** A2 云端恢复（换机/坏库）：隔离备份当前数据 → 全新空库 → 重启后首次同步全量拉取。 */
  const runCloudRestore = async () => {
    if (!native.capabilities.nativeDialog) { setBackupMsg("浏览器端不支持云端恢复（需重启本机应用，请在桌面端操作）"); return; }
    if (!window.confirm("从云端恢复将：① 把当前全部本地数据改名隔离保存（可手动找回）；② 清空工作区为全新空库；③ 重启后首次同步从云端全量拉取（只拉不打）。继续？")) return;
    setBackupBusy(true);
    setBackupMsg(null);
    try {
      const { quarantinePath } = await native.prepareCloudRestore();
      window.alert(`当前数据已隔离备份到：\n${quarantinePath}\n\n应用即将重启并从云端恢复。`);
      await native.confirmRelaunch();
    } catch (e) {
      setBackupMsg(`云端恢复失败：${getNativeErrorMessage(e)}`);
    } finally {
      setBackupBusy(false);
    }
  };

  /** F1 日志查看：尾部关键字过滤（GC/sync/trash 等），纯读。 */
  const runLogLoad = async (keyword: string) => {
    setLogBusy(true);
    try {
      const r = await native.readAppLog({ keyword: keyword.trim() || undefined, maxLines: 200, context: 1 });
      setLogRows(r.matches);
      setLogInfo(r.matches.length === 0 ? "无匹配日志" : r.truncated ? `显示最近 ${r.matches.length} 行（已截断）` : `共 ${r.matches.length} 行`);
    } catch (e) {
      setLogRows([]);
      setLogInfo(`日志读取失败：${getNativeErrorMessage(e)}`);
    } finally {
      setLogBusy(false);
    }
  };

  /** A3 数据体检：只读三查（notes↔文件/hash、history↔文件、orphan 登记↔文件）。 */
  const runHealth = async () => {
    setHealthBusy(true);
    try {
      const report = await native.runDataHealthCheck();
      setHealth(report);
    } catch (e) {
      setHistMsg(`数据体检失败：${getNativeErrorMessage(e)}`);
    } finally {
      setHealthBusy(false);
    }
  };

  const refreshGcPending = async () => {
    try {
      const items = await native.listS3GcPending();
      setGcPendingRows(items);
      setGcPending(items.length);
    } catch { /* 忽略：下次打开/操作后再刷新 */ }
  };

  /** 待回收行拆分：已过窗口（自动对账可删）/ 窗口内（最早何时到期）/ 时间未知。 */
  const gcSummary = useMemo(() => {
    const now = Date.now();
    const retention = gcCfg?.gcRetentionDays ?? 7;
    const cutoff = gcCutoffMs(now, retention);
    let due = 0;
    let inWindow = 0;
    let unknown = 0;
    let earliest: number | null = null;
    for (const row of gcPendingRows) {
      const ms = parseIsoMs(row.markedAt);
      if (ms === null) { unknown += 1; continue; }
      if (ms <= cutoff) { due += 1; }
      else {
        inWindow += 1;
        const at = ms + retention * 86_400_000;
        if (earliest === null || at < earliest) earliest = at;
      }
    }
    return { due, inWindow, unknown, earliest };
  }, [gcPendingRows, gcCfg]);

  /** 未引用资源按所属文档分组（含回收站/已删除状态标注）。 */
  const groupedOrphans = useMemo(() => {
    const map = new Map<string, { title: string; state: string; items: RemovedAsset[] }>();
    for (const o of orphans) {
      const state = o.noteState ?? "active";
      const key = (o.noteTitle ?? o.noteId) + "|" + state;
      let g = map.get(key);
      if (!g) { g = { title: o.noteTitle ?? o.noteId, state, items: [] }; map.set(key, g); }
      g.items.push(o);
    }
    return [...map.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [orphans]);

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
    void refreshGcPending();
    void native.listS3GcLog().then(setGcLog).catch((error) => reportNativeActionError("设置页读取", error));
  }, [open, openCategory]);

  useEffect(() => {
    if (open && category === "resources") void refreshOrphans();
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

  useEffect(() => {
    const ids = new Set(itemHits.map((h) => h.id));
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(".settings-content [data-set-id]"))) {
      el.classList.toggle("is-match", ids.has(el.dataset.setId ?? ""));
    }
  }, [itemHits, category]);

  const revealFolder = (kind: import("../lib/types").DataFolderKind) => {
    void native.revealDataFolder(kind).then((r) => setDiagMsg(r.ok ? `已在 Finder 中显示：${r.path}` : `目录尚不存在：${r.path}`)).catch((e) => setDiagMsg(getNativeErrorMessage(e)));
  };

  const copyDiagnostics = async () => {
    if (!sysInfo) return;
    const st = sysInfo.storage;
    const lines = [
      `Lake Notes ${sysInfo.app.version}${sysInfo.packaged ? "" : "（开发实例）"}`,
      `Electron ${sysInfo.runtime.electron} · Chromium ${sysInfo.runtime.chromium} · Node ${sysInfo.runtime.node} · ${sysInfo.runtime.platform}/${sysInfo.runtime.arch}`,
      `依赖：${Object.entries(sysInfo.deps).map(([k, v]) => `${k}@${v}`).join(", ")}`,
      `数据目录：${st.root}`,
      `日志目录：${sysInfo.paths.logs}`,
      `笔记 ${st.notes} · 笔记本 ${st.notebooks} · 分组 ${st.groups} · 小记 ${sysInfo.quickNotes}`,
      `资源 ${st.assetFiles} 个 / ${formatBytes(st.assetBytes)} · 历史快照 ${st.historySnapshots} 份 / ${formatBytes(st.historyBytes)}`,
      `回收站节点 ${st.trashedNodes} · 删除墓碑 ${st.tombstones} · 孤儿登记 ${st.orphanRows} · 库文件 ${formatBytes(st.dbBytes)}`,
      `生成于 ${new Date().toLocaleString()}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setDiagMsg("诊断信息已复制到剪贴板");
    } catch { setDiagMsg("复制失败（剪贴板不可用）"); }
  };

  // 选中即预览、切换自动加载（思源式资源管理交互）。
  // 切换时**不清空**上一张已解码的图：旧实现 setPv(null) 会让预览区先塌成一行"加载中…"文本、
  // 图到位再撑开（实测 220 → 412，192px 跳动），冷读盘时正好被看见 = "初次切换闪一下"。
  // 现在：保留旧图 + 新图先 decode 再替换 + 预览舞台固定高度（见 .preview-stage），几何全程不变。
  useEffect(() => {
    if (!sel) { setPv(null); setPvLoading(false); return; }
    let alive = true;
    setPvLoading(true);
    native.readAssetPreview(sel.noteId, sel.filename)
      .then(async (r) => {
        if (r.supported && r.dataUrl) await decodeImage(r.dataUrl);   // 解码完再上屏，避免换上去那一帧空白
        if (!alive) return;
        setPv(r); setPvLoading(false);
      })
      .catch(() => { if (alive) { setPv({ filename: sel.filename, mimeType: "", supported: false }); setPvLoading(false); } });
    return () => { alive = false; };
  }, [sel]);

  const nav = [
    { id: "editor" as const, label: "编辑器", keywords: "字号 大纲 工具栏 标签页" , icon: <Type size={15} /> },
    { id: "appearance" as const, label: "外观", keywords: "浅色 深色 主题", icon: <Palette size={15} /> },
    { id: "shortcuts" as const, label: "快捷键", keywords: "快捷键 搜索 专注模式 键盘", icon: <Keyboard size={15} /> },
    { id: "history" as const, label: "文档与历史", keywords: "快照 保留 清理", icon: <History size={15} /> },
    { id: "sync" as const, label: "云端与同步", keywords: "S3 上传 下载 资源 云端 回收", icon: <Cloud size={15} /> },
    { id: "ai" as const, label: "AI", keywords: "AI 助手 供应商 模型 key api openai deepseek 密钥", icon: <Sparkles size={15} /> },
    { id: "resources" as const, label: "资源", keywords: "资源 未引用 孤儿 清理 附件 图片", icon: <ImageIcon size={15} /> },
    { id: "trash" as const, label: "回收站", keywords: "删除 恢复 清空", icon: <Trash size={15} /> },
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
      setHistMsg("历史设置保存失败：" + getNativeErrorMessage(reason));
      void native.getHistorySettings().then(setHistCfg).catch((error) => reportNativeActionError("重读历史设置", error));
    });
  };

  const runCleanup = async () => {
    if (histBusy) return;
    setHistBusy(true); setHistMsg(null);
    try {
      const r = await native.cleanupHistory();
      setStats(await native.getHistoryStats());
      setHistMsg(r.deletedSnapshots > 0 ? `已清理 ${r.deletedSnapshots} 份过期快照` : "无过期快照");
    } catch (e) { setHistMsg(getNativeErrorMessage(e)); }
    finally { setHistBusy(false); }
  };

  const setS3Field = (key: keyof S3Settings, value: string | boolean) => setS3((c) => ({ ...c, [key]: value }));
  const saveS3 = async () => {
    setSyncMsg(null);
    try { await native.saveS3Settings(s3); onS3SettingsChanged?.(s3); setSyncMsg("S3 配置已保存在当前设备"); }
    catch (e) { setSyncMsg(getNativeErrorMessage(e)); }
  };
  const testS3 = async () => {
    setSyncMsg("正在连接...");
    try { await native.saveS3Settings(s3); onS3SettingsChanged?.(s3); setSyncMsg(await native.testS3Connection()); }
    catch (e) { setSyncMsg(getNativeErrorMessage(e)); }
  };

  const saveSyncCfg = async (patch: Partial<SyncSettings>) => {
    if (!syncCfg || syncCfgBusy) return;
    const next = { ...syncCfg, ...patch };
    setSyncCfgBusy(true); setSyncMsg(null);
    try {
      // 只有 S3 配置可保存且连通测试通过，才允许开启云同步；任一失败都保持关闭。
      if (patch.enabled === true) {
        setSyncMsg("正在测试 S3 连接...");
        await native.saveS3Settings(s3);
        onS3SettingsChanged?.(s3);
        setSyncMsg(await native.testS3Connection());
      }
      const saved = await native.saveSyncSettings(next);
      setSyncCfg(saved);
      onSyncSettingsChanged?.(saved);
      setSyncMsg(saved.enabled ? "同步策略已保存" : "云同步已关闭（已完成最后一次对齐）");
    } catch (e) {
      setSyncMsg(getNativeErrorMessage(e));
      void native.getSyncSettings().then(setSyncCfg).catch((error) => reportNativeActionError("设置页读取", error));
    } finally {
      setSyncCfgBusy(false);
    }
  };

  const setWeb = async (enabled: boolean) => {
    if (webBusy) return;
    setWebBusy(true); setWebMsg(null);
    try {
      const st = await native.setWebEnabled(enabled);
      setWebStatus(st);
      setWebMsg(st.enabled ? null : "已关闭");
    } catch (e) {
      setWebMsg(getNativeErrorMessage(e));
      void native.getWebStatus().then(setWebStatus).catch((error) => reportNativeActionError("设置页读取", error));
    } finally {
      setWebBusy(false);
    }
  };

  const openWeb = async () => {
    try {
      const r = await native.openWebClient();
      if (!r.ok) setWebMsg(r.reason ?? "打开失败");
    } catch (e) {
      setWebMsg(getNativeErrorMessage(e));
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
    if (gcBusy) return;
    setGcBusy(true); setSyncMsg(null);
    try {
      // 手动清理 = 显式清云端：无视 7 天窗口，直接列出/删除当前全部未引用对象（自动定时仍按窗口）
      const r = await native.runS3DeepCleanup(dryRun, true);
      await refreshGcPending();
      setGcDiag(null);
      setSyncMsg(dryRun ? `预览：可清理 Lake ${r.lake.candidateCount} 个、小记 ${r.quickNotes.candidateCount} 个` : `已清理：Lake ${r.lake.deletedCount} 个、小记 ${r.quickNotes.deletedCount} 个`);
    } catch (e) { setSyncMsg(getNativeErrorMessage(e)); }
    finally { setGcBusy(false); }
  };
  const runReconcile = async () => {
    if (gcBusy) return;
    setGcBusy(true); setSyncMsg(null);
    try {
      // 手动对账 = 显式清云端：无视 7 天窗口（自动/定时仍按窗口）
      const r = await native.runS3GcReconcile(true);
      await refreshGcPending();
      setGcDiag(null);
      const cleared = r.clearedReferenced > 0 ? `；另有 ${r.clearedReferenced} 条已恢复引用、移出待回收` : "";
      setSyncMsg(r.deleted > 0 ? `已删除 ${r.deleted} 个未引用对象${cleared}` : cleared ? `无未引用对象可删${cleared}` : "云端无未引用对象");
    } catch (e) { setSyncMsg(getNativeErrorMessage(e)); }
    finally { setGcBusy(false); }
  };
  const refreshOrphans = async () => {
    try { setOrphans(await native.listRemovedAssets()); } catch { /* 忽略 */ }
  };
  const copyPath = async (o: RemovedAsset) => {
    try {
      const full = await native.copyAssetPath(o.noteId, o.filename);
      setSyncMsg(`已复制路径：${full}`);
    } catch (err) { setSyncMsg(getNativeErrorMessage(err)); }
  };
  const openFolder = async (o: RemovedAsset) => {
    try { await native.showAttachmentInFolder(o.noteId, o.filename); }
    catch (err) { setSyncMsg(getNativeErrorMessage(err)); }
  };
  const deleteOne = async (o: RemovedAsset) => {
    if (busyId !== null || o.orphanId == null) return;
    if (!window.confirm(`删除未引用资源「${o.filename}」？`)) return;
    setBusyId(o.orphanId); setSyncMsg(null);
    try {
      const r = await native.deleteOrphanAsset(o.orphanId);
      if (r.deleted) setSyncMsg(`已删除「${o.filename}」（释放 ${formatBytes(r.freedBytes)}）`);
      else setSyncMsg(`「${o.filename}」此刻仍被引用或删除失败，已保留`);
      setSel(null);
      await refreshOrphans();
    } catch (err) { setSyncMsg(getNativeErrorMessage(err)); }
    finally { setBusyId(null); }
  };
  const cleanOrphans = async () => {
    if (orphanBusy || orphans.length === 0) return;
    if (!window.confirm(`删除 ${orphans.length} 个未引用资源文件？
此操作物理删除本地文件并使其不再上传；被当前正文或历史快照引用的会在此刻自动跳过。`)) return;
    setOrphanBusy(true); setSyncMsg(null);
    try {
      const r: CleanOrphanResult = await native.cleanOrphanAssets();
      setSel(null);
      await refreshOrphans();
      setSyncMsg(r.count > 0 ? `已清理 ${r.count} 个资源（释放 ${formatBytes(r.freedBytes)}）` : "没有可清理的未引用资源");
    } catch (err) { setSyncMsg(getNativeErrorMessage(err)); }
    finally { setOrphanBusy(false); }
  };
  const refreshCloudStats = async () => {
    if (gcDiagBusy) return;
    setGcDiagBusy(true); setSyncMsg(null);
    try {
      const d = await native.runS3GcDiagnostics();
      setGcDiag(d);
      setSyncMsg("云端统计已刷新");
    } catch (e) { setSyncMsg(getNativeErrorMessage(e)); }
    finally { setGcDiagBusy(false); }
  };
  const diagNs = (name: string) => gcDiag?.cloud.namespaces.find((n) => n.namespace === name);
  const orphanCount = orphans.filter((o) => o.status === "orphan").length;
  const historyCount = orphans.filter((o) => o.status === "history").length;

  return (
    <div className="settings-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !floating.interactionRef.current) onClose(); }}>
      <div ref={floating.panelRef} className="floating-dialog settings-panel settings-panel-large" style={floating.panelStyle} role="dialog" aria-modal="true" aria-labelledby="settings-panel-title" onClick={(e) => e.stopPropagation()}>
        <header id="settings-panel-title" className="settings-header floating-dialog-header" onPointerDown={floating.startDrag}>
          <Settings size={16} />
          <span>偏好设置</span>
          <button className="ln-close" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav b3-list b3-list--background">
            <label className="settings-nav-search"><Search size={14} /><input ref={navSearchRef} value={navQuery} onChange={(event) => setNavQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { navSearchRef.current?.blur(); return; } if (event.key === "Enter" && itemHits.length > 0) { event.preventDefault(); jumpToItem(itemHits[0]); } }} placeholder="搜索设置（分类与条目）" aria-label="搜索设置" /></label>
            {visibleNav.map((item) => (
              <button key={item.id} className={`b3-list-item settings-nav-item${category === item.id ? " active" : ""}`} onClick={() => setCategory(item.id)}>
                {item.icon}<span>{item.label}</span>
              </button>
            ))}
            {visibleNav.length === 0 && itemHits.length === 0 && <span className="settings-nav-empty">没有匹配的设置</span>}
            {navQuery.trim() && itemHits.length > 0 && (
              <div className="settings-nav-hits">
                <span className="settings-nav-hits__label">条目 · {itemHits.length} 项</span>
                {itemHits.map((hit) => (
                  <button key={hit.id} className="b3-list-item settings-nav-hit" onClick={() => jumpToItem(hit)} title={hit.label}>
                    <span className="b3-list-item__text ln-ellipsis">{hit.label}</span>
                    <span className="b3-list-item__meta">{nav.find((item) => item.id === hit.category)?.label}</span>
                  </button>
                ))}
              </div>
            )}
          </nav>
          <div className="settings-content">
            {category === "editor" && (
              <>
                <Group title="编辑器" icon={<Type size={16} />}>
                  <Field itemId="editor-font-size" name="正文字号" desc="作用于当前文档正文。">
                    <select className="b3-select" value={settings.fontSize} onChange={(e) => onChange({ fontSize: Number(e.target.value) })} aria-label="正文字号">
                      {fontSizeOptions().map((fs) => <option key={fs} value={fs}>{fs} px</option>)}
                    </select>
                  </Field>
                  <Switch itemId="editor-outline-enhance" name="大纲增强" desc="开启=应用自建增强大纲（筛选/折叠/级别徽标/悬停；桌面右栏）；关闭（默认）=直接使用 Lake 原生大纲。移动端始终使用应用大纲面板。" checked={settings.outlineEnhance} onChange={(checked) => onChange({ outlineEnhance: checked })} />
                  <Switch itemId="editor-toolbar" name="显示固定工具栏" desc="编辑器顶部那条固定工具栏。关掉后编辑区更干净，格式操作走浮动工具栏。" checked={settings.showToolbar} onChange={(checked) => onChange({ showToolbar: checked })} />
                  <Switch itemId="editor-floating-toolbar" name="浮动工具栏" desc="选中文字或图片时，在选区上方弹出格式浮框。与固定工具栏互相独立，可任意组合开关。" checked={settings.floatingToolbar} onChange={(checked) => onChange({ floatingToolbar: checked })} />
                </Group>
                <Group title="标签页" icon={<Files size={16} />}>
                  <Field itemId="editor-max-open-tabs" name="最大同时打开标签数" desc="超过上限时自动关闭最旧的标签（当前编辑的标签与钉住的标签除外），未保存内容会自动保存。">
                    <select className="b3-select" value={settings.maxOpenTabs} onChange={(e) => onChange({ maxOpenTabs: Number(e.target.value) })} aria-label="最大同时打开标签数">
                      <option value={0}>不限</option>
                      <option value={4}>4 个</option>
                      <option value={6}>6 个</option>
                      <option value={8}>8 个</option>
                      <option value={12}>12 个</option>
                      <option value={16}>16 个</option>
                      <option value={24}>24 个</option>
                    </select>
                  </Field>
                </Group>
                <Group title="附件" icon={<Paperclip size={16} />}>
                  <Field itemId="editor-max-attachment" name="附件大小上限" desc="插入附件时的本机上限；同步/下载使用协议上限（100 MiB），其他设备配置不同不影响接收。">
                    <select className="b3-select" value={settings.maxAttachmentBytes / (1024 * 1024)} onChange={(e) => onChange({ maxAttachmentBytes: Number(e.target.value) * 1024 * 1024 })} aria-label="附件大小上限">
                      <option value={25}>25 MiB</option>
                      <option value={50}>50 MiB</option>
                      <option value={100}>100 MiB</option>
                    </select>
                  </Field>
                </Group>
              </>
            )}

            {category === "appearance" && (
              <Group title="外观" icon={<Monitor size={16} />}>
                <Item itemId="appearance-theme" name="主题">
                  <Seg ariaLabel="主题">
                    {LAKE_THEMES.map((t) => (
                      <button key={t.id} className={`b3-button b3-button--outline seg__item ${settings.theme === t.id ? "is-active" : ""}`} onClick={() => onChange({ theme: t.id })}>
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
                      {lastCleanup && <span>上次清理 {formatDateTime(Date.parse(lastCleanup.at))} · {lastCleanup.deletedSnapshots} 份 · {formatBytes(lastCleanup.freedBytes)}</span>}
                    </div>
                    <div className="config-block__actions">
                      <button className="b3-button b3-button--outline" onClick={() => void runCleanup()} disabled={histBusy}><Trash size={14} /> {histBusy ? "清理中…" : "立即清理"}</button>
                    </div>
                    {histMsg && <div className="block__text">{histMsg}</div>}
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
                  <Block itemId="history-data-health" name="一致性检查" desc="只读比对正文文件、历史快照、孤儿登记与引用资源；不自动修复。发现问题请从备份/云端恢复对应文件。">
                    <div className="config-block__actions">
                      <button className="b3-button b3-button--outline" onClick={() => void runHealth()} disabled={healthBusy}><Search size={14} /> {healthBusy ? "检查中…" : "运行检查"}</button>
                      {health && !healthBusy && (
                        <span className="config-stats"><span>笔记 {health.notesChecked} · 快照 {health.historyChecked} · 孤儿登记 {health.orphanRowsChecked} · 树节点 {health.treeChecked}</span></span>
                      )}
                    </div>
                    {health && (
                      <div className="checks">
                        {health.notesMissingFile.length === 0 && health.notesHashMismatch.length === 0 && health.historyMissingFile === 0 && health.orphanRowsFileMissing.length === 0 && health.refsMissingResource.length === 0 && health.treeDanglingParent.length === 0 ? (
                          <div className="checks__row checks__row--ok">✓ 全部自洽：正文文件、历史快照、孤儿登记、引用资源、目录树父子链均一致。</div>
                        ) : (
                          <>
                            {health.notesMissingFile.length > 0 && <div className="checks__row checks__row--error">✗ {health.notesMissingFile.length} 篇笔记正文文件缺失（首 3：{health.notesMissingFile.slice(0, 3).map((n) => n.title).join("、")}）</div>}
                            {health.notesHashMismatch.length > 0 && <div className="checks__row checks__row--error">✗ {health.notesHashMismatch.length} 篇正文与基线哈希不符（可能被外部改动）</div>}
                            {health.historyMissingFile > 0 && <div className="checks__row checks__row--warn">✗ {health.historyMissingFile} 份历史快照文件缺失（恢复对应版本时会失败）</div>}
                            {health.orphanRowsFileMissing.length > 0 && <div className="checks__row checks__row--warn">✗ {health.orphanRowsFileMissing.length} 条孤儿登记文件缺失（登记漂移）</div>}
                            {health.refsMissingResource.length > 0 && <div className="checks__row checks__row--error">✗ 正文引用的 {health.refsMissingResource.length} 个资源文件缺失（首 3：{health.refsMissingResource.slice(0, 3).map((r) => r.filename).join("、")}）</div>}
                          {health.treeDanglingParent.length > 0 && <div className="checks__row checks__row--error">✗ {health.treeDanglingParent.length} 个节点的父目录不存在（侧栏与回收站都看不到它）：{health.treeDanglingParent.slice(0, 3).map((t) => `${t.title}→${t.parentId}`).join("、")}</div>}
                          </>
                        )}
                        <div className="checks__row">生成于 {formatDateTime(Date.parse(health.checkedAt))}。</div>
                      </div>
                    )}
                  </Block>
                </Group>
              </>
            )}

            {category === "sync" && (
              <>
                <Group title="同步策略（仅保存在当前设备）" icon={<Cloud size={16} />}>
                  {syncCfg && (
                    <>
                      <Switch itemId="sync-enabled" name="启用云同步" desc="S3 配置与同步策略均为本机配置，不会上传云端；A 端关闭不影响 B 端。" checked={syncCfg.enabled} disabled={syncCfgBusy} onChange={(checked) => void saveSyncCfg({ enabled: checked })} />
                      {syncCfg.enabled && (
                        <>
                          <Field itemId="sync-auto-mode" name="自动同步模式">
                            <select className="b3-select" value={syncCfg.autoMode} onChange={(e) => void saveSyncCfg({ autoMode: e.target.value as SyncSettings["autoMode"] })} aria-label="自动同步模式">
                              <option value="manual">完全手动</option>
                              <option value="interval">按固定间隔自动同步</option>
                              <option value="onOpenClose">仅在开启/关闭时同步</option>
                            </select>
                          </Field>
                          {syncCfg.autoMode === "interval" && (
                            <Item itemId="sync-auto-interval" name="自动同步间隔（分钟）"><NumField label="自动同步间隔（分钟）" min={1} max={1440} value={syncCfg.autoIntervalMinutes} onSave={(v) => void saveSyncCfg({ autoIntervalMinutes: v })}  floor={1} fallback={15} /></Item>
                          )}
                        </>
                      )}
                    </>
                  )}
                </Group>
                <Group title="备份与恢复" icon={<Archive size={16} />}>
                  <Block itemId="backup-export" name="整库备份" desc="数据库 + 全部笔记/资源/历史快照 + 小记，导出到所选目录（不覆盖非空目录）。">
                    <div className="config-block__actions">
                      <button className="b3-button b3-button--outline" onClick={() => void runBackup()} disabled={backupBusy}><Archive size={14} /> {backupBusy ? "备份中…" : "整库备份到…"}</button>
                    </div>
                  </Block>
                  <Block itemId="backup-restore" name="从云端恢复" desc="当前数据先改名隔离保存，再以全新空库从云端全量拉取（只拉不打）。用于换机或本地库损坏。">
                    <div className="config-block__actions">
                      <button className="b3-button b3-button--outline ft__error" onClick={() => void runCloudRestore()} disabled={backupBusy}>从云端恢复（换机/坏库）…</button>
                    </div>
                  </Block>
                  {backupMsg && <Block name={backupMsg} />}
                </Group>
                <Group title="S3 对象存储" icon={<Cloud size={16} />}>
                  <Field itemId="s3-endpoint" name="Endpoint" desc="七牛 Kodo 形如 https://s3.cn-north-1.qiniucs.com。"><TextField label="Endpoint" value={s3.endpoint} placeholder="https://s3-cn-east-1.qiniucs.com" onSave={(v) => setS3Field("endpoint", v)} /></Field>
                  <Field itemId="s3-access-key" name="Access Key"><TextField label="Access Key" value={s3.accessKeyId} onSave={(v) => setS3Field("accessKeyId", v)} /></Field>
                  <Field itemId="s3-secret-key" name="Secret Key" desc="留空或保持 ******** 表示沿用已保存密钥（本机加密存储）。"><TextField label="Secret Key" type="password" placeholder="留空或保持 ******** 表示沿用已保存密钥" value={s3.secretAccessKey} onSave={(v) => setS3Field("secretAccessKey", v)} /></Field>
                  <Field itemId="s3-bucket" name="Bucket"><TextField label="Bucket" value={s3.bucket} onSave={(v) => setS3Field("bucket", v)} /></Field>
                  <Field itemId="s3-region" name="Region"><TextField label="Region" value={s3.region} onSave={(v) => setS3Field("region", v)} /></Field>
                  <Field itemId="s3-prefix" name="对象前缀"><TextField label="对象前缀" value={s3.prefix} onSave={(v) => setS3Field("prefix", v)} /></Field>
                  <Switch itemId="s3-path-style" name="使用 Path-style URL" desc="自建 MinIO 等需要开启；七牛 Kodo 关闭即可。" checked={s3.forcePathStyle} onChange={(checked) => setS3Field("forcePathStyle", checked)} />
                  <Block itemId="s3-connection" name="连接" desc="测试仅探测桶可读性，不写入数据。">
                    <div className="config-block__actions">
                      <button className="b3-button b3-button--outline" onClick={() => void testS3()}>测试连接</button>
                      <button className="b3-button" onClick={() => void saveS3()}>保存配置</button>
                    </div>
                  </Block>
                </Group>
                <Group title="云端回收（S3 GC）" icon={<Trash size={16} />}>
                  <Block itemId="gc-status" name="回收状态" desc="手动按钮会立即删除当前未被清单/历史引用的云端对象；自动对账按回收窗口到期后定期清理。结果偏少通常是被引用保护，不是漏删。">
                    <div className="config-stats">
                      <span>待回收键 <strong>{gcPending}</strong> 个</span>
                      <span>可删 <strong>{gcSummary.due}</strong></span>
                      <span>窗口内 <strong>{gcSummary.inWindow}</strong>{gcSummary.earliest !== null ? " · 最早 " + formatDateTime(gcSummary.earliest) + " 到期" : ""}</span>
                      {gcSummary.unknown > 0 && <span>时间未知 {gcSummary.unknown}</span>}
                    </div>
                    <div className="config-block__actions">
                      <button className="b3-button b3-button--outline" onClick={() => void runReconcile()} disabled={gcBusy}><Trash size={14} /> {gcBusy ? "处理中…" : "立即对账"}</button>
                      <button className="b3-button b3-button--outline" onClick={() => void runGcAction(true)} disabled={gcBusy}>深度清理预览</button>
                      <button className="b3-button b3-button--outline ft__error" onClick={() => void runGcAction(false)} disabled={gcBusy}>执行深度清理</button>
                      <button className="b3-button b3-button--outline" onClick={() => void refreshCloudStats()} disabled={gcBusy || gcDiagBusy}>{gcDiagBusy ? "统计中…" : "刷新云端统计"}</button>
                    </div>
                    {gcDiag && (
                      <div className="config-stats">
                        <span>云端占用 {gcDiag.cloud.objects} 个对象 / {formatBytes(gcDiag.cloud.bytes)}</span>
                        <span>正文 {diagNs("objects")?.cloudObjects ?? 0} · 资源 {diagNs("assets")?.cloudObjects ?? 0} · 清单 {diagNs("manifests")?.cloudObjects ?? 0} · 小记 {diagNs("quick-notes")?.cloudObjects ?? 0}</span>
                        <span>未引用 {gcDiag.cloud.unreferenced} · 已到期 {gcDiag.cloud.due} · 窗口内 {gcDiag.cloud.inWindow}</span>
                        <span>统计生成于 {formatDateTime(Date.parse(gcDiag.generatedAt))}</span>
                      </div>
                    )}
                  </Block>
                  {gcCfg && (
                    <>
                      <Item itemId="gc-retention-days" name="回收窗口（天）" desc="对象被替换/移除后的保护期；0 = 立即到期。"><NumField label="回收窗口（天）" min={0} max={90} value={gcCfg.gcRetentionDays} onSave={(v) => saveGcCfg({ gcRetentionDays: v })}  floor={0} fallback={7} /></Item>
                      <Item itemId="gc-interval-hours" name="自动对账周期（小时）" desc="自动清理频率；0 = 仅手动。"><NumField label="自动对账周期（小时）" min={0} max={720} value={gcCfg.gcIntervalHours} onSave={(v) => saveGcCfg({ gcIntervalHours: v })}  floor={0} fallback={24} /></Item>
                    </>
                  )}
                  <Block itemId="gc-mirror" name="云端只是镜像" desc="删除云端冗余不影响本地正文/回收站/历史快照（“彻底删除/清空回收站”除外）。" />
                  {gcPendingRows.length > 0 && (
                    <Block itemId="gc-pending-list" name={`待回收键明细（${gcPendingRows.length} 条）`} desc="按标记时间升序；[原因] 标注该键为何进入待回收。">
                      <div className="config-readonly">
                        {gcPendingRows.slice().sort((a, b) => (parseIsoMs(a.markedAt) ?? Infinity) - (parseIsoMs(b.markedAt) ?? Infinity)).map((row) => (
                          <div key={row.key} title={row.markedAt}>{row.markedAt.slice(0, 10)} [{pendingKeyReason(row.key)}] {row.key}</div>
                        ))}
                      </div>
                    </Block>
                  )}
                  <Block itemId="gc-log" name={`删除记录（最近 ${gcLog.length > 0 ? Math.min(gcLog.length, 30) : 0} 条 · 只读审计）`}>
                    {gcLog.length > 0 ? (
                      <div className="config-readonly">
                        {gcLog.slice(0, 30).map((l) => <div key={l.id}>{l.ts.slice(0, 19)}&nbsp;[{l.action} · {l.reason}] {l.key}</div>)}
                      </div>
                    ) : (
                      <div className="block__text">暂无删除记录。</div>
                    )}
                  </Block>
                </Group>
              </>
            )}

            {category === "resources" && (
              <Group title="全文搜索" icon={<Search size={16} />}>
                <Item itemId="search-rebuild" name="重建全文搜索索引" desc="标题/正文全文索引（FTS5，中文单字分词）。正常由增量账本自动维护；索引异常或换分词器后可手动重建。">
                  {searchMsg && <span className="b3-label__text">{searchMsg}</span>}
                  <button className="b3-button b3-button--outline" disabled={searchBusy} onClick={() => {
                    setSearchBusy(true);
                    setSearchMsg(null);
                    void native.rebuildSearchIndex()
                      .then(() => setSearchMsg("已重建搜索索引"))
                      .catch((error) => setSearchMsg(getNativeErrorMessage(error)))
                      .finally(() => setSearchBusy(false));
                  }}>{searchBusy ? "重建中…" : "重建"}</button>
                </Item>
              </Group>
            )}

            {category === "resources" && (
              <Group title="未引用资源（本地）" icon={<Paperclip size={16} />}>
                <Block desc="汇总所有文档中“当前正文不再引用”的本地资产文件：未引用（可删除/复制/打开位置）与历史保护（仍被历史快照引用，仅查看不可删除）。点击条目即预览并自动切换；文档在回收站时文件仍列出，彻底删除时随 purge 一并清理。">
                  <div className="config-stats">
                    <span>共 <strong>{orphans.length}</strong> 个</span>
                    <span>{formatBytes(orphans.reduce((s, o) => s + (o.size || 0), 0))}</span>
                    <span>可删 <strong>{orphanCount}</strong></span>
                    <span>历史保护 <strong>{historyCount}</strong></span>
                    <span>涉及 <strong>{groupedOrphans.length}</strong> 篇文档</span>
                  </div>
                  <div className="config-block__actions">
                    <button className="b3-button b3-button--outline" onClick={() => void refreshOrphans()}>刷新</button>
                    <button className="b3-button b3-button--outline ft__error" onClick={() => void cleanOrphans()} disabled={orphanBusy || orphanCount === 0}>{orphanBusy ? "清理中…" : `清理未引用（${orphanCount}）`}</button>
                  </div>
                </Block>
                {orphans.length === 0 ? (
                  <Block><div className="config-empty">没有被移除的资源文件。</div></Block>
                ) : (
                  <Block>
                    <div className="config-assets">
                      <div className="b3-list b3-list--background config-assets__list">
                        {groupedOrphans.map((g) => (
                          <div key={g.title + "|" + g.state} className="config-assets__group">
                            <div className="config-assets__grouptitle">
                              <Paperclip size={13} />
                              <span className="fn__ellipsis">{g.title}</span>
                              {g.state === "trash" && <span className="badge badge--warn">回收站</span>}
                              {g.state === "missing" && <span className="badge badge--error">文档已删除</span>}
                              <span className="config-assets__count">{g.items.length} 个</span>
                            </div>
                            {g.items.map((o) => (
                              <div
                                key={o.noteId + "/" + o.filename}
                                className={`b3-list-item b3-list-item--hide-action${sel && sel.noteId === o.noteId && sel.filename === o.filename ? " b3-list-item--focus" : ""}`}
                                onClick={() => setSel(sel && sel.noteId === o.noteId && sel.filename === o.filename ? null : o)}
                                title="点击预览"
                              >
                                <File size={14} className="b3-list-item__graphic" />
                                <span className="b3-list-item__text ln-ellipsis">{o.filename}</span>
                                <span className={`badge ${o.status === "history" ? "badge--warn" : "badge--muted"}`}>{o.status === "history" ? "历史保护" : "未引用"}</span>
                                <span className="b3-list-item__meta">{formatBytes(o.size)}</span>
                                <span className="fn__space" />
                                <button className="b3-list-item__action" title="复制路径" aria-label="复制路径" onClick={(ev) => { ev.stopPropagation(); void copyPath(o); }}><Copy size={14} /></button>
                                <button className="b3-list-item__action" title="在文件夹中显示" aria-label="在文件夹中显示" onClick={(ev) => { ev.stopPropagation(); void openFolder(o); }}><FolderOpen size={14} /></button>
                                {o.orphanId != null && (
                                  <button className="b3-list-item__action b3-list-item__action--warning" title="删除（不可撤销）" aria-label="删除" disabled={busyId !== null} onClick={(ev) => { ev.stopPropagation(); void deleteOne(o); }}><Trash size={14} /></button>
                                )}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                      <div className={`config-assets__preview${pvLoading ? " is-loading" : ""}`}>
                        <div className="config-assets__stage">
                          {pv?.supported && pv.dataUrl ? (
                            <img key={pv.filename} src={pv.dataUrl} alt={pv.filename} />
                          ) : (
                            <span className="config-assets__hint">
                              {!sel ? "点击左侧条目预览" : pvLoading ? "加载中…" : pv ? "该类型不支持预览" : "读取失败"}
                            </span>
                          )}
                        </div>
                        <div className="config-assets__previewname">
                          {sel?.filename ?? pv?.filename}
                          {sel && <span className="config-assets__hint"> · {pv?.mimeType || sel.mimeType}{pvLoading ? " · 加载中" : ""}</span>}
                        </div>
                      </div>
                    </div>
                  </Block>
                )}
              </Group>
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
                <Switch itemId="browser-enabled" name="启用浏览器端" desc="在本机浏览器中打开 Lake Notes（与桌面端同一份本地数据）。仅监听 127.0.0.1，不做局域网伺服、不允许其它设备访问。开关即时生效、无需重启；应用重启后恢复为关闭。" checked={webStatus?.enabled ?? false} disabled={!webStatus || webBusy} onChange={(checked) => void setWeb(checked)} />
                <Block name="这是什么" desc="浏览器端不是「伺服」：不对外开放、不监听局域网。它只是把桌面端这一份本地库（同一个数据库、同一批文件）通过回环地址 http://127.0.0.1:19880/ 交给本机浏览器，数据不经过网络。打开开关后，用 Chrome 等浏览器打开该地址即可。" />
                <Block name="现状" desc="读写与本机同一份数据；同步进度/待办计数走 SSE 实时推送；图片「另存为」走浏览器下载、附件在新标签打开。导出/整库备份等需要系统目录框的操作仍请在桌面端使用。此开关不落盘（每次启动应用都从关闭开始）。" />
                {webStatus?.enabled && (
                  <Item itemId="browser-open" name="在本机浏览器打开" desc={webStatus.url}>
                    <button className="b3-button b3-button--outline" onClick={() => void openWeb()}><ExternalLink size={14} /> 打开浏览器</button>
                  </Item>
                )}
                {webMsg && <Block desc={webMsg} />}
              </Group>
            )}

            {category === "logs" && (
              <Group title="应用日志（只读）" icon={<Terminal size={16} />}>
                <Block itemId="logs-main" name="主进程日志" desc="GC / 同步 / 回收站 / 历史清理写入 userData/logs/lake-notes.log。按关键字过滤，每条命中附带前后一行上下文。">
                  <div className="config-block__actions">
                    <input
                      className="b3-text-field logs__filter"
                      type="text"
                      value={logKeyword}
                      onChange={(e) => setLogKeyword(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void runLogLoad(logKeyword); }}
                      placeholder="过滤（如 GC / sync / trash / purge / snapshot）"
                      aria-label="日志关键字过滤"
                    />
                    <button className="b3-button b3-button--outline" onClick={() => void runLogLoad(logKeyword)} disabled={logBusy}><Search size={14} /> {logBusy ? "读取中…" : "读取"}</button>
                  </div>
                  {logInfo && <div className="block__text">{logInfo}</div>}
                </Block>
                <Block>
                  {logRows.length > 0 ? (
                    <div className="config-readonly readonly--tall">
                      {logRows.map((row, i) => <div key={i} className={row.hit ? "logs__hit" : undefined}>{row.line}</div>)}
                    </div>
                  ) : (
                    !logBusy && <div className="config-empty">尚无日志或未读取。</div>
                  )}
                </Block>
              </Group>
            )}

            {category === "ai" && (
              <>
                <Group title="AI 助手" icon={<Sparkles size={16} />}>
                  <Section title="服务">
                    <Field itemId="ai-provider" name="供应商" desc="只支持 OpenAI 兼容接口：内置 OpenAI / DeepSeek，也可选「自定义」指向任意兼容端点（Ollama / vLLM / OneAPI 等）。切换即按该家默认值初始化。">
                      <select className="b3-select" value={aiProviderId} onChange={(e) => void switchAiProvider(e.target.value)} aria-label="AI 供应商">
                        {AI_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                    </Field>
                    <Field itemId="ai-base-url" name="Base URL" desc={"留空即用该家默认；可改成任意 OpenAI 兼容端点，例如 " + activeDef.defaultBaseUrl + "。"} error={aiErr.baseUrl}>
                      <span className="ln-input"><input className="ln-input__field" value={aiPending.baseUrl} placeholder={activeDef.defaultBaseUrl} spellCheck={false} onChange={(e) => setAiDraft((d) => ({ ...d, baseUrl: e.target.value }))} aria-label="Base URL" /></span>
                      <button className="b3-button b3-button--outline" onClick={() => setAiDraft((d) => ({ ...d, baseUrl: activeDef.defaultBaseUrl }))}>恢复默认</button>
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
                        <button className="b3-button b3-button--outline" onClick={() => void saveAi({ providers: [{ id: aiProviderId, clearApiKey: true }] })}>清除</button>
                      )}
                    </Field>
                  </Section>

                  <Section title="模型与参数">
                    <Field itemId="ai-model" name="模型" desc="从供应商拉取候选会同时验证连通性；端点不实现 /models 时可手填。" error={aiErr.model}>
                      {aiModels && aiModels.length > 0 && !aiManualModel ? (
                        <select className="b3-select" value={aiPending.model} onChange={(e) => { const v = e.target.value; if (v === "__manual__") { setAiManualModel(true); return; } setAiDraft((d) => ({ ...d, model: v })); }} aria-label="AI 模型">
                          {aiModels.map((m) => <option key={m} value={m}>{m}</option>)}
                          {aiPending.model && aiModels.indexOf(aiPending.model) < 0 && <option value={aiPending.model}>{aiPending.model}</option>}
                          <option value="__manual__">手填…</option>
                        </select>
                      ) : (
                        <>
                          <span className="ln-input"><input className="ln-input__field" value={aiPending.model} placeholder={activeDef.defaultModel || "模型名"} onChange={(e) => setAiDraft((d) => ({ ...d, model: e.target.value }))} aria-label="AI 模型" /></span>
                          {aiModels && aiModels.length > 0 && <button className="b3-button b3-button--outline" onClick={() => setAiManualModel(false)}>用列表</button>}
                        </>
                      )}
                      <button className="b3-button b3-button--outline" disabled={aiModelsBusy} onClick={() => void fetchAiModels()}>{aiModelsBusy ? "拉取中…" : "获取模型列表"}</button>
                    </Field>
                    {activeDef.supportsReasoning && (
                      <Item itemId="ai-reasoning" name="思考强度" desc="DeepSeek 的 reasoning_effort（默认 high）。思考模式下 temperature 不生效。">
                        <select className="b3-select fn__size200" value={aiPending.reasoningEffort ?? activeDef.defaultReasoningEffort ?? "high"} onChange={(e) => setAiDraft((d) => ({ ...d, reasoningEffort: e.target.value as AiReasoningEffort }))}>
                          {AI_REASONING_EFFORTS.map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </Item>
                    )}
                    {activeDef.supportsThinking && (
                      <Item itemId="ai-thinking" name="思考模式" desc="DeepSeek 的 thinking：关闭更省 token 与延迟；开启时温度不生效。">
                        <select className="b3-select fn__size200" value={aiPending.thinking ?? "enabled"} onChange={(e) => setAiDraft((d) => ({ ...d, thinking: e.target.value as AiThinkingMode }))}>
                          {AI_THINKING_MODES.map((v) => <option key={v} value={v}>{v === "enabled" ? "开启" : "关闭"}</option>)}
                        </select>
                      </Item>
                    )}
                    {(!activeDef.supportsThinking || aiPending.thinking === "disabled") && (
                      <Item itemId="ai-temperature" name="温度" desc="0 更稳定、2 更发散。">
                        <NumField label="温度" min={0} max={2} floor={0} fallback={0.7} value={aiPending.temperature} onSave={(n) => setAiDraft((d) => ({ ...d, temperature: n }))} />
                      </Item>
                    )}
                  </Section>

                  <Section title="连通性">
                    <Block itemId="ai-test" name="测试并保存" desc="保存前先发一次最小真实请求：鉴权 / 模型类错误会拦住保存；网络 / 限流可选择仍要保存。">
                      <div className="config-block__actions">
                        <button className="b3-button" disabled={aiBusy} onClick={() => void testAndSaveAi()}>{aiBusy ? "测试中…" : "测试并保存"}</button>
                        <button className="b3-button b3-button--outline" disabled={aiBusy} onClick={() => void testAi()}>仅测试</button>
                        {aiForceSave && <button className="b3-button b3-button--outline" onClick={() => void forceSaveAi()}>仍要保存</button>}
                      </div>
                      {aiErr.all && <div className="config-item__error">{aiErr.all}</div>}
                      {aiMsg && <div className="config-note">{aiMsg}</div>}
                    </Block>
                  </Section>
                </Group>
                <Group title="说明">
                  <Block name="内容只在你主动触发时外发" desc="AI 只把你要处理的文本发到上面配置的供应商；API Key 只保存在本机主进程，不参与同步、S3 与备份。" />
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
                      <Block itemId="about-app" name={`Lake Notes ${sysInfo.app.version}${sysInfo.packaged ? "" : "（开发实例）"}`} desc="本地优先 · 离线可用 · 数据保存在本机，S3 仅作云端镜像备份。" />
                      <Block itemId="about-fonts" name="字体" desc="界面与正文使用内置 MiSans（小米科技，依《MiSans 字体知识产权许可协议》免费商用；此处按协议注明使用）。代码块使用 JetBrains Mono（SIL OFL 1.1）。两者均随应用内置、离线可用。" />
                    </Group>

                    <Group title="版本与运行环境" icon={<Monitor size={16} />}>
                      <Item itemId="about-version" name="应用版本" desc={sysInfo.app.description || undefined}>
                        <span className="config-item__ctl"><code className="kv__v">v{sysInfo.app.version}</code></span>
                      </Item>
                      <Block itemId="about-runtime" name="运行时" desc="Electron 43 是 Lake 内核的原生环境（Chromium）；Node 版本决定 better-sqlite3 的 N-API 加载。">
                        <div className="kv">
                          <div className="kv__row"><span className="kv__k">Electron</span><span className="kv__v">{sysInfo.runtime.electron}</span></div>
                          <div className="kv__row"><span className="kv__k">Chromium</span><span className="kv__v">{sysInfo.runtime.chromium}</span></div>
                          <div className="kv__row"><span className="kv__k">Node</span><span className="kv__v">{sysInfo.runtime.node}</span></div>
                          <div className="kv__row"><span className="kv__k">平台</span><span className="kv__v">{sysInfo.runtime.platform} / {sysInfo.runtime.arch}</span></div>
                        </div>
                      </Block>
                      <Block itemId="about-deps" name="内核与关键依赖" desc="vendor 内核按 package.json 锁定版本，勿随意升级（lakex 闭源，只做最小 hack）。">
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
                          <span>资源 <strong>{sysInfo.storage.assetFiles}</strong> 个 · {formatBytes(sysInfo.storage.assetBytes)}</span>
                          <span>历史快照 <strong>{sysInfo.storage.historySnapshots}</strong> 份 · {formatBytes(sysInfo.storage.historyBytes)}</span>
                          <span>库文件 {formatBytes(sysInfo.storage.dbBytes)}</span>
                        </div>
                        <div className="config-stats">
                          <span>回收站节点 {sysInfo.storage.trashedNodes}</span>
                          <span>删除墓碑 {sysInfo.storage.tombstones}</span>
                          <span>孤儿登记 {sysInfo.storage.orphanRows}</span>
                        </div>
                      </Block>
                      <Item itemId="about-data-dir" name="数据目录" pathDesc desc={sysInfo.storage.root}>
                        <button className="b3-button b3-button--outline" onClick={() => revealFolder("data")}>在 Finder 中显示</button>
                      </Item>
                      <Item itemId="about-workspace-dir" name="工作空间" pathDesc desc={sysInfo.paths.workspace}>
                        <button className="b3-button b3-button--outline" onClick={() => revealFolder("workspace")}>在 Finder 中显示</button>
                      </Item>
                      <Item itemId="about-assets-dir" name="资源目录" desc="图片与附件按笔记分目录存放（note-assets/{noteId}/）。">
                        <button className="b3-button b3-button--outline" onClick={() => revealFolder("assets")}>在 Finder 中显示</button>
                      </Item>
                      <Item itemId="about-history-dir" name="历史快照目录" desc="快照与正文分离存放，恢复对应版本时从这里读。">
                        <button className="b3-button b3-button--outline" onClick={() => revealFolder("history")}>在 Finder 中显示</button>
                      </Item>
                      <Item itemId="about-logs-dir" name="日志目录" pathDesc desc={sysInfo.paths.logs}>
                        <button className="b3-button b3-button--outline" onClick={() => revealFolder("logs")}>在 Finder 中显示</button>
                      </Item>
                    </Group>

                    <Group title="诊断" icon={<Search size={16} />}>
                      <Block itemId="about-diagnostics" name="复制诊断信息" desc="把版本、运行环境、依赖与本机计数拼成一段纯文本，反馈问题时直接贴出来。">
                        <div className="config-block__actions">
                          <button className="b3-button b3-button--outline" onClick={() => void copyDiagnostics()} disabled={!sysInfo}>复制诊断信息</button>
                        </div>
                      </Block>
                      <Block itemId="about-health-entry" name="一致性检查" desc="正文文件、历史快照、孤儿登记、引用资源与目录树父子链的只读体检在「文档与历史」页运行。" />
                    </Group>

                    <Group title="第三方与许可" icon={<Info size={16} />}>
                      <Block itemId="about-siyuan-license" name="思源笔记 SiYuan" desc="界面版式与主题令牌移植自 SiYuan（AGPL-3.0，https://github.com/siyuan-note/siyuan）：组件样式见 src/b3/siyuan/，分组版式见 src/b3/siyuan/business/_config.scss，均在文件头保留署名；本项目不构成分发思源代码。" />
                      <Block itemId="about-lakex-license" name="语雀 Lake 内核" desc="Lake 内核为语雀闭源产物（随 @dlient/lakex-doc-react 的 MIT wrapper 源码一并 vendor、已 pin）；wrapper 与卡片层源码可改并保留署名，内核本体内核不修改、不再分发。" />
                      <Block itemId="about-third-party" name="开源依赖" desc="better-sqlite3 (MIT) · sharp (Apache-2.0/MIT) · @aws-sdk/client-s3 (Apache-2.0) · lucide-react (ISC) · react/react-dom (MIT) · electron-log (MIT) · Typescript (Apache-2.0) · Vite (MIT)。完整清单以 package.json 与 lockfile 为准。" />
                    </Group>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        {(syncMsg ?? diagMsg) && <p className="settings-statusbar">{syncMsg ?? diagMsg}</p>}
        <DialogResizeHandles onResize={floating.startResize} />
      </div>
    </div>
  );
}
