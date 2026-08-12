import { useEffect, useState } from "react";
import { Settings, Type, AlignLeft, ListTree, PanelTop, History, Trash2 } from "lucide-react";
import { fontSizeOptions, type AppSettings } from "../lib/settings";
import { native } from "../lib/native";

interface SettingsPanelProps {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onChange: (patch: Partial<AppSettings>) => void;
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export function SettingsPanel({ open, settings, onClose, onChange }: SettingsPanelProps) {
  const [stats, setStats] = useState<{ snapshotCount: number; totalBytes: number } | null>(null);
  const [histCfg, setHistCfg] = useState<{ maxSnapshots: number; retentionDays: number; cleanupIntervalHours: number; snapshotIntervalMinutes: number } | null>(null);
  const [histMsg, setHistMsg] = useState<string | null>(null);
  const [histBusy, setHistBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void native.getHistoryStats().then(setStats).catch(() => undefined);
    void native.getHistorySettings().then(setHistCfg).catch(() => undefined);
  }, [open]);

  if (!open) return null;

  const saveHistCfg = (patch: Partial<NonNullable<typeof histCfg>>) => {
    if (!histCfg) return;
    const next = { ...histCfg, ...patch };
    setHistCfg(next);
    void native.saveHistorySettings(next).catch(() => undefined);
  };

  const runCleanup = async () => {
    if (histBusy) return;
    setHistBusy(true);
    setHistMsg(null);
    try {
      const r = await native.cleanupHistory();
      const s = await native.getHistoryStats();
      setStats(s);
      setHistMsg(r.deletedSnapshots > 0 ? `已清理 ${r.deletedSnapshots} 份过期快照` : "无过期快照");
    } catch (e) {
      setHistMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setHistBusy(false);
    }
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <header className="settings-header">
          <Settings size={16} />
          <span>偏好设置</span>
          <button className="settings-close" onClick={onClose} aria-label="关闭">✕</button>
        </header>
        <div className="settings-body">
          <section className="settings-group">
            <h4><Type size={13} /> 正文字号</h4>
            <div className="settings-row">
              {fontSizeOptions().map((size) => (
                <button
                  key={size}
                  className={`settings-choice ${settings.fontSize === size ? "active" : ""}`}
                  onClick={() => onChange({ fontSize: size })}
                >
                  {size}
                </button>
              ))}
            </div>
          </section>

          <section className="settings-group">
            <h4>编辑器</h4>
            <label className="settings-toggle">
              <AlignLeft size={13} />
              <span>段间距（更宽松的段落留白）</span>
              <input type="checkbox" checked={settings.paragraphSpacing} onChange={(e) => onChange({ paragraphSpacing: e.target.checked })} />
            </label>
            <label className="settings-toggle">
              <ListTree size={13} />
              <span>显示文档大纲（TOC）</span>
              <input type="checkbox" checked={settings.showToc} onChange={(e) => onChange({ showToc: e.target.checked })} />
            </label>
            <label className="settings-toggle">
              <PanelTop size={13} />
              <span>显示编辑器工具栏</span>
              <input type="checkbox" checked={settings.showToolbar} onChange={(e) => onChange({ showToolbar: e.target.checked })} />
            </label>
          </section>

          <section className="settings-group">
            <h4><History size={13} /> 文档历史</h4>
            <div className="settings-row" style={{ alignItems: "center", gap: 8, fontSize: 12, color: "#48515c" }}>
              <span>历史快照：{stats ? `${stats.snapshotCount} 份 · ${formatBytes(stats.totalBytes)}` : "…"}</span>
              <button className="settings-choice" onClick={() => void runCleanup()} disabled={histBusy}>
                <Trash2 size={12} /> {histBusy ? "清理中…" : "立即清理"}
              </button>
            </div>
            {histMsg && <p className="settings-hint">{histMsg}</p>}
            {histCfg && (
              <div className="settings-row" style={{ gap: 6 }}>
                <label className="settings-toggle" style={{ height: 30 }}>
                  <span>每文档上限</span>
                  <input type="number" min={20} max={1000} value={histCfg.maxSnapshots}
                    onChange={(e) => saveHistCfg({ maxSnapshots: Math.max(1, Number(e.target.value) || 100) })} />
                </label>
              </div>
            )}
            {histCfg && (
              <div className="settings-row" style={{ gap: 6 }}>
                <label className="settings-toggle" style={{ height: 30 }}>
                  <span>保留天数</span>
                  <input type="number" min={1} max={365} value={histCfg.retentionDays}
                    onChange={(e) => saveHistCfg({ retentionDays: Math.max(1, Number(e.target.value) || 30) })} />
                </label>
              </div>
            )}
            {histCfg && (
              <div className="settings-row" style={{ gap: 6 }}>
                <label className="settings-toggle" style={{ height: 30 }}>
                  <span>定期清理（小时，0=关）</span>
                  <input type="number" min={0} max={720} value={histCfg.cleanupIntervalHours}
                    onChange={(e) => saveHistCfg({ cleanupIntervalHours: Math.max(0, Number(e.target.value) || 24) })} />
                </label>
              </div>
            )}
            {histCfg && (
              <div className="settings-row" style={{ gap: 6 }}>
                <label className="settings-toggle" style={{ height: 30 }}>
                  <span>自动快照间隔（分钟，0=关）</span>
                  <input type="number" min={0} max={1440} value={histCfg.snapshotIntervalMinutes}
                    onChange={(e) => saveHistCfg({ snapshotIntervalMinutes: Math.max(0, Number(e.target.value) || 15) })} />
                </label>
              </div>
            )}
            <p className="settings-hint">历史快照保存在本机，不参与同步。保留策略修改即时生效。</p>
          </section>

          <p className="settings-hint">设置保存在本机（localStorage），不参与同步。</p>
        </div>
      </div>
    </div>
  );
}
