/** 移动端设置页（§6：同步设置 S3 / 清理缓存 / 回收站 / 关于）。
 * 版式：竖向菜单列表（设置项一行一行），点某项进入新页面（带返回）；子页内容用 .config-* + .b3-* 骨架（AGENTS §3.14）。
 * 注意：全部 App 设置为竖向（无横向 tab）；「回收站」并入总回收站（见 TrashList）。 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, Cloud, HardDrive, History, Images, Info, List, Palette, Pencil, RefreshCw, Trash } from "lucide-react";
import { loadSettings, saveSettings, fontSizeOptions, MAX_ATTACHMENT_MB_OPTIONS_SETTINGS, type AppSettings } from "../../lib/settings";
import { Group, Item, Switch, Seg, Block, NumField } from "../../components/settingsPrimitives";
import { bridge } from "../bridge";
import { usePanelDrag } from "../usePanelDrag";
import type { HistoryMobileSettings } from "../bridge";
import { mobileCachePort } from "../cachePort";
import { mobileAppInfoPort } from "../appInfoPort";
import { TrashList } from "./TrashList";
import { TrashPreviewPage } from "../trash/TrashPreviewPage";
import type { AppInfo } from "../../core/ports";
import type { S3Settings } from "../../lib/types";

export interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

type View = "menu" | "editor" | "appearance" | "history" | "resources" | "s3" | "cache" | "trash" | "about";

const MENU: { key: Exclude<View, "menu">; label: string; icon: typeof Cloud }[] = [
  { key: "editor", label: "编辑器", icon: List },
  { key: "appearance", label: "外观", icon: Palette },
  { key: "history", label: "历史", icon: History },
  { key: "resources", label: "资源管理", icon: Images },
  { key: "s3", label: "同步设置", icon: Cloud },
  { key: "cache", label: "清理缓存", icon: HardDrive },
  { key: "trash", label: "回收站", icon: Trash },
  { key: "about", label: "关于", icon: Info },
];

const MENU_LABEL = (key: Exclude<View, "menu">) => MENU.find((m) => m.key === key)?.label ?? "";

/** 对齐桌面 registerSync 的 S3_SECRET_MASK：get 不回显明文，保存时掩码则保留旧值。 */
const S3_SECRET_MASK = "********";

