/**
 * v4 Commit 的纯前半段（E2-2a）：把 plan.publish + Apply 的结果合成**最终索引**。
 *
 * 为什么单独成纯函数：索引是「本轮真相」的唯一载体，回退规则（上传失败必须回到远端旧条目）
 * 如果散在 IO 代码里，最容易在重构时丢掉，而丢掉的后果是索引引用未落盘的正文/声明。
 * 纯函数 ⇒ 可穷举测试、可 dry-run 打印（「这一轮会把索引变成什么样」）。
 *
 * 规则（与 v3 引擎 `failUpload` + uploadAssets 结果一致）：
 *  1. plan.publish = null ⇒ 本轮不提交（零变更/纯拉取），返回 null；
 *  2. 上传失败的条目：远端有同 id ⇒ **回退远端旧条目**；远端也没有 ⇒ 从索引移除（绝不引用未落盘字节）；
 *  3. assetsHashes：覆盖/清空条目的 assetsHash（applyAssets 的新声明）；
 *  4. 顺序稳定：保持 plan.publish 的条目顺序（folder/笔记排列稳定，diff 友好）。
 */
import type { LakeIndex, LakeNoteEntry, QuickNoteEntry, QuickNotesIndex } from "../protocol/index.js";
import type { Space, SyncPlan } from "../plan/types.js";

export interface PublishOverrides {
  /** 上传失败（正文缺失/字节不符/传输失败）：该条目必须回退到远端旧版本。 */
  failedUploads: Array<{ space: Space; id: string }>;
  /** applyAssets 产出的新 assetsHash；undefined = 该条目已无资产。 */
  assetsHashes: Array<{ space: Space; id: string; assetsHash: string | undefined }>;
}

export interface PublishWorld {
  lake: LakeIndex;
  quickNotes: QuickNotesIndex;
}

/** 组装最终索引；null = 本轮不提交。纯函数，零 IO。 */
export function buildPublishIndex(plan: SyncPlan, remote: PublishWorld, over: PublishOverrides): PublishWorld | null {
  if (!plan.publish) return null;
  // 快路径（正常轮）：没有上传失败、没有资产 hash 覆盖 ⇒ 计划索引就是最终索引，
  // 不做任何逐条遍历/查表（2 万文档时省一次全量扫描）。
  if (over.failedUploads.length === 0 && over.assetsHashes.length === 0) {
    // 浅拷贝顶层（不返回调用方对象引用），条目数组直接复用：O(1)，不做逐条处理。
    return { lake: plan.publish.lake, quickNotes: plan.publish.quickNotes };
  }
  const failed = new Set(over.failedUploads.map((f) => f.space + ":" + f.id));
  const assets = new Map(over.assetsHashes.map((a) => [a.space + ":" + a.id, a.assetsHash]));

  const notes: LakeNoteEntry[] = [];
  for (const n of plan.publish.lake.notes) {
    const key = "lake:" + n.id;
    if (failed.has(key)) {
      const prev = remote.lake.notes.find((r) => r.id === n.id);
      if (prev) notes.push({ ...prev });
      continue; // 远端也没有 ⇒ 不进索引（宁可不写也不能引用未落盘内容）
    }
    const next = { ...n };
    if (assets.has(key)) {
      const hash = assets.get(key);
      if (hash) next.assetsHash = hash; else delete next.assetsHash;
    }
    notes.push(next);
  }

  const items: QuickNoteEntry[] = [];
  for (const q of plan.publish.quickNotes.items) {
    const key = "quickNotes:" + q.id;
    if (failed.has(key)) {
      const prev = remote.quickNotes.items.find((r) => r.id === q.id);
      if (prev) items.push({ ...prev });
      continue;
    }
    const next = { ...q };
    if (assets.has(key)) {
      const hash = assets.get(key);
      if (hash) next.assetsHash = hash; else delete next.assetsHash;
    }
    items.push(next);
  }

  return {
    lake: { ...plan.publish.lake, notes, folders: plan.publish.lake.folders.map((f) => ({ ...f })) },
    quickNotes: { ...plan.publish.quickNotes, items, tags: (plan.publish.quickNotes.tags ?? []).map((t) => ({ ...t })) },
  };
}
