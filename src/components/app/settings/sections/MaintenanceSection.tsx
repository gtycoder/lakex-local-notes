// 261112 R2-S7：设置页「maintenance」分组（纯搬移自 SettingsPanel.tsx；只改文件位置，不改任何设置项/文案）。
import type { SettingsPanelContext } from "../useSettingsPanelScope";
import { Group, Item, NumField, Block } from "../../../ui/settingsPrimitives";
import { Trash, Search, Image as Info, Archive, Terminal } from "lucide-react";
import { formatDateTime } from "../../../../core/dateFormat";
import { RebuildDataBlock } from "../../RebuildDataBlock";
import { native } from "../../../../lib/native";

export function MaintenanceSection({ c }: { c: SettingsPanelContext }) {
  const { confirm, gcCfg, health, healthCheck, logKeyword, logLoad, logRows, logText, rebuildSearchIndex, runHealth, runLogLoad, saveGcCfg, saveScanInterval, scanIntervalHours, searchIndex, searchText, setLogKeyword } = c;
  return (
    <>
              <>
              <Group title="回收站" icon={<Trash size={16} />}>
                {gcCfg && (
                  <Item itemId="trash-auto-purge-days" name="回收站自动过期（天）" desc="0 = 关闭。到期后自动彻底删除（含云端），不可撤销；需要保留请在到期前恢复。">
                    <NumField label="回收站自动过期（天）" min={0} max={365} value={gcCfg.trashAutoPurgeDays} onSave={(v) => saveGcCfg({ trashAutoPurgeDays: v })}  floor={0} fallback={0} />
                  </Item>
                )}
                <Block desc="回收站内容随云同步到所有设备；彻底删除会同时删除云端数据且不可撤销。" />
              </Group>

              <Group title="全文搜索" icon={<Search size={16} />}>
                <Item itemId="search-rebuild" name="重建全文搜索索引" desc="标题与正文的全文索引（FTS5，中文单字分词），平时自动维护；索引异常或更换分词器后可手动重建。">
                  {searchText && <span className="ln-label__text">{searchText}</span>}
                  <button className="ln-btn ln-btn--outlined" disabled={searchIndex.busy} onClick={() => void rebuildSearchIndex()}>{searchIndex.busy ? "重建中…" : "重建"}</button>
                </Item>
              </Group>

                <Group title="数据体检（只读诊断）" icon={<Info size={16} />}>
                  <Block itemId="history-data-health" name="一致性检查" desc="只读检查正文文件、历史快照、未归属记录与引用资源，不会自动修复。发现问题请从备份或云端恢复。">
                    <div className="config-block__actions">
                      <button className="ln-btn ln-btn--outlined" onClick={() => void runHealth()} disabled={healthCheck.busy}><Search size={14} /> {healthCheck.busy ? "检查中…" : "运行检查"}</button>
                      {health && !healthCheck.busy && (
                        <span className="config-stats"><span>笔记 {health.notesChecked}，快照 {health.historyChecked}，未归属记录 {health.orphanRowsChecked}，树节点 {health.treeChecked}</span></span>
                      )}
                    </div>
                    {health && (
                      <div className="checks">
                        {health.notesMissingFile.length === 0 && health.notesHashMismatch.length === 0 && health.historyMissingFile === 0 && health.orphanRowsFileMissing.length === 0 && health.refsMissingResource.length === 0 && health.treeDanglingParent.length === 0 ? (
                          <div className="checks__row checks__row--ok">✓ 全部正常：正文文件、历史快照、未归属记录、引用资源与目录树均一致。</div>
                        ) : (
                          <>
                            {health.notesMissingFile.length > 0 && <div className="checks__row checks__row--error">✗ {health.notesMissingFile.length} 篇笔记正文文件缺失（首 3：{health.notesMissingFile.slice(0, 3).map((n) => n.title).join("、")}）</div>}
                            {health.notesHashMismatch.length > 0 && <div className="checks__row checks__row--error">✗ {health.notesHashMismatch.length} 篇正文与基线哈希不符（可能被外部改动）</div>}
                            {health.historyMissingFile > 0 && <div className="checks__row checks__row--warn">✗ {health.historyMissingFile} 份历史快照文件缺失（恢复对应版本时会失败）</div>}
                            {health.orphanRowsFileMissing.length > 0 && <div className="checks__row checks__row--warn">✗ {health.orphanRowsFileMissing.length} 条未归属记录的文件缺失（记录与文件不一致）</div>}
                            {health.refsMissingResource.length > 0 && <div className="checks__row checks__row--error">✗ 正文引用的 {health.refsMissingResource.length} 个资源文件缺失（首 3：{health.refsMissingResource.slice(0, 3).map((r) => r.filename).join("、")}）</div>}
                          {health.treeDanglingParent.length > 0 && <div className="checks__row checks__row--error">✗ {health.treeDanglingParent.length} 个节点的父目录不存在（侧栏与回收站都看不到它）：{health.treeDanglingParent.slice(0, 3).map((t) => `${t.title}→${t.parentId}`).join("、")}</div>}
                          </>
                        )}
                        <div className="checks__row">
                          文件↔元数据后台扫描：{health.fileScanIntervalHours && health.fileScanIntervalHours > 0 ? `已启用（每 ${health.fileScanIntervalHours} 小时一次，只报告）` : "未启用（0 = 关闭；手动「重建数据 → 扫描」仍可用）"}
                          {health.fileReconcile ? `；上次扫描 ${formatDateTime(new Date(health.fileReconcile.generatedAt))}：扫描 ${health.fileReconcile.scannedFiles} 个正文文件、已知笔记 ${health.fileReconcile.knownRows} 条，候选 ${health.fileReconcile.candidateCount} 个${health.fileReconcile.truncated ? "（已截断显示）" : ""}` : "；最近还没有扫描记录"}
                          。
                        </div>
                        <div className="checks__row">生成于 {formatDateTime(new Date(health.checkedAt))}。</div>
                      </div>
                    )}
                    <Item itemId="data-scan-interval" name="后台扫描间隔（小时）" desc="低频文件↔元数据扫描：只报告、不写库/不重建；默认 24 小时。0 = 关闭后台扫描（手动「重建数据 → 扫描」仍可用）。"><NumField label="后台扫描间隔（小时）" min={0} max={720} value={scanIntervalHours ?? health?.fileScanIntervalHours ?? 24} onSave={(v) => saveScanInterval(v)} floor={0} fallback={24} /></Item>
                  </Block>
                </Group>
                <Group title="数据恢复（手动）" icon={<Archive size={16} />}>
                  <Block itemId="data-rebuild" name="重建数据" desc="当正文文件还在、笔记行丢失（文件↔元数据候选）时，从正文手动重建元数据行：只补笔记行并标为待同步，不改写、不删除任何正文文件；只允许重建本次扫描出的候选，正文不可解析的条目会被拒绝。">
                    <RebuildDataBlock scan={() => native.scanRebuildCandidates()} rebuild={(ids) => native.rebuildOrphanNotes(ids)} confirm={confirm} />
                  </Block>
                </Group>
              <Group title="应用日志（只读）" icon={<Terminal size={16} />}>
                <Block itemId="logs-main" name="主进程日志" desc="同步、回收站与历史清理过程写入 userData/logs/lakex-local-notes.log；按关键字过滤，每条命中附带上下文。">
                  <div className="config-block__actions">
                    <input
                      className="ln-text-field logs__filter"
                      type="text"
                      value={logKeyword}
                      onChange={(e) => setLogKeyword(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void runLogLoad(logKeyword); }}
                      placeholder="过滤（如 GC / sync / trash / purge / snapshot）"
                      aria-label="日志关键字过滤"
                    />
                    <button className="ln-btn ln-btn--outlined" onClick={() => void runLogLoad(logKeyword)} disabled={logLoad.busy}><Search size={14} /> {logLoad.busy ? "读取中…" : "读取"}</button>
                  </div>
                  {logText && <div className="block__text">{logText}</div>}
                </Block>
                <Block>
                  {logRows.length > 0 ? (
                    <div className="config-readonly readonly--tall">
                      {logRows.map((row, i) => <div key={i} className={row.hit ? "logs__hit" : undefined}>{row.line}</div>)}
                    </div>
                  ) : (
                    !logLoad.busy && <div className="config-empty">尚无日志或未读取。</div>
                  )}
                </Block>
              </Group>
              </>
    </>
  );
}
