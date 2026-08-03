import { Moon, Settings, Sun, Monitor, Type, AlignLeft, ListTree, PanelTop } from "lucide-react";
import { fontSizeOptions, type AppSettings, type ThemeMode } from "../lib/settings";

interface SettingsPanelProps {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onChange: (patch: Partial<AppSettings>) => void;
}

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "light", label: "亮色", icon: Sun },
  { value: "dark", label: "暗色", icon: Moon },
];

export function SettingsPanel({ open, settings, onClose, onChange }: SettingsPanelProps) {
  if (!open) return null;
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
            <h4><Monitor size={13} /> 主题</h4>
            <div className="settings-row">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`settings-choice ${settings.theme === opt.value ? "active" : ""}`}
                  onClick={() => onChange({ theme: opt.value })}
                >
                  <opt.icon size={14} />
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

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

          <p className="settings-hint">设置保存在本机（localStorage），不参与同步。</p>
        </div>
      </div>
    </div>
  );
}
