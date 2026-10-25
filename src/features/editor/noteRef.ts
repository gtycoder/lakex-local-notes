/**
 * 「文档引用」的**纯逻辑**（无 React / 无 DOM / 无 CSS 依赖，可直接单测）。
 *
 * 单一来源：引用标识（`lake-note://<noteId>`）、解析、宿主注册表、失效判据、斜杠接线。
 * 将来若换成 R1（内核 `mention`）或 R3（普通内部链接），都复用它，避免"三种形态三套约定"。
 * 卡片本体（React）见 `noteRefCard.tsx`。
 */
import { isGoneNote } from "../../core/syncDecisions";
import type { NoteSummary } from "../../lib/types";
import { CUSTOM_CARD_SLASH_GROUP_TITLE, appendCustomCard, withCustomCardSlashItem } from "./customCardUtils";

/** 卡片名（持久化在 cardValue.`$name` 上，**必须唯一且不要改**：改了旧正文就不再渲染本卡）。 */
export const NOTE_REF_CARD_NAME = "lake-note-ref";
/**
 * 插入面板里本卡图标的 **sprite symbol id**（用户 261008 设计，见 noteRefIcon.tsx）。
 * 面板按 slash.icon 的值直接解析成 use href="#<id>" ⇒ 这里必须是**全限定 id**，不是内核的短名。
 */
export const NOTE_REF_ICON_ID = "icon-lake-note-ref";
/** 斜杠项名：官方规定必须是 `custom-${name}`（见 yuque-developer-docs 69·开发自定义卡片）。 */
export const NOTE_REF_SLASH_ITEM = `custom-${NOTE_REF_CARD_NAME}`;
/** 斜杠面板里的主搜索词（`/` 后直接打这几个字母命中）。 */
export const NOTE_REF_MAIN_SEARCH = "/doc";
/** 斜杠分组标题：与 lockedText 卡共用同一份常量（单一来源 = customCardUtils）。 */
export const NOTE_REF_SLASH_GROUP_TITLE = CUSTOM_CARD_SLASH_GROUP_TITLE;
const NOTE_REF_SCHEME = "lake-note";

export interface NoteRefValue {
  noteId?: string;
  /** 标题快照：目标暂不可解析时也能显示点什么；复制/导出也用它。 */
  title?: string;
}

/** 引用的规范形态：把 noteId 编码成 URL（复制到别处 / `writeHtml` / 将来 R1·R3 共用同一份约定）。 */
export function noteRefUrl(noteId: string): string {
  return `${NOTE_REF_SCHEME}://${noteId}`;
}

/** 从卡片数据或 URL 里解析出 noteId；非法输入返回 null。 */
export function parseNoteRef(input: unknown): string | null {
  if (input && typeof input === "object") {
    const raw = (input as NoteRefValue).noteId;
    return typeof raw === "string" && raw.trim() ? raw.trim() : null;
  }
  if (typeof input === "string") {
    const m = new RegExp(`^${NOTE_REF_SCHEME}://([A-Za-z0-9_-]{4,})$`).exec(input.trim());
    return m ? m[1] : null;
  }
  return null;
}

/**
 * 宿主接口（**模块级注册表**，与 imagePreview 同一姿势）：
 * 自定义卡由**内核自己的 React 树**渲染，拿不到应用的 context/props ⇒ 只能由 App 注入。
 */
export interface NoteRefHost {
  listNotes(): NoteSummary[];
  openNote(noteId: string): void;
  /**
   * 目标文档在**资料库树里的全路径**（`笔记本/分组/…/文档`）——「复制引用」复制的就是它
   * （用户 261008 定稿：不再复制只有本应用认识的 `lake-note://<id>`；一度改成"本机绝对路径"，用户最终定回资料库路径）。
   * 取不到（树里没有该节点）时返回 null，调用方回落标题。签名允许同步或异步，调用方统一 `await`。
   */
  pathOf?(noteId: string): Promise<string | null> | string | null;
}

let host: NoteRefHost | null = null;
export function setNoteRefHost(next: NoteRefHost | null): void { host = next; }
export function noteRefHost(): NoteRefHost | null { return host; }

export function findNoteRef(noteId: string | null): NoteSummary | null {
  if (!noteId) return null;
  return host?.listNotes().find((n) => n.id === noteId) ?? null;
}

/** 引用是否已失效：与「打开文档」同一条判据（进回收站 / 被 purge / 已不在库里都算）。 */
export function isNoteRefGone(noteId: string | null): boolean {
  if (!noteId) return false;
  const note = findNoteRef(noteId);
  if (!note) return true;
  return isGoneNote({ parentId: note.parentId, syncState: note.syncState, isPurged: note.isPurged });
}

/** 目标文档类型的中文名（只做展示）。 */
export function noteKindLabel(kind: string | undefined): string {
  switch (kind) {
    case "usheet": return "表格";
    case "bitable": return "多维表";
    case "board": return "画板";
    default: return "文档";
  }
}

/** 卡片描述里**与 React 无关**的部分；组件由 `noteRefCard.tsx` 补上。 */
export const NOTE_REF_CARD_META = {
  name: NOTE_REF_CARD_NAME,
  cardType: "block" as const,
  slash: {
    // 自绘图标（用户 261008 设计稿）：symbol 见 noteRefIcon.tsx，经 ensureCustomCardIcons 进 sprite。
    // ⚠️ 值必须是**全限定 symbol id**（见 NOTE_REF_ICON_ID 注释）；不要退回内核短名，也不要引第三方图标库（AGENTS §14）。
    icon: NOTE_REF_ICON_ID,
    mainSearch: NOTE_REF_MAIN_SEARCH,
    label: "文档引用",
    description: "插入同库文档（引用 + 点击打开）",
    keywords: ["doc", "文档", "引用", "文档引用", "表格", "note"],
  },
  initValue: { noteId: "", title: "" } as NoteRefValue,
  /** 复制 / 导出时的纯文本：标题（缺标题回落 URL）。 */
  writeText: (value: NoteRefValue | null): string =>
    value?.title ? value.title : value?.noteId ? noteRefUrl(value.noteId) : "",
  /** 复制 / 导出时的 HTML：一条可点的 `lake-note://` 链接。 */
  writeHtml: (value: NoteRefValue | null): string => {
    const id = parseNoteRef(value);
    if (!id) return "";
    return `<a href="${noteRefUrl(id)}">${value?.title || id}</a>`;
  },
};

/**
 * 把本卡追加进内核的 customCard.cards（幂等；由 noteRefCard.tsx 传入带组件的完整描述）。
 * icon 是可选的 **React 组件**（内核 CustomCard.icon 字段）：它必须渲染一个 **symbol id 元素**，
 * 由 lakeRuntime.ensureCustomCardIcons() 收进隐藏 sprite（不传则用内核 sprite 里既有的符号）。
 */
export function appendNoteRefCard(config: Record<string, unknown>, cardConfig: unknown, icon?: unknown): void {
  appendCustomCard(config, NOTE_REF_CARD_NAME, cardConfig, icon);
}

/** 把斜杠项 `custom-lake-note-ref` 加进「小工具」分组（官方口径；幂等，其它组一字不动）。 */
export function withNoteRefSlashItem(groups: unknown[]): unknown[] {
  return withCustomCardSlashItem(groups, NOTE_REF_SLASH_ITEM, NOTE_REF_SLASH_GROUP_TITLE);
}
