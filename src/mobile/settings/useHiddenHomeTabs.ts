/**
 * 移动端：订阅「已关闭空间」并按 React 渲染（底部 Dock / 分页器 / 默认空间 / 设置页共用）。
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { getHiddenSpaces, setHiddenSpaces, subscribeHiddenSpaces } from "../../lib/hiddenSpacesStore";
import { isSpaceVisible } from "../../core/hiddenSpaces";
import type { HomeTab } from "../home/tabPager";
import { MOBILE_HIDEABLE_TABS, MOBILE_HIDDEN_SPACES_KEY, visibleHomeTabsFrom, type MobileHideableTab } from "./spaceVisibility";

const subscribe = (listener: () => void) => subscribeHiddenSpaces(MOBILE_HIDDEN_SPACES_KEY, listener);
const snapshot = () => getHiddenSpaces(MOBILE_HIDDEN_SPACES_KEY, MOBILE_HIDEABLE_TABS);

export interface HiddenHomeTabsApi {
  hidden: readonly MobileHideableTab[];
  /** 可见 tab（顺序 = HOME_TABS）；空数组不可能出现（小记/知识库/标签恒显示）。 */
  tabs: readonly HomeTab[];
  isVisible: (tab: HomeTab) => boolean;
  toggle: (tab: MobileHideableTab, visible: boolean) => void;
}

export function useHiddenHomeTabs(): HiddenHomeTabsApi {
  const hidden = useSyncExternalStore(subscribe, snapshot, snapshot);
  const tabs = useMemo(() => visibleHomeTabsFrom(hidden), [hidden]);
  const toggle = useCallback((tab: MobileHideableTab, nextVisible: boolean) => {
    const current = getHiddenSpaces(MOBILE_HIDDEN_SPACES_KEY, MOBILE_HIDEABLE_TABS);
    const next = nextVisible ? current.filter((id) => id !== tab) : [...current, tab];
    setHiddenSpaces(MOBILE_HIDDEN_SPACES_KEY, next, MOBILE_HIDEABLE_TABS);
  }, []);
  const isVisible = useCallback((tab: HomeTab) => isSpaceVisible(tab, hidden), [hidden]);
  return { hidden, tabs, isVisible, toggle };
}
