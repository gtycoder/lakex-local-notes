/** 移动端设置页（§6：同步设置 S3 / 清理缓存 / 回收站 / 关于）。
 * 版式：竖向菜单列表（设置项一行一行），点某项进入新页面（带返回）；子页内容用 .config-* + .b3-* 骨架（AGENTS §3.14）。
 * 注意：全部 App 设置为竖向（无横向 tab）；「回收站」并入总回收站（见 TrashList）。 */
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, Cloud, Info, Trash2, X, RefreshCw, HardDrive, ListTree } from "lucide-react";
import { loadSettings, saveSettings } from "../../lib/settings";
import { bridge } from "../bridge";
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

type View = "menu" | "editor" | "s3" | "cache" | "trash" | "about";

const MENU: { key: Exclude<View, "menu">; label: string; icon: typeof Cloud }[] = [
  { key: "editor", label: "编辑器", icon: ListTree },
  { key: "s3", label: "同步设置", icon: Cloud },
  { key: "cache", label: "清理缓存", icon: HardDrive },
  { key: "trash", label: "回收站", icon: Trash2 },
  { key: "about", label: "关于", icon: Info },
];

const MENU_LABEL = (key: Exclude<View, "menu">) => MENU.find((m) => m.key === key)?.label ?? "";

/** 对齐桌面 registerSync 的 S3_SECRET_MASK：get 不回显明文，保存时掩码则保留旧值。 */
const S3_SECRET_MASK = "********";

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
  const [outlineEnhance, setOutlineEnhance] = useState(() => loadSettings().outlineEnhance);

  useEffect(() => {
    if (!open || view !== "about") return;
    void mobileAppInfoPort.getAppInfo().then(setAppInfo).catch(() => undefined);
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

  if (!open) return null;

  const isSub = view !== "menu";

  return (
    <div className="mobile-settings-page">
      <header className="mobile-settings-head">
        {isSub ? (
          <button className="mobile-settings-close" onClick={() => { setView("menu"); setPreviewNoteId(null); }} aria-label="返回"><ArrowLeft size={22} /></button>
        ) : (
          <div className="mobile-settings-spacer" />
        )}
        <div className="mobile-settings-title">{isSub ? MENU_LABEL(view) : "设置"}</div>
        {isSub ? (
          <div className="mobile-settings-spacer mobile-settings-spacer--sm" />
        ) : (
          <button className="mobile-settings-close" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        )}
      </header>

      {isSub ? (
        <div className="mobile-settings-content">
          {view === "editor" && (
            <div className="config-group">
              <div className="config-title"><ListTree size={16} />编辑器</div>
              <div className="config-items">
                <div className="config-item">
                  <div className="config-item__main">
                    <div className="config-name">大纲增强</div>
                    <div className="config-item__desc">开启=应用自建大纲（移动端大纲面板）；关闭=使用 Lake 原生大纲（不做任何改动）。</div>
                  </div>
                  <div className="config-item__ctl">
                    <input type="checkbox" className="b3-switch" checked={outlineEnhance} onChange={(e) => { const v = e.target.checked; setOutlineEnhance(v); saveSettings({ outlineEnhance: v }); }} aria-label="大纲增强" />
                  </div>
                </div>
              </div>
            </div>
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
                  <div className="config-block__text">平台：{appInfo?.platform === "web" ? "Web 预览 (Capacitor 未就绪)" : "Android (Capacitor + sql.js WASM)"}</div>
                  <div className="config-block__text">本地优先笔记应用（Electron + 安卓共享同步层）</div>
                </div>
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
  );
}
