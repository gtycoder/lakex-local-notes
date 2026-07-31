import { Check, Cloud, Eye, EyeOff, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { native } from "../lib/native";
import type { S3Settings } from "../lib/types";

const defaults: S3Settings = { endpoint: "", region: "cn-east-1", bucket: "", prefix: "lake-notes", accessKeyId: "", secretAccessKey: "", forcePathStyle: false };

export function SyncPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [settings, setSettings] = useState(defaults);
  const [showSecret, setShowSecret] = useState(false);
  const [status, setStatus] = useState<"idle" | "busy" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => { if (open) void native.getS3Settings().then((value) => value && setSettings(value)); }, [open]);
  if (!open) return null;
  const set = (key: keyof S3Settings, value: string | boolean) => setSettings((current) => ({ ...current, [key]: value }));
  const test = async () => {
    setStatus("busy"); setMessage("正在连接...");
    try { await native.saveS3Settings(settings); setMessage(await native.testS3Connection()); setStatus("ok"); }
    catch (error) { setMessage(String(error)); setStatus("error"); }
  };
  const save = async () => {
    setStatus("busy");
    try { await native.saveS3Settings(settings); setMessage("配置已保存在当前设备"); setStatus("ok"); }
    catch (error) { setMessage(String(error)); setStatus("error"); }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="sync-panel" role="dialog" aria-modal="true">
        <header><div><Cloud size={20} /><div><h2>S3 同步</h2><p>凭据仅保存在当前设备</p></div></div><button className="icon-button" onClick={onClose} title="关闭"><X size={19} /></button></header>
        <div className="form-grid">
          <label className="wide">Endpoint<input value={settings.endpoint} onChange={(e) => set("endpoint", e.target.value)} placeholder="https://s3-cn-east-1.qiniucs.com" /></label>
          <label>Region<input value={settings.region} onChange={(e) => set("region", e.target.value)} /></label>
          <label>Bucket<input value={settings.bucket} onChange={(e) => set("bucket", e.target.value)} /></label>
          <label className="wide">对象前缀<input value={settings.prefix} onChange={(e) => set("prefix", e.target.value)} /></label>
          <label className="wide">Access Key<input value={settings.accessKeyId} onChange={(e) => set("accessKeyId", e.target.value)} /></label>
          <label className="wide">Secret Key<span className="secret-field"><input type={showSecret ? "text" : "password"} value={settings.secretAccessKey} onChange={(e) => set("secretAccessKey", e.target.value)} /><button className="icon-button" onClick={() => setShowSecret(!showSecret)} title={showSecret ? "隐藏" : "显示"}>{showSecret ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
          <label className="checkbox wide"><input type="checkbox" checked={settings.forcePathStyle} onChange={(e) => set("forcePathStyle", e.target.checked)} /><span>使用 Path-style URL</span></label>
        </div>
        {message && <div className={`connection-message ${status}`}>{status === "busy" ? <LoaderCircle className="spin" size={16} /> : status === "ok" ? <Check size={16} /> : null}{message}</div>}
        <footer><button className="secondary-button" onClick={test} disabled={status === "busy"}>测试连接</button><button className="primary-button" onClick={save} disabled={status === "busy"}>保存配置</button></footer>
      </section>
    </div>
  );
}
