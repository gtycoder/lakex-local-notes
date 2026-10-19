/**
 * OOXML 公共转义（xlsx / docx 两个极简写入器共用；避免各写一份导致行为漂移）。
 */
/** XML 文本/属性转义：先剔除 XML 1.0 非法控制字符（Excel/Word 会拒收整份文件），再转五个实体。 */
export function xmlText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
