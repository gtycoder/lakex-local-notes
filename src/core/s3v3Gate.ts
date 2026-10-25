/**
 * 待删队列「执行门禁」（纯逻辑）：执行时刻按当前世界状态校验对象是否已不可达。
 * 设计：docs/S3-REDESIGN.md §5.2（第一份审计 R1 + 第二份 P1-B/第三轮条件 1）。
 * 原则：仍被引用 → 跳过并出队；宁可不删，不可误删。
 */

export interface IndexNote {
  id: string;
  contentHash: string;
  /** 当前资产声明版本；缺省 = 无资产。 */
  assetsHash?: string;
}

export interface IndexQuickNote {
  id: string;
  contentHash: string;
  assetsHash?: string;
}

export interface AssetDeclaration {
  declHash: string;
  filenames: string[];
}

/** 当前指针 + 当前索引 + 当前声明的世界状态快照。 */
export interface CurrentWorld {
  lakeCommit: string;
  quickNotesCommit: string;
  notes: IndexNote[];
  quickNotes: IndexQuickNote[];
  /** noteId → 当前声明。 */
  declarations: Record<string, AssetDeclaration>;
  /** quickNoteId → 当前声明。 */
  quickDeclarations: Record<string, AssetDeclaration>;
}

interface PendingBase {
  /** 完整对象 key 或前缀（排障用）。 */
  key: string;
  targetEpoch: string;
  targetGeneration: number;
  targetCommit: string;
  createdAt: string;
}

export type PendingDelete =
  | (PendingBase & { kind: "body"; noteId: string; oldHash: string })
  | (PendingBase & { kind: "asset"; noteId: string; filename: string })
  | (PendingBase & { kind: "declaration"; noteId: string; oldDeclHash: string })
  | (PendingBase & { kind: "purge-prefix"; noteId: string })
  | (PendingBase & { kind: "index"; space: "lake" | "quickNotes"; oldIndexHash: string })
  | (PendingBase & { kind: "quick-note-body"; noteId: string; oldHash: string })
  | (PendingBase & { kind: "quick-note-asset"; noteId: string; filename: string })
  | (PendingBase & { kind: "quick-note-declaration"; noteId: string; oldDeclHash: string })
  | (PendingBase & { kind: "quick-note-purge-prefix"; noteId: string });

export interface GateResult {
  execute: boolean;
  reason: string;
}

const KEEP = (reason: string): GateResult => ({ execute: false, reason });
const DELETE = (reason: string): GateResult => ({ execute: true, reason });

/** 执行门禁：execute=true 才允许物理删除。未知类型一律不删。 */
export function gatePendingDelete(item: PendingDelete, world: CurrentWorld): GateResult {
  switch (item.kind) {
    case "body": {
      const note = world.notes.find((n) => n.id === item.noteId);
      if (!note) return DELETE("条目已不存在");
      return note.contentHash === item.oldHash ? KEEP("当前索引仍引用该正文") : DELETE("正文已被替换");
    }
    case "asset": {
      const note = world.notes.find((n) => n.id === item.noteId);
      if (!note) return DELETE("条目已不存在");
      if (!note.assetsHash) return DELETE("当前条目无资产声明");
      const decl = world.declarations[item.noteId];
      if (!decl || decl.declHash !== note.assetsHash) return KEEP("声明缺失或与索引不一致，保守跳过");
      return decl.filenames.includes(item.filename) ? KEEP("当前声明仍引用该附件") : DELETE("附件已从声明移除");
    }
    case "declaration": {
      const note = world.notes.find((n) => n.id === item.noteId);
      if (!note) return DELETE("条目已不存在");
      return note.assetsHash === item.oldDeclHash ? KEEP("当前索引仍引用该声明版本") : DELETE("声明版本已被替换");
    }
    case "purge-prefix": {
      return world.notes.some((n) => n.id === item.noteId) ? KEEP("条目仍在当前索引") : DELETE("条目已从索引移除");
    }
    case "index": {
      const current = item.space === "lake" ? world.lakeCommit : world.quickNotesCommit;
      return current === item.oldIndexHash ? KEEP("当前指针仍指向该索引") : DELETE("索引已被替换");
    }
    case "quick-note-body": {
      const note = world.quickNotes.find((n) => n.id === item.noteId);
      if (!note) return DELETE("小记条目已不存在");
      return note.contentHash === item.oldHash ? KEEP("小记索引仍引用该正文") : DELETE("小记正文已被替换");
    }
    case "quick-note-asset": {
      const note = world.quickNotes.find((n) => n.id === item.noteId);
      if (!note) return DELETE("小记条目已不存在");
      if (!note.assetsHash) return DELETE("当前小记无图片声明");
      const decl = world.quickDeclarations[item.noteId];
      if (!decl || decl.declHash !== note.assetsHash) return KEEP("小记声明缺失或与索引不一致，保守跳过");
      return decl.filenames.includes(item.filename) ? KEEP("当前小记声明仍引用该图片") : DELETE("图片已从声明移除");
    }
    case "quick-note-declaration": {
      const note = world.quickNotes.find((n) => n.id === item.noteId);
      if (!note) return DELETE("小记条目已不存在");
      return note.assetsHash === item.oldDeclHash ? KEEP("小记索引仍引用该声明版本") : DELETE("小记声明版本已被替换");
    }
    case "quick-note-purge-prefix": {
      return world.quickNotes.some((n) => n.id === item.noteId) ? KEEP("小记条目仍在当前索引") : DELETE("小记条目已从索引移除");
    }
    default:
      return KEEP("未知待删类型，保守跳过");
  }
}
