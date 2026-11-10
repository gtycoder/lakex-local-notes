/**
 * 更新中心（桌面，261109）：设置分类「更新」的独立页面 —— 不再用弹窗，也不再混进「关于」。
 *
 * 口径见 docs/UPDATE-CENTER.md：
 * - 只有稳定版（GitHub latest）；不做静默安装（下载后由用户打开安装包）；
 * - 自动检查/自动下载默认开；忽略版本只影响提示与自动下载，手动检查仍能看到；
 * - UI 只用既有原语（settingsPrimitives 的 Group/Item/Switch + ui/Select + MarkdownView）与 --lake-* 令牌，
 *   不写内联静态样式、不新增 CSS/依赖。
 */
import { useCallback, useEffect, useState } from "react";
import { Block, Group, Item, Switch } from "../ui/settingsPrimitives";
import { Select } from "../ui/Select";
import { native } from "../../lib/native";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { formatBytes } from "../../core/update/updateManifest";
import { UPDATE_CHECK_INTERVAL_OPTIONS, type UpdateSettingsPatch, type UpdateState } from "../../core/update/updateTypes";
import { formatDateTime } from "../../core/dateFormat";
import { MarkdownView } from "../ui/markdown/MarkdownView";
import RELEASE_NOTES from "../../../docs/RELEASE-NOTES.md?raw";

const INTERVAL_LABELS: Record<number, string> = { 0: "关闭", 6: "6 小时", 12: "12 小时", 24: "24 小时" };

function statusText(state: UpdateState | null): string {
  if (!state) return "读取中…";
  switch (state.status) {
    case "checking": return "正在检查更新…";
    case "up-to-date": return "已是最新版本";
    case "available": return state.ignored ? "发现新版本（此版本已忽略，下个版本会恢复提示）" : "发现新版本";
    case "downloading": return "正在下载安装包…";
    case "downloaded": return "安装包已下载，可以打开安装";
    case "error": return state.lastError ?? "检查更新失败";
    default: return "尚未检查（可点「检查更新」）";
  }
}

