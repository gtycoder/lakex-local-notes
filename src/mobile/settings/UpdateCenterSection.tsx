/**
 * 设置 →「更新中心」（独立菜单项，位于「关于」上方；应用内更新中心，Android）。
 *
 * 四行 + 仅 Wi-Fi 行（docs/UPDATE-CENTER.md §2）：
 *   检查更新 / 自动检查（间隔 24 小时 / 每周 / 每月；与桌面同口径）/ 自动下载 / 仅 Wi-Fi 自动下载 / 更新日志。
 * 发现新版本用 MobileSheet 展示版本、大小、更新内容、下载进度与「安装」（系统安装器，不静默安装）。
 * 更新日志直接渲染 docs/RELEASE-NOTES.md（?raw，与应用内/Release 同源）。
 * 视觉只用移动端既有 mb-* 原语与 MobileSheet，不新增 CSS。
 */
import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, ScrollText } from "lucide-react";
import { Field, Group, Item, Switch } from "../ui/settingsPrimitives";
import { PickerSheet } from "../ui/PickerSheet";
import { MobileSheet } from "../ui/MobileSheet";
import { SheetFooter } from "../ui/SheetFooter";
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
import { loadReleaseNotesText } from "../../lib/releaseNotesText";

/** 检查间隔的三档文案（261116 用户点单：24 小时 / 每周 / 每月；与桌面 UpdateCenter 同文案）。 */
const INTERVAL_LABELS: Record<number, string> = { 24: "24 小时", 168: "每周", 720: "每月" };
const INTERVAL_OPTION_VALUES: readonly number[] = UPDATE_CHECK_INTERVAL_OPTIONS;

function lastCheckText(checkedAt: number): string {
  if (!checkedAt || !Number.isFinite(checkedAt)) return "尚未检查";
  try {
    return "上次检查：" + formatUpdatedAt(new Date(checkedAt).toISOString(), true);
  } catch {
    return "尚未检查";
  }
}

/** 导出供测试：版本标签的唯一格式化点（261118：appInfo 未就绪时**不打假版本号**）。 */
export function statusText(snapshot: ReturnType<typeof useUpdateCenter>, settings: UpdateSettings, currentVersion: string): string {
  const manifest = snapshot.manifest;
  switch (snapshot.status) {
    case "checking":
      return "正在检查更新…";
    case "up-to-date":
      // 261118：appInfo 异步取数可能晚于检查结果落定 —— 未就绪就如实说「已是最新版本」，
      // 绝不打「（0.0.0）」这类假版本号（恢复演练冒烟实测的占位误导）。
      return currentVersion ? "已是最新版本（" + currentVersion + "）" : "已是最新版本";
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
  const currentVersion = appInfo?.version ?? "";
  const manifest = snapshot.manifest;
  const asset = manifest ? androidUpdateAsset(manifest) : null;
  // 261120：发版说明按需加载（原 ?raw 静态导入会把 57KB 文本打进首屏资源图，见 lib/releaseNotesText.ts）。
  const [releaseNotesText, setReleaseNotesText] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void loadReleaseNotesText()
      .then((text) => { if (alive) setReleaseNotesText(text); })
      .catch(() => { /* 读不到就只显示清单里的 notes（下方已有兜底） */ });
    return () => { alive = false; };
  }, []);
  const notesVersions = useMemo(
    () => (releaseNotesText ? parseReleaseNotes(releaseNotesText) : []),
    [releaseNotesText],
  );
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
      <Group>
        <Item
          itemId="update-check"
          name="检查更新"
          desc={statusText(snapshot, settings, currentVersion)}
          icon={<RefreshCw size={16} />}
          tone="#3f5fa0"
        >
          <button
            type="button"
            className="mb-btn mb-btn--outlined mb-btn--sm"
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

        {/* 261116 用户点单：与桌面同口径——只留 24 小时 / 每周 / 每月（关闭由上方「自动检查」开关承担；
            历史 0 / 6 / 12 在模型里已归一，这里再把不在档位里的值显示成默认 24，避免选择器空白）。 */}
        <Field itemId="update-check-interval" name="检查间隔" desc="按这个间隔在后台检查；不想自动检查就关掉上面的「自动检查」（仍可手动检查）。">
          <PickerSheet
            label="检查间隔"
            value={INTERVAL_OPTION_VALUES.includes(settings.checkIntervalHours) ? settings.checkIntervalHours : 24}
            options={UPDATE_CHECK_INTERVAL_OPTIONS.map((hours) => ({ value: hours, label: INTERVAL_LABELS[hours] }))}
            onChange={(hours) => applySettings({ checkIntervalHours: hours })}
          />
        </Field>

        <Switch
          itemId="update-auto-download"
          name="自动下载"
          desc="仅用于后台自动检查：发现新版本即在后台下载（不会自动安装）。手动检查不会自动下载，由你点「下载并安装」或「前往发布页」。"
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
          <button type="button" className="mb-btn mb-btn--outlined mb-btn--sm" onClick={() => setNotesSheetOpen(true)}>
            查看
          </button>
        </Item>
      </Group>

      <MobileSheet
        open={updateSheetOpen}
        title={snapshot.status === "downloaded" ? "更新已下载" : "发现新版本"}
        onClose={() => setUpdateSheetOpen(false)}
        footer={
          // 261119 按钮边界审计 B-2/B-9：footer 收进 SheetFooter（.mb-sheet__foot 唯一底栏几何：8/16/20+safe）；
          // 多按钮走 children 保持「主 + 次 + ghost」梯队与顺序，主操作加 mb-flex1（不再与次操作同宽排队）。
          <SheetFooter>
            {snapshot.status === "available" && asset ? (
              <button type="button" className="mb-btn mb-btn--primary mb-flex1" onClick={() => void startUpdateDownload()}>
                <Download size={16} />下载并安装
              </button>
            ) : null}
            {snapshot.status === "downloading" ? (
              <button type="button" className="mb-btn mb-btn--secondary mb-flex1" onClick={() => void cancelUpdateDownload()}>
                取消下载
              </button>
            ) : null}
            {snapshot.status === "downloaded" ? (
              <button type="button" className="mb-btn mb-btn--primary mb-flex1" onClick={() => void installDownloadedUpdate()}>
                安装
              </button>
            ) : null}
            {snapshot.status === "error" ? (
              <button type="button" className="mb-btn mb-btn--primary mb-flex1" onClick={() => void startUpdateDownload()}>
                重试下载
              </button>
            ) : null}
            <button type="button" className="mb-btn mb-btn--secondary" onClick={openUpdateReleasePage}>
              前往发布页
            </button>
            {snapshot.status === "available" ? (
              <button type="button" className="mb-btn mb-btn--ghost" onClick={ignoreThisVersion}>
                忽略此版本
              </button>
            ) : null}
          </SheetFooter>
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
