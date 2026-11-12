// 261112 R2-S7：设置页「history」分组（纯搬移自 SettingsPanel.tsx；只改文件位置，不改任何设置项/文案）。
import type { SettingsPanelContext } from "../useSettingsPanelScope";
import { Group, Block, Item, NumField } from "../../../ui/settingsPrimitives";
import { History, Trash } from "lucide-react";
import { formatBytes } from "../../../../lib/formatBytes";
import { formatDateTime } from "../../../../core/dateFormat";

export function HistorySection({ c }: { c: SettingsPanelContext }) {
  const { hist, histCfg, histText, lastCleanup, runCleanup, saveHistCfg, stats } = c;
  return (
    <>
              <>
                <Group title="文档历史" icon={<History size={16} />}>
                  <Block itemId="history-stats" name="快照占用" desc="历史快照保存在本机，不参与同步。恢复前会自动保存当前版本。">
                    <div className="config-stats">
                      <span>快照 <strong>{stats ? stats.snapshotCount : "—"}</strong> 份</span>
                      <span>{stats ? formatBytes(stats.totalBytes) : "统计中…"}</span>
                      {lastCleanup && <span>上次清理 {formatDateTime(new Date(lastCleanup.at))}，{lastCleanup.deletedSnapshots} 份，{formatBytes(lastCleanup.freedBytes)}</span>}
                    </div>
                    <div className="config-block__actions">
                      <button className="ln-btn ln-btn--outlined" onClick={() => void runCleanup()} disabled={hist.busy}><Trash size={14} /> {hist.busy ? "清理中…" : "立即清理"}</button>
                    </div>
                    {histText && <div className="block__text">{histText}</div>}
                  </Block>
                  {histCfg && (
                    <>
                      <Item itemId="history-max-snapshots" name="每文档上限" desc="单篇文档最多保留的快照份数。"><NumField label="每文档上限" min={20} max={1000} value={histCfg.maxSnapshots} onSave={(v) => saveHistCfg({ maxSnapshots: v })}  floor={1} fallback={100} /></Item>
                      <Item itemId="history-retention-days" name="保留天数" desc="超期的自动快照会被定期清理；手动快照与冲突留档另计。"><NumField label="保留天数" min={1} max={365} value={histCfg.retentionDays} onSave={(v) => saveHistCfg({ retentionDays: v })}  floor={1} fallback={30} /></Item>
                      <Item itemId="history-cleanup-interval" name="定期清理（小时）" desc="0 = 不自动清理。"><NumField label="定期清理（小时）" min={0} max={720} value={histCfg.cleanupIntervalHours} onSave={(v) => saveHistCfg({ cleanupIntervalHours: v })}  floor={0} fallback={24} /></Item>
                      <Item itemId="history-snapshot-interval" name="自动快照（分钟）" desc="定时兜底：每 N 分钟给「自上次兜底后有正文改动」的文档留一份历史快照（同内容 24 小时内只留一份，仍受每文档上限与保留天数约束；0 = 关闭）。代价：磁盘占用增加，间隔越短增长越快。"><NumField label="自动快照（分钟）" min={0} max={1440} value={histCfg.snapshotIntervalMinutes} onSave={(v) => saveHistCfg({ snapshotIntervalMinutes: v })}  floor={0} fallback={10} /></Item>
                    </>
                  )}
                </Group>
              </>
    </>
  );
}
