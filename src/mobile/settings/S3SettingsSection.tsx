/**
 * 「云端与同步」设置分节（M-05 从 SettingsDrawer.tsx 拆出，纯搬移/零行为变化；与既有分节同形）：
 * 第三方说明 → S3 连接表单（含保存/测试/立即同步 + 云端首次相遇）→ 配置迁移 → 同步策略（启用闸门）→
 * 同步诊断（上次同步 / 诊断 / 被覆盖清单 / 警告清单）→ 导出迁移码。
 * 契约：`data-set-id`（Field/Item/Block 的 itemId）逐个不变 —— settingsSearch.ts SETTING_ITEMS / MOBILE_ONLY_SETTING_IDS
 * 注册表与 settingsInputRows.render.test 的锚点断言都认这些 id，新增/改名必须先改注册表。
 * 状态面：表单 = useS3SettingsForm（水合在抽屉层，open && view === "s3" 页面级一次，261123 E2E）；
 * 同步策略/闸门/首次相遇 = useSyncSettingsForm + core/cloudSyncGate（261114 用户裁决：没配置/没测试通过不能开启）。
 */
import { useState } from "react";
import { Cloud, Download, RefreshCw, Terminal, TriangleAlert } from "lucide-react";
import { Group, Item, Block, Switch, TextField, Field } from "../ui/settingsPrimitives";
import { PickerSheet } from "../ui/PickerSheet";
import { CLOUD_PRIVACY_NOTICE } from "../../core/cloudState";
import { cloudSyncEnableGate } from "../../core/cloudSyncGate";
import { SYNC_AUTO_MODE_OPTIONS, SYNC_OPEN_CLOSE_NOTE, syncIntervalOptions } from "../../core/syncModes";
import { ENCOUNTER_OPTIONS } from "../../core/firstEncounter.js";
import { syncWarningCopy, syncWarningRows, syncWarningSummary, syncWarningSummaryText, syncWarningTitle } from "../../core/syncWarningText";
import { formatS3v3Diagnostics } from "../../core/s3v3Report";
import { SyncConflictsEntry } from "./SyncConflictsSheet";
import { S3ConfigImportSheet } from "./S3ConfigImportSheet";
import type { useS3SettingsForm } from "./useS3SettingsForm";
import type { useSyncSettingsForm } from "./useSyncSettingsForm";

type S3FormState = ReturnType<typeof useS3SettingsForm>;
type SyncFormState = ReturnType<typeof useSyncSettingsForm>;

export interface S3SettingsSectionProps {
  /** useS3SettingsForm 状态面（表单/保存/测试/迁移码导入导出；水合在抽屉层）。 */
  form: S3FormState;
  /** 同步策略状态面（useSyncSettingsForm）：enabled 的唯一写入口 = updateSyncSettings。 */
  syncCfg: SyncFormState["syncSettings"];
  updateSyncSettings: SyncFormState["updateSyncSettings"];
  runSync: SyncFormState["runSync"];
  syncMsg: SyncFormState["syncMsg"];
  syncProgressText: SyncFormState["syncProgressText"];
  lastSyncText: SyncFormState["lastSyncText"];
  lastSyncBreakdown: SyncFormState["lastSyncBreakdown"];
  conflictUnacked: SyncFormState["conflictUnacked"];
  syncSuperseded: SyncFormState["supersededNotes"];
  syncWarnings: SyncFormState["warnings"];
  syncWarningDigest: SyncFormState["warningSummary"];
  syncReports: SyncFormState["syncReports"];
  /** 「云端首次相遇」（SYNC-PROTOCOL §21）：事实 + 五选项 + 取消。 */
  encounterFacts: SyncFormState["encounterFacts"];
  chooseEncounter: SyncFormState["chooseEncounter"];
  cancelEncounter: SyncFormState["cancelEncounter"];
  /** 云同步开启闸门（261114 用户裁决；判据单一来源 core/cloudSyncGate，抽屉层计算后传入）。 */
  syncEnableGate: ReturnType<typeof cloudSyncEnableGate>;
  syncEnableGateMessage: string | null;
  syncEnableHint: string;
  setSyncEnableHint: (hint: string) => void;
  /** 「同步记录」列表页入口（Sheet 由抽屉层持有）。 */
  onOpenConflicts: () => void;
  /** 同步警告行打开对应文档。 */
  onOpenNote?: (noteId: string) => void;
  /** 缺正文「去恢复」：跳资源管理并刷新清单。 */
  onOpenResourcesRestore: () => void;
}

