/**
 * 坏正文安全判定（CORE-02）：usheet / board / ink 三族共用**单一判据**。
 *
 * 背景（docs/audit-261027/09-core-data-models.md §CORE-02）：同一句「正文损坏」在四族里曾有四种行为——
 * ink / bitable 只读 + 横幅；usheet 解析失败被当成空表（可编辑）⇒ 用户改一格就把原文覆盖；
 * board 的解析器没有失败态 ⇒ 坏正文静默变成空白画板，画一笔就落盘「空白 + 新元素」。
 *
 * 本文件只回答一个问题：**这段正文能不能安全地交给编辑器？**
 * - **空正文**（null / undefined / 纯空白）= ok + 空文档 ⇒ 仍可编辑（新建、清空后的正常形态）；
 * - **非空但解析失败 / 结构不对 / kind 不符** = unreadable ⇒ 宿主必须「只读 + 横幅」，禁止保存与标脏。
 *
 * 判据不做兼容：raw 原样交给各领域既有 parse*（AGENTS §3#7 不为旧数据写迁移）。
 * board 的宽容解析（坏数据退化成空白画板，保证文档打得开）仍留在 parseBoardBody，
 * 由 parseBoardBodyChecked 同时给出「退化后的 doc」与「可读性」，宿主不必自己再 JSON.parse 一遍。
 *
 * 边界：纯函数，不读写 DOM / localStorage / 文件，渲染层与主进程都能用。
 */
import { createBoardDoc, parseBoardBodyChecked, type BoardDoc } from "./boardDoc.js";
import { createInkDoc, parseInkBody, type InkDoc } from "./inkDoc.js";
import {
  USHEET_DOC_KIND,
  USHEET_DOC_VERSION,
  emptyUsheetWorkbook,
  parseUsheetBody,
  type UsheetDoc,
} from "./usheetDoc.js";

export type DocBodyKind = "usheet" | "board" | "ink";

/** 失败原因：只用于日志 / 测试诊断；宿主 UI 只认 `status`，不要按 reason 分叉行为。 */
export type DocBodyUnreadableReason = "invalid-json" | "wrong-shape";

export interface DocBodyUnreadable {
  status: "unreadable";
  kind: DocBodyKind;
  reason: DocBodyUnreadableReason;
}

export type UsheetBodyCheck =
  | { status: "ok"; kind: "usheet"; /** 正文为空（新建/清空）：仍是可编辑形态 */ empty: boolean; doc: UsheetDoc }
  | DocBodyUnreadable;

export type BoardBodyCheck =
  | { status: "ok"; kind: "board"; empty: boolean; doc: BoardDoc }
  | DocBodyUnreadable;

export type InkBodyCheck =
  | { status: "ok"; kind: "ink"; empty: boolean; doc: InkDoc }
  | DocBodyUnreadable;

export type DocBodyCheck = UsheetBodyCheck | BoardBodyCheck | InkBodyCheck;

/** 正文为空：null/undefined（缺正文走另外的 bodyMissing 通道）与纯空白都算。 */
function isBlank(raw: string | null | undefined): boolean {
  return typeof raw !== "string" || raw.trim().length === 0;
}

/** 只在失败路径多解析一次：能 JSON.parse 说明结构不对，否则是坏 JSON。 */
function reasonOf(raw: string): DocBodyUnreadableReason {
  try {
    JSON.parse(raw);
    return "wrong-shape";
  } catch {
    return "invalid-json";
  }
}

function emptyUsheetDoc(): UsheetDoc {
  return { kind: USHEET_DOC_KIND, version: USHEET_DOC_VERSION, workbook: emptyUsheetWorkbook() };
}

export function checkDocBody(kind: "usheet", raw: string | null | undefined): UsheetBodyCheck;
export function checkDocBody(kind: "board", raw: string | null | undefined): BoardBodyCheck;
export function checkDocBody(kind: "ink", raw: string | null | undefined): InkBodyCheck;
/** 泛型入口（kind 是变量时用；返回联合类型）。 */
export function checkDocBody(kind: DocBodyKind, raw: string | null | undefined): DocBodyCheck;
export function checkDocBody(kind: DocBodyKind, raw: string | null | undefined): DocBodyCheck {
  if (isBlank(raw)) {
    if (kind === "usheet") return { status: "ok", kind, empty: true, doc: emptyUsheetDoc() };
    if (kind === "board") return { status: "ok", kind, empty: true, doc: createBoardDoc() };
    return { status: "ok", kind, empty: true, doc: createInkDoc() };
  }
  // isBlank 已排除 null/undefined ⇒ 这里一定是 string（下面三个 parse* 都只收 string）。
  const text = raw as string;
  if (kind === "usheet") {
    const doc = parseUsheetBody(text);
    return doc
      ? { status: "ok", kind, empty: false, doc }
      : { status: "unreadable", kind, reason: reasonOf(text) };
  }
  if (kind === "board") {
    const parsed = parseBoardBodyChecked(text);
    return parsed.readable
      ? { status: "ok", kind, empty: false, doc: parsed.doc }
      : { status: "unreadable", kind, reason: reasonOf(text) };
  }
  const doc = parseInkBody(text);
  return doc
    ? { status: "ok", kind, empty: false, doc }
    : { status: "unreadable", kind, reason: reasonOf(text) };
}