function formatBytes(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

export function SettingsDrawer(props: SettingsDrawerProps) {
  const { open, onClose, onRefresh } = props;
  const [view, setView] = useState<View>("menu");
  const [previewNoteId, setPreviewNoteId] = useState<string | null>(null);
  const [listKey, setListKey] = useState(0);
  const [s3, setS3] = useState<S3Settings | null>(null);
  const [s3Test, setS3Test] = useState("");
  const [syncMsg, setSyncMsg] = useState("");
  const [cacheMsg, setCacheMsg] = useState("");
  const [cacheSummary, setCacheSummary] = useState<import("../../core/ports").CacheSummary | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [diag, setDiag] = useState<{ noteCount: number; folderCount: number; quickNoteCount: number; resourceCount: number; orphanCount: number; gcPendingCount: number; snapshotCount: number; dbBytes: number } | null>(null);
  const [orphans, setOrphans] = useState<Array<{ id: number; noteId: string; filename: string; size: number; mimeType: string }>>([]);
  const [orphanBusy, setOrphanBusy] = useState(false);
  const [gcMsg, setGcMsg] = useState("");
  const [hist, setHist] = useState<HistoryMobileSettings | null>(null);

  const updateHist = (patch: Partial<HistoryMobileSettings>) => {
    if (!hist) return;
    const next = { ...hist, ...patch };
    setHist(next);
    void bridge.saveHistorySettings(next);
  };

  useEffect(() => {
    if (!open || view !== "resources") return;
    void bridge.listOrphanAssets().then((rows) => setOrphans(rows)).catch(() => setOrphans([]));
  }, [open, view]);

  useEffect(() => {
    if (!open || view !== "history") return;
    void bridge.getHistorySettings().then((h) => setHist(h));
  }, [open, view]);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const update = (patch: Partial<AppSettings>) => setSettings(saveSettings(patch));

  useEffect(() => {
    if (!open || view !== "about") return;
    void mobileAppInfoPort.getAppInfo().then(setAppInfo).catch(() => undefined);
    void bridge.getDiagnostics().then(setDiag).catch(() => undefined);
  }, [open, view]);

  useEffect(() => {
    if (!open || view !== "cache") return;
    void mobileCachePort.getCacheSummary().then(setCacheSummary).catch(() => undefined);
  }, [open, view]);

  // S3 表单：复用共享 S3Settings（prefix 参与透传）
  const [endpoint, setEndpoint] = useState(s3?.endpoint ?? "https://s3.cn-north-1.qiniucs.com");
  const [region, setRegion] = useState(s3?.region ?? "cn-north-1");
  const [bucket, setBucket] = useState(s3?.bucket ?? "");
  const [prefix, setPrefix] = useState(s3?.prefix ?? "lake-notes");
  const [ak, setAk] = useState(s3?.accessKeyId ?? "");
  // Secret 不显示明文（§6.2）：初始与回显都用掩码；未修改时保存保留旧值
  const [sk, setSk] = useState(S3_SECRET_MASK);

  useEffect(() => {
    if (!open) return;
    void bridge.getS3Settings().then((cfg) => {
      setS3(cfg);
      if (cfg) {
        setEndpoint(cfg.endpoint); setRegion(cfg.region); setBucket(cfg.bucket);
        setPrefix(cfg.prefix); setAk(cfg.accessKeyId); setSk(S3_SECRET_MASK);
      }
    }).catch(() => undefined);
  }, [open]);

  const saveS3 = useCallback(async () => {
    const prev = await bridge.getS3Settings().catch(() => null);
    const secret = sk === S3_SECRET_MASK ? (prev?.secretAccessKey ?? "") : sk;
    const cfg: S3Settings = { endpoint, region, bucket, prefix, accessKeyId: ak, secretAccessKey: secret, forcePathStyle: false };
    await bridge.saveS3Settings(cfg);
    setS3(cfg);
    setS3Test("已保存");
  }, [endpoint, region, bucket, prefix, ak, sk]);

  const testS3 = useCallback(async () => {
    await saveS3();
    setS3Test("测试中…");
    setS3Test(await bridge.testS3Connection());
  }, [saveS3]);

  const runSync = useCallback(async () => {
    setSyncMsg("同步中…");
    try {
      const result = await bridge.syncNow();
      setSyncMsg(result.message);
      await onRefresh();
    } catch (e) {
      setSyncMsg("同步失败: " + (e as Error).message);
    }
  }, [onRefresh]);

  const clearCache = useCallback(async () => {
    setCacheMsg("清理中…");
    try {
      const result = await mobileCachePort.clearDerivedCaches();
      setCacheMsg("已清理：blob " + (result.cleared.runtimeBlobBytes ?? 0) + " 项");
    } catch (e) {
      setCacheMsg("清理失败: " + (e as Error).message);
    }
    void mobileCachePort.getCacheSummary().then(setCacheSummary).catch(() => undefined);
  }, []);

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
        <div className="mobile-settings-spacer mobile-settings-spacer--sm" />
      </header>

      {isSub ? (
        <div className="mobile-settings-content">
          {view === "editor" && (
            <Group title="编辑器" icon={<Pencil size={16} />}>
              <Item itemId="editor-font-size" name="正文字号" desc="作用于当前文档正文。">
                <select className="b3-select" value={settings.fontSize} onChange={(e) => update({ fontSize: Number(e.target.value) })} aria-label="正文字号">
                  {fontSizeOptions().map((fs) => <option key={fs} value={fs}>{fs} px</option>)}
                </select>
              </Item>
              <Item itemId="editor-max-open-tabs" name="最大同时打开标签数" desc="超过上限自动关闭最旧的标签。">
                <select className="b3-select fn__size200" value={settings.maxOpenTabs} onChange={(e) => update({ maxOpenTabs: Number(e.target.value) })} aria-label="最大同时打开标签数">
                  <option value={0}>不限</option>
                  {[4, 6, 8, 12, 16, 24].map((n) => <option key={n} value={n}>{n} 个</option>)}
                </select>
              </Item>
              <Item itemId="editor-max-attachment" name="附件大小上限" desc="仅影响本机上传校验。">
                <select className="b3-select fn__size200" value={Math.round(settings.maxAttachmentBytes / (1024 * 1024))} onChange={(e) => update({ maxAttachmentBytes: Number(e.target.value) * 1024 * 1024 })} aria-label="附件大小上限">
                  {MAX_ATTACHMENT_MB_OPTIONS_SETTINGS.map((mb) => <option key={mb} value={mb}>{mb} MiB</option>)}
                </select>
              </Item>
            </Group>
          )}

          {view === "appearance" && (
            <Group title="外观" icon={<Palette size={16} />}>
              <Item itemId="appearance-theme" name="主题" desc="浅色=思源 daylight / 深色=midnight。">
                <Seg ariaLabel="主题">
                  <button className={"b3-button b3-button--outline seg__item" + (settings.theme === "light" ? " is-active" : "")} onClick={() => update({ theme: "light" })}>浅色</button>
                  <button className={"b3-button b3-button--outline seg__item" + (settings.theme === "dark" ? " is-active" : "")} onClick={() => update({ theme: "dark" })}>深色</button>
                </Seg>
              </Item>
            </Group>
          )}

          {view === "history" && hist && (
            <Group title="历史" icon={<History size={16} />}>
              <Item itemId="history-max-snapshots" name="每文档快照上限" desc="超过后保留最新 N 份（对齐桌面）。">
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
              <Block itemId="resources-clean" name="未引用资源" desc="删除正文图片后残留的本地文件（不会被上传，可安全清理）。">
                <button className="b3-button" disabled={orphans.length === 0 || orphanBusy} onClick={() => { setOrphanBusy(true); void bridge.cleanOrphanAssets().then(() => setOrphans([])).finally(() => setOrphanBusy(false)); }}>清理全部（{orphans.length}）</button>
              </Block>
              <Block itemId="resources-gc" name="云端未引用对象" desc="删除云端未被任何清单/历史快照引用且超过 7 天的对象（对齐桌面深度清理）。">
                <button className="b3-button" disabled={orphanBusy} onClick={() => { setGcMsg("清理中…"); setOrphanBusy(true); void bridge.gcDeepCleanup().then((r) => setGcMsg("已清理 " + r.deletedCount + " 个对象（候选 " + r.candidateCount + "）")).catch(() => setGcMsg("清理失败")).finally(() => setOrphanBusy(false)); }}>清理云端</button>
                {gcMsg && <div className="b3-label__text">{gcMsg}</div>}
              </Block>
              {orphans.length === 0 && <div className="config-empty">暂无冗余资源</div>}
              {orphans.map((o) => (
                <div key={o.id} className="b3-list-item">
                  <span className="b3-list-item__text">{o.filename}</span>
                  <span className="b3-list-item__meta">{formatBytes(o.size)}</span>
                  <button className="b3-list-item__action" onClick={() => { void bridge.deleteOrphanAsset(o.id).then(() => setOrphans((prev) => prev.filter((x) => x.id !== o.id))); }} aria-label="删除"><Trash size={16} /></button>
                </div>
              ))}
            </Group>
          )}

          {view === "s3" && (
            <>
              <div className="config-group">
                <div className="config-title"><Cloud size={16} />同步设置（七牛 S3）</div>
                <div className="config-items">
                  <div className="config-item">
                    <div className="config-item__main"><div className="config-name">Endpoint</div></div>
                    <div className="config-item__ctl"><input className="b3-text-field" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} /></div>
                  </div>
                  <div className="config-item">
                    <div className="config-item__main"><div className="config-name">Region</div></div>
                    <div className="config-item__ctl"><input className="b3-text-field" value={region} onChange={(e) => setRegion(e.target.value)} /></div>
                  </div>
                  <div className="config-item">
                    <div className="config-item__main"><div className="config-name">Bucket</div></div>
                    <div className="config-item__ctl"><input className="b3-text-field" value={bucket} onChange={(e) => setBucket(e.target.value)} /></div>
                  </div>
                  <div className="config-item">
                    <div className="config-item__main"><div className="config-name">Object prefix</div></div>
                    <div className="config-item__ctl"><input className="b3-text-field" value={prefix} onChange={(e) => setPrefix(e.target.value)} /></div>
                  </div>
                  <div className="config-item">
                    <div className="config-item__main"><div className="config-name">Access Key</div></div>
                    <div className="config-item__ctl"><input className="b3-text-field" value={ak} onChange={(e) => setAk(e.target.value)} /></div>
                  </div>
                  <div className="config-item">
                    <div className="config-item__main"><div className="config-name">Secret Key</div></div>
                    <div className="config-item__ctl"><input className="b3-text-field" type="password" value={sk} onChange={(e) => setSk(e.target.value)} /></div>
                  </div>
                </div>
              </div>
              <div className="config-group">
                <div className="config-title"><RefreshCw size={16} />连接与同步</div>
                <div className="config-items">
                  <div className="config-block">
                    <div className="config-block__name">保存并测试连接</div>
                    <div className="config-block__text">配置将由本地保存为真相，S3 仅作同步镜像。</div>
                    <div className="config-block__actions">
                      <button className="b3-button" onClick={saveS3}>保存</button>
                      <button className="b3-button" onClick={() => void testS3()}>测试连接</button>
                      <button className="b3-button b3-button--outline" onClick={() => void runSync()}><RefreshCw size={14} />立即同步</button>
                    </div>
                    {s3Test && <div className="config-block__text">{s3Test}</div>}
                    {syncMsg && <div className="config-block__text">{syncMsg}</div>}
                  </div>
                </div>
              </div>
            </>
          )}

          {view === "cache" && (
            <div className="config-group">
              <div className="config-title"><HardDrive size={16} />清理缓存</div>
              <div className="config-items">
                <div className="config-block">
                  <div className="config-block__text">只清理可重建的派生数据（blob 运行时缓存）。<br />不会删除正文、未同步修改或已下载资源。</div>
                  {cacheSummary && (
                    <div className="config-stats">
                      <span><strong>Blob 运行时缓存</strong> {cacheSummary.runtimeBlobBytes} 项</span>
                      <span>已下载资源（不清理）{cacheSummary.downloadableAssetBytes} 项</span>
                      <span>待上传（不清理）{cacheSummary.pendingUploadBytes} 项</span>
                    </div>
                  )}
                  <div className="config-block__actions">
                    <button className="b3-button" onClick={() => void clearCache()}>清理缓存</button>
                  </div>
                  {cacheMsg && <div className="config-block__text">{cacheMsg}</div>}
                </div>
              </div>
            </div>
          )}

          {view === "about" && (
            <div className="config-group">
              <div className="config-title"><Info size={16} />关于</div>
              <div className="config-items">
                <div className="config-block">
                  <div className="config-block__name">{appInfo?.name ?? "Lake Notes"}</div>
                  <div className="config-block__text">版本：{appInfo?.version ?? "…"}（build {appInfo?.build ?? "…"}）</div>
                  <div className="config-block__text">协议：manifest v{appInfo?.protocolVersion ?? "4"} · 本地为真相，S3 为同步镜像</div>
                  <div className="config-block__text">平台：{appInfo?.platform === "web" ? "Web 预览 (Capacitor 未就绪)" : "Android (Capacitor + native SQLite)"}</div>
                  <div className="config-block__text">本地优先笔记应用（Electron + 安卓共享同步层）</div>
                </div>
                {diag && (
                  <div className="config-block">
                    <div className="config-block__name">数据诊断</div>
                    <div className="config-stats">
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
              <button key={m.key} className="b3-list-item mobile-settings-row" onClick={() => { setView(m.key); setPreviewNoteId(null); }}>
                <Icon size={20} className="b3-list-item__graphic" />
                <span className="b3-list-item__text">{m.label}</span>
                <ChevronRight size={18} className="b3-list-item__arrow" />
              </button>
            );
          })}
        </div>
      )}

      {previewNoteId && (
        <div className="mobile-settings-preview">
          <TrashPreviewPage
            noteId={previewNoteId}
            onBack={() => setPreviewNoteId(null)}
            onRestored={() => { setPreviewNoteId(null); setListKey((k) => k + 1); void onRefresh(); }}
          />
        </div>
      )}
      </div>
    </>
  );
}
