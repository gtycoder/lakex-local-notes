import { useEffect, useMemo, useRef, useState } from "react";
import { AlignLeft, Cloud, Files, History, Info, Keyboard, ListTree, Monitor, Moon, PanelTop, Paperclip, ScrollText, Search, Settings, Sun, Trash2, Type } from "lucide-react";
import { fontSizeOptions, type AppSettings } from "../lib/settings";
import { native } from "../lib/native";
import type { CleanOrphanResult, DataHealthReport, S3GcPendingItem, S3Settings, SyncSettings } from "../lib/types";
import type { GcDiagnostics } from "../core/gcDiagnostics";
import { gcCutoffMs, parseIsoMs, pendingKeyReason } from "../core/gcPolicy";
import { useFloatingDialog } from "./useFloatingDialog";
import { filterSettingsNav } from "./settingsSearch";
import { getNativeErrorMessage } from "../lib/nativeErrors";

export type SettingsCategory = "editor" | "appearance" | "shortcuts" | "history" | "sync" | "resources" | "trash" | "logs" | "about";

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

export function SettingsPanel({ open, settings, onClose, onChange, openCategory = "editor", onS3SettingsChanged, onSyncSettingsChanged }: SettingsPanelProps) {
  const [category, setCategory] = useState<SettingsCategory>(openCategory);
  const [navQuery, setNavQuery] = useState("");
  const navSearchRef = useRef<HTMLInputElement>(null);
  const floating = useFloatingDialog({ initialSize: { w: 840, h: 600 }, minSize: { w: 620, h: 420 } });

  const [stats, setStats] = useState<{ snapshotCount: number; totalBytes: number } | null>(null);
  const [histCfg, setHistCfg] = useState<{ maxSnapshots: number; retentionDays: number; cleanupIntervalHours: number; snapshotIntervalMinutes: number } | null>(null);
  const [histMsg, setHistMsg] = useState<string | null>(null);
  const [histBusy, setHistBusy] = useState(false);
  const [lastCleanup, setLastCleanup] = useState<{ at: string; deletedSnapshots: number; freedBytes: number } | null>(null);
  // A3 数据体检：只读三查报告
  const [health, setHealth] = useState<DataHealthReport | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  // F1 日志查看
  const [logRows, setLogRows] = useState<Array<{ line: string; hit: boolean }>>([]);
  const [logKeyword, setLogKeyword] = useState("");
  const [logBusy, setLogBusy] = useState(false);
  const [logInfo, setLogInfo] = useState<string | null>(null);

  const [s3, setS3] = useState<S3Settings>(S3_DEFAULTS);
  const [gcCfg, setGcCfg] = useState<{ gcRetentionDays: number; gcIntervalHours: number; trashAutoPurgeDays: number } | null>(null);
  const [gcPending, setGcPending] = useState<number>(0);
  const [gcLog, setGcLog] = useState<Array<{ id: number; ts: string; action: string; key: string; reason: string; ok: boolean }>>([]);
  const [gcBusy, setGcBusy] = useState(false);
  const [gcDiag, setGcDiag] = useState<GcDiagnostics | null>(null);
  const [gcDiagBusy, setGcDiagBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncCfg, setSyncCfg] = useState<SyncSettings | null>(null);
  const [syncCfgBusy, setSyncCfgBusy] = useState(false);
  const [gcPendingRows, setGcPendingRows] = useState<S3GcPendingItem[]>([]);
  const [orphans, setOrphans] = useState<RemovedAsset[]>([]);
  const [orphanBusy, setOrphanBusy] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [sel, setSel] = useState<RemovedAsset | null>(null);
  const [pv, setPv] = useState<{ filename: string; mimeType: string; supported: boolean; dataUrl?: string } | null>(null);

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
    void native.getHistoryStats().then(setStats).catch(() => undefined);
    void native.getHistorySettings().then(setHistCfg).catch(() => undefined);
    void native.getLastHistoryCleanup().then(setLastCleanup).catch(() => undefined);
    void native.getS3Settings().then((v) => v && setS3(v)).catch(() => undefined);
    void native.getS3GcSettings().then(setGcCfg).catch(() => undefined);
    void native.getSyncSettings().then(setSyncCfg).catch(() => undefined);
    void refreshGcPending();
    void native.listS3GcLog().then(setGcLog).catch(() => undefined);
  }, [open, openCategory]);

  useEffect(() => {
    if (open && category === "resources") void refreshOrphans();
  }, [open, category]);

  // 选中即预览、切换自动加载（思源式资源管理交互）
  useEffect(() => {
    if (!sel) { setPv(null); return; }
    let alive = true;
    setPv(null);
    native.readAssetPreview(sel.noteId, sel.filename)
      .then((r) => { if (alive) setPv(r); })
      .catch(() => { if (alive) setPv({ filename: sel.filename, mimeType: "", supported: false }); });
    return () => { alive = false; };
  }, [sel]);

  const nav = [
    { id: "editor" as const, label: "编辑器", keywords: "字号 段间距 大纲 工具栏 标签页" , icon: <Type size={15} /> },
    { id: "appearance" as const, label: "外观", keywords: "浅色 深色 主题", icon: <Monitor size={15} /> },
    { id: "shortcuts" as const, label: "快捷键", keywords: "快捷键 搜索 专注模式 键盘", icon: <Keyboard size={15} /> },
    { id: "history" as const, label: "文档与历史", keywords: "快照 保留 清理", icon: <History size={15} /> },
    { id: "sync" as const, label: "云端与同步", keywords: "S3 上传 下载 资源 云端 回收", icon: <Cloud size={15} /> },
    { id: "resources" as const, label: "资源", keywords: "资源 未引用 孤儿 清理 附件 图片", icon: <Paperclip size={15} /> },
    { id: "trash" as const, label: "回收站", keywords: "删除 恢复 清空", icon: <Trash2 size={15} /> },
    { id: "logs" as const, label: "日志", keywords: "日志 诊断 GC 同步 调试", icon: <ScrollText size={15} /> },
    { id: "about" as const, label: "关于", keywords: "版本", icon: <Info size={15} /> },
  ];
  const visibleNav = filterSettingsNav(nav, navQuery);
  useEffect(() => {
    if (!navQuery.trim() || visibleNav.length !== 1 || visibleNav[0].id === category) return;
    setCategory(visibleNav[0].id);
  }, [navQuery, category, visibleNav.map((item) => item.id).join("|")]);


  if (!open) return null;

  const saveHistCfg = (patch: Partial<NonNullable<typeof histCfg>>) => {
    if (!histCfg) return;
    const next = { ...histCfg, ...patch };
    setHistCfg(next);
    void native.saveHistorySettings(next).catch(() => undefined);
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
      const saved = await native.saveSyncSettings(next);
      setSyncCfg(saved);
      onSyncSettingsChanged?.(saved);
      setSyncMsg(saved.enabled ? "同步策略已保存" : "云同步已关闭（已完成最后一次对齐）");
    } catch (e) {
      setSyncMsg(getNativeErrorMessage(e));
      void native.getSyncSettings().then(setSyncCfg).catch(() => undefined);
    } finally {
      setSyncCfgBusy(false);
    }
  };

  const saveGcCfg = (patch: Partial<NonNullable<typeof gcCfg>>) => {
    if (!gcCfg) return;
    const next = { ...gcCfg, ...patch };
    setGcCfg(next);
    void native.saveS3GcSettings(next).catch(() => undefined);
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

  return (
    <div className="settings-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !floating.interactionRef.current) onClose(); }}>
      <div ref={floating.panelRef} className="floating-dialog settings-panel settings-panel-large" style={floating.panelStyle} role="dialog" aria-modal="true" aria-labelledby="settings-panel-title" onClick={(e) => e.stopPropagation()}>
        <header id="settings-panel-title" className="settings-header floating-dialog-header" onPointerDown={floating.startDrag}>
          <Settings size={16} />
          <span>偏好设置</span>
          <button className="settings-close" onClick={onClose} aria-label="关闭">✕</button>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav">
            <label className="settings-nav-search"><Search size={14} /><input ref={navSearchRef} value={navQuery} onChange={(event) => setNavQuery(event.target.value)} placeholder="搜索设置" aria-label="搜索设置" /></label>
            {visibleNav.map((item) => (
              <button key={item.id} className={`settings-nav-item ${category === item.id ? "active" : ""}`} onClick={() => setCategory(item.id)}>
                {item.icon}<span>{item.label}</span>
              </button>
            ))}
            {visibleNav.length === 0 && <span className="settings-nav-empty">没有匹配的设置</span>}
          </nav>
          <div className="settings-content">
            {category === "editor" && (
              <>
                <section className="settings-group">
                  <h4><Type size={13} /> 正文字号</h4>
                  <div className="settings-row">
                    {fontSizeOptions().map((fs) => (
                      <button key={fs} className={`settings-choice ${settings.fontSize === fs ? "active" : ""}`} onClick={() => onChange({ fontSize: fs })}>{fs}</button>
                    ))}
                  </div>
                </section>
                <section className="settings-group">
                  <h4>编辑器显示</h4>
                  <label className="settings-toggle"><AlignLeft size={13} /><span>段间距（更宽松的段落留白）</span><input type="checkbox" checked={settings.paragraphSpacing} onChange={(e) => onChange({ paragraphSpacing: e.target.checked })} /></label>
                  <label className="settings-toggle"><ListTree size={13} /><span>显示文档大纲（TOC）</span><input type="checkbox" checked={settings.showToc} onChange={(e) => onChange({ showToc: e.target.checked })} /></label>
                  <label className="settings-toggle"><PanelTop size={13} /><span>显示编辑器工具栏</span><input type="checkbox" checked={settings.showToolbar} onChange={(e) => onChange({ showToolbar: e.target.checked })} /></label>
                </section>
                <section className="settings-group">
                  <h4><Files size={13} /> 标签页</h4>
                  <div className="settings-row">
                    <div className="settings-field">
                      <span>最大同时打开标签数</span>
                      <select value={settings.maxOpenTabs} onChange={(e) => onChange({ maxOpenTabs: Number(e.target.value) })} aria-label="最大同时打开标签数">
                        <option value={0}>不限</option>
                        <option value={4}>4 个</option>
                        <option value={6}>6 个</option>
                        <option value={8}>8 个</option>
                        <option value={12}>12 个</option>
                        <option value={16}>16 个</option>
                        <option value={24}>24 个</option>
                      </select>
                    </div>
                  </div>
                  <p className="settings-hint">超过上限时自动关闭最旧的标签（当前编辑的标签与钉住的标签除外），未保存内容会自动保存。</p>
                </section>
                <section className="settings-group">
                  <h4><Paperclip size={13} /> 附件</h4>
                  <div className="settings-row">
                    <div className="settings-field">
                      <span>附件大小上限</span>
                      <select value={settings.maxAttachmentBytes / (1024 * 1024)} onChange={(e) => onChange({ maxAttachmentBytes: Number(e.target.value) * 1024 * 1024 })} aria-label="附件大小上限">
                        <option value={25}>25 MiB</option>
                        <option value={50}>50 MiB</option>
                        <option value={100}>100 MiB</option>
                      </select>
                    </div>
                  </div>
                  <p className="settings-hint">插入附件时的本机上限；同步/下载使用协议上限（100 MiB），其他设备配置不同不影响接收。</p>
                </section>
              </>
            )}

            {category === "appearance" && (
              <>
                <section className="settings-group">
                  <h4><Monitor size={13} /> 主题</h4>
                  <div className="settings-row">
                    <button className={`settings-choice ${settings.theme === "light" ? "active" : ""}`} onClick={() => onChange({ theme: "light" })}><Sun size={13} /> 浅色（思源 daylight）</button>
                    <button className={`settings-choice ${settings.theme === "dark" ? "active" : ""}`} onClick={() => onChange({ theme: "dark" })}><Moon size={13} /> 深色（思源 midnight）</button>
                  </div>
                </section>

              </>
            )}

            {category === "shortcuts" && (
              <>
                <section className="settings-group">
                  <h4><Keyboard size={13} /> 快捷键</h4>
                  <p className="settings-hint">当前版本先展示固定快捷键，暂不支持自定义。</p>
                  <div className="shortcut-list" aria-label="快捷键列表">
                    <div className="shortcut-row"><kbd>⌘K</kbd><span>打开全局搜索（标题和正文）</span></div>
                    <div className="shortcut-row"><kbd>⌘⇧Enter</kbd><span>进入或退出专注模式</span></div>
                    <div className="shortcut-row"><kbd>↑ / ↓</kbd><span>在搜索结果中移动</span></div>
                    <div className="shortcut-row"><kbd>Enter</kbd><span>打开搜索结果并定位命中</span></div>
                    <div className="shortcut-row"><kbd>⌘Enter</kbd><span>在新标签打开并定位命中</span></div>
                    <div className="shortcut-row"><kbd>Esc</kbd><span>关闭当前菜单或浮层</span></div>
                  </div>
                </section>
              </>
            )}

            {category === "history" && (
              <>
                <section className="settings-group">
                  <h4><History size={13} /> 文档历史</h4>
                  <div className="settings-row" style={{ alignItems: "center", gap: 8, fontSize: 12, color: "#48515c" }}>
                    <span>历史快照：{stats ? `${stats.snapshotCount} 份 · ${formatBytes(stats.totalBytes)}` : "…"}</span>
                    <button className="settings-choice" onClick={() => void runCleanup()} disabled={histBusy}><Trash2 size={12} /> {histBusy ? "清理中…" : "立即清理"}</button>
                  </div>
                  {histMsg && <p className="settings-hint">{histMsg}</p>}
                  {lastCleanup && (
                    <p className="settings-hint">上次清理：{formatDateTime(Date.parse(lastCleanup.at))} · {lastCleanup.deletedSnapshots} 份 · {formatBytes(lastCleanup.freedBytes)}</p>
                  )}
                  {histCfg && (
                    <>
                      <div className="settings-field"><span>每文档上限</span><input type="number" min={20} max={1000} value={histCfg.maxSnapshots} onChange={(e) => saveHistCfg({ maxSnapshots: Math.max(1, Number(e.target.value) || 100) })} /></div>
                      <div className="settings-field"><span>保留天数</span><input type="number" min={1} max={365} value={histCfg.retentionDays} onChange={(e) => saveHistCfg({ retentionDays: Math.max(1, Number(e.target.value) || 30) })} /></div>
                      <div className="settings-field"><span>定期清理（小时）</span><input type="number" min={0} max={720} value={histCfg.cleanupIntervalHours} onChange={(e) => saveHistCfg({ cleanupIntervalHours: Math.max(0, Number(e.target.value) || 24) })} /></div>
                      <div className="settings-field"><span>自动快照（分钟）</span><input type="number" min={0} max={1440} value={histCfg.snapshotIntervalMinutes} onChange={(e) => saveHistCfg({ snapshotIntervalMinutes: Math.max(0, Number(e.target.value) || 15) })} /></div>
                    </>
                  )}
                  <p className="settings-hint">历史快照保存在本机，不参与同步。保留策略修改即时生效。</p>
                </section>
                <section className="settings-group">
                  <h4><Info size={13} /> 数据体检（只读诊断）</h4>
                  <div className="settings-row" style={{ alignItems: "center", gap: 8, fontSize: 12, color: "#48515c" }}>
                    <button className="settings-choice" onClick={() => void runHealth()} disabled={healthBusy}><Search size={12} /> {healthBusy ? "检查中…" : "运行检查"}</button>
                    {health && healthBusy === false && (
                      <span>
                        笔记 {health.notesChecked} · 快照 {health.historyChecked} · 孤儿登记 {health.orphanRowsChecked}
                      </span>
                    )}
                  </div>
                  {health && (
                    <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.7 }}>
                      {health.notesMissingFile.length === 0 && health.notesHashMismatch.length === 0 && health.historyMissingFile === 0 && health.orphanRowsFileMissing.length === 0 ? (
                        <p className="settings-hint" style={{ color: "#15803d" }}>✓ 全部自洽：正文文件、历史快照、孤儿登记均与数据库一致。</p>
                      ) : (
                        <>
                          {health.notesMissingFile.length > 0 && <p className="settings-hint" style={{ color: "#b91c1c" }}>✗ {health.notesMissingFile.length} 篇笔记正文文件缺失（首 3：{health.notesMissingFile.slice(0, 3).map((n) => n.title).join("、")}）</p>}
                          {health.notesHashMismatch.length > 0 && <p className="settings-hint" style={{ color: "#b91c1c" }}>✗ {health.notesHashMismatch.length} 篇正文与基线哈希不符（可能被外部改动）</p>}
                          {health.historyMissingFile > 0 && <p className="settings-hint" style={{ color: "#b45309" }}>✗ {health.historyMissingFile} 份历史快照文件缺失（恢复对应版本时会失败）</p>}
                          {health.orphanRowsFileMissing.length > 0 && <p className="settings-hint" style={{ color: "#b45309" }}>✗ {health.orphanRowsFileMissing.length} 条孤儿登记文件缺失（登记漂移）</p>}
                        </>
                      )}
                      <p className="settings-hint">生成于 {formatDateTime(Date.parse(health.checkedAt))}。本检查只读、不修复；发现问题请从备份/云端恢复对应文件。</p>
                    </div>
                  )}
                </section>
              </>
            )}

            {category === "sync" && (
              <>
                <section className="settings-group">
                  <h4><Cloud size={13} /> 同步策略（仅保存在当前设备）</h4>
                  {syncCfg && (
                    <>
                      <label className="settings-toggle">
                        <input type="checkbox" checked={syncCfg.enabled} disabled={syncCfgBusy} onChange={(e) => void saveSyncCfg({ enabled: e.target.checked })} />
                        <span>启用云同步</span>
                      </label>
                      {syncCfg.enabled && (
                        <>
                          <div className="settings-field">
                            <span>自动同步模式</span>
                            <select value={syncCfg.autoMode} onChange={(e) => void saveSyncCfg({ autoMode: e.target.value as SyncSettings["autoMode"] })}>
                              <option value="manual">完全手动</option>
                              <option value="interval">按固定间隔自动同步</option>
                              <option value="onOpenClose">仅在开启/关闭时同步</option>
                            </select>
                          </div>
                          {syncCfg.autoMode === "interval" && (
                            <div className="settings-field"><span>自动同步间隔（分钟）</span><input type="number" min={1} max={1440} value={syncCfg.autoIntervalMinutes} onChange={(e) => void saveSyncCfg({ autoIntervalMinutes: Math.max(1, Number(e.target.value) || 15) })} /></div>
                          )}
                        </>
                      )}
                      <p className="settings-hint">S3 配置与同步策略均为本机配置，不会上传云端；A 端关闭不影响 B 端。</p>
                    </>
                  )}
                </section>
                <section className="settings-group">
                  <h4><Cloud size={13} /> S3 连接（凭据仅保存在当前设备）</h4>
                  <div className="settings-field"><span>Endpoint</span><input type="text" value={s3.endpoint} placeholder="https://s3-cn-east-1.qiniucs.com" onChange={(e) => setS3Field("endpoint", e.target.value)} /></div>
                  <div className="settings-field"><span>Access Key</span><input type="text" value={s3.accessKeyId} onChange={(e) => setS3Field("accessKeyId", e.target.value)} /></div>
                  <div className="settings-field"><span>Secret Key</span><input type="password" value={s3.secretAccessKey} placeholder="留空或保持 ******** 表示沿用已保存密钥" onChange={(e) => setS3Field("secretAccessKey", e.target.value)} /></div>
                  <div className="settings-field"><span>Bucket</span><input type="text" value={s3.bucket} onChange={(e) => setS3Field("bucket", e.target.value)} /></div>
                  <div className="settings-field"><span>Region</span><input type="text" value={s3.region} onChange={(e) => setS3Field("region", e.target.value)} /></div>
                  <div className="settings-field"><span>对象前缀</span><input type="text" value={s3.prefix} onChange={(e) => setS3Field("prefix", e.target.value)} /></div>
                  <label className="settings-toggle"><input type="checkbox" checked={s3.forcePathStyle} onChange={(e) => setS3Field("forcePathStyle", e.target.checked)} /><span>使用 Path-style URL</span></label>
                  <div className="settings-row" style={{ gap: 6 }}>
                    <button className="settings-choice" onClick={() => void testS3()}>测试连接</button>
                    <button className="settings-choice" onClick={() => void saveS3()}>保存配置</button>
                  </div>
                </section>
                <section className="settings-group">
                  <h4><Trash2 size={13} /> 云端回收（S3 GC）</h4>
                  <div style={{ display: "flex", flexWrap: "wrap", columnGap: 14, rowGap: 4, alignItems: "baseline", fontSize: 12, color: "#48515c" }}>
                    <span><strong>待回收键 {gcPending} 个</strong></span>
                    <span>可删 {gcSummary.due}</span>
                    <span>窗口内 {gcSummary.inWindow}{gcSummary.earliest !== null ? " · 最早 " + formatDateTime(gcSummary.earliest) + " 到期" : ""}</span>
                    {gcSummary.unknown > 0 && <span>时间未知 {gcSummary.unknown}</span>}
                  </div>
                  <div className="settings-row" style={{ gap: 6, marginTop: 8 }}>
                    <button className="settings-choice" onClick={() => void runReconcile()} disabled={gcBusy}><Trash2 size={12} /> {gcBusy ? "处理中…" : "立即对账"}</button>
                    <button className="settings-choice" onClick={() => void runGcAction(true)} disabled={gcBusy}>深度清理预览</button>
                    <button className="settings-choice" onClick={() => void runGcAction(false)} disabled={gcBusy}>执行深度清理</button>
                  </div>
                  <p className="settings-hint">手动按钮会立即删除当前未被清单/历史引用的云端对象；自动对账按回收窗口到期后定期清理。结果偏少通常是被引用保护，不是漏删。</p>
                  <div className="settings-row" style={{ gap: 6, marginTop: 6 }}>
                    <button className="settings-choice" onClick={() => void refreshCloudStats()} disabled={gcBusy || gcDiagBusy}>{gcDiagBusy ? "统计中…" : "刷新云端统计"}</button>
                    {gcDiagBusy && <span style={{ fontSize: 12, color: "#6b7280" }}>正在拉取云端清单…</span>}
                  </div>
                  {gcDiag && (
                    <p className="settings-hint" style={{ marginTop: 6, lineHeight: 1.7 }}>
                      云端占用：{gcDiag.cloud.objects} 个对象 / {formatBytes(gcDiag.cloud.bytes)}
                      （正文 {diagNs("objects")?.cloudObjects ?? 0} 个 · 资源 {diagNs("assets")?.cloudObjects ?? 0} 个 · 清单 {diagNs("manifests")?.cloudObjects ?? 0} 个 · 小记 {diagNs("quick-notes")?.cloudObjects ?? 0} 个）
                      未引用 {gcDiag.cloud.unreferenced} 个 · 已到期可回收 {gcDiag.cloud.due} 个 · 窗口内 {gcDiag.cloud.inWindow} 个
                      （生成于 {formatDateTime(Date.parse(gcDiag.generatedAt))}）
                    </p>
                  )}
                  {gcCfg && (
                    <>
                      <div className="settings-field"><span>回收窗口（天）</span><input type="number" min={0} max={90} value={gcCfg.gcRetentionDays} onChange={(e) => saveGcCfg({ gcRetentionDays: Math.max(0, Number(e.target.value) || 7) })} /></div>
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: -4, marginBottom: 6 }}>对象被替换/移除后的保护期；0 = 立即到期</div>
                      <div className="settings-field"><span>自动对账周期（小时）</span><input type="number" min={0} max={720} value={gcCfg.gcIntervalHours} onChange={(e) => saveGcCfg({ gcIntervalHours: Math.max(0, Number(e.target.value) || 24) })} /></div>
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: -4 }}>自动清理频率；0 = 仅手动</div>
                    </>
                  )}
                  <p className="settings-hint">云端只是镜像：删除云端冗余不影响本地正文/回收站/历史快照（“彻底删除/清空回收站”除外）。</p>
                  {gcPendingRows.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      <p className="settings-hint" style={{ fontWeight: 600, margin: "6px 0 2px" }}>待回收键明细（{gcPendingRows.length} 条）</p>
                      <div className="settings-hint" style={{ maxHeight: 140, overflow: "auto", fontSize: 11, lineHeight: 1.7 }}>
                        {gcPendingRows.slice().sort((a, b) => {
                          const am = parseIsoMs(a.markedAt) ?? Infinity;
                          const bm = parseIsoMs(b.markedAt) ?? Infinity;
                          return am - bm;
                        }).map((row) => (
                          <div key={row.key} title={row.markedAt}>
                            <span style={{ color: "#6b7280" }}>{row.markedAt.slice(0, 10)}</span> [{pendingKeyReason(row.key)}] <span style={{ wordBreak: "break-all" }}>{row.key}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="settings-hint" style={{ fontWeight: 600, margin: "8px 0 2px" }}>删除记录（最近 {gcLog.length > 0 ? Math.min(gcLog.length, 30) : 0} 条 · 只读审计）</p>
                  {gcLog.length > 0 ? (
                    <div className="settings-hint" style={{ maxHeight: 150, overflow: "auto", fontFamily: "monospace", fontSize: 11, lineHeight: 1.7 }}>
                      {gcLog.slice(0, 30).map((l) => <div key={l.id}>{l.ts.slice(0, 19)}&nbsp;[{l.action} · {l.reason}] {l.key}</div>)}
                    </div>
                  ) : (
                    <p className="settings-hint">（暂无删除记录）</p>
                  )}
                </section>
              </>
            )}

            {category === "resources" && (
              <>
              <section className="settings-group">
                <h4><Paperclip size={13} /> 未引用资源（本地）</h4>
                <p className="settings-hint">
                  汇总所有文档中“当前正文不再引用”的本地资产文件：<strong>未引用</strong>（可删除/复制/打开位置）
                  与 <strong>历史保护</strong>（仍被历史快照引用，仅查看不可删除）。点击条目即预览并自动切换；
                  文档在回收站时文件仍列出，彻底删除时随 purge 一并清理。
                </p>
                <div className="settings-row" style={{ flexWrap: "wrap", rowGap: 6, gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#48515c" }}>
                    共 <strong>{orphans.length}</strong> 个 · {formatBytes(orphans.reduce((s, o) => s + (o.size || 0), 0))} ·
                    可删 {orphans.filter((o) => o.status === "orphan").length} · 历史保护 {orphans.filter((o) => o.status === "history").length} · 涉及 {groupedOrphans.length} 篇文档
                  </span>
                  <span style={{ flex: 1 }} />
                  <button className="settings-choice" onClick={() => void refreshOrphans()}>刷新</button>
                  <button className="settings-choice" onClick={() => void cleanOrphans()} disabled={orphanBusy || orphans.filter((o) => o.status === "orphan").length === 0}>{orphanBusy ? "清理中…" : `清理未引用（${orphans.filter((o) => o.status === "orphan").length}）`}</button>
                </div>
                {orphans.length === 0 ? (
                  <p className="settings-hint" style={{ marginTop: 8 }}>没有被移除的资源文件。</p>
                ) : (
                  <div style={{ display: "flex", gap: 12, marginTop: 8, alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0, maxHeight: 360, overflow: "auto", paddingRight: 4 }}>
                      {groupedOrphans.map((g) => (
                        <div key={g.title + "|" + g.state} style={{ marginBottom: 8 }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 13, fontWeight: 600, marginBottom: 3 }}>
                            <Paperclip size={13} />
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{g.title}</span>
                            {g.state === "trash" && <span style={{ fontSize: 11, color: "#b45309" }}>回收站</span>}
                            {g.state === "missing" && <span style={{ fontSize: 11, color: "#b91c1c" }}>文档已删除</span>}
                            <span style={{ fontSize: 11, color: "#6b7280", fontWeight: 400 }}>{g.items.length} 个</span>
                          </div>
                          {g.items.map((o) => (
                            <div
                              key={o.noteId + "/" + o.filename}
                              onClick={() => setSel(sel && sel.noteId === o.noteId && sel.filename === o.filename ? null : o)}
                              title="点击预览"
                              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "4px 6px", borderRadius: 6, cursor: "pointer", marginBottom: 2, background: sel && sel.noteId === o.noteId && sel.filename === o.filename ? "rgba(59,130,246,0.14)" : "rgba(127,127,127,0.07)" }}
                            >
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }} title={o.filename}>{o.filename}</span>
                              {o.status === "history"
                                ? <span style={{ color: "#b45309", whiteSpace: "nowrap" }}>历史保护</span>
                                : <span style={{ color: "#6b7280", whiteSpace: "nowrap" }}>未引用</span>}
                              <span style={{ color: "#6b7280", whiteSpace: "nowrap" }}>{formatBytes(o.size)}</span>
                              <span style={{ display: "inline-flex", gap: 4 }}>
                                <button className="settings-choice" style={{ padding: "0 6px" }} title="复制路径" onClick={(ev) => { ev.stopPropagation(); void copyPath(o); }}>复制</button>
                                <button className="settings-choice" style={{ padding: "0 6px" }} title="在文件夹中显示" onClick={(ev) => { ev.stopPropagation(); void openFolder(o); }}>位置</button>
                                {o.orphanId != null && (
                                  <button className="settings-choice" style={{ padding: "0 6px" }} title="删除（不可撤销）" onClick={(ev) => { ev.stopPropagation(); void deleteOne(o); }} disabled={busyId !== null}>{busyId === o.orphanId ? "…" : "删除"}</button>
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div style={{ width: 320, flexShrink: 0, border: "1px solid rgba(127,127,127,0.25)", borderRadius: 8, padding: 10, minHeight: 180, maxHeight: 360, overflow: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                      {!sel ? (
                        <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>点击左侧条目预览</p>
                      ) : pv == null ? (
                        <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>加载中…</p>
                      ) : pv.supported && pv.dataUrl ? (
                        <>
                          <img src={pv.dataUrl} alt={pv.filename} style={{ maxWidth: "100%", maxHeight: 260, objectFit: "contain", alignSelf: "center" }} />
                          <div style={{ fontSize: 12, wordBreak: "break-all" }}>{pv.filename}<span style={{ color: "#6b7280" }}> · {pv.mimeType || sel.mimeType}</span></div>
                        </>
                      ) : (
                        <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>该类型不支持预览。<br />{sel.filename}</p>
                      )}
                    </div>
                  </div>
                )}
              </section>
              </>
            )}
            {category === "trash" && (
              <section className="settings-group">
                <h4><Trash2 size={13} /> 回收站</h4>
                {gcCfg && (
                  <div className="settings-field"><span>回收站自动过期（天，0=关闭）</span><input type="number" min={0} max={365} value={gcCfg.trashAutoPurgeDays} onChange={(e) => saveGcCfg({ trashAutoPurgeDays: Math.max(0, Number(e.target.value) || 0) })} /></div>
                )}
                <p className="settings-hint">回收站内容仅保存在本机；彻底删除会同时删除云端数据且不可撤销。</p>
              </section>
            )}

            {category === "logs" && (
              <section className="settings-group">
                <h4><ScrollText size={13} /> 应用日志（只读）</h4>
                <p className="settings-hint">主进程日志（GC / 同步 / 回收站 / 历史清理）位于 userData/logs/lake-notes.log。按关键字过滤，每条命中附带前后一行上下文。</p>
                <div className="settings-row" style={{ gap: 6 }}>
                  <input
                    type="text"
                    style={{ flex: 1, minWidth: 0, height: 30, padding: "0 8px", border: "1px solid var(--lake-border)", borderRadius: 6, outline: "none", fontSize: 12 }}
                    value={logKeyword}
                    onChange={(e) => setLogKeyword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void runLogLoad(logKeyword); }}
                    placeholder="过滤（如 GC / sync / trash / purge / snapshot）"
                  />
                  <button className="settings-choice" onClick={() => void runLogLoad(logKeyword)} disabled={logBusy}><Search size={12} /> {logBusy ? "读取中…" : "读取"}</button>
                </div>
                {logInfo && <p className="settings-hint">{logInfo}</p>}
                {logRows.length > 0 ? (
                  <div className="settings-hint" style={{ maxHeight: 280, overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, lineHeight: 1.6, marginTop: 6 }}>
                    {logRows.map((row, i) => (
                      <div key={i} style={row.hit ? { color: "#b45309" } : { color: "#6b7280" }}>{row.line}</div>
                    ))}
                  </div>
                ) : (
                  !logBusy && <p className="settings-hint">（尚无日志或未读取）</p>
                )}
              </section>
            )}

            {category === "about" && (
              <section className="settings-group">
                <h4><Info size={13} /> 关于</h4>
                <p className="settings-hint">Lake Notes：本地优先的笔记应用。数据保存在本机，S3 仅作云端镜像备份。</p>
              </section>
            )}
          </div>
        </div>
        {syncMsg && <p className="settings-hint" style={{ padding: "0 16px 10px" }}>{syncMsg}</p>}
        <div className="floating-dialog-resize" onPointerDown={floating.startResize} title="拖动调整大小" />
      </div>
    </div>
  );
}
