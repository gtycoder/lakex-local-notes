/**
 * 设备级「默认空间」设置（261110 用户点单）：打开 App 落在哪个一级页。
 *
 * 选项 = 首页五个 tab（小记 / 知识库 / 日记 / **AI** / 标签；261110 底部 Dock 扩到五格后同步），
 * **默认小记**（用户 261014 定稿的冷启动落点）。
 * **仅本机**（localStorage，前缀 lakex-local-notes-mobile.，与 libraryView / 导入默认笔记本 / 平板面板偏好
 * 同口径）：不参与同步、**不进 S3**、不进 wire；换设备各自保留各自的落点。
 *
 * 判据不复制：可选值直接取 `HOME_TABS`（home/tabPager 唯一来源），存档值不在其中 ⇒ 回落默认（fail-safe）。
 */
import { HOME_TABS, type HomeTab } from "../home/tabPager";

const KEY = "lakex-local-notes-mobile.default-space";

/** 默认落点 = 小记（与 261014 的冷启动口径一致）。 */
export const DEFAULT_HOME_TAB: HomeTab = "quick";

/** 设置项文案（顺序 = 首页 tab 顺序，不另排一种）。 */
export const DEFAULT_SPACE_OPTIONS: Array<{ value: HomeTab; label: string }> = [
  { value: "quick", label: "小记" },
  { value: "library", label: "知识库" },
  { value: "diary", label: "日记" },
  { value: "ai", label: "AI" },
  { value: "tags", label: "标签" },
];

function isHomeTab(value: string | null): value is HomeTab {
  return value !== null && (HOME_TABS as readonly string[]).includes(value);
}

/** 读默认落点：存储不可用 / 值非法 / 未设置 ⇒ 小记（不抛错、不提示）。 */
export function readDefaultHomeTab(): HomeTab {
  try {
    const value = localStorage.getItem(KEY);
    return isHomeTab(value) ? value : DEFAULT_HOME_TAB;
  } catch {
    return DEFAULT_HOME_TAB;
  }
}

/** 写默认落点（下次启动生效；本次会话的当前页不动 —— 不打断用户正在做的事）。 */
export function writeDefaultHomeTab(tab: HomeTab): void {
  try {
    if (tab === DEFAULT_HOME_TAB) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, tab);
  } catch {
    // 存储不可用：设置项仍显示新值（调用方持有 state），只是记不住；不抛错。
  }
}

/** 仅供测试：清掉设备级默认空间。 */
export function clearDefaultHomeTabForTest(): void {
  try { localStorage.removeItem(KEY); } catch { /* 存储不可用：测试清理无需处理 */ }
}
