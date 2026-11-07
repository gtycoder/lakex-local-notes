/**
 * Lake 正文「复制改写」流水线（261107 收口）：把格式相关的改写从 `duplicateNotes` 契约里拆出来。
 *
 * 三件套（顺序固定，两端只调 `prepareDuplicateBody`，不要再各写一遍）：
 * 1) `rewriteAssetNoteIds`：资源 URL 里的原 noteId → 新 noteId（明文 + 百分号编码两种形态）；
 * 2) `remapBlockIds`：**仅 kind=doc** 时把块 id 全量换新（源/副本同窗并排不撞 document 级 id 查找）；
 * 3) `forbidSelfNoteRefs`：禁止副本引用自己（防御性，正常路径不触发）。
 *
 * 依据见 docs/LAKEX-CONTRACT.md §5.48/§5.49；测试见 `lakeBodyRewrite.test.ts`。
 */
import type { NoteKind } from "./noteKind.js";

/** 块 id 的默认生成器：与内核观察到的形态一致（`u` + 8 位十六进制），保证 HTML id 合法且短。 */
export function defaultBlockId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(4);
    cryptoApi.getRandomValues(bytes);
    return "u" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return "u" + Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
}

/** 这些 id 值不是"块 id"（URL/data/路径/锚点/布尔串），不参与重映射。 */
function isRemappableBlockId(value: string): boolean {
  if (!value || value.length > 64 || value.includes(" ") || value === "true" || value === "false") return false;
  return !/^(?:https?:|data:|blob:|lake-asset:|file:|mailto:|tel:|\/|#)/i.test(value);
}

/**
 * 把正文里资源 URL 的**原 noteId 段**替换成新 noteId。
 *
 * 覆盖两端的三种落盘形态（前缀都在 id 前、id 后必是 "/"）：
 *   http://127.0.0.1:<port>/{noteId}/{filename}
 *   lake-asset://{noteId}/{filename}
 *   .../note-assets/{noteId}/{filename}
 * 只在「/ 或 :// 之后、/ 之前」命中，避免误改用户正文里恰好出现的同串文本。
 * 另外覆盖**百分号编码形态**（Lake 图片/文件卡的 value = data: 套 JSON 再整体编码：`...%2F{id}%2F...`）。
 */
export function rewriteAssetNoteIds(content: string, fromId: string, toId: string): string {
  if (!content || !fromId || !toId || fromId === toId) return content;
  const escaped = fromId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let next = content.replace(new RegExp("(\\/|:\\/\\/)" + escaped + "(?=\\/)", "g"), "$1" + toId);
  next = next.replace(new RegExp("(%2[fF])" + escaped + "(%2[fF])", "gi"), "$1" + toId + "$2");
  return next;
}

/**
 * 把 Lake 正文里的**块 id 全量重映射**成新值（261106 D 方案）。
 *
 * 为什么：副本如果照抄源的块 id，同一窗口多 tab / 分屏同时挂载源与副本时，
 * 内核 `scrollByNodeId` 等基于 `document.getElementById` 的定位会命中错误的一篇。
 *
 * 口径（**只用于 kind=doc 的 Lake HTML**）：收集 `id` / `data-lake-id` / `list` / `fid` 的值，
 * 每个旧 id 换一个不与任何旧 id 冲突的新值，然后把正文里该旧 id 的所有出现替换掉
 * （属性与卡片 payload/百分号编码引用一起换；URL/data:/路径不动）。
 */
export function remapBlockIds(body: string, makeId: () => string = defaultBlockId): string {
  if (!body) return body;
  const attribute = /\b(?:id|data-lake-id|list|fid)="([^"]+)"/g;
  const oldIds = new Set<string>();
  for (const match of body.matchAll(attribute)) {
    const value = match[1];
    if (isRemappableBlockId(value)) oldIds.add(value);
  }
  if (oldIds.size === 0) return body;
  const used = new Set(oldIds);
  const mapping = new Map<string, string>();
  for (const oldId of oldIds) {
    let next = makeId();
    let guard = 0;
    while (used.has(next) && guard < 10) { next = makeId(); guard += 1; }
    while (used.has(next)) next = defaultBlockId();
    used.add(next);
    mapping.set(oldId, next);
  }
  let output = body;
  for (const [oldId, nextId] of mapping) output = output.split(oldId).join(nextId);
  return output;
}

/**
 * 禁止「副本引用自己」（261107 用户定稿）：引用卡 = `lake-note://{目标笔记 id}`。
 * 正常复制不会产生自引用（引用指向原目标、块 id 已重映射）；这里是防御性回退：
 * 若正文出现 `lake-note://{副本id}`（含百分号编码形态）就改为指向源目标。
 */
export function forbidSelfNoteRefs(body: string, selfNoteId: string, fallbackNoteId: string): string {
  if (!body || !selfNoteId || !fallbackNoteId || selfNoteId === fallbackNoteId) return body;
  const escaped = selfNoteId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let next = body.replace(new RegExp("lake-note:\\/\\/" + escaped, "g"), "lake-note://" + fallbackNoteId);
  next = next.replace(new RegExp("lake-note%3[aA]%2[fF]%2[fF]" + escaped, "g"), "lake-note%3A%2F%2F" + fallbackNoteId);
  // JSON 字符串里可能把斜杠转义成 \/（卡片 value 经 JSON 序列化后的形态）；同样必须回退。
  next = next.replace(new RegExp("lake-note:\\\\/\\\\/" + escaped, "g"), "lake-note:\\/\\/" + fallbackNoteId);
  return next;
}

/** 副本正文统一改写入口（两端只调这个，避免三件套顺序/条件在两端漂移）。 */
export function prepareDuplicateBody(
  body: string,
  options: { sourceId: string; newId: string; kind: NoteKind },
): string {
  const rewritten = rewriteAssetNoteIds(body, options.sourceId, options.newId);
  const remapped = options.kind === "doc" ? remapBlockIds(rewritten) : rewritten;
  return forbidSelfNoteRefs(remapped, options.newId, options.sourceId);
}