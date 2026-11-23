/**
 * 「云端首次相遇」探测与询问机制（261123 用户两轮讨论定稿）—— 纯逻辑单一来源，两端共用。
 * 规格：docs/SYNC-PROTOCOL.md §21 / docs/PORTABLE-TRANSFER.md §3.2。
 *
 * 业务背景：没有共同历史时「云端没有我这批笔记」分不清是「被删了」还是「没传上去」；
 * 原规则猜前者 ⇒ 配错桶/顺序走反时全库进回收站（可恢复但体验灾难）。裁决：不猜，问用户。
 *
 * 两个入口：① S3 配置保存时的三态探测（只提示不提问）；② 首次同步的五选一询问（弹窗）。
 * 选择即成为共同基线（记入设备基线的 targetKey/firstEncounter），此后永不再问；换桶/换前缀 = 新的首次相遇。
 */
import type { ItemAction } from "./s3v3Decision.js";

/** 首次相遇的合并选择（弹窗五选一，「取消」不入本枚举 = 本轮不同步）。 */
export type FirstEncounterMode = "smart" | "additive" | "local-wins" | "cloud-wins";

/** 云端目标身份：endpoint + region + bucket + prefix。换任一项 = 换目标 = 重新判定首次相遇。 */
export interface SyncTargetSettings {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
}

export function targetKeyOf(s: SyncTargetSettings): string {
  return [s.endpoint.trim().toLowerCase(), s.region.trim(), s.bucket.trim(), s.prefix.trim().replace(/^\/+|\/+$/g, "")].join("\u0000");
}

/** 功能一：配置探测三态。marker = meta/pointer.json（本产品库标记）。 */
export type CloudProbeKind = "empty" | "ours" | "foreign";

export function classifyCloudProbe(probe: { objectCount: number; hasLibraryMarker: boolean }): CloudProbeKind {
  if (probe.objectCount <= 0) return "empty";
  return probe.hasLibraryMarker ? "ours" : "foreign";
}

/** 探测结果对应的配置页提示（只提示不提问）。null = 静默通过。 */
export function probeHint(kind: CloudProbeKind): { tone: "info" | "warn"; text: string } | null {
  if (kind === "empty") return null;
  if (kind === "ours") return { tone: "info", text: "该前缀下已有数据（已存在的知识库）。首次同步将询问合并方式。" };
  return { tone: "warn", text: "该前缀下已有其它文件（非本产品数据）——请确认前缀是否正确。" };
}

/** 弹窗亮的事实（本机 N / 云端 M / 重合 K）。 */
export interface EncounterFacts {
  localNotes: number;
  cloudNotes: number;
  overlapNotes: number;
}

export interface FirstEncounterDecisionInput {
  /** 无真实同步基线（null 或 bootstrap 底稿）或基线属于别的云端目标。 */
  noRelationship: boolean;
  /** 云端非空（有 pointer/索引内容）。 */
  cloudNonEmpty: boolean;
  /** 本地非空（活跃文档/小记/目录任一）。 */
  localNonEmpty: boolean;
}

/** 功能二触发判定：双方无共同历史 且 云端非空 且 本地非空 ⇒ 必须先问。 */
export function needsFirstEncounterDecision(input: FirstEncounterDecisionInput): boolean {
  return input.noRelationship && input.cloudNonEmpty && input.localNonEmpty;
}

/** 文档条目决策的映射结果：在既有 ItemAction 之上新增 download-to-trash（远端独有 → 本地回收站）。 */
export type EncounterItemAction = ItemAction | "download-to-trash";

export interface EncounterItemContext {
  localPresent: boolean;
  remotePresent: boolean;
}

/**
 * 四选项对单条目决策的改写（纯函数）。
 * - smart：原判定不动（有包内基线按基线判真删；无基线时原判定本就不删——见 s3v3Decision 空 base 分支）；
 * - additive（只增不删，仅这一次）：双向都不删——本地删除意图本轮不执行、云端缺席不传播、冲突本机胜；
 * - local-wins（以本地为准）：本机全量上行覆盖云端；云端独有 → 本地回收站（可恢复）；云端的删除一律不认；
 * - cloud-wins（以云端为准）：云端拉取覆盖本地；本地独有 → 「云端已删除·仅本地」回收站（可恢复）；小记走小记回收站绝不物删。
 */
export function applyEncounterAction(mode: FirstEncounterMode, action: ItemAction, ctx: EncounterItemContext): EncounterItemAction {
  if (mode === "smart") return action;
  if (mode === "additive") {
    if (action === "local-purge-wins") return "none";                 // 本地删除意图推迟到下一轮（本轮不删）
    if (action === "remote-purged-move-to-trash") return "upload";     // 云端缺席不传播：本机内容视为待上传
    if (action === "remote-wins-keep-history") return "upload";        // 「本机内容全视为待上传」
    return action;
  }
  if (mode === "local-wins") {
    if (action === "download") return ctx.localPresent ? "upload" : "download-to-trash"; // 双方都在=本机胜；远端独有=进回收站
    if (action === "remote-wins-keep-history") return "upload";
    if (action === "remote-purged-move-to-trash") return "upload";     // 云端的删除被「本地为准」覆盖
    return action;                                                    // local-purge-wins = 本机显式删除，照常传播
  }
  // cloud-wins
  if (action === "upload") return ctx.remotePresent ? "remote-wins-keep-history" : "remote-purged-move-to-trash";
  if (action === "local-purge-wins") return "download";               // 云端为准：云端条目回拉（显式删除意图留下一轮生效）
  return action;
}

