/**
 * 偏好设置面板（261112 R2-S7 拆分）：**只留导航 / 搜索 / 布局**。
 * - 状态/副作用/事件处理 = ./settings/useSettingsPanelScope（纯搬移，零行为变化）；
 * - 11 个分组的 JSX = ./settings/sections/*（纯搬移；设置项 id/name/desc 一字未改）；
 * - 分类导航、搜索框、命中列表、Dialog 外壳仍在本文件。
 * 护栏：settingsSearch.test / settingsGroups.test（按新文件扫描）、settingsBackupObservability。
 */
import { Settings, X, Search } from "lucide-react";
import { Dialog } from "../ui/Overlay";
import { DialogResizeHandles } from "../ui/DialogResizeHandles";
import { S3ConfigImportDialog } from "./S3ConfigImportDialog";
import { useSettingsPanelScope } from "./settings/useSettingsPanelScope";
import { EditorSection, AppearanceSection, ShortcutsSection, SyncSection, BackupSection, HistorySection, MaintenanceSection, BrowserSection, AiSection, UpdateSection, AboutSection } from "./settings/sections";
import type { SettingsPanelProps } from "./settings/settingsPanelTypes";

export type { SettingsPanelProps, SettingsCategory } from "./settings/settingsPanelTypes";
export type { SettingsPanelContext } from "./settings/useSettingsPanelScope";

export function SettingsPanel(props: SettingsPanelProps) {
  const s = useSettingsPanelScope(props);
  const { category, confirmElement, diagMsg, floating, importS3Config, itemHits, jumpToItem, nav, navQuery, navSearchRef, onClose, open, s3ImportOpen, setCategory, setNavQuery, setS3ImportOpen, syncMsg, visibleNav } = s;
  if (!open) return null;

  return (
    <Dialog open onDismiss={() => { if (!floating.interactionRef.current) onClose(); }} label="偏好设置"
      surfaceRef={floating.panelRef} surfaceClassName="floating-dialog settings-panel settings-panel-large"
      style={floating.panelStyle} initialFocus={navSearchRef}>
        <header id="settings-panel-title" className="settings-header floating-dialog-header" onPointerDown={floating.startDrag}>
          <Settings size={16} />
          <span>偏好设置</span>
          <button className="ln-close" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav ln-list-panel ln-list-panel--background">
            <label className="settings-nav-search"><Search size={14} /><input ref={navSearchRef} value={navQuery} onChange={(event) => setNavQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { navSearchRef.current?.blur(); return; } if (event.key === "Enter" && itemHits.length > 0) { event.preventDefault(); jumpToItem(itemHits[0]); } }} placeholder="搜索设置（分类与条目）" aria-label="搜索设置" /></label>
            {visibleNav.map((item) => (
              <button key={item.id} className={`ln-list-item settings-nav-item${category === item.id ? " active" : ""}`} onClick={() => setCategory(item.id)}>
                {item.icon}<span>{item.label}</span>
              </button>
            ))}
            {visibleNav.length === 0 && itemHits.length === 0 && <span className="settings-nav-empty">没有匹配的设置</span>}
            {navQuery.trim() && itemHits.length > 0 && (
              <div className="settings-nav-hits">
                <span className="settings-nav-hits__label">条目 {itemHits.length} 项</span>
                {itemHits.map((hit) => (
                  <button key={hit.id} className="ln-list-item settings-nav-hit" onClick={() => jumpToItem(hit)} title={hit.label}>
                    <span className="ln-list-item__text ln-ellipsis">{hit.label}</span>
                    <span className="ln-list-item__meta">{nav.find((item) => item.id === hit.category)?.label}</span>
                  </button>
                ))}
              </div>
            )}
          </nav>
          {/* 资源页：内容区交给浏览器自己排版（列表/预览铺满到底、各自滚动），见 feature.css 的 --fill 链 */}
          <div className="settings-content">
            {category === "editor" && <EditorSection c={s} />}

            {category === "appearance" && <AppearanceSection c={s} />}

            {category === "shortcuts" && <ShortcutsSection c={s} />}

            {category === "history" && <HistorySection c={s} />}

            {category === "sync" && <SyncSection c={s} />}

            {category === "backup" && <BackupSection c={s} />}

            {category === "maintenance" && <MaintenanceSection c={s} />}

            {category === "browser" && <BrowserSection c={s} />}

            {category === "ai" && <AiSection c={s} />}
            {category === "update" && <UpdateSection c={s} />}

            {category === "about" && <AboutSection c={s} />}
          </div>
        </div>
        {(syncMsg ?? diagMsg) && <p className="settings-statusbar">{syncMsg ?? diagMsg}</p>}
        <DialogResizeHandles onResize={floating.startResize} />
        {s3ImportOpen && (
          <S3ConfigImportDialog
            onClose={() => setS3ImportOpen(false)}
            onImport={importS3Config}
          />
        )}
        {confirmElement}
    </Dialog>
  );
}
