/**
 * S3 GC 诊断（lake-core：纯函数、零平台依赖，桌面/移动/测试共用）。
 *
 * 为什么需要它：设置面板的「待回收键」与三个按钮**从来不是同一个集合**（见 docs/S3-GC-DESIGN.md §6.8）——
 *   · 待回收表 s3_gc_pending = 本机同步时标记的"疑似冗余"键，**含保留窗口内不可删的**；
 *   · 立即对账 = 只删「已标记 ∧ 已过窗口 ∧ 不被权威引用集 keep 命中」的键（增量）；
 *   · 深度清理 = 只删「云端实扫 ∧ 已过窗口 ∧ 不在 keep」的键（全量，含孤儿）。
 * 三者都受 gcRetentionDays 保护，所以"界面显示 23、点了对账/深度清理都是 0"是**设计使然**，
 * 但旧 UI 只报一个总数，用户无从判断。本模块把三份输入归一成一份可解释统计：
 * 总数 / 已过窗口（可删） / 窗口内（暂不可删 + 最早可删时刻） / 云端未引用 / 时间戳缺失。
 *
 * 判定窗口用同一组导出函数（gcCutoffMs / isPastWindow），对账与深度清理执行器也调用它们，
 * 保证「诊断预测」与「实际执行」逐字节一致，不会出现"预览 5 个、实删 4 个"。
 */

/** 本机待回收表一行（来自 store.listS3GcPending()）。 */
export interface GcPendingRow {
  key: string;
  /** ISO 字符串（store 侧 nowIso()）。 */
  markedAt: string;
}

/** 云端实扫一个对象（来自 ObjectStore.list()）。 */
export interface GcCloudObject {
  key: string;
  /** 云端 LastModified 的 ISO 字符串；缺失时为空串。 */
  lastModified: string;
  /** 对象字节数（云端 Size）。 */
  size: number;
}

export interface GcNamespaceStat {
  /** 键的第一段：objects | assets | manifests | quick-notes | other。 */
  namespace: string;
  cloudObjects: number;
  cloudBytes: number;
  /** 不在 keep 集（= 云端当前无人引用）。 */
  unreferenced: number;
  unreferencedBytes: number;
  /** 不在 keep 且已过窗口 ⇒ 深度清理会删。 */
  due: number;
  dueBytes: number;
  /** 不在 keep 但仍在窗口内 ⇒ 暂不可删。 */
  inWindow: number;
  /** 时间戳缺失/非法：既不算 due 也不算 inWindow，单独暴露（永不误删）。 */
  ageUnknown: number;
  /** 窗口内对象里最早变为可删的时刻（ISO）；无窗口内对象则 null。 */
  nextEligibleAt: string | null;
}

export interface GcDiagnostics {
  generatedAt: string;
  retentionDays: number;
  /** 窗口边界时刻：早于此时间点即"已过窗口"。 */
  cutoffAt: string;
  pending: {
    total: number;
    /** 已过窗口的已标记键。 */
    due: number;
    /** 已过窗口且不在 keep ⇒ 等于「立即对账」将删除的数量。 */
    dueDeletable: number;
    /** 已过窗口但仍被引用 ⇒ 对账会保留（不清表，等真正不再引用）。 */
    dueReferenced: number;
    /** 仍在窗口内的已标记键（删不掉，属正常冗余窗口）。 */
    inWindow: number;
    ageUnknown: number;
    oldestMarkedAt: string | null;
    /** 窗口内最早变为可删的时刻（= 最早 marked_at + 窗口）。 */
    nextEligibleAt: string | null;
  };
  cloud: {
    objects: number;
    bytes: number;
    unreferenced: number;
    unreferencedBytes: number;
    due: number;
    dueBytes: number;
    inWindow: number;
    ageUnknown: number;
    nextEligibleAt: string | null;
    namespaces: GcNamespaceStat[];
  };
  /** 权威引用集大小（latest manifest + commit 链 + 本设备历史 refs + 元数据键）。 */
  keepSetSize: number;
  manifest: { commitId: string; notes: number; folders: number } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 窗口边界（毫秒时刻）：`<= cutoff` 即已过窗口。retentionDays=0 ⇒ 边界就是现在（全部到期）。 */
export function gcCutoffMs(nowMs: number, retentionDays: number): number {
  const days = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 0;
  return nowMs - days * DAY_MS;
}

/** 时间戳是否已过窗口；无法解析（缺失/非法）返回 false（保守：判不出就不删）。 */
export function isPastWindow(iso: string | undefined, cutoffMs: number): boolean {
  const ms = parseMs(iso);
  return ms !== null && ms <= cutoffMs;
}

/** 时间戳是否仍受窗口保护（缺失/非法不算，交给 ageUnknown）。 */
export function isInsideWindow(iso: string | undefined, cutoffMs: number): boolean {
  const ms = parseMs(iso);
  return ms !== null && ms > cutoffMs;
}

/** 时间戳缺失/非法（云端未返回 LastModified、脏数据等）。 */
export function hasUnknownAge(iso: string | undefined): boolean {
  return parseMs(iso) === null;
}

function parseMs(iso: string | undefined): number | null {
  if (typeof iso !== "string" || iso.trim() === "") return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** 键命名空间 = 第一段前缀（`objects/x` → `objects`；无斜杠 → `other`）。 */
export function namespaceOf(key: string): string {
  const slash = key.indexOf("/");
  if (slash <= 0) return "other";
  return key.slice(0, slash);
}

/** 某时刻在 retentionDays 之后变为可删（用于"最早 X 天后可回收"提示）。 */
function eligibleAtMs(markMs: number, retentionDays: number): number {
  const days = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 0;
  return markMs + days * DAY_MS;
}

interface Bucket {
  cloudObjects: number;
  cloudBytes: number;
  unreferenced: number;
  unreferencedBytes: number;
  due: number;
  dueBytes: number;
  inWindow: number;
  ageUnknown: number;
  nextEligible: number | null;
}

function newBucket(): Bucket {
  return { cloudObjects: 0, cloudBytes: 0, unreferenced: 0, unreferencedBytes: 0, due: 0, dueBytes: 0, inWindow: 0, ageUnknown: 0, nextEligible: null };
}

export interface GcDiagnosticsInput {
  pending: GcPendingRow[];
  cloud: GcCloudObject[];
  keep: Set<string>;
  /** 当前时刻（毫秒），由调用方注入以便测试确定性。 */
  nowMs: number;
  retentionDays: number;
  manifest?: { commitId: string; notes: number; folders: number } | null;
}

export function computeGcDiagnostics(input: GcDiagnosticsInput): GcDiagnostics {
  const { pending, cloud, keep, nowMs, retentionDays } = input;
  const cutoff = gcCutoffMs(nowMs, retentionDays);

  // ---- 本机待回收表 ----
  let due = 0, dueDeletable = 0, dueReferenced = 0, inWindow = 0, ageUnknown = 0;
  let oldestMarked: number | null = null;
  let nextEligible: number | null = null;
  for (const row of pending) {
    const marked = parseMs(row.markedAt);
    if (marked === null) { ageUnknown += 1; continue; }
    if (oldestMarked === null || marked < oldestMarked) oldestMarked = marked;
    if (marked <= cutoff) {
      due += 1;
      if (keep.has(row.key)) dueReferenced += 1;
      else dueDeletable += 1;
    } else {
      inWindow += 1;
      const at = eligibleAtMs(marked, retentionDays);
      if (nextEligible === null || at < nextEligible) nextEligible = at;
    }
  }

  // ---- 云端实扫 ----
  const buckets = new Map<string, Bucket>();
  let cObjects = 0, cBytes = 0, cUnref = 0, cUnrefBytes = 0, cDue = 0, cDueBytes = 0, cInWindow = 0, cAgeUnknown = 0;
  let cNextEligible: number | null = null;
  for (const obj of cloud) {
    const ns = namespaceOf(obj.key);
    let b = buckets.get(ns);
    if (!b) { b = newBucket(); buckets.set(ns, b); }
    const size = Number.isFinite(obj.size) && obj.size > 0 ? obj.size : 0;
    cObjects += 1; cBytes += size;
    b.cloudObjects += 1; b.cloudBytes += size;
    if (keep.has(obj.key)) continue;                       // 仍被权威引用：不是回收对象
    cUnref += 1; cUnrefBytes += size;
    b.unreferenced += 1; b.unreferencedBytes += size;
    if (hasUnknownAge(obj.lastModified)) {
      cAgeUnknown += 1; b.ageUnknown += 1;
      continue;                                            // 判不出年龄 ⇒ 永不列为可删
    }
    if (isPastWindow(obj.lastModified, cutoff)) {
      cDue += 1; cDueBytes += size;
      b.due += 1; b.dueBytes += size;
    } else {
      cInWindow += 1; b.inWindow += 1;
      const at = eligibleAtMs(parseMs(obj.lastModified) as number, retentionDays);
      if (b.nextEligible === null || at < b.nextEligible) b.nextEligible = at;
      if (cNextEligible === null || at < cNextEligible) cNextEligible = at;
    }
  }

  const namespaces: GcNamespaceStat[] = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([namespace, b]) => ({
      namespace,
      cloudObjects: b.cloudObjects,
      cloudBytes: b.cloudBytes,
      unreferenced: b.unreferenced,
      unreferencedBytes: b.unreferencedBytes,
      due: b.due,
      dueBytes: b.dueBytes,
      inWindow: b.inWindow,
      ageUnknown: b.ageUnknown,
      nextEligibleAt: b.nextEligible === null ? null : new Date(b.nextEligible).toISOString(),
    }));

  return {
    generatedAt: new Date(nowMs).toISOString(),
    retentionDays,
    cutoffAt: new Date(cutoff).toISOString(),
    pending: {
      total: pending.length,
      due,
      dueDeletable,
      dueReferenced,
      inWindow,
      ageUnknown,
      oldestMarkedAt: oldestMarked === null ? null : new Date(oldestMarked).toISOString(),
      nextEligibleAt: nextEligible === null ? null : new Date(nextEligible).toISOString(),
    },
    cloud: {
      objects: cObjects,
      bytes: cBytes,
      unreferenced: cUnref,
      unreferencedBytes: cUnrefBytes,
      due: cDue,
      dueBytes: cDueBytes,
      inWindow: cInWindow,
      ageUnknown: cAgeUnknown,
      nextEligibleAt: cNextEligible === null ? null : new Date(cNextEligible).toISOString(),
      namespaces,
    },
    keepSetSize: keep.size,
    manifest: input.manifest ?? null,
  };
}

/** 相对时间描述（用于"约 N 天后可回收"）：<1 天按小时，>=1 天按天。 */
export function formatWindowRemaining(
  targetIso: string | null,
  nowMs: number
): string | null {
  if (!targetIso) return null;
  const ms = parseMs(targetIso);
  if (ms === null) return null;
  const diff = ms - nowMs;
  if (diff <= 0) return "已可回收";
  const hours = diff / 3600_000;
  if (hours < 24) return `约 ${Math.max(1, Math.ceil(hours))} 小时后`;
  return `约 ${Math.ceil(hours / 24)} 天后`;
}
