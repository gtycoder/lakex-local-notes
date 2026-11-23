// 261112 R2-S7：设置页「sync」分组（纯搬移自 SettingsPanel.tsx；只改文件位置，不改任何设置项/文案）。
// 261116 用户验收（对标新版思源）：S3 配置**全部收进「同步服务配置」弹窗**，设置页里只剩一行 +
//   右侧竖排「设置 / 导入 / 导出」；弹窗用现成原语 `NativeDialog`（原生 <dialog>，Esc/外点/焦点回收由它负责）。
//   handler 一律复用 SettingsPanelContext 里的既有实现（setS3Field / saveS3 / testS3 / 导入导出 / setS3ImportOpen），
//   **不改 IPC 语义、不动 s3Verified 失效判据**（setS3Field 内部照旧 invalidateS3Verified）。
//   注意：字段行不再带 itemId —— 进弹窗后没有常驻锚点；搜索注册表里并成一条常驻的 `s3-config`（见 settingsSearch.ts），
//   否则 settingsSearch.test 的「id ↔ data-set-id 一致」会红。
import { useState } from "react";
import type { SettingsPanelContext } from "../useSettingsPanelScope";
import { Group, Field, TextField, Switch, Block, Item, NumField } from "../../../ui/settingsPrimitives";
import { NativeDialog } from "../../../ui/Overlay";
import { native } from "../../../../lib/native";
import { s3SettingsChanged } from "../../../../core/firstEncounter.js";
import { Cloud, TriangleAlert, Trash, Terminal, X } from "lucide-react";
import { isQiniuEndpoint } from "../../../../lib/s3FormState";
import { CLOUD_PRIVACY_NOTICE, cloudStateHint } from "../../../../core/cloudState";
import { cloudSyncEnableGate } from "../../../../core/cloudSyncGate";
import { SYNC_OPEN_CLOSE_NOTE, SYNC_AUTO_MODE_OPTIONS } from "../../../../core/syncModes";
import { AdaptiveSelect } from "../../../ui/AdaptiveSelect";
import type { SyncSettings } from "../../../../lib/types";