export function S3SettingsSection({
  form,
  syncCfg, updateSyncSettings, runSync, syncMsg, syncProgressText,
  lastSyncText, lastSyncBreakdown,
  conflictUnacked, syncSuperseded, syncWarnings, syncWarningDigest, syncReports,
  encounterFacts, chooseEncounter, cancelEncounter,
  syncEnableGate, syncEnableGateMessage, syncEnableHint, setSyncEnableHint,
  onOpenConflicts, onOpenNote, onOpenResourcesRestore,
}: S3SettingsSectionProps) {
  const {
    form: s3Form, updateForm: updateS3Form, testText: s3Test, s3ProbeHint,
    exportState: s3Export, transferRef,
    save: saveS3, testConnection: testS3,
    openExport: openS3Export, copyExport: copyS3Transfer, closeExport: closeS3Export,
    importFromFile: importS3ConfigFromFile, importFromCode: importS3ConfigFromCode,
  } = form;
  /** 「粘贴迁移码」导入面板（与桌面 S3ConfigImportDialog 同形同构）。 */
  const [s3ImportOpen, setS3ImportOpen] = useState(false);
  // SD-13：同步诊断文本（最近 3 轮；只存本机，复制给维护者排障）。
  const syncDiagText = formatS3v3Diagnostics(syncReports);
  const [syncDiagMsg, setSyncDiagMsg] = useState("");
  const copySyncDiagnostics = async (): Promise<void> => {
    if (!syncDiagText) { setSyncDiagMsg("本机还没有同步诊断记录"); return; }
    try {
      await navigator.clipboard.writeText(syncDiagText);
      setSyncDiagMsg("同步诊断已复制到剪贴板");
    } catch {
      setSyncDiagMsg("无法写入剪贴板，请长按下方文本手动复制");
    }
  };
  return (
    <>
              {/* 261114 用户点单：第三方 S3 服务说明**放在最开始**（先说明计费/隐私，再让填连接信息）。 */}
              <Group title="服务说明" icon={<TriangleAlert size={16} />}>
                  <div className="mb-s3-notice" role="note">
                    <div className="mb-s3-notice__title">第三方 S3 服务说明</div>
                    <p>通过 S3 兼容 API 使用第三方存储（七牛 Kodo、阿里云 OSS、Cloudflare R2 等）；存储、流量与请求由服务商单独计费，本应用不收费、不含套餐。技术限制、计费与数据安全责任以服务商条款为准。</p>
                    <ul>
                      <li>接口调用频率、带宽等技术限制；</li>
                      <li>存储空间、流量、请求次数等计费项目；</li>
                      <li>服务条款、可用性保障与数据安全责任。</li>
                    </ul>
                    <p className="mb-s3-notice__warn"><TriangleAlert size={14} aria-hidden="true" /><span>笔记正文与附件按原样上传、云端不加密；桶必须为私有、未开放公开读。</span></p>
                    <p className="mb-s3-notice__disclaimer">本应用仅通过 S3 兼容 API 访问你配置的桶，不对第三方服务的可用性、计费与数据安全负责。</p>
                  </div>
              </Group>

              <Group title="S3 对象存储" icon={<Cloud size={16} />}>
                  {/* 261102 用户点单 3b：S3 连接信息是内容输入类 ⇒ 一律 Field（标签在上、输入框占满下一行），
                      与桌面设置页同一形态；此前是裸 .mb-set-item + <input class="mb-input">（第二套输入外观，
                      且窄屏上输入框被标签挤到只剩几十像素，Endpoint/AK/SK 长值看不全）。
                      锚点 s3-endpoint…s3-prefix 登记在 settingsSearch 的 MOBILE_ONLY_SETTING_IDS（261116：桌面已把
                      这六个字段收进「同步服务配置」弹窗，注册表只剩 s3-config；两端 UI 独立，锚点不必强行同名）。
                      261113 用户点单：字段顺序对齐桌面 SyncSection —— Endpoint → Access Key → Secret Key
                      → Bucket → Region → 对象前缀（凭据紧跟 Endpoint，不再垫在最后）。 */}
                  <Field itemId="s3-endpoint" name="Endpoint">
                    <TextField label="Endpoint" value={s3Form.endpoint} onSave={(v) => updateS3Form({ endpoint: v })} />
                  </Field>
                  <Field itemId="s3-access-key" name="Access Key">
                    <TextField label="Access Key" value={s3Form.accessKeyId} onSave={(v) => updateS3Form({ accessKeyId: v })} />
                  </Field>
                  <Field itemId="s3-secret-key" name="Secret Key" desc="只保存在本机；已保存时显示 ********，不改即沿用原密钥。">
                    <TextField label="Secret Key" type="password" value={s3Form.secretAccessKey} onSave={(v) => updateS3Form({ secretAccessKey: v })} />
                  </Field>
                  <Field itemId="s3-bucket" name="Bucket">
                    <TextField label="Bucket" value={s3Form.bucket} onSave={(v) => updateS3Form({ bucket: v })} />
                  </Field>
                  <Field itemId="s3-region" name="Region">
                    <TextField label="Region" value={s3Form.region} onSave={(v) => updateS3Form({ region: v })} />
                  </Field>
                  <Field itemId="s3-prefix" name="Object prefix">
                    <TextField label="Object prefix" value={s3Form.prefix} onSave={(v) => updateS3Form({ prefix: v })} />
                  </Field>
                  {/* 桌面「连接」块在 S3 对象存储分组内（保存 / 测试连接）；移动端另挂「立即同步」。 */}
                  <Block itemId="s3-connection" name="连接" desc="配置保存在本机；S3 只用于同步。">
                    <div className="mb-set-block__actions">
                      <button className="mb-btn mb-btn--outlined" onClick={() => { void saveS3().then((ok) => { if (ok) setSyncEnableHint(""); }); }}>保存</button>
                      <button className="mb-btn mb-btn--outlined" onClick={() => void testS3()}>测试连接</button>
                      <button className="mb-btn mb-btn--outlined" disabled={syncCfg?.enabled === false} title={syncCfg?.enabled === false ? "云同步已关闭：不会联网" : undefined} onClick={() => void runSync()}><RefreshCw size={14} />立即同步</button>
                    </div>
                    {s3Test && <div className="mb-set-item__desc">{s3Test}</div>}
                    {s3ProbeHint && <div className="mb-set-item__desc" data-testid="s3-probe-hint">{s3ProbeHint}</div>}
                    {syncMsg && <div className="mb-set-item__desc">{syncMsg}</div>}
                    {/* 「云端首次相遇」（SYNC-PROTOCOL §21）：手动同步命中询问 ⇒ 亮事实 + 五选项 + 取消。 */}
                    {encounterFacts && (
                      <div className="mb-set-item__desc" data-testid="first-encounter-ask">
                        本机 {encounterFacts.localNotes} 篇 / 云端 {encounterFacts.cloudNotes} 篇 / 重合 {encounterFacts.overlapNotes} 篇。请选择这次怎么合并（选定后不再询问）：
                        <div className="mb-set-block__actions">
                          {ENCOUNTER_OPTIONS.map((o) => (
                            <button key={o.mode} className="mb-btn mb-btn--outlined" title={o.hint} onClick={() => void chooseEncounter(o.mode)}>{o.label}</button>
                          ))}
                          <button className="mb-btn mb-btn--ghost" onClick={cancelEncounter}>取消</button>
                        </div>
                      </div>
                    )}
                    {syncProgressText && <div className="mb-set-item__desc" aria-live="polite">{syncProgressText}</div>}
                  </Block>
              </Group>

              <Group title="配置迁移" icon={<Download size={16} />}>
                  <Block itemId="s3-transfer" name="导入 / 导出迁移码" desc="桌面端「设置 → 云端与同步 → 配置迁移」导出 .json 后在手机导入，或粘贴迁移码（LLN1. 开头）。迁移码含 S3 密钥（已加密封装），只在自己的设备间传递。">
                    <div className="mb-set-block__actions">
                      <button className="mb-btn mb-btn--outlined" onClick={() => void importS3ConfigFromFile()}>从文件导入</button>
                      <button className="mb-btn mb-btn--outlined" onClick={() => setS3ImportOpen(true)}>粘贴迁移码</button>
                      <button className="mb-btn mb-btn--outlined" onClick={() => void openS3Export()}>导出迁移码</button>
                    </div>
                  </Block>
              </Group>

              {/* 261113 用户点单：顺序对齐桌面 SyncSection —— 同步策略（启用 → 自动同步模式 → 间隔 → 按需下载），
                  上次同步与诊断另起「同步诊断」分组（桌面同名分组），保存/测试连接已上移到 S3 对象存储的分组内。 */}
              <Group title="同步策略" icon={<RefreshCw size={16} />}>
                  <Switch
                    name="启用云同步"
                    desc="关闭即纯本地（不连 S3、不同步、不补拉云端资源）；重新开启后下次同步自动补拉。"
                    note={<><span className="mb-tag mb-tag--pending">{CLOUD_PRIVACY_NOTICE.badge}</span>{" "}{CLOUD_PRIVACY_NOTICE.text}</>}
                    checked={syncCfg?.enabled === true}
                    onChange={(next) => {
                      // 261114 用户裁决：没有配置 / 没有通过连接测试 ⇒ 不能开启（点击只给提示，状态保持关闭）。
                      if (next && !syncCfg?.enabled && !syncEnableGate.allowed) {
                        setSyncEnableHint(syncEnableGateMessage ?? "");
                        return;
                      }
                      setSyncEnableHint("");
                      // 单一写入口：同步策略改了 → 自动同步定时器立刻重挂（useAutoSync）
                      updateSyncSettings({ enabled: next });
                    }}
                  />
                  {/* 261114 用户点单：闸门提醒用**红字**（.mb-form__desc--error 单一来源），且只出现一处（desc 保持正常说明）。
                      边界：提醒必须落在分组卡**内部的行/块**里（Block 自带 18px 横向内距），不能作为裸 div 贴在卡外缘。 */}
                  {(syncEnableHint || syncEnableGateMessage) && (
                    <Block>
                      <div className="mb-form__desc mb-form__desc--error" role="status">{syncEnableHint || syncEnableGateMessage}</div>
                    </Block>
                  )}
                  {syncCfg?.enabled !== false && (
                    <>
                      {/* 261113 用户点单：说明长 + 选项值长（「仅在开启/关闭时同步」）⇒ 上下两段，不挤一行。 */}
                      <Item itemId="sync-auto-mode" name="自动同步模式" stacked desc={`${SYNC_OPEN_CLOSE_NOTE}移动端以「回到前台」代替关闭时同步。`}>
                        <PickerSheet
                          label="自动同步模式"
                          value={syncCfg?.autoMode ?? "manual"}
                          options={SYNC_AUTO_MODE_OPTIONS}
                          onChange={(v) => {
                            updateSyncSettings({ autoMode: v });
                          }}
                        />
                      </Item>
                      {syncCfg?.autoMode === "interval" && (
                        <Item itemId="sync-auto-interval" name="自动同步间隔" stacked desc="到点触发一次；App 未运行时不触发，下次打开或回到前台补一次。">
                          <PickerSheet
                            label="自动同步间隔"
                            value={syncCfg?.autoIntervalMinutes ?? 15}
                            options={syncIntervalOptions(syncCfg?.autoIntervalMinutes ?? 15).map((m) => ({ value: m, label: m + " 分钟" }))}
                            onChange={(v) => {
                              updateSyncSettings({ autoIntervalMinutes: v });
                            }}
                          />
                        </Item>
                      )}
                      <Switch
                        name="按需下载附件"
                        desc="附件在打开/预览时再下载（省流量）；关闭则首次同步全量下载。新设备默认开启。"
                        checked={syncCfg?.deferAssets === true}
                        onChange={(next) => updateSyncSettings({ deferAssets: next })}
                      />
                    </>
                  )}
              </Group>

              <Group title="同步诊断" icon={<Terminal size={16} />}>
                  {/* 常驻：上次同步的时间/结果/失败原因（自动同步的失败也在这里看得到；云同步关闭时另加一句说明） */}
                  <Block itemId="sync-last" name="上次同步">
                    <div className="mb-set-item__desc">
                      上次同步：{lastSyncText}
                      {syncCfg?.enabled === false ? "（云同步当前已关闭，不会联网）" : ""}
                    </div>
                    {lastSyncBreakdown && <div className="mb-set-item__desc">{lastSyncBreakdown}</div>}
                    {/* 261105 P1 第 4 项：有未读同步记录（覆盖/删除）时给列表入口；没有就不占位。 */}
                    <SyncConflictsEntry count={conflictUnacked} onOpen={onOpenConflicts} />
                  </Block>
                  {/* 261105 晚：恢复动作迁到独立的「备份与恢复」子页（与桌面分组对齐）；
                      本页只保留联网配置与同步本身。 */}
                  {/* SD-13：同步诊断（最近 3 轮；阶段耗时/对象数/字节/失败对象），可一键复制 */}
                  <div className="mb-set-block">
                    <div className="mb-set-block__name">最近 3 轮同步</div>
                    <div className="mb-set-item__desc">最近 3 轮同步的耗时、文件数量与失败项（只存本机，不上传）。同步变慢或失败时复制给维护者。</div>
                    {syncDiagText ? (
                      <div className="mb-input mb-input--multiline">
                        <textarea rows={5} readOnly spellCheck={false} value={syncDiagText} aria-label="最近 3 轮同步诊断" />
                      </div>
                    ) : (
                      <div className="mb-set-item__desc">本机还没有同步记录。</div>
                    )}
                    <div className="mb-set-block__actions">
                      <button className="mb-btn mb-btn--outlined" disabled={!syncDiagText} onClick={() => void copySyncDiagnostics()}>复制同步诊断</button>
                    </div>
                    {syncDiagMsg && <div className="mb-set-item__desc">{syncDiagMsg}</div>}
                  </div>
                  {syncSuperseded.length > 0 && (
                    <div className="mb-set-block">
                      <div className="mb-set-block__name">同步有 {syncSuperseded.length} 篇被云端版本覆盖</div>
                      <div className="mb-set-item__desc">本地版本已自动留历史（可在此条目历史里找回），云端版本为准。</div>
                      <div className="mb-list" role="list">
                        {syncSuperseded.map((n) => (
                          <button key={n.id} type="button" className="mb-list-item" disabled={!onOpenNote} onClick={() => onOpenNote?.(n.id)}>
                            <span className="mb-list-item__text mb-ellipsis">{n.title || n.id}</span>
                            <span className="mb-list-item__meta">已留历史</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {syncWarnings.length > 0 && (
                    <div className="mb-set-block">
                      {/* 261112 task-56：文案/重试语义单一来源 = core/syncWarningText（不再手写一份）。 */}
                      <div className="mb-set-block__name">{syncWarningSummaryText(syncWarningDigest ?? syncWarningSummary(syncWarnings))}</div>
                      <div className="mb-list" role="list">
                        {syncWarningRows(syncWarnings).map((w, i) => {
                          // 只有「正文缺失」类警告才给「去恢复」入口；资源类（asset_missing / asset_kept_remote /
                          // asset_invalid_name 等）一律按附件行展示，别把文件名问题误报成正文缺失。
                          // 文案/顺序/可重试语义全部来自 core/syncWarningText（需处理在前）。
                          const copy = syncWarningCopy(w.kind);
                          const missingBody = w.kind === "local_body_missing" || w.kind === "local_body_restored";
                          const title = syncWarningTitle(w);
                          // 缺正文行给「去恢复」入口：正文文件不在，点开文档只会被拦，直接跳资源管理的清单。
                          if (missingBody) {
                            return (
                              <div key={`${w.kind}-${w.noteId ?? i}`} className="mb-row">
                                <span className="mb-row__title mb-ellipsis">{title}</span>
                                <span className="mb-row__meta">{copy.label}</span>
                                <button className="mb-btn mb-btn--outlined" onClick={onOpenResourcesRestore}>去恢复</button>
                              </div>
                            );
                          }
                          return (
                            <button
                              key={`${w.kind}-${w.noteId ?? i}-${w.filename ?? ""}`}
                              type="button"
                              className="mb-list-item"
                              disabled={!w.noteId || !onOpenNote}
                              onClick={() => { if (w.noteId) onOpenNote?.(w.noteId); }}
                            >
                              <span className="mb-list-item__text mb-ellipsis">{title}</span>
                              <span className="mb-list-item__meta">{copy.label}{w.filename ? "：" + w.filename : ""}</span>
                              {/* hint 逐项可见：可重试与需人工处理不再共用一句笼统说明。 */}
                              <span className="mb-set-item__desc">{copy.hint}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
              </Group>

              {s3Export && (
                <Group title="导出配置迁移码" icon={<Cloud size={16} />}>
                    <div className="mb-set-item">
                      <div className="mb-set-item__main">
                        <div className="mb-input mb-input--multiline">
                          <textarea ref={transferRef} rows={6} readOnly spellCheck={false} value={s3Export.code} />
                        </div>
                        <div className="mb-set-item__desc">迁移码含 S3 密钥（已加密封装），用于在桌面端导入。请只在自己的设备间传递。</div>
                        {s3Export.msg && <div className="mb-set-item__desc">{s3Export.msg}</div>}
                      </div>
                    </div>
                    <div className="mb-set-block">
                      <div className="mb-set-block__actions">
                        <button className="mb-btn mb-btn--outlined" onClick={() => void copyS3Transfer()}>复制迁移码</button>
                        <button className="mb-btn mb-btn--outlined" onClick={closeS3Export}>关闭</button>
                      </div>
                    </div>
                </Group>
              )}
              <S3ConfigImportSheet
                open={s3ImportOpen}
                onClose={() => setS3ImportOpen(false)}
                onImport={importS3ConfigFromCode}
              />
    </>
  );
}
