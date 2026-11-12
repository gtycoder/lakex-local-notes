// 261112 R2-S7：设置页「backup」分组（纯搬移自 SettingsPanel.tsx；只改文件位置，不改任何设置项/文案）。
import type { SettingsPanelContext } from "../useSettingsPanelScope";
import { Group, Block, Switch, Item, NumField } from "../../../ui/settingsPrimitives";
import { Archive, RotateCcw, Download, HardDrive } from "lucide-react";
import { Select } from "../../../ui/Select";
import { hostCapabilities } from "../../../../lib/hostCapabilities";

export function BackupSection({ c }: { c: SettingsPanelContext }) {
  const { backup, backupCfg, backupResult, backupText, backupUsageBusy, backupUsageInfo, cloudOffline, loadBackupUsage, loadPortableStatus, portable, portableProgress, portableProgressText, portableStatusText, revealFolder, runBackup, runBackupNow, runCloudRestore, runPortableExport, runRestoreFromBackup, saveBackupCfg } = c;
  return (
    <>
              <>
                <Group title="备份" icon={<Archive size={16} />}>
                  <Block itemId="backup-export" name="整库备份（完整目录）" desc="完整复制工作区：数据库快照 + 正文/资源/历史快照 + 小记，导出到所选空目录。用于整机迁移或归档；与下面的数据库快照互补，不能互相替代。" descAfter>
                    <div className="config-block__actions">
                      <button className="ln-btn ln-btn--outlined" onClick={() => void runBackup()} disabled={backup.busy}><Archive size={14} /> {backup.busy ? "备份中…" : "整库备份到…"}</button>
                    </div>
                  </Block>
                  <Block itemId="auto-backup" name="自动备份（仅数据库）" desc="每天/每周把主库与小记库 VACUUM INTO 快照到 userData/backups，保留最近 N 份并限制总大小（本机保存、不进云端）。只备份数据库，不含正文/资源/历史快照；恢复用「从数据库快照恢复」。">
                    {backupCfg ? (
                      <>
                        <Switch itemId="auto-backup-enabled" name="启用自动备份" desc="应用就绪后每 6 小时检查一次（启动不会立刻跑）；内容未变则跳过。关闭后仍可用「立即备份数据库」。" checked={backupCfg.enabled} onChange={(checked) => saveBackupCfg({ enabled: checked })} />
                        <Item itemId="auto-backup-interval" name="备份间隔" desc="每天或每周（按上次成功备份时间计算；错过的会在下一次 6h 检查时补跑）。">
                          <Select label="备份间隔" value={String(backupCfg.intervalDays)} onChange={(v) => saveBackupCfg({ intervalDays: Number(v) })} options={[
                            { value: "1", label: "每天" }, { value: "7", label: "每周" },
                          ]} />
                        </Item>
                        <Item itemId="auto-backup-keep" name="保留份数" desc="保留最近 N 份（超出按最旧优先删除；备份目录总大小上限 300MB，删除失败只记日志）。"><NumField label="保留份数" min={1} max={50} value={backupCfg.keepCount} onSave={(value) => saveBackupCfg({ keepCount: value })} floor={1} fallback={7} /></Item>
                        <div className="config-block__actions">
                          <button className="ln-btn ln-btn--outlined" onClick={() => void runBackupNow()} disabled={backup.busy}>{backup.busy ? "备份中…" : "立即备份数据库"}</button>
                        </div>
                      </>
                    ) : (
                      <div className="config-stats"><span>读取自动备份配置…</span></div>
                    )}
                  </Block>

                </Group>

                <Group title="恢复" icon={<RotateCcw size={16} />}>
                  <Block itemId="backup-import" name="从数据库快照恢复" desc="选择一个数据库快照（metadata*.sqlite3）：先校验完整性/关键表，再把当前库改名隔离（不删除、可找回）并替换，重启应用后生效。只恢复数据库；正文/资源/历史需用整库备份。" descAfter>
                    <div className="config-block__actions">
                      <button className="ln-btn ln-btn--outlined" onClick={() => void runRestoreFromBackup()} disabled={backup.busy}>从备份恢复…</button>
                    </div>
                  </Block>
                  <Block itemId="backup-restore" name="从云端恢复" desc="当前数据先改名隔离保存，再从云端全量拉取重建（不会上传本机数据）。用于换机或本地库损坏。" descAfter>
                    <div className="config-block__actions">
                      <button className="ln-btn ln-btn--outlined ln-btn--danger" onClick={() => void runCloudRestore()} disabled={backup.busy || cloudOffline} title={cloudOffline ? "云同步未启用：不会联网" : undefined}>从云端恢复（换机/坏库）…</button>
                    </div>
                  </Block>
                </Group>

                <Group title="迁移到手机" icon={<Download size={16} />}>
                  <Block itemId="backup-portable-export" name="导出便携包（桌面 → 手机）" descAfter desc="把本机全部数据（正文/资源/小记/标签/回收站，不含历史快照）打成一个 .zip.lln（上限 4GiB），经网盘或 USB 拷到手机后导入。未配置 S3 也能离线导出；若已开启云同步，导出前会先同步一次，手机之后只需增量同步。包内是明文笔记，请自行选择传输方式；不包含任何 S3 密钥。">
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
                </Group>

                <Group title="存储占用" icon={<HardDrive size={16} />}>
                  <Block itemId="backup-usage" name="数据库快照占用" desc="只读统计 userData/backups 里的数据库快照份数与总大小（只 stat、不读文件内容）。自动备份按「保留份数」与总大小上限删最旧的备份；这里不提供手动删除，避免误删兜底数据。" descAfter>
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
                  <Block itemId="backup-last-result" name="上次数据库备份结果" desc="最近一次自动/手动备份的结果（本机记录，不上传云端）：成功 / 部分成功 / 失败，以及可读的失败原因。部分成功 = 主库备份可用，但小记库不可用或备份校验失败。" descAfter>
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
                      <div className="block__text">还没有备份记录（自动备份默认开启，每天一份；也可以点上面的「立即备份数据库」）。</div>
                    )}
                  </Block>
                </Group>

                {backupText && <Block name={backupText} />}
              </>
    </>
  );
}
