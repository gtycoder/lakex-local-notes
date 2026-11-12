/**
 * 只读原因的单一来源（261112 UI 审计 17 / P1）：
 *   为什么这篇文档不能编辑 + 怎么解除。桌面编辑器横幅 / 缺正文面板共用；移动端将来可直接复用文案。
 *
 * 输入全部是**既有判据**（tab.deleted / cloudDeleted / isEditLocked / bodyMissing），不新增状态、不碰同步协议。
 * 文案红线（AGENTS §3#14）：界面文案不用中点「·」作分隔符。
 */

export type ReadonlyReasonKind = "trashed" | "cloud-deleted" | "locked" | "body-missing";

/** 判据入口：全部可选，调用方只传自己已有的那份状态。 */
export interface ReadonlyReasonInput {
  /** 文档在回收站（软删）或已被他端 purge（本地副本在回收站）。= tab.deleted / isGoneNote。 */
  trashed?: boolean;
  /** 「云端已删除（仅本地）」副本：云端已 purge、本机仍保留可恢复副本（trashed 的子集，优先说明）。 */
  cloudDeleted?: boolean;
  /** 本机编辑锁（只读标记，随 v3 索引同步传播）。 */
  locked?: boolean;
  /** 正文文件缺失：不挂编辑器、只读面板。 */
  bodyMissing?: boolean;
}

/** 一条原因的完整文案 + 横幅动作（null = 该原因在面板里自带动作组，横幅不重复给）。 */
export interface ReadonlyReasonCopy {
  /** 横幅标题：一句话说清「为什么只读」。 */
  title: string;
  /** 一句「怎么解除」。 */
  releaseHint: string;
  action: "open-trash" | "unlock" | null;
}

export interface ReadonlyReason extends ReadonlyReasonCopy {
  reason: ReadonlyReasonKind;
}

export const READONLY_REASON_COPY: Record<ReadonlyReasonKind, ReadonlyReasonCopy> = {
  trashed: {
    title: "该文档在回收站中：只读、编辑不会保存",
    releaseHint: "需要继续写请先恢复；恢复后可继续编辑。",
    action: "open-trash",
  },
  "cloud-deleted": {
    title: "云端已删除（仅本地）：只读、编辑不会保存",
    releaseHint: "需要继续写请先在回收站恢复；恢复后会重新上传。",
    action: "open-trash",
  },
  locked: {
    title: "本文档已锁定（只读）",
    releaseHint: "点「解锁」后可继续编辑；锁定期间编辑与工具栏被禁用。",
    action: "unlock",
  },
  "body-missing": {
    title: "正文文件已丢失，已按只读打开",
    releaseHint: "不会覆盖磁盘上的任何数据，也不会上传空正文；从历史版本恢复或同步拉回后点「重新读取」。",
    action: null,
  },
};

/**
 * 判据优先级：正文缺失 > 云端已删除 > 回收站 > 锁定。
 * 理由：正文缺失时编辑器根本不挂载（最特殊）；cloudDeleted 是 trashed 的更具体说明，必须先判；
 * 锁定是用户主动行为，最低优先（已被数据事实覆盖时不提锁定）。
 */
export function readonlyReasonOf(input: ReadonlyReasonInput): ReadonlyReason | null {
  if (input.bodyMissing) return { reason: "body-missing", ...READONLY_REASON_COPY["body-missing"] };
  if (input.cloudDeleted) return { reason: "cloud-deleted", ...READONLY_REASON_COPY["cloud-deleted"] };
  if (input.trashed) return { reason: "trashed", ...READONLY_REASON_COPY.trashed };
  if (input.locked) return { reason: "locked", ...READONLY_REASON_COPY.locked };
  return null;
}

export function readonlyReasonCopy(kind: ReadonlyReasonKind): ReadonlyReasonCopy {
  return READONLY_REASON_COPY[kind];
}