/** 小记条目决策的映射结果（QuickNoteActionKind + download-to-trash）。 */
export type EncounterQuickAction = "upload" | "download" | "remote-wins-history" | "local-delete" | "local-purge" | "none" | "download-to-trash";

export function applyQuickEncounterAction(mode: FirstEncounterMode, kind: EncounterQuickAction, ctx: EncounterItemContext): EncounterQuickAction {
  if (mode === "smart") return kind;
  if (mode === "additive") {
    if (kind === "local-purge") return "none";
    if (kind === "local-delete") return ctx.localPresent ? "upload" : "none"; // 云端缺席不传播（有本机内容=重传）；本机删除推迟
    if (kind === "remote-wins-history") return "upload";
    return kind;
  }
  if (mode === "local-wins") {
    if (kind === "download") return ctx.localPresent ? "upload" : "download-to-trash";
    if (kind === "remote-wins-history") return "upload";
    if (kind === "local-delete" && ctx.localPresent) return "upload"; // 云端的删除被本地为准覆盖
    return kind;
  }
  // cloud-wins
  if (kind === "upload") return ctx.remotePresent ? "remote-wins-history" : "local-delete"; // 本地独有 → 小记回收站（local-delete+有本地行 = quick-soft-delete 发射）
  if (kind === "local-purge") return "download";
  if (kind === "local-delete" && !ctx.localPresent) return "download"; // 云端为准：云端条目回拉，不从云端删除
  return kind;
}

/**
 * 一次性决策注入（设备本地、会话级）：弹窗选定后写入，下一次同步入口消费掉。
 * 免改两端 IPC/桥签名；「仅这一次」语义天然成立（该轮建立共同基线后不再需要）。
 * 后台同步若先跑到，执行的也是用户已选定的模式（用户裁决优先于触发方式）。
 */
let pendingMode: FirstEncounterMode | null = null;
export function setPendingFirstEncounterMode(mode: FirstEncounterMode): void { pendingMode = mode; }
export function consumePendingFirstEncounterMode(): FirstEncounterMode | null {
  const m = pendingMode;
  pendingMode = null;
  return m;
}

/** 从 first-encounter-decision-required 错误消息解析事实（两端 UI 共用）。 */
export function parseEncounterFacts(message: string): EncounterFacts | null {
  // 消息可能被桥/包装层裹层（如「同步失败：{...}」）⇒ 从首个 { 到末个 } 截取 JSON 再试。
  const start = message.indexOf("{");
  const end = message.lastIndexOf("}");
  const raw = start >= 0 && end > start ? message.slice(start, end + 1) : message;
  try {
    const v = JSON.parse(raw) as Partial<EncounterFacts>;
    if (typeof v.localNotes === "number" && typeof v.cloudNotes === "number" && typeof v.overlapNotes === "number") {
      return { localNotes: v.localNotes, cloudNotes: v.cloudNotes, overlapNotes: v.overlapNotes };
    }
  } catch { /* 非事实消息 */ }
  return null;
}

/** 五选项文案单一来源（顺序 = 弹窗按钮顺序；「取消」由 UI 自行渲染为关闭）。 */
export const ENCOUNTER_OPTIONS: ReadonlyArray<{ mode: FirstEncounterMode; label: string; hint: string }> = [
  { mode: "smart", label: "智能合并", hint: "推荐：按真实历史判定删除（顺序正确时即增量同步）" },
  { mode: "additive", label: "只增不删", hint: "仅这一次：本机内容全部上传，本轮双向都不删" },
  { mode: "local-wins", label: "以本地为准", hint: "本地覆盖云端；云端多出的进回收站（可恢复）" },
  { mode: "cloud-wins", label: "以云端为准", hint: "云端覆盖本地；本地多出的进回收站（可恢复）" },
];

/** 探测远端所需的最小端口（S3v3Remote 的子集；桌面主进程/移动 v3 适配器都可直接喂）。 */
export interface ProbeRemoteLike {
  list(prefix: string): Promise<Array<{ key: string }>>;
  get(key: string): Promise<Uint8Array | null>;
}

/**
 * 功能一探测（保存变更时跑一次，只提示不提问）：限配置前缀之下。
 * 本产品库标记 = meta/pointer.json；无标记但有对象 = 疑似前缀/桶配错（宁可提醒不静默）。
 * 成本：pointer 一次 GET +（无标记时）一次前缀列举；仅在配置变更时执行（s3SettingsChanged）。
 */
export async function probeCloudTarget(remote: ProbeRemoteLike): Promise<{ kind: CloudProbeKind; hint: { tone: "info" | "warn"; text: string } | null }> {
  const marker = await remote.get("meta/pointer.json");
  if (marker) return { kind: "ours", hint: probeHint("ours") };
  const objects = await remote.list("");
  const kind = classifyCloudProbe({ objectCount: objects.length, hasLibraryMarker: false });
  return { kind, hint: probeHint(kind) };
}

/** 配置保存「变更即重探」判定（功能一触发条件）：endpoint/region/bucket/prefix 任一变化。 */
export function s3SettingsChanged(prev: SyncTargetSettings | null, next: SyncTargetSettings): boolean {
  if (!prev) return true;
  return targetKeyOf(prev) !== targetKeyOf(next);
}

/** 询问结果的事实行文案（弹窗用；两端 UI 各自排版）。 */
export function encounterFactsText(f: EncounterFacts): string {
  return `本机 ${f.localNotes} 篇 / 云端 ${f.cloudNotes} 篇 / 重合 ${f.overlapNotes} 篇`;
}