/**
 * S3 Secret 掩码与「留空/掩码 = 沿用已保存值」策略单一来源（M-10，审计 03-mobile；安全相邻语义）。
 *
 * 背景：掩码常量与保存裁决此前在 electron/ipc/registerSync.ts、src/mobile/settings/useS3SettingsForm.ts、
 * src/core/s3ConfigTransfer.ts 三处各写一份 —— 两端漂移的后果是「改了没存上」或「掩码被当密钥存坏」。
 * 判据同源（W-14）：get 不回显明文 Secret（渲染层 console 输出会经 console-message 落盘），
 * 表单只显示掩码；保存时掩码/留空 ⇒ 沿用已保存值。
 */
export const S3_SECRET_MASK = "********";

/**
 * 保存时的 Secret 字段裁决（两端表单共用）：
 * 草稿是掩码或留空 ⇒ 用户未改密钥，沿用已保存值（无已存值保持空，交给 validateS3Settings 拦截）；
 * 其余按草稿新值覆盖。
 */
export function resolveSecretField(draft: string, saved: string | undefined): string {
  if (draft === S3_SECRET_MASK || draft.trim() === "") return saved ?? "";
  return draft;
}
