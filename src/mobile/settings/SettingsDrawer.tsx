/** 移动端设置抽屉（§6：同步设置 S3 / 清理缓存 / 关于）。Phase 4a 真实功能。 */
import { useCallback, useEffect, useState } from "react";
import { Cloud, Info, Trash2, X, RefreshCw } from "lucide-react";
import { bridge } from "../bridge";
import { mobileCachePort } from "../cachePort";
import { mobileAppInfoPort } from "../appInfoPort";
import type { AppInfo } from "../../core/ports";
import type { S3Settings } from "../../lib/types";

export interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onOpenTrash: () => void;
}

type Tab = "s3" | "cache" | "about";

/** 对齐桌面 registerSync 的 S3_SECRET_MASK：get 不回显明文，保存时掩码则保留旧值。 */
const S3_SECRET_MASK = "********";

export function SettingsDrawer(props: SettingsDrawerProps) {
  const { open, onClose, onRefresh, onOpenTrash } = props;
  const [tab, setTab] = useState<Tab>("s3");
  const [s3, setS3] = useState<S3Settings | null>(null);
  const [s3Test, setS3Test] = useState("");
  const [syncMsg, setSyncMsg] = useState("");
  const [cacheMsg, setCacheMsg] = useState("");
  const [cacheSummary, setCacheSummary] = useState<import("../../core/ports").CacheSummary | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    if (!open || tab !== "about") return;
    void mobileAppInfoPort.getAppInfo().then(setAppInfo).catch(() => undefined);
  }, [open, tab]);

  useEffect(() => {
    if (!open || tab !== "cache") return;
    void mobileCachePort.getCacheSummary().then(setCacheSummary).catch(() => undefined);
  }, [open, tab]);

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
    setSyncMsg("同步中（文档）…");
    try {
      setSyncMsg("文档同步: " + await bridge.syncNow() + "（小记同步待后续版本）");
      await onRefresh();
    } catch (e) {
      setSyncMsg("同步失败: " + (e as Error).message);
    }
  }, [onRefresh]);

  const clearCache = useCallback(async () => {
    setCacheMsg("清理中…");
    const result = await mobileCachePort.clearDerivedCaches();
    const cleared = result.cleared;
    setCacheMsg("已清理：blob " + (cleared.runtimeBlobBytes ?? 0) + " 项 / 迁移残留 " + (cleared.legacyMigrationBytes ?? 0) + " 项");
    void mobileCachePort.getCacheSummary().then(setCacheSummary).catch(() => undefined);
  }, []);

  if (!open) return null;

  return (
    <>
      <div className="mobile-drawer-mask" onClick={onClose} />
      <div className="mobile-drawer">
        <div className="mobile-drawer-head">
          设置
          <button className="mobile-drawer-close" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>
        <div className="mobile-drawer-tabs">
          <button className={tab === "s3" ? "active" : ""} onClick={() => setTab("s3")}><Cloud size={15} />同步设置</button>
          <button className={tab === "cache" ? "active" : ""} onClick={() => setTab("cache")}><Trash2 size={15} />清理缓存</button>
          <button className={tab === "about" ? "active" : ""} onClick={() => setTab("about")}><Info size={15} />关于</button>
        </div>
        <button className="mobile-drawer-trash-entry" onClick={onOpenTrash}><Trash2 size={15} />回收站</button>
        <div className="mobile-drawer-body">
          {tab === "s3" && (
            <div className="mobile-settings-form">
              <label>Endpoint</label><input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
              <label>Region</label><input value={region} onChange={(e) => setRegion(e.target.value)} />
              <label>Bucket</label><input value={bucket} onChange={(e) => setBucket(e.target.value)} />
              <label>Object prefix</label><input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
              <label>Access Key</label><input value={ak} onChange={(e) => setAk(e.target.value)} />
              <label>Secret Key</label><input type="password" value={sk} onChange={(e) => setSk(e.target.value)} />
              <div className="mobile-settings-actions">
                <button onClick={saveS3}>保存</button>
                <button onClick={() => void testS3()}>测试连接</button>
                <button onClick={() => void runSync()}><RefreshCw size={14} />同步</button>
              </div>
              {s3Test && <div className="mobile-settings-msg">{s3Test}</div>}
              {syncMsg && <div className="mobile-settings-msg">{syncMsg}</div>}
            </div>
          )}
          {tab === "cache" && (
            <div className="mobile-settings-form">
              <p className="mobile-settings-hint">只清理可重建的派生数据（blob 运行时缓存 / 旧迁移残留）。<br />不会删除正文、未同步修改或已下载资源。</p>
              {cacheSummary && (
                <div className="mobile-cache-summary">
                  <div className="mobile-cache-row"><span>Blob 运行时缓存</span><span>{cacheSummary.runtimeBlobBytes} 项</span></div>
                  <div className="mobile-cache-row"><span>旧迁移残留</span><span>{cacheSummary.legacyMigrationBytes} 项</span></div>
                  <div className="mobile-cache-row muted"><span>已下载资源（不清理）</span><span>{cacheSummary.downloadableAssetBytes} 项</span></div>
                  <div className="mobile-cache-row muted"><span>待上传（不清理）</span><span>{cacheSummary.pendingUploadBytes} 项</span></div>
                </div>
              )}
              <button onClick={() => void clearCache()}>清理缓存</button>
              {cacheMsg && <div className="mobile-settings-msg">{cacheMsg}</div>}
            </div>
          )}
          {tab === "about" && (
            <div className="mobile-settings-form">
              <div className="mobile-about-name">{appInfo?.name ?? "Lake Notes"}</div>
              <div className="mobile-about-item">版本：{appInfo?.version ?? "…"}（build {appInfo?.build ?? "…"}）</div>
              <div className="mobile-about-item">协议：manifest v{appInfo?.protocolVersion ?? "4"} · 本地为真相，S3 为同步镜像</div>
              <div className="mobile-about-item">平台：{appInfo?.platform === "web" ? "Web 预览 (Capacitor 未就绪)" : "Android (Capacitor + sql.js WASM)"}</div>
              <div className="mobile-about-item">本地优先笔记应用（Electron + 安卓共享同步层）</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
