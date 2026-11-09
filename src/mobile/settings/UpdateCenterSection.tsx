/**
 * 设置 →「更新中心」（独立菜单项，位于「关于」上方；应用内更新中心，Android）。
 *
 * 四行 + 仅 Wi-Fi 行（docs/UPDATE-CENTER.md §2）：
 *   检查更新 / 自动检查（间隔 关闭·6·12·24h）/ 自动下载 / 仅 Wi-Fi 自动下载 / 更新日志。
 * 发现新版本用 MobileSheet 展示版本、大小、更新内容、下载进度与「安装」（系统安装器，不静默安装）。
 * 更新日志直接渲染 docs/RELEASE-NOTES.md（?raw，与应用内/Release 同源）。
 * 视觉只用移动端既有 mb-* 原语与 MobileSheet，不新增 CSS。
 */
import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, ScrollText } from "lucide-react";
import { Field, Group, Item, Switch } from "../ui/settingsPrimitives";
import { PickerSheet } from "../ui/PickerSheet";
import { MobileSheet } from "../ui/MobileSheet";
import { formatBytes } from "../../lib/formatBytes";
import { formatUpdatedAt } from "../lib/listTime";
import type { AppInfo } from "../../core/ports";
import { useUpdateCenter } from "../update/useUpdateCenter";
import {
  cancelUpdateDownload,
  checkForUpdates,
  ignoreCurrentVersion,
  installDownloadedUpdate,
  markUpdatePrompted,
  openUpdateReleasePage,
  readUpdateSettings,
  startUpdateDownload,
  writeUpdateSettings,
} from "../update/updateCenterStore";
import { loadUpdateRuntimeState, UPDATE_CHECK_INTERVAL_OPTIONS, type UpdateSettings } from "../update/updateSettings";
import { androidUpdateAsset, isVersionIgnored } from "../update/updatePolicy";
import { parseReleaseNoteLines, parseReleaseNotes, type ReleaseNoteLine } from "../update/releaseNotes";
import releaseNotesRaw from "../../../docs/RELEASE-NOTES.md?raw";

function lastCheckText(checkedAt: number): string {
  if (!checkedAt || !Number.isFinite(checkedAt)) return "尚未检查";
  try {
    return "上次检查：" + formatUpdatedAt(new Date(checkedAt).toISOString(), true);
  } catch {
    return "尚未检查";
  }
}

function statusText(snapshot: ReturnType<typeof useUpdateCenter>, settings: UpdateSettings, currentVersion: string): string {
  const manifest = snapshot.manifest;
  switch (snapshot.status) {
    case "checking":
      return "正在检查更新…";
    case "up-to-date":
      return "已是最新版本（" + currentVersion + "）";
    case "available":
      return manifest
        ? "发现新版本 " + manifest.version + (isVersionIgnored(settings, manifest.version) ? "（已忽略）" : "")
        : "发现新版本";
    case "downloading": {
      const progress = snapshot.progress;
      if (!progress || progress.total <= 0) return "正在下载更新…";
      const percent = Math.min(100, Math.round((progress.received / progress.total) * 100));
      return "正在下载 " + percent + "%（" + formatBytes(progress.received) + " / " + formatBytes(progress.total) + "）";
    }
    case "downloaded":
      return "已下载 " + (snapshot.downloadedVersion || "") + "，点击「安装」";
    case "error":
      return snapshot.error ?? "检查更新失败";
    default:
      return snapshot.native ? lastCheckText(snapshot.checkedAt ?? 0) : "浏览器预览不支持应用内更新";
  }
}

function ReleaseLines({ lines }: { lines: ReleaseNoteLine[] }) {
  return (
    <div className="mb-set-items">
      {lines.map((line, index) => {
        if (line.kind === "heading") {
          return <div key={index} className="mb-set-block__name">{line.text}</div>;
        }
        if (line.kind === "subheading") {
          return <div key={index} className="mb-set-name">{line.text}</div>;
        }
        if (line.kind === "bullet") {
          return <div key={index} className="mb-set-item__desc">• {line.text}</div>;
        }
        if (line.kind === "code") {
          return <div key={index} className="mb-set-item__desc mb-ellipsis">{line.text}</div>;
        }
        return <div key={index} className="mb-set-item__desc">{line.text}</div>;
      })}
    </div>
  );
}

