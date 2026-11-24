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

export function targetKeyOf(s: SyncTargetSettings | null | undefined): string | undefined {
  // 无设置行/注入式 remote（测试与降级路径）＝ 无云端目标身份 ⇒ undefined（闸门按「无 targetKey」处理，绝不抛）。
  if (!s || !s.endpoint || !s.bucket) return undefined;
  return [s.endpoint.trim().toLowerCase(), s.region.trim(), s.bucket.trim(), s.prefix.trim().replace(/^\/+|\/+$/g, "")].join("\u0000");
}

/**
 * 云端目标「数据身份」比较：**忽略 region**（261124 数据事故复盘）。region 只是 S3 签名作用域，
 * 七牛等兼容层不严格校验（cn-north-1 / cn-east-1 都能读写），并不改变 endpoint+bucket+prefix 指向的
 * 同一份数据。两端 region 填得不一致（移动端表单默认 cn-north-1、桌面历史值 cn-east-1）曾把同一个桶
 * 判成两个目标 ⇒ 误触发首次相遇的破坏性改写。比较按字段进行（\u0000 分隔，端点小写、前缀去首尾 /），
 * 兼容旧四段式存储键；缺段的键只比较可得段。相同返回 true。
 */
export function sameSyncTargetKey(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const parts = (k: string) => k.split("\u0000").map((x) => x.trim());
  const pa = parts(a);
  const pb = parts(b);
  // 261124 ⑤P3-1：不足三段的**截断键**只在「同一字符串」时判同目标——pick 对缺段按 undefined
  // 比较，不同截断键会经缺段对齐互判「同目标」（换桶保护输入被静默放行）。同一字符串恒同目标
  // （基线盖章/闸门「同 targetKey」自比语义；首轮把短键一律判不等曾打断 ask-once 闸门，勿回退）。
  if (a === b) return true;
  if (pa.length < 3 || pb.length < 3) return false;
  // 四段式 [endpoint, region, bucket, prefix]；三段式无 region。endpoint 小写归一、prefix 去首尾 /（与 targetKeyOf 同口径）。
  const norm = (v: string | undefined, kind: "ep" | "rest") => {
    if (v === undefined) return v;
    const t = v.trim();
    return kind === "ep" ? t.toLowerCase() : kind === "rest" ? t.replace(/^\/+|\/+$/g, "") : t;
  };
  const pick = (p: string[]) => (p.length >= 4 ? [norm(p[0], "ep"), norm(p[2], "rest"), norm(p[3], "rest")] : [norm(p[0], "ep"), norm(p[1], "rest"), norm(p[2], "rest")]);
  const [ae, ab, ap] = pick(pa);
  const [be, bb, bp] = pick(pb);
  return ae === be && ab === bb && ap === bp;
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
  /** 基线是否认识该条目（共享历史）。**基线已知条目绝不走破坏性改写**（261124 数据事故：导入丢行 + 配置指纹不一致 +
   *  「以本地为准」把基线里明明存在的文档当「云端多出」发布成已删 ⇒ 他端整批进回收站）。 */
  basePresent: boolean;
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
    // 双方都在=本机胜；远端独有且**基线也不认识**=真·云端多出→进回收站；基线认识=共享历史缺失副本→普通下载补回（绝不误删）。
    if (action === "download") return ctx.localPresent ? "upload" : (ctx.basePresent ? "download" : "download-to-trash");
    if (action === "remote-wins-keep-history") return "upload";
    if (action === "remote-purged-move-to-trash") return "upload";     // 云端的删除被「本地为准」覆盖
    return action;                                                    // local-purge-wins = 本机显式删除，照常传播
  }
  // cloud-wins
  if (action === "upload") return ctx.remotePresent ? "remote-wins-keep-history" : "remote-purged-move-to-trash";
  if (action === "local-purge-wins") return "download";               // 云端为准：云端条目回拉（显式删除意图留下一轮生效）
  return action;
}

/**
 * 目录条目决策的映射结果（folders 计划动作；261124 P0-B1 补齐）。
 *
 * 旧实现 applyEncounterAction 只覆盖文档/小记 ⇒ folders 循环裸用原始判定：
 * 「只增不删」轮里本地独有目录仍被收进回收站（remove-folder → deleteTreeNode **级联整棵子树**），
 * 与 §21.2「本轮双向都不删」直接矛盾。目录版映射镜像文档语义（不丢数据优先）：
 * - additive（只增不删）：云端缺席不传播（本地目录保留上行）、本地删除推迟；
 * - local-wins（以本地为准）：云端的删除一律不认（本地目录上行）、本地在场全量上行；
 *   云端独有且基线不认识 ⇒ 直接补拉（**已知偏差**：文档走 download-to-trash 进回收站，
 *   目录无此动作 —— 补拉多收一个目录不丢数据，方向安全，登记在 00-MASTER）；
 * - cloud-wins：沿用既有近似（plan.ts 抑制本地上行；remote-purged-trash = 本地回收站，可恢复）。
 */
export type EncounterFolderAction = "upload" | "download" | "local-delete" | "local-purge" | "remote-purged-trash" | "none";

export function applyFolderEncounterAction(mode: FirstEncounterMode, kind: EncounterFolderAction, ctx: EncounterItemContext): EncounterFolderAction {
  if (mode === "smart") return kind;
  if (mode === "additive") {
    if (kind === "local-delete" || kind === "local-purge") return "none"; // 本地删除意图推迟（本轮不删）
    if (kind === "remote-purged-trash") return "upload";                  // 云端缺席不传播：本地目录视为待上传
    return kind;
  }
  if (mode === "local-wins") {
    if (kind === "remote-purged-trash") return "upload";                  // 云端的删除被「本地为准」覆盖
    if (kind === "download") return ctx.localPresent ? "upload" : "download"; // 在场全量上行；缺席补回
    return kind;
  }
  // cloud-wins：目录沿用既有近似（不丢数据方向；见类型注释）
  return kind;
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
    // 远端独有小记：**安全兜底 = 普通下载（内容必保）**。原定「下载落小记回收站」变体因合并世界
    // 不物化远端独有下载条目（行生成缺口，261123 E2E 定位）暂不可达——绝不丢数据优先于覆盖细节；
    // 回收站变体待 state 世界物化面修通后再开（SYNC-PROTOCOL §21 已知近似）。
    if (kind === "download") return ctx.localPresent ? "upload" : "download"; // 双方都在=本机胜；远端独有=安全兜底下载
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