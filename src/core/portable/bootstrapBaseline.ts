/**
 * 便携包零基线迁移的「合并底稿」基线（bootstrap baseline）—— 261123 设计决定，规格 docs/PORTABLE-TRANSFER.md §3.1。
 * 纯逻辑，不 import node:* / electron / capacitor；桌面与移动端导入端共用，是合成基线的单一来源。
 *
 * 背景：纯离线包（导出端从未配 S3）没有云端基线可随包；若导入后按「无基线」处理，首同步走拉全轮
 * （云端是真相）会把迁移数据误判成「云端已删」（小记甚至被物理丢弃）。合并底稿把**导出时刻的内容快照**
 * 当三方合并的 base：导出后云端删/改的照常传播（删除压编辑不变），导入后本机新建/修改的判成新增上传，
 * 小记不丢、文档不打假删除标。谱系字段留空（从未同步过 ⇒ 无谱系可校验），首轮对齐云端谱系后
 * 基线推进为真基线（bootstrap 标记消失）。
 */
import type { DeviceBaseline } from "../s3v3DeviceStore";
import { assertSafeSegment } from "../s3v3/protocol/s3v3Keys";
import { S3V3_HASH_RE } from "../s3v3/protocol/s3v3Types";
import {
  S3V3_INDEX_VERSION,
  validateLakeIndex,
  validateQuickNotesIndex,
  type LakeFolderEntry,
  type LakeNoteEntry,
  type QuickNoteEntry,
  type QuickNoteTagEntry,
} from "../s3v3/protocol/s3v3Index";

/** 合成输入：导出时刻的世界（活跃 + 回收站条目；contentHash = 导出时刻哈希）。 */
export interface BootstrapRowSet {
  notes: LakeNoteEntry[];
  folders: LakeFolderEntry[];
  quickItems: QuickNoteEntry[];
  quickTags?: QuickNoteTagEntry[];
  /** 导出时刻已彻底删除的小记 id（进 base 的 purged 墓碑，与真基线同形）。 */
  quickPurged?: string[];
}

/** 条目能不能进底稿（坏 id / 坏 hash 只丢该条，不毁整包导入）。 */
function usableEntry(e: { id: string; contentHash: string }): boolean {
  if (typeof e.id !== "string" || e.id.length === 0) return false;
  try { assertSafeSegment(e.id); } catch { return false; }
  return S3V3_HASH_RE.test(e.contentHash);
}

function tryValidate(fn: () => unknown): boolean {
  try { fn(); return true; } catch { return false; }
}

function buildQuickRaw(items: QuickNoteEntry[], rows: BootstrapRowSet): Record<string, unknown> {
  return {
    v: S3V3_INDEX_VERSION,
    space: "quickNotes",
    items,
    ...(rows.quickTags && rows.quickTags.length > 0 ? { tags: rows.quickTags } : {}),
    ...(rows.quickPurged && rows.quickPurged.length > 0 ? { purged: rows.quickPurged } : {}),
  };
}

/**
 * 合成合并底稿基线。非法条目逐条丢弃（幂等导入不因个别坏行失败）；整个索引仍过 core 校验
 * （单一判据 = validateLakeIndex / validateQuickNotesIndex），校验不过说明行数据整体损坏 ⇒ 抛错。
 */
export function buildBootstrapBaseline(rows: BootstrapRowSet): DeviceBaseline {
  // 去重（id 只留第一条）+ 坏条目过滤：个别坏行不毁整包导入。
  const dedupe = <T extends { id: string }>(list: T[]): T[] => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const item of list) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out;
  };
  const notes = dedupe(rows.notes.filter(usableEntry));
  const quickItems = dedupe(rows.quickItems.filter((e) => usableEntry(e)));
  const folders = dedupe(rows.folders.filter((f) => {
    if (typeof f.id !== "string" || f.id.length === 0) return false;
    try { assertSafeSegment(f.id); } catch { return false; }
    return true;
  }));
  // 整体校验优先（常见路径一次过）；个别坏条目（重复 id / 超限 tagIds 等）不毁整次导入：
  // 逐条试校验、只丢坏条，重建后再整体校验（仍失败 = 行数据整体损坏 ⇒ 抛可读错误）。
  let lake;
  let quickNotes;
  try {
    lake = validateLakeIndex({ v: S3V3_INDEX_VERSION, space: "lake", notes, folders });
    quickNotes = validateQuickNotesIndex(buildQuickRaw(quickItems, rows));
  } catch {
    const okNotes = notes.filter((n) => tryValidate(() => validateLakeIndex({ v: S3V3_INDEX_VERSION, space: "lake", notes: [n], folders: [] })));
    const okFolders = folders.filter((f) => tryValidate(() => validateLakeIndex({ v: S3V3_INDEX_VERSION, space: "lake", notes: [], folders: [f] })));
    const okQuick = quickItems.filter((q) => tryValidate(() => validateQuickNotesIndex({ v: S3V3_INDEX_VERSION, space: "quickNotes", items: [q] })));
    lake = validateLakeIndex({ v: S3V3_INDEX_VERSION, space: "lake", notes: okNotes, folders: okFolders });
    quickNotes = validateQuickNotesIndex(buildQuickRaw(okQuick, rows));
  }
  return {
    epoch: "",
    generation: 0,
    lakeCommit: "",
    quickNotesCommit: "",
    lake,
    quickNotes,
    bootstrap: true,
  };
}

/** 是否合并底稿基线（谱系未定、内容底稿有效）。 */
export function isBootstrapBaseline(baseline: DeviceBaseline | null | undefined): boolean {
  return !!baseline && baseline.bootstrap === true;
}

/** 云端谱系形状（pointer 的最小结构；两端同形）。 */
export interface BootstrapLineage {
  epoch: string;
  generation: number;
  lakeCommit: string;
  quickNotesCommit: string;
}

/**
 * 血缘对齐：从未同步过的设备没有谱系可校验 ⇒ 首个同步轮采纳云端谱系（epoch/generation/commit），
 * **内容底稿保持导出时刻快照**（三方合并的 base 不变）。对齐后的基线仍带 bootstrap 标记：
 * 引擎据此跳过「基线内容 = 远端内容」的零变更快路径，并在本轮结束把基线推进为真基线。
 */
export function rebaseBootstrapBaseline(baseline: DeviceBaseline, lineage: BootstrapLineage): DeviceBaseline {
  return {
    ...baseline,
    epoch: lineage.epoch,
    generation: lineage.generation,
    lakeCommit: lineage.lakeCommit,
    quickNotesCommit: lineage.quickNotesCommit,
    bootstrap: true,
  };
}