export function UpdateCenterSection() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void native.updateGetState()
      .then((next) => { if (alive) setState(next); })
      .catch((reason) => { if (alive) setError(getNativeErrorMessage(reason)); });
    const off = native.onUpdateState((next) => setState(next));
    return () => { alive = false; off(); };
  }, []);

  const run = useCallback(async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(getNativeErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }, []);

  const check = () => void run(async () => { setState(await native.updateCheck()); });
  const download = () => void run(async () => { setState(await native.updateDownload()); });
  const openFile = () => void run(() => native.updateOpenFile());
  const openReleasePage = () => void run(() => native.updateOpenReleasePage());
  const ignore = (): void => {
    const version = state?.manifest?.version;
    if (!version) return;
    void run(async () => { await native.updateIgnoreVersion(version); });
  };
  const saveSettings = (patch: UpdateSettingsPatch): void => {
    void run(async () => {
      const settings = await native.updateSetSettings(patch);
      setState((prev) => (prev ? { ...prev, settings } : prev));
    });
  };

  const settings = state?.settings ?? null;
  const manifest = state?.manifest ?? null;
  const asset = state?.asset ?? null;
  const ignored = state?.ignored ?? false;
  const downloading = state?.status === "downloading";
  const downloaded = state?.status === "downloaded";
  const checking = state?.status === "checking";
  const progress = state?.progress ?? null;
  const percent = progress && progress.total > 0 ? Math.min(100, Math.floor((progress.received / progress.total) * 100)) : 0;
  const canDownload = Boolean(manifest && asset) && !downloading && !downloaded && !ignored;
  const publishedDate = manifest ? new Date(manifest.publishedAt) : null;
  const publishedText = manifest
    ? (publishedDate && !Number.isNaN(publishedDate.getTime()) ? formatDateTime(publishedDate) : manifest.publishedAt)
    : "";

  return (
    <>
      <Group title="版本与检查">
        <Item
          itemId="update-check"
          name="当前版本"
          desc={"v" + (state?.currentVersion ?? "—") + " · 上次检查：" + (state?.lastCheckAt ? formatDateTime(new Date(state.lastCheckAt)) : "从未")}
        >
          <button type="button" className="ln-btn ln-btn--outlined" disabled={busy || checking} onClick={check}>
            {checking ? "检查中…" : "检查更新"}
          </button>
        </Item>
        <Item itemId="update-status" name="状态" desc={statusText(state)} />
      </Group>

      {manifest && asset && (
        <Group title="可用更新">
          <Item
            itemId="update-available"
            name={"新版本 v" + manifest.version}
            desc={"发布于 " + publishedText + " · 安装包 " + formatBytes(asset.size) + (ignored ? " · 已忽略此版本" : "")}
          >
            <span className="config-item__ctl">
              {downloaded ? (
                <button type="button" className="ln-btn ln-btn--outlined" disabled={busy} onClick={openFile}>打开安装包</button>
              ) : (
                <button type="button" className="ln-btn ln-btn--outlined" disabled={busy || !canDownload} onClick={download}>
                  {downloading ? "下载中… " + percent + "%" : "下载安装包"}
                </button>
              )}
            </span>
          </Item>
          {(downloading || downloaded || progress) && (
            <Block name="下载进度">
              <p className="config-note" role="status">
                {downloaded
                  ? "安装包已下载完成（sha256 已校验）：" + formatBytes(asset.size)
                  : "已下载 " + formatBytes(progress?.received ?? 0) + " / " + formatBytes(asset.size) + "（" + percent + "%）"}
              </p>
            </Block>
          )}
          {manifest.notes.trim() !== "" && (
            <Block name="更新内容">
              <MarkdownView source={manifest.notes} />
            </Block>
          )}
          <Item itemId="update-actions" name="其它操作" desc="前往 GitHub 发布页（当前最新 tag）手动下载；或忽略此版本（下个版本恢复提示）。">
            <span className="config-item__ctl">
              <button type="button" className="ln-btn ln-btn--outlined" disabled={busy} onClick={openReleasePage}>前往发布页</button>
              {!ignored && (
                <button type="button" className="ln-btn ln-btn--ghost" disabled={busy} onClick={ignore}>忽略此版本</button>
              )}
            </span>
          </Item>
        </Group>
      )}

      <Group title="自动更新">
        <Switch
          itemId="update-auto-check"
          name="自动检查"
          desc="启动时检查一次，并按下面的频率在后台检查（默认开）。"
          checked={settings?.autoCheck ?? true}
          disabled={!settings || busy}
          onChange={(checked) => saveSettings({ autoCheck: checked })}
        />
        <Item itemId="update-check-interval" name="检查频率" desc="「关闭」= 不自动检查，仍可手动检查。">
          <Select
            label="自动检查频率"
            value={String(settings?.checkIntervalHours ?? 24)}
            options={UPDATE_CHECK_INTERVAL_OPTIONS.map((hours) => ({ value: String(hours), label: INTERVAL_LABELS[hours] }))}
            onChange={(value) => saveSettings({ checkIntervalHours: Number(value) as UpdateSettingsPatch["checkIntervalHours"] })}
            disabled={!settings || busy}
          />
        </Item>
        <Switch
          itemId="update-auto-download"
          name="自动下载"
          desc="仅用于后台自动检查：发现新版本即在后台下载（默认开）。手动点「检查更新」不会自动下载，由你决定下载或前往发布页；下载后也不会自动安装。"
          checked={settings?.autoDownload ?? true}
          disabled={!settings || busy}
          onChange={(checked) => saveSettings({ autoDownload: checked })}
        />
      </Group>

      <Group title="更新日志">
        <Item itemId="update-release-notes" name="更新日志（当前版本及历史）" desc="与 GitHub Release body 同源：docs/RELEASE-NOTES.md。">
          <button type="button" className="ln-btn ln-btn--outlined" onClick={() => setNotesOpen((value) => !value)}>
            {notesOpen ? "收起" : "查看更新日志"}
          </button>
        </Item>
        {notesOpen && <Block><MarkdownView source={RELEASE_NOTES} /></Block>}
      </Group>

      {error && <p className="config-note" role="alert">{error}</p>}
    </>
  );
}
