/**
 * 自定义卡「待落盘」提交注册表（评审 B1 的最小修法）。
 *
 * 问题：卡片里的明文只活在组件内存，正文（含密文）只在防抖到期后才更新 ⇒
 * 用户打完最后一句立刻关标签 / 锁文档 / 退出时，生命周期闸门看到 tab **不脏**，
 * 于是跳过保存，最后一段明文静默丢失（不是泄漏，是丢数据 —— 违反"本地是真相"）。
 *
 * 用法：卡片 mount 时注册一个 flush（返回"是否真的写了"），生命周期入口在
 * 判定/保存**之前** await `flushPendingLockedTextCommits()`：
 * - 有 pending ⇒ 先把明文加密写回 cardValue（内核模型立刻变脏）；
 * - 返回值 = 是否写入过 ⇒ 调用方即使原先 `tab.dirty === false` 也要补一次 persist。
 *
 * 为什么放在 features/editor（而不是 core）：它只是渲染层的编排，不承载策略。
 */
type Flush = () => Promise<boolean>;

const flushes = new Set<Flush>();

/** 注册一个 flush；返回注销函数（组件卸载时调用）。 */
export function registerLockedTextFlush(flush: Flush): () => void {
  flushes.add(flush);
  return () => { flushes.delete(flush); };
}

/** 把当前所有卡片的"未落盘明文"补写成密文。返回是否发生过写入。 */
export async function flushPendingLockedTextCommits(): Promise<boolean> {
  if (flushes.size === 0) return false;
  let wrote = false;
  for (const flush of Array.from(flushes)) {
    try {
      if (await flush()) wrote = true;
    } catch { /* 单张卡失败不阻断其他卡与生命周期动作 */ }
  }
  return wrote;
}
