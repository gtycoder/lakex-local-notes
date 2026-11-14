/**
 * 桌面：订阅「已关闭空间」并按 React 渲染（空间菜单 / ⌘ 快捷键 / 默认空间 / 设置页共用）。
 * 写入口只有 `toggle`（设置页开关），存储与订阅在 `lib/hiddenSpacesStore`。
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { getHiddenSpaces, setHiddenSpaces, subscribeHiddenSpaces } from "../lib/hiddenSpacesStore";
import { isSpaceVisible, visibleSpaces } from "../core/hiddenSpaces";
import {
  DESKTOP_HIDEABLE_SPACES,
  DESKTOP_HIDDEN_SPACES_KEY,
  DESKTOP_PRIMARY_SPACES,
  type DesktopHideableSpace,
} from "../desktop/spaceVisibility";

const subscribe = (listener: () => void) => subscribeHiddenSpaces(DESKTOP_HIDDEN_SPACES_KEY, listener);
const snapshot = () => getHiddenSpaces(DESKTOP_HIDDEN_SPACES_KEY, DESKTOP_HIDEABLE_SPACES);

export interface HiddenDesktopSpacesApi {
  /** 已关闭的空间（稳定引用；空数组 = 全部可见）。 */
  hidden: readonly DesktopHideableSpace[];
  /** 按定义顺序的可见一级空间（菜单/Dock/默认空间选项的唯一来源）。 */
  visible: readonly (typeof DESKTOP_PRIMARY_SPACES)[number][];
  isVisible: (space: (typeof DESKTOP_PRIMARY_SPACES)[number]) => boolean;
  /** 设置页开关：visible=true 表示「显示/开启」。 */
  toggle: (space: DesktopHideableSpace, visible: boolean) => void;
}

export function useHiddenDesktopSpaces(): HiddenDesktopSpacesApi {
  const hidden = useSyncExternalStore(subscribe, snapshot, snapshot);
  const visible = useMemo(() => visibleSpaces(DESKTOP_PRIMARY_SPACES, hidden), [hidden]);
  const toggle = useCallback((space: DesktopHideableSpace, nextVisible: boolean) => {
    const current = getHiddenSpaces(DESKTOP_HIDDEN_SPACES_KEY, DESKTOP_HIDEABLE_SPACES);
    const next = nextVisible ? current.filter((id) => id !== space) : [...current, space];
    setHiddenSpaces(DESKTOP_HIDDEN_SPACES_KEY, next, DESKTOP_HIDEABLE_SPACES);
  }, []);
  const isVisible = useCallback((space: (typeof DESKTOP_PRIMARY_SPACES)[number]) => isSpaceVisible(space, hidden), [hidden]);
  return { hidden, visible, isVisible, toggle };
}
