/**
 * AI 写作「置顶对话」= **设备本地偏好**（261110 用户定稿：搜索 + 置顶，不做对话分组）。
 *
 * 存 localStorage 的有序 id 数组（最新置顶在前），不进 DB、不进 S3、不参与同步：
 * 与「侧栏宽度」同族——不同设备各自有各自的置顶顺序。
 */
const PINS_KEY = "lakex-local-notes-v3.aiwriting.pins";

type PinStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): PinStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function sanitize(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/** 读置顶 id（坏数据/存储不可用 ⇒ 空数组，不抛错）。 */
export function loadPinnedIds(storage: PinStorage | null = defaultStorage()): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(PINS_KEY);
    if (!raw) return [];
    return sanitize(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** 写置顶 id（空数组 = 删键；写失败静默）。 */
export function savePinnedIds(ids: readonly string[], storage: PinStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    const clean = sanitize(ids);
    if (clean.length === 0) storage.removeItem(PINS_KEY);
    else storage.setItem(PINS_KEY, JSON.stringify(clean));
  } catch {
    /* 配额/隐私模式：记不住不影响本次会话 */
  }
}

/** 切换置顶：新置顶放最前（与列表顺序一致）；取消置顶直接移除。 */
export function togglePinnedId(ids: readonly string[], id: string): string[] {
  const clean = sanitize(ids);
  return clean.includes(id) ? clean.filter((item) => item !== id) : [id, ...clean];
}

/** 剪掉已不存在的会话 id（会话被删后别留幽灵置顶）。 */
export function prunePinnedIds(ids: readonly string[], liveIds: ReadonlySet<string>): string[] {
  return sanitize(ids).filter((id) => liveIds.has(id));
}
