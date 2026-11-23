// 261112 R2-S7：设置页「backup」分组（纯搬移自 SettingsPanel.tsx；只改文件位置，不改任何设置项/文案）。
import type { SettingsPanelContext } from "../useSettingsPanelScope";
import { Group, Block, Switch, Item, NumField } from "../../../ui/settingsPrimitives";
import { Archive, RotateCcw, Download } from "lucide-react";
import { AdaptiveSelect } from "../../../ui/AdaptiveSelect";
import { hostCapabilities } from "../../../../lib/hostCapabilities";

export function BackupSection({ c }: { c: SettingsPanelContext }) {
  const { backup, backupCfg, backupResult, backupText, backupUsageBusy, backupUsageInfo, cloudOffline, loadBackupUsage, loadPortableStatus, portable, portableProgress, portableProgressText, portableStatusText, revealFolder, runBackup, runBackupNow, runCloudRestore, runPortableExport, runPortableImport, runRestoreFromBackup, runRestoreFromBackupDir, saveBackupCfg } = c;
  return (
    <>
              <>
                <Group title="备份" icon={<Archive size={16} />}>
                  {/* 261116 用户验收：单动作行统一「说明在左、操作在右」（原 descAfter + 左起按钮会留一条空带）。 */}
                  <Item itemId="backup-export" name="整库备份（完整目录）" desc="完整复制工作区到所选目录（含历史快照与 AI 会话，无大小限制）；同端换机/留档用，跨端迁移用「便携包」。">
                    <button className="ln-btn ln-btn--outlined" onClick={() => void runBackup()} disabled={backup.busy}><Archive size={14} /> {backup.busy ? "备份中…" : "整库备份到…"}</button>
                  </Item>
                  <Block itemId="auto-backup" name="自动备份（仅数据库）" desc="每天/每周自动快照数据库到本机（仅数据库，不含正文/资源/历史）；恢复用「从数据库快照恢复」。">
                    {backupCfg ? (
                      <>
                        <Switch itemId="auto-backup-enabled" name="启用自动备份" desc="按「备份间隔」自动执行，内容未变则跳过；关闭后仍可手动备份。" checked={backupCfg.enabled} onChange={(checked) => saveBackupCfg({ enabled: checked })} />
                        <Item itemId="auto-backup-interval" name="备份间隔" desc="每天或每周，按上次成功备份时间计算。">
                          {/* A13（261115 试点 / 261116 推广）：逐档写盘无害的 2 选项；支持 base-select 用原生，否则同位置退回自研 Select。
                              ⚠️ 原生下拉在闭态按 ↑/↓ 会直接改值并派发 change（这里是「每天/每周」两档，最安全）。 */}
                          <AdaptiveSelect label="备份间隔" value={String(backupCfg.intervalDays)} onChange={(v) => saveBackupCfg({ intervalDays: Number(v) })} options={[
                            { value: "1", label: "每天" }, { value: "7", label: "每周" },
                          ]} />
                        </Item>
                        <Item itemId="auto-backup-keep" name="保留份数" desc="保留最近 N 份，超出删最旧；备份总大小上限 300MB。"><NumField label="保留份数" min={1} max={50} value={backupCfg.keepCount} onSave={(value) => saveBackupCfg({ keepCount: value })} floor={1} fallback={7} /></Item>
                        <div className="config-block__actions">
                          <button className="ln-btn ln-btn--outlined" onClick={() => void runBackupNow()} disabled={backup.busy}>{backup.busy ? "备份中…" : "立即备份数据库"}</button>
                        </div>
                      </>
                    ) : (
                      <div className="config-stats"><span>读取自动备份配置…</span></div>
                    )}
                  </Block>
                  <Block itemId="backup-usage" name="数据库快照占用" desc="只读统计数据库快照的份数与占用；不提供手动删除（防误删兜底数据）。">
                    <div className="config-block__actions">
                      <button className="ln-btn ln-btn--outlined" onClick={() => void loadBackupUsage()} disabled={backupUsageBusy}>{backupUsageBusy ? "统计中…" : "刷新统计"}</button>
                      <button className="ln-btn ln-btn--outlined" onClick={() => void revealFolder("backups")}>打开备份目录</button>
                    </div>
                    <div className="config-stats">
                      <span>{backupUsageInfo.countText}</span>
                      {backupUsageInfo.sizeText && <span>{backupUsageInfo.sizeText}</span>}
                      {backupUsageInfo.limitText && <span>{backupUsageInfo.limitText}</span>}
                      {backupUsageInfo.newestText && <span>{backupUsageInfo.newestText}</span>}
                    </div>
                    {backupUsageInfo.note && (
                      <div className="checks">
                        <div className={"checks__row checks__row--" + (backupUsageInfo.tone === "warn" ? "warn" : "ok")}>{backupUsageInfo.note}</div>
                      </div>
                    )}
                  </Block>
                  <Block itemId="backup-last-result" name="上次数据库备份结果" desc="最近一次备份的结果与失败原因（仅存本机）；「部分成功」= 主库可用、小记库或校验失败。" descAfter>
                    {backupResult ? (
                      <div className="checks">
                        <div className={"checks__row checks__row--" + backupResult.tone}>{backupResult.headline}</div>
                        {backupResult.message && <div className="checks__row">{backupResult.message}</div>}
                        {backupResult.guidance && <div className={"checks__row checks__row--" + backupResult.tone}>{backupResult.guidance}</div>}
                        {backupResult.retry && (
                          <div className="config-block__actions">
                            <button className="ln-btn ln-btn--outlined" onClick={() => void runBackupNow()} disabled={backup.busy}>{backup.busy ? "备份中…" : "立即备份数据库"}</button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="block__text">还没有备份记录。</div>
                    )}
                  </Block>
                </Group>

                <Group title="恢复" icon={<RotateCcw size={16} />}>
                  <Item itemId="backup-restore-dir" name="从整库备份恢复（完整目录）" desc="用「整库备份」目录整库替换当前工作区；当前工作区改名隔离（不删除、可找回），重启生效。">
                    <button className="ln-btn ln-btn--outlined" onClick={() => void runRestoreFromBackupDir()} disabled={backup.busy}>选择备份目录…</button>
                  </Item>
                  <Item itemId="backup-import" name="从数据库快照恢复" desc="用数据库快照替换当前库（先校验；当前库改名隔离、可找回），重启生效；正文/资源/历史需整库备份。">
                    <button className="ln-btn ln-btn--outlined" onClick={() => void runRestoreFromBackup()} disabled={backup.busy}>从备份恢复…</button>
                  </Item>
                  <Item itemId="backup-restore" name="从云端恢复" desc="本机数据改名隔离后从云端拉取重建（不上传本机数据），用于换机或坏库。">
                    <button className="ln-btn ln-btn--outlined ln-btn--danger" onClick={() => void runCloudRestore()} disabled={backup.busy || cloudOffline} title={cloudOffline ? "云同步未启用：不会联网" : undefined}>从云端恢复（换机/坏库）…</button>
                  </Item>
                </Group>

                <Group title="迁入迁出（便携包）" icon={<Download size={16} />}>
                  {/* 261116 用户验收：说明回位到标题下（descAfter 会把说明甩到最后，中间留空带）。 */}
                  <Block itemId="backup-portable-export" name="迁出：导出便携包（.zip.lln）" desc="打包全部跨端数据为 .zip.lln（上限 4GiB；不含历史快照与 AI 会话，需保留历史用「整库备份」），手机/其它桌面均可导入。包内带同步基线，导入端配好 S3 即增量同步；包内为明文笔记、不含 S3 密钥。">
                    <div className="config-block__actions">
                      <button
                        className="ln-btn ln-btn--outlined"
                        onClick={() => void runPortableExport()}
                        disabled={portable.busy || !hostCapabilities().localFileSystem}
                      >
                        {portable.busy ? "导出中…" : "选择目录并导出…"}
                      </button>
                      <button className="ln-btn ln-btn--outlined" onClick={() => void loadPortableStatus()} disabled={portable.busy}>刷新状态</button>
                    </div>
                    <div className="config-stats">
                      <span>{portableStatusText}</span>
                    </div>
                    {portableProgress && <div className="block__text">{portableProgressText}</div>}
                    {portable.message && <div className="block__text">{portable.message}</div>}
                  </Block>
                  <Item itemId="backup-portable-import" name="迁入：从便携包导入（覆盖本机）" desc="用 .zip.lln 整库替换当前工作区（当前工作区改名隔离、可找回，重启生效）；配好 S3 即增量同步。历史快照与 S3 密钥不随包。">
                    <button className="ln-btn ln-btn--outlined" onClick={() => void runPortableImport()} disabled={portable.busy || !hostCapabilities().localFileSystem}>选择便携包导入…</button>
                  </Item>
                </Group>

                {backupText && <Block name={backupText} />}
              </>
    </>
  );
}
