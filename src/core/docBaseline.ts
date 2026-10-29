/**
 * 「打开 = 只读」的 core 单一判据（CORE-03）。
 *
 * 背景（docs/audit-261027/09-core-data-models.md §CORE-03）：桌面 usheet 自己拼了
 * normalizedBodyOf / baselineSettled / contentInput / canonicalBody 四件套，移动端 usheet 只有
 * 裸 save()，board / ink 各写一套。宿主一多就重演「打开文档自己写盘 → contentHash 变 → 同步上传」。
 *
 * 本文件回答一个问题：**当前正文与磁盘原文是不是同一份内容？**
 * - 先按 kind 收敛到各自的「写盘/比较唯一形式」（usheet 见 normalizeUsheetWorkbook；board / ink 见
 *   boardToBody / inkToBody 的稳定字段顺序），再按字节比较；
 * - 等价 ⇒ 宿主 capture 必须返回**磁盘原文**（而不是规范化后的内存形态），这样「打开后直接关闭」
 *   「改过又改回原样（撤销 / 改回原值）」都不会产生保存与同步；
 * - 空正文 = 各 kind 的空文档（新建 / 清空后的正常形态），两者等价；
 * - 解析失败（坏正文）一律视为**不等价** —— 调用方本来就该走只读（CORE-02），不能借等价路径写回。
 *
 * 边界：纯函数，不读写 DOM / localStorage / 文件；禁止 import @univerjs/*（同 core 约束）。
 */
import { boardToBody, parseBoardBodyChecked } from "./boardDoc.js";
import { createInkDoc, inkToBody, parseInkBody } from "./inkDoc.js";
import {
  emptyUsheetWorkbook,
  normalizeUsheetWorkbook,
  parseUsheetBody,
  usheetToBody,
  type UsheetWorkbook,
} from "./usheetDoc.js";
import type { DocBodyKind } from "./docBodySafety.js";

function isBlank(raw: string | null | undefined): boolean {
  return typeof raw !== "string" || raw.trim().length === 0;
}

/**
 * 正文 → 该 kind 的 canonical 写盘形态；解析失败返回 null。
 * 与宿主 capture 落盘时使用同一套序列化，保证「同内容同字节」。
 */
export function canonicalDocBody(kind: DocBodyKind, raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  if (kind === "usheet") {
    // 空正文 = 空表（新建 / 清空）；parseUsheetBody 对 "" 返回 null，这里按空文档补上。
    const workbook: UsheetWorkbook | undefined = isBlank(raw) ? emptyUsheetWorkbook() : parseUsheetBody(raw)?.workbook;
    if (!workbook) return null;
    normalizeUsheetWorkbook(workbook);
    return usheetToBody(workbook);
  }
  if (kind === "board") {
    // 宽容解析已把空正文当成空画板；readable=false（坏 JSON / 非画板）不能参与等价判断。
    const parsed = parseBoardBodyChecked(raw);
    return parsed.readable ? boardToBody(parsed.doc) : null;
  }
  // ink 的 parseInkBody 对空正文也返回 null（严格校验），空正文按空文档补上。
  const doc = isBlank(raw) ? createInkDoc() : parseInkBody(raw);
  if (!doc) return null;
  try {
    return inkToBody(doc);
  } catch {
    return null;
  }
}

/** 两份正文规范化后是否等价（任一侧解析失败 ⇒ false）。 */
export function sameDocAsDisk(
  kind: DocBodyKind,
  diskRaw: string | null | undefined,
  currentRaw: string | null | undefined,
): boolean {
  const disk = canonicalDocBody(kind, diskRaw);
  if (disk === null) return false;
  const current = canonicalDocBody(kind, currentRaw);
  return current !== null && current === disk;
}

/**
 * 审计建议的命名入口：candidate 与磁盘原文等价 = 基线已收敛（没有真实改动）。
 * 与 sameDocAsDisk 同一个实现，仅语义更贴近「打开 = 只读」调用点。
 */
export function docBaselineSettled(
  kind: DocBodyKind,
  diskRaw: string | null | undefined,
  currentRaw: string | null | undefined,
): boolean {
  return sameDocAsDisk(kind, diskRaw, currentRaw);
}