export function UpdateCenterSection({ appInfo }: { appInfo: AppInfo | null }) {
  const snapshot = useUpdateCenter();
  const [settings, setSettings] = useState<UpdateSettings>(readUpdateSettings);
  const [updateSheetOpen, setUpdateSheetOpen] = useState(false);
  const [notesSheetOpen, setNotesSheetOpen] = useState(false);
  const currentVersion = appInfo?.version ?? "0.0.0";
  const manifest = snapshot.manifest;
  const asset = manifest ? androidUpdateAsset(manifest) : null;
  const notesVersions = useMemo(() => parseReleaseNotes(releaseNotesRaw), []);
  const manifestNotes = useMemo(
    () => (manifest ? parseReleaseNoteLines(manifest.notes) : []),
    [manifest],
  );

  const applySettings = (patch: Partial<UpdateSettings>): void => {
    writeUpdateSettings(patch);
    setSettings(readUpdateSettings());
  };

  // 发现更新 / 已下载待安装：每版本最多自动弹一次（已忽略的不弹）。
  useEffect(() => {
    const target = snapshot.manifest;
    if (!target) return;
    if (snapshot.status !== "available" && snapshot.status !== "downloaded") return;
    if (isVersionIgnored(settings, target.version)) return;
    const prompted = loadUpdateRuntimeState().promptedVersion;
    if (prompted === target.version) return;
    markUpdatePrompted(target.version);
    setUpdateSheetOpen(true);
  }, [snapshot.status, snapshot.manifest, settings.ignoredVersion]);

  const ignoreThisVersion = (): void => {
    ignoreCurrentVersion();
    setSettings(readUpdateSettings());
    setUpdateSheetOpen(false);
  };

  return (
    <>
      <Group title="更新" icon={<RefreshCw size={16} />}>
        <Item
          itemId="update-check"
          name="检查更新"
          desc={statusText(snapshot, settings, currentVersion)}
          icon={<RefreshCw size={16} />}
          tone="#3f5fa0"
        >
          <button
            type="button"
            className="mb-btn mb-btn--settings mb-btn--sm"
            disabled={!snapshot.native || snapshot.status === "checking" || snapshot.status === "downloading"}
            onClick={() => void checkForUpdates({ manual: true })}
          >
            立即检查
          </button>
        </Item>

        <Switch
          itemId="update-auto-check"
          name="自动检查"
          desc="启动时检查一次，之后按下面的间隔检查"
          checked={settings.autoCheck}
          onChange={(next) => applySettings({ autoCheck: next })}
        />

        <Field itemId="update-check-interval" name="检查间隔" desc="「关闭」= 不自动检查，仍可手动检查">
          <PickerSheet
            label="检查间隔"
            value={settings.checkIntervalHours}
            options={UPDATE_CHECK_INTERVAL_OPTIONS.map((hours) => ({
              value: hours,
              label: hours === 0 ? "关闭" : hours + " 小时",
            }))}
            onChange={(hours) => applySettings({ checkIntervalHours: hours })}
          />
        </Field>

        <Switch
          itemId="update-auto-download"
          name="自动下载"
          desc="发现新版本后后台下载（不会自动安装，安装前仍由你确认）"
          checked={settings.autoDownload}
          onChange={(next) => applySettings({ autoDownload: next })}
        />

        <Switch
          itemId="update-auto-download-wifi"
          name="仅 Wi-Fi 自动下载"
          desc={snapshot.native ? "移动网络下不自动下载（手动下载不受限）" : "仅 Android 端生效"}
          checked={settings.autoDownloadWifiOnly}
          disabled={!settings.autoDownload}
          onChange={(next) => applySettings({ autoDownloadWifiOnly: next })}
        />

        <Item
          itemId="update-release-notes"
          name="更新日志"
          desc="当前版本与历史版本的更新内容（与应用内、GitHub Release 同源）"
          icon={<ScrollText size={16} />}
          tone="#5b6472"
        >
          <button type="button" className="mb-btn mb-btn--settings mb-btn--sm" onClick={() => setNotesSheetOpen(true)}>
            查看
          </button>
        </Item>
      </Group>

      <MobileSheet
        open={updateSheetOpen}
        title={snapshot.status === "downloaded" ? "更新已下载" : "发现新版本"}
        onClose={() => setUpdateSheetOpen(false)}
        footer={
          <div className="mb-set-block__actions">
            {snapshot.status === "available" && asset ? (
              <button type="button" className="mb-btn mb-btn--primary" onClick={() => void startUpdateDownload()}>
                <Download size={16} />下载并安装
              </button>
            ) : null}
            {snapshot.status === "downloading" ? (
              <button type="button" className="mb-btn mb-btn--secondary" onClick={() => void cancelUpdateDownload()}>
                取消下载
              </button>
            ) : null}
            {snapshot.status === "downloaded" ? (
              <button type="button" className="mb-btn mb-btn--primary" onClick={() => void installDownloadedUpdate()}>
                安装
              </button>
            ) : null}
            {snapshot.status === "error" ? (
              <button type="button" className="mb-btn mb-btn--primary" onClick={() => void startUpdateDownload()}>
                重试下载
              </button>
            ) : null}
            <button type="button" className="mb-btn mb-btn--secondary" onClick={openUpdateReleasePage}>
              打开下载页
            </button>
            {snapshot.status === "available" ? (
              <button type="button" className="mb-btn mb-btn--ghost" onClick={ignoreThisVersion}>
                忽略此版本
              </button>
            ) : null}
          </div>
        }
      >
        <div className="mb-set-items">
          <div className="mb-set-block">
            <div className="mb-set-block__name">版本 {manifest?.version ?? snapshot.downloadedVersion ?? "—"}</div>
            <div className="mb-set-item__desc">
              {manifest ? "发布于 " + manifest.publishedAt.slice(0, 10) : "已下载到本机，等待安装"}
              {asset ? " · 大小 " + formatBytes(asset.size) : ""}
            </div>
            {snapshot.status === "downloading" && snapshot.progress ? (
              <>
                <div className="mb-set-item__desc">
                  正在下载 {formatBytes(snapshot.progress.received)} / {formatBytes(snapshot.progress.total)}（
                  {Math.min(100, Math.round((snapshot.progress.received / Math.max(1, snapshot.progress.total)) * 100))}%）
                </div>

              </>
            ) : null}
            {snapshot.error ? (
              <div className="mb-set-item__desc" role="alert">{snapshot.error}</div>
            ) : null}
            <ReleaseLines lines={manifestNotes} />
          </div>
        </div>
      </MobileSheet>

      <MobileSheet open={notesSheetOpen} title="更新日志" onClose={() => setNotesSheetOpen(false)}>
        <div className="mb-set-items">
          {notesVersions.map((version) => (
            <div key={version.version} className="mb-set-block">
              <div className="mb-set-block__name">v{version.version}</div>
              <ReleaseLines lines={version.lines} />
            </div>
          ))}
        </div>
      </MobileSheet>
    </>
  );
}