export function SyncSection({ c }: { c: SettingsPanelContext }) {
  const { cloudConfigured, cloudOffline, cloudState, copySyncDiagnostics, exportS3ConfigFile, gcCfg, gcLog, gcRun, importS3ConfigFile, runGcAction, s3, s3Verified, saveGcCfg, saveS3, saveSyncCfg, setS3Field, setS3ImportOpen, setSyncGateAlert, setSyncMsg, syncCfg, syncMsg, syncDiagMsg, syncDiagText, syncGateAlert, testS3 } = c;
  /** 261116：S3 配置弹窗开关（纯本地 UI 状态，不落盘；关掉弹窗不撤销已输入到 context 的字段值）。 */
  const [s3Open, setS3Open] = useState(false);
  /** 「粘贴迁移码…」开的是另一个原生模态（SettingsPanel 里的 S3ConfigImportDialog）。
   *  261116 修复后可以直接切：外层 Overlay 的 portal host 已稳定（ui/Overlay 的 pickPortalHost），
   *  不再出现「内层 <dialog> 卸载把外层设置面板一起带走」。这里仍先关本弹窗、同一批提交里开迁移码弹窗
   *  （不叠两个原生模态，关掉迁移码后回到设置页，行内摘要已刷新）。 */
  const openTransfer = () => { setS3Open(false); setS3ImportOpen(true); };
  /** 261114 用户裁决：没有配置或没通过连接测试 ⇒ 不能开启（两端同一判据/文案，见 core/cloudSyncGate）。 */
  const enableGate = cloudSyncEnableGate({ configured: cloudConfigured, verified: s3Verified });
  const closeS3 = () => setS3Open(false);
  /** 功能一（SYNC-PROTOCOL §21）：保存变更后的配置探测提示（只提示不提问）。 */
  const [probeHint, setProbeHint] = useState<string | null>(null);
  /** 保存 = 既有 saveS3（主进程落库）→ 成功失败都由它写 syncMsg，然后关弹窗把结果留给设置页状态条。 */
  const saveS3AndClose = async () => {
    // 预读旧配置只服务「变更才探测」判定：读不到（无桥/异常）就当 null，**绝不挡保存**（含同步抛）。
    let prev: Awaited<ReturnType<typeof native.getS3Settings>> | null = null;
    try { prev = await native.getS3Settings(); } catch { prev = null; }
    await saveS3();
    closeS3();
    // 功能一：endpoint/region/bucket/prefix 变更 ⇒ 限前缀重探三态，只提示不提问（探测失败不影响保存）。
    try {
      const next = await native.getS3Settings();
      const toTarget = (s: { endpoint: string; region: string; bucket: string; prefix: string } | null) => (s ? { endpoint: s.endpoint, region: s.region, bucket: s.bucket, prefix: s.prefix } : null);
      if (next && s3SettingsChanged(toTarget(prev), toTarget(next)!)) {
        const probe = await native.s3ProbeTarget();
        setProbeHint(probe.hint?.text ?? (probe.error ? "配置探测失败：" + probe.error : ""));
      }
    } catch { /* 探测失败不影响保存 */ }
  };
  /** 行内说明：已配置时显示当前 Endpoint · Bucket（这是用户最常确认的两项）；未配置时给指路文案。 */
  const s3Summary = cloudConfigured
    ? [s3.endpoint, s3.bucket].filter(Boolean).join(" · ") || "已保存 S3 配置"
    : "未配置。点「设置」填写 Endpoint、密钥与 Bucket。";
  return (
    <>
              <>
                <Group title="S3 对象存储" icon={<Cloud size={16} />}>
                  <Item itemId="s3-config" name="同步服务配置" desc={probeHint || s3Summary}>
                    {/* 261116 用户定稿：本仓设置行的操作一律**横排**（与全站一致），不再竖排。 */}
                    <button type="button" className="ln-btn ln-btn--outlined" onClick={() => setS3Open(true)}>设置</button>
                    <button type="button" className="ln-btn ln-btn--outlined" onClick={() => void importS3ConfigFile()}>导入</button>
                    <button type="button" className="ln-btn ln-btn--outlined" onClick={() => void exportS3ConfigFile()}>导出</button>
                  </Item>
                  {s3Open && (
                    <NativeDialog open onDismiss={closeS3} label="同步服务配置" className="s3-config-dialog">
                      <header className="ln-dialog__head">
                        <h2 className="ln-dialog__title">同步服务配置</h2>
                        <button type="button" className="ln-close" aria-label="关闭" onClick={closeS3}><X size={15} aria-hidden="true" /></button>
                      </header>
                      <div className="ln-dialog__body">
                        <div className="s3-config-dialog__body">
                          <Field name="Endpoint" desc="七牛 Kodo 示例：https://s3.cn-north-1.qiniucs.com"><TextField label="Endpoint" value={s3.endpoint} placeholder="https://s3-cn-east-1.qiniucs.com" onSave={(v) => setS3Field("endpoint", v)} /></Field>
                          <Field name="Access Key"><TextField label="Access Key" value={s3.accessKeyId} onSave={(v) => setS3Field("accessKeyId", v)} /></Field>
                          <Field name="Secret Key" desc="留空或保持 ******** = 沿用已保存密钥（本机加密存储）。"><TextField label="Secret Key" type="password" placeholder="留空或保持 ******** 表示沿用已保存密钥" value={s3.secretAccessKey} onSave={(v) => setS3Field("secretAccessKey", v)} /></Field>
                          <Field name="Bucket"><TextField label="Bucket" value={s3.bucket} onSave={(v) => setS3Field("bucket", v)} /></Field>
                          <Field name="Region"><TextField label="Region" value={s3.region} onSave={(v) => setS3Field("region", v)} /></Field>
                          <Field name="对象前缀"><TextField label="对象前缀" value={s3.prefix} onSave={(v) => setS3Field("prefix", v)} /></Field>
                          <Switch
                            name="使用 Path-style URL"
                            desc={isQiniuEndpoint(s3.endpoint)
                              ? "七牛 Kodo 必须关闭（已自动处理）。"
                              : "自建 MinIO 等开启；七牛 Kodo 关闭。"}
                            checked={isQiniuEndpoint(s3.endpoint) ? false : s3.forcePathStyle}
                            disabled={isQiniuEndpoint(s3.endpoint)}
                            onChange={(checked) => setS3Field("forcePathStyle", checked)}
                          />
                          {/* 原分组里的第三方服务说明整体搬进弹窗（设置页只留一行；免责/计费/私有桶提醒仍可见）。 */}
                          <div className="s3-service-notice" role="note">
                            <div className="s3-service-notice__title">第三方 S3 服务说明</div>
                            <p>通过 S3 兼容 API 使用第三方存储（七牛 Kodo、阿里云 OSS、Cloudflare R2 等）；存储、流量与请求由服务商单独计费，本应用不收费、不含套餐。技术限制、计费与数据安全责任以服务商条款为准。</p>
                            <p className="s3-service-notice__warn"><TriangleAlert size={14} aria-hidden="true" /><span>笔记正文与附件按原样上传、云端不加密；桶必须为私有、未开放公开读。</span></p>
                            <p className="s3-service-notice__disclaimer">本应用仅通过 S3 兼容 API 访问你配置的桶，不对第三方服务的可用性、计费与数据安全负责。</p>
                          </div>
                          {syncMsg && <div className="s3-config-dialog__msg" role="status" aria-live="polite">{syncMsg}</div>}
                        </div>
                      </div>
                      {/* 底部动作：粘贴迁移码（保留既有能力，靠左）｜测试连接｜取消｜保存。 */}
                      <div className="ln-dialog__actions">
                        <button type="button" className="ln-btn ln-btn--ghost s3-config-dialog__paste" onClick={openTransfer}>粘贴迁移码…</button>
                        <button type="button" className="ln-btn ln-btn--outlined" onClick={() => void testS3()}>测试连接</button>
                        <button type="button" className="ln-btn ln-btn--secondary" onClick={closeS3}>取消</button>
                        <button type="button" className="ln-btn ln-btn--primary" onClick={() => void saveS3AndClose()}>保存</button>
                      </div>
                    </NativeDialog>
                  )}
                </Group>
                <Group title="同步策略（仅保存在当前设备）" icon={<Cloud size={16} />}>
                  {syncCfg && (
                    <>
                      <Switch
                        itemId="sync-enabled"
                        name="启用云同步"
                        desc="关闭即纯本地（不连 S3、不自动同步）；开启后增量同步并自动补拉云端资源。配置仅存本机。"
                        note={<><span className="ln-tag ln-tag--pending">{CLOUD_PRIVACY_NOTICE.badge}</span>{" "}{CLOUD_PRIVACY_NOTICE.text}</>}
                        // 261114 用户点单：闸门提醒用**红字**（错误色单一来源 .config-item__error），且只出现一处（不再与 desc 重复）。
                        alert={syncGateAlert
                          ? <span className="config-item__error">{syncGateAlert}</span>
                          : enableGate.allowed ? undefined : <span className="config-item__error">{enableGate.message}</span>}
                        checked={syncCfg.enabled}
                        onChange={(checked) => {
                          // 261114：没有配置 / 没有通过连接测试 ⇒ 不能开启；点击给出可见提示，状态保持关闭。
                          if (checked && !syncCfg.enabled && !enableGate.allowed) {
                            setSyncGateAlert(enableGate.message);
                            setSyncMsg(enableGate.message);
                            return;
                          }
                          setSyncGateAlert(null);
                          void saveSyncCfg({ enabled: checked });
                        }}
                      />
                      {syncCfg.enabled && (
                        <>
                          <Field itemId="sync-auto-mode" name="自动同步模式" desc={SYNC_OPEN_CLOSE_NOTE}>
                            {/* 261116 推广：3 档、逐档只写同步策略（定时器按最终值重建），写盘无害。 */}
                            <AdaptiveSelect label="自动同步模式" value={syncCfg.autoMode} onChange={(v) => void saveSyncCfg({ autoMode: v as SyncSettings["autoMode"] })} options={SYNC_AUTO_MODE_OPTIONS} />
                          </Field>
                          {syncCfg.autoMode === "interval" && (
                            <Item itemId="sync-auto-interval" name="自动同步间隔（分钟）" desc="到点触发一次；退出后不后台续跑，下次启动自动对齐。"><NumField label="自动同步间隔（分钟）" min={1} max={1440} value={syncCfg.autoIntervalMinutes} onSave={(v) => void saveSyncCfg({ autoIntervalMinutes: v })}  floor={1} fallback={15} /></Item>
                          )}
                          <Switch itemId="sync-defer-assets" name="按需下载附件" desc="附件改为打开/预览时再下载（省流量）；关闭则首次同步全量下载（离线最完整）。" checked={syncCfg.deferAssets === true} onChange={(checked) => void saveSyncCfg({ deferAssets: checked })} />
                        </>
                      )}
                    </>
                  )}
                </Group>
                <Group title="云端回收" icon={<Trash size={16} />}>
                  {cloudOffline && (
                    <Block desc={cloudStateHint(cloudState) ?? "云同步未启用：按纯本地空间工作，云端相关操作一律不联网。"} />
                  )}
                  <Block itemId="gc-status" name="回收状态" desc="清理云端已无引用的对象；数量偏少多为引用保护，不是漏删。">
                    <div className="config-block__actions">
                      <button className="ln-btn ln-btn--outlined" onClick={() => void runGcAction(true)} disabled={gcRun.busy || cloudOffline}>深度清理预览</button>
                      <button className="ln-btn ln-btn--outlined ln-btn--danger-text" onClick={() => void runGcAction(false)} disabled={gcRun.busy || cloudOffline}>执行深度清理</button>
                    </div>
                  </Block>
                  {gcCfg && (
                    <>
                      <Item itemId="gc-retention-days" name="回收窗口（天）" desc="对象被替换/移除后的保护期；0 = 立即到期。"><NumField label="回收窗口（天）" min={0} max={90} value={gcCfg.gcRetentionDays} onSave={(v) => saveGcCfg({ gcRetentionDays: v })}  floor={0} fallback={7} /></Item>
                      <Item itemId="gc-interval-hours" name="自动对账周期（小时）" desc="自动清理频率；0 = 仅手动。"><NumField label="自动对账周期（小时）" min={0} max={720} value={gcCfg.gcIntervalHours} onSave={(v) => saveGcCfg({ gcIntervalHours: v })}  floor={0} fallback={24} /></Item>
                    </>
                  )}
                  <Block itemId="gc-mirror" name="云端只是镜像" desc="删除云端冗余不影响本地正文/回收站/历史快照（“彻底删除/清空回收站”除外）。" />
                  <Block itemId="gc-log" name={`删除记录（最近 ${gcLog.length > 0 ? Math.min(gcLog.length, 30) : 0} 条，只读）`}>
                    {gcLog.length > 0 ? (
                      <div className="config-readonly">
                        {gcLog.slice(0, 30).map((l) => <div key={l.id}>{l.ts.slice(0, 19)}&nbsp;[{l.action}，{l.reason}] {l.key}</div>)}
                      </div>
                    ) : (
                      <div className="block__text">暂无删除记录。</div>
                    )}
                  </Block>
                </Group>
                <Group title="同步诊断" icon={<Terminal size={16} />}>
                  <Block itemId="sync-diagnostics" name="最近 3 轮同步" desc="最近 3 轮同步的耗时、对象数与失败项，仅存本机；反馈问题时可复制。">
                    {syncDiagText ? (
                      <div className="config-readonly">
                        {syncDiagText.split("\n").map((line, i) => <div key={i}>{line.trim() ? line : "\u00a0"}</div>)}
                      </div>
                    ) : (
                      <div className="block__text">本机还没有同步记录。</div>
                    )}
                    <div className="config-block__actions">
                      <button className="ln-btn ln-btn--outlined" onClick={() => void copySyncDiagnostics()} disabled={!syncDiagText}>复制同步诊断</button>
                    </div>
                    {syncDiagMsg && <div className="block__text">{syncDiagMsg}</div>}
                  </Block>
                </Group>
              </>
    </>
  );
}
