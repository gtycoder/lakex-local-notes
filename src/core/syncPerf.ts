/**
 * 同步性能/边界纯函数（lake-core 共享层）。
 *
 * 背景：桌面 sync.ts 与共享 syncEngine 各有编排（入口不同），但决策逻辑必须单点——
 * 改一处两端生效（机制共享、逻辑一致，V5 原则）。以下纯函数从桌面 sync.ts 抽取：
 * - shouldSkipZeroChange：零变更早退判定（桌面 L309-312）
 * - isRemoteDescendant：目录循环移动的环检测（桌面 L370-380）
 * - createSupersededTracker：superseded 去重（桌面 L328-331）
 */

/** 零变更早退判定输入（全部来自端口数据，无副作用）。 */
export interface ZeroChangeCheck {
  remoteCommitId: string | null;
  lastSeenCommitId: string | null;
  hasPending: boolean;
  tombstoneSig: string;
  lastTombstoneSig: string;
}

/**
 * 零变更早退：远端 commitId 与本设备上次相同，且本地无待上传变更、墓碑签名一致
 * → 整轮跳过（不做 manifest 解析/逐条记账/重写上传）。
 * 10k 条时从秒级降到 ~100ms（纯性能、语义等价）。
 */
export function shouldSkipZeroChange(check: ZeroChangeCheck): boolean {
  return (
    check.remoteCommitId !== null
    && check.remoteCommitId === check.lastSeenCommitId
    && !check.hasPending
    && check.tombstoneSig === check.lastTombstoneSig
  );
}

/**
 * 环检测：nodeId 在远端树中是否为 ancestorId 的子孙（含自身；防环 seen 兜底异常清单）。
 * 用于本地移动与远端已提交移动互成父子（循环移动）的结构冲突检测。
 */
export function isRemoteDescendant(
  nodeId: string,
  ancestorId: string,
  parentMap: Map<string, string | null>,
): boolean {
  let cur: string | null | undefined = nodeId;
  const seen = new Set<string>();
  while (cur !== null && cur !== undefined) {
    if (cur === ancestorId) return true;
    if (seen.has(cur)) return false;
    seen.add(cur);
    cur = parentMap.get(cur);
  }
  return false;
}

/**
 * superseded 去重跟踪器：Lake 下载阶段冲突语义由 supersededNotes 表达
 * （trash-cross 与下载分支可能重复记同一笔记，需 Set 去重）。
 */
export function createSupersededTracker() {
  const ids = new Set<string>();
  const list: Array<{ id: string; title: string }> = [];
  return {
    push(id: string, title: string): void {
      if (ids.has(id)) return;
      ids.add(id);
      list.push({ id, title });
    },
    list(): Array<{ id: string; title: string }> {
      return list;
    },
  };
}
