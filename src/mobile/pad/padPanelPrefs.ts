/**
 * 平板「目录/大纲固定」偏好（261102 十四批，用户定稿要持久化）。
 *
 * 语义：固定 = 停靠进布局（占列、收窄可编辑区）；这是**设备本地的视图偏好**，
 * 与「编辑器本机视图」同一条口径 —— 不写正文、不标脏、不进 S3，只落 localStorage。
 * 只存 pinned（是否固定），不存 open（当前开合）：冷启时若曾固定就直接按固定态打开。
 */
export interface PadPanelPrefs {
  tree: boolean;
  outline: boolean;
}

/** localStorage key（移动端前缀 lakex-local-notes-mobile.*）。 */
export const PAD_PANEL_PREFS_KEY = "lakex-local-notes-mobile.pad-panels";

const EMPTY: PadPanelPrefs = { tree: false, outline: false };

/** 纯解析：坏 JSON / 缺字段 / 非布尔一律回落 false（不能因为一条脏偏好让面板乱停靠）。 */
export function parsePadPanelPrefs(raw: string | null): PadPanelPrefs {
  if (!raw) return { ...EMPTY };
  try {
    const value: unknown = JSON.parse(raw);
    const read = (key: "tree" | "outline"): boolean =>
      typeof value === "object" && value !== null && (value as Record<string, unknown>)[key] === true;
    return { tree: read("tree"), outline: read("outline") };
  } catch {
    return { ...EMPTY };
  }
}

/** 读当前偏好（SSR / 隐私模式 / 存储禁用时回落"都不固定"）。 */
export function readPadPanelPrefs(): PadPanelPrefs {
  try {
    return parsePadPanelPrefs(window.localStorage.getItem(PAD_PANEL_PREFS_KEY));
  } catch {
    return { ...EMPTY };
  }
}

/** 写偏好（失败静默：只是记不住，不影响本次布局）。 */
export function writePadPanelPrefs(prefs: PadPanelPrefs): void {
  try {
    window.localStorage.setItem(PAD_PANEL_PREFS_KEY, JSON.stringify({ tree: prefs.tree === true, outline: prefs.outline === true }));
  } catch {
    /* 存不了就算了 */
  }
}
