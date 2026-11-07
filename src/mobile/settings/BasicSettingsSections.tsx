import { History, Palette, Info } from "lucide-react";
import { Group, Item, Seg, NumField } from "../ui/settingsPrimitives";
import type { AppSettings } from "../../lib/settings";
import type { HistoryMobileSettings } from "../bridge";
import type { useSettingsSectionData } from "./useSettingsSectionData";
import { S3V3_POINTER_VERSION } from "../../core/s3v3/protocol/s3v3Types";
import { HISTORY_SETTINGS_DEFAULTS } from "../../core/settingsDefaults";
import { formatBytes } from "../../lib/formatBytes";
import { formatCrashEntries, readCrashLog } from "../lib/crashLog";
import { showToast } from "../ui/toastBus";
const LAKEX_KERNEL_VERSION = "1.99.0";

export function AppearanceSettingsSection({ settings, update }: { settings: AppSettings; update(patch: Partial<AppSettings>): void }) {
  return (
            <Group title="外观" icon={<Palette size={16} />}>
              {/* 用户 261012：说明文案去掉，只留选项（名字即语义）；261107 v2 增加「纯黑（OLED）」。 */}
              <Item itemId="appearance-theme" name="主题" icon={<Palette size={16} />} tone="#b9822f">
                <Seg ariaLabel="主题">
                  <button className={"mb-btn mb-btn--secondary mb-segment__item" + (settings.theme === "light" ? " is-active" : "")} onClick={() => update({ theme: "light", oled: false })}>浅色</button>
                  <button className={"mb-btn mb-btn--secondary mb-segment__item" + (settings.theme === "dark" && !settings.oled ? " is-active" : "")} onClick={() => update({ theme: "dark", oled: false })}>深色</button>
                  <button className={"mb-btn mb-btn--secondary mb-segment__item" + (settings.theme === "dark" && settings.oled ? " is-active" : "")} onClick={() => update({ theme: "dark", oled: true })}>纯黑</button>
                </Seg>
              </Item>
            </Group>
  );
}
export function HistorySettingsSection({ hist, updateHist }: { hist: HistoryMobileSettings; updateHist(patch: Partial<HistoryMobileSettings>): void }) {
  return (
            <Group title="历史" icon={<History size={16} />}>
              <Item itemId="history-max-snapshots" name="每文档快照上限" desc="超过后只保留最新 N 份。">
                <NumField label="每文档快照上限" value={hist.maxSnapshots} min={1} max={500} floor={1} fallback={100} onSave={(n) => updateHist({ maxSnapshots: n })} />
              </Item>
              <Item itemId="history-retention-days" name="保留天数" desc="超过该天数的快照会被清理。">
                <NumField label="保留天数" value={hist.retentionDays} min={1} max={365} floor={1} fallback={30} onSave={(n) => updateHist({ retentionDays: n })} />
              </Item>
              <Item itemId="history-snapshot-interval" name="自动快照间隔（分钟）" desc="0 = 关闭定时自动快照。">
                <NumField label="自动快照间隔" value={hist.snapshotIntervalMinutes} min={0} max={1440} floor={0} fallback={HISTORY_SETTINGS_DEFAULTS.snapshotIntervalMinutes} onSave={(n) => updateHist({ snapshotIntervalMinutes: n })} />
              </Item>
              <Item itemId="history-cleanup-interval" name="定期清理间隔（小时）" desc="0 = 关闭定期巡检清理。">
                <NumField label="定期清理间隔" value={hist.cleanupIntervalHours} min={0} max={168} floor={0} fallback={24} onSave={(n) => updateHist({ cleanupIntervalHours: n })} />
              </Item>
            </Group>
  );
}
export function AboutSettingsSection({ appInfo, diag }: { appInfo: ReturnType<typeof useSettingsSectionData>["appInfo"]; diag: ReturnType<typeof useSettingsSectionData>["diagnostics"] }) {
  return (
            <div className="mb-set-group">
              <div className="mb-set-title"><Info size={16} />关于</div>
              <div className="mb-set-items">
                <div className="mb-set-block">
                  <div className="mb-set-block__name">{appInfo?.name ?? "LakexLocalNotes"}</div>
                  <div className="mb-set-item__desc">版本 {appInfo?.version ?? "…"}（构建 {appInfo?.build ?? "…"}）</div>
                  <div className="mb-set-item__desc">平台：{appInfo?.platform === "web" ? "Web 预览（原生能力未就绪）" : "Android，Capacitor 8 + 原生 SQLite"}</div>
                  <div className="mb-set-item__desc">编辑器：Lake 内核 v{LAKEX_KERNEL_VERSION}</div>
                  <div className="mb-set-item__desc">Lake 为语雀闭源第三方产物，以 vendored 形式随仓库及构建产物包含；本项目与语雀/蚂蚁无关，未取得官方分发授权，详见仓库 NOTICE。</div>
                  <div className="mb-set-item__desc">同步：S3 协议 v{String(S3V3_POINTER_VERSION)}（内容寻址）；本地是真相，S3 只做同步镜像</div>
                  <div className="mb-set-item__desc">本地优先：正文、附件与索引都保存在本机。</div>
                  <div className="mb-set-item__desc">字体：内置 MiSans（小米科技，依《MiSans 字体知识产权许可协议》免费商用并注明）+ JetBrains Mono（SIL OFL 1.1）</div>
                </div>
                {diag && (
                  <div className="mb-set-block">
                    <div className="mb-set-block__name">数据诊断</div>
                    <div className="mb-set-stats">
                      <span><strong>文档</strong> {diag.noteCount}</span>
                      <span><strong>分组</strong> {diag.folderCount}</span>
                      <span><strong>小记</strong> {diag.quickNoteCount}</span>
                      <span><strong>资源</strong> {diag.resourceCount}</span>
                      <span><strong>孤儿</strong> {diag.orphanCount}</span>
                      <span><strong>待回收</strong> {diag.gcPendingCount}</span>
                      <span><strong>快照</strong> {diag.snapshotCount}</span>
                      <span><strong>库大小</strong> {formatBytes(diag.dbBytes)}</span>
                    </div>
                    {/* 261105：设置页也能导出诊断（含最近崩溃记录；dev 控制台另有 __lakeCrashLog()）。 */}
                    <div className="mb-set-block__actions">
                      <button
                        type="button"
                        className="mb-btn mb-btn--secondary"
                        onClick={() => {
                          const lines = [
                            "时间：" + new Date().toISOString(),
                            "应用：" + (appInfo?.name ?? "LakexLocalNotes") + " " + (appInfo?.version ?? "?") + "（构建 " + (appInfo?.build ?? "?") + "）",
                            "平台：" + (appInfo?.platform ?? "unknown"),
                            "环境：" + (typeof navigator === "undefined" ? "unknown" : navigator.userAgent),
                            "数据：文档 " + diag.noteCount + " / 分组 " + diag.folderCount + " / 小记 " + diag.quickNoteCount
                              + " / 资源 " + diag.resourceCount + " / 孤儿 " + diag.orphanCount + " / 快照 " + diag.snapshotCount
                              + " / 库 " + diag.dbBytes + " B",
                          ];
                          const crashes = formatCrashEntries(readCrashLog(10));
                          lines.push("", "最近崩溃记录：", ...(crashes.length > 0 ? crashes : ["（无）"]));
                          void navigator.clipboard.writeText(lines.join("\n"))
                            .then(() => showToast("诊断信息已复制"))
                            .catch(() => showToast("复制失败，请记录屏幕上的错误信息", { type: "error" }));
                        }}
                      >复制诊断信息</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
  );
}
