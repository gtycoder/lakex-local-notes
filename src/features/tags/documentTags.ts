import { native } from "../../lib/native";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { normalizeDocumentTagLinks, type DocumentTagLinks } from "./tagsModel";

/**
 * 文档标签关系的**宿主适配层**（P1）。
 *
 * 数据层由主进程提供（task-33）：`list_note_tag_links` / `set_note_tags`；
 * 标签目录本身仍是 quick-notes 库的 tags（增删改排序/合并走既有 *_quick_note_tag 通道）。
 *
 * 为什么还要这一层：
 * - **能力感知**：老主进程/浏览器端没有这两个方法时，页面要退化成可读提示，而不是抛 TypeError；
 * - **脏数据兜底**：IPC 回来统一过 normalizeDocumentTagLinks；
 * - 组件只依赖这里，不直接摸 window/native，便于单测。
 */
type HostBridge = { listNoteTagLinks?: () => Promise<unknown>; setNoteTags?: (noteId: string, tagIds: string[]) => Promise<unknown> };

function hostBridge(): HostBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { lakeNative?: HostBridge }).lakeNative ?? null;
}

/** 数据层是否可用（不可用时页面显示「标签数据暂不可用」而不是空白/报错）。 */
export function documentTagBridgeAvailable(): boolean {
  const bridge = hostBridge();
  return typeof bridge?.listNoteTagLinks === "function" && typeof bridge?.setNoteTags === "function";
}

/** 读整表文档关系。不可用 ⇒ available:false + 空表（UI 据此给可读提示）。 */
export async function loadDocumentTagLinks(): Promise<{ available: boolean; links: DocumentTagLinks }> {
  if (!documentTagBridgeAvailable()) return { available: false, links: {} };
  try {
    return { available: true, links: normalizeDocumentTagLinks(await native.listNoteTagLinks()) };
  } catch (error) {
    console.warn("[tags] 读取文档标签关系失败：" + getNativeErrorMessage(error));
    return { available: false, links: {} };
  }
}

/** 整组替换某文档标签；返回落库顺序（失败向上抛可读错误，调用方提示）。 */
export async function saveDocumentTags(noteId: string, tagIds: readonly string[]): Promise<string[]> {
  if (!documentTagBridgeAvailable()) throw new Error("标签数据层未就绪：请升级到支持文档标签的版本");
  const saved = await native.setNoteTags(noteId, [...tagIds]);
  return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [...tagIds];
}
