import { Check, Cloud, Eye, EyeOff, History, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { native } from "../lib/native";
import type { S3Settings, SyncProgress, SyncStatusInfo } from "../lib/types";

const defaults: S3Settings = { endpoint: "", region: "cn-east-1", bucket: "", prefix: "lake-notes", accessKeyId: "", secretAccessKey: "", forcePathStyle: false };

const PHASE_LABEL: Record<SyncProgress["phase"], string> = {
  connect: "连接 S3",
  download: "下载远端变更",
  upload: "上传本地变更",
  manifest: "写入清单",
  done: "同步完成",
};

function formatTime(iso: string | null): string {
  if (!iso) return "从未";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function SyncPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [settings, setSettings] = useState(defaults);
  const [showSecret, setShowSecret] = useState(false);
  const [status, setStatus] = useState<"idle" | "busy" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [lastSync, setLastSync] = useState<SyncStatusInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    void native.getS3Settings().then((value) => value && setSettings(value)).catch(() => undefined);
    void native.getSyncStatus().then(setLastSync).catch(() => undefined);
  }, [open]);

  if (!open) return null;

  const set = (key: keyof S3Settings, value: string | boolean) => setSettings((current) => ({ ...current, [key]: value }));

  const test = async () => {
    setStatus("busy"); setMessage("正在连接...");
    try {
      await native.saveS3Settings(settings);
      setMessage(await native.testS3Connection());
      setStatus("ok");
    } catch (error) { setMessage(String(error)); setStatus("error"); }
  };

  const save = async () => {
    setStatus("busy");
    try {
      await native.saveS3Settings(settings);
      setMessage("配置已保存在当前设备");
      setStatus("ok");
    } catch (error) { setMessage(String(error)); setStatus("error"); }
  };

  const sync = async () => {
    setStatus("busy");
    setProgress({ phase: "connect", message: "准备同步..." });
    const unsubscribe = native.onSyncProgress(setProgress);
    try {
      await native.saveS3Settings(settings);
      const result = await native.syncNow();
      setLastSync({ lastSyncedAt: result.completedAt, lastResult: result });
      setMessage(`同步完成：上传 ${result.uploaded}，下载 ${result.downloaded}，冲突 ${result.conflicts}`);
      setStatus("ok");
    } catch (error) {
      setMessage(String(error));
      setStatus("error");
    } finally {
      unsubscribe();
      window.setTimeout(() => setProgress(null), 400);
    }
  };

  const progressPercent = progress && progress.current != null && progress.total
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : null;
  const busy = status === "busy";

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="sync-panel" role="dialog" aria-modal="true">
        <header>
          <div><Cloud size={20} /><div><h2>S3 同步</h2><p>凭据仅保存在当前设备</p></div></div>
          <button className="icon-button" onClick={onClose} title="关闭"><X size={19} /></button>
        </header>
        <div className="form-grid">
          <label className="wide">Endpoint<input value={settings.endpoint} onChange={(e) => set("endpoint", e.target.value)} placeholder="https://s3-cn-east-1.qiniucs.com" /></label>
          <label>Region<input value={settings.region} onChange={(e) => set("region", e.target.value)} /></label>
          <label>Bucket<input value={settings.bucket} onChange={(e) => set("bucket", e.target.value)} /></label>
          <label className="wide">对象前缀<input value={settings.prefix} onChange={(e) => set("prefix", e.target.value)} /></label>
          <label className="wide">Access Key<input value={settings.accessKeyId} onChange={(e) => set("accessKeyId", e.target.value)} /></label>
          <label className="wide">Secret Key<span className="secret-field"><input type={showSecret ? "text" : "password"} value={settings.secretAccessKey} onChange={(e) => set("secretAccessKey", e.target.value)} /><button className="icon-button" onClick={() => setShowSecret(!showSecret)} title={showSecret ? "隐藏" : "显示"}>{showSecret ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
          <label className="checkbox wide"><input type="checkbox" checked={settings.forcePathStyle} onChange={(e) => set("forcePathStyle", e.target.checked)} /><span>使用 Path-style URL</span></label>
        </div>

        {progress && (
          <div className="sync-progress">
            <div className="sync-progress-row">
              <span className="sync-progress-label">
                {busy ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}
                {PHASE_LABEL[progress.phase]}
                {progress.current != null && progress.total ? `（${progress.current}/${progress.total}）` : ""}
              </span>
              {progressPercent != null && <span className="sync-progress-pct">{progressPercent}%</span>}
            </div>
            <div className="sync-progress-track">
              <div
                className={`sync-progress-bar ${progressPercent == null ? "indeterminate" : ""}`}
                style={progressPercent != null ? { width: `${progressPercent}%` } : undefined}
              />
            </div>
            <div className="sync-progress-message">{progress.message}</div>
          </div>
        )}

        {lastSync?.lastSyncedAt && (
          <div className="sync-last-result">
            <div className="sync-last-row"><History size={13} />最近同步：{formatTime(lastSync.lastSyncedAt)}</div>
            {lastSync.lastResult && (
              <div className="sync-last-row sync-last-counts">
                上传 {lastSync.lastResult.uploaded} · 下载 {lastSync.lastResult.downloaded} · 冲突 {lastSync.lastResult.conflicts}
                <span className="sync-last-manifest">#{lastSync.lastResult.manifestId.slice(0, 8)}</span>
              </div>
            )}
          </div>
        )}

        {message && <div className={`connection-message ${status}`}>{status === "busy" ? <LoaderCircle className="spin" size={16} /> : status === "ok" ? <Check size={16} /> : null}{message}</div>}
        <footer>
          <button className="secondary-button" onClick={test} disabled={busy}>测试连接</button>
          <button className="secondary-button" onClick={save} disabled={busy}>保存配置</button>
          <button className="primary-button" onClick={sync} disabled={busy}>{busy ? "同步中..." : "立即同步"}</button>
        </footer>
      </section>
    </div>
  );
}
