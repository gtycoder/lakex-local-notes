import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { getOutlineTab } from "../features/outline/registry";

export interface UseOutlineSyncOptions {
  activeNoteId: string | null;
  outlineTabsVersion: number;
  setOutlineEmptyOverride: Dispatch<SetStateAction<boolean>>;
  setActiveOutlineEmpty: Dispatch<SetStateAction<boolean>>;
}

/** 大纲同步：订阅活动大纲变化（面包屑刷新）、空大纲评估（从 App.tsx 抽出）。 */
export function useOutlineSync({
  activeNoteId, outlineTabsVersion, setOutlineEmptyOverride, setActiveOutlineEmpty,
}: UseOutlineSyncOptions) {
  // 面包屑大纲路径：订阅活动文档大纲变化（滚动切换标题时刷新）
  const [, forceOutlineRender] = useState(0);
  useEffect(() => {
    const handle = getOutlineTab(activeNoteId);
    if (!handle) return;
    return handle.controller.subscribe(() => forceOutlineRender((v) => v + 1));
  }, [activeNoteId, outlineTabsVersion]);

  // 跟踪当前文档是否为空大纲；切换标签时清除豁免、重新评估。
  useEffect(() => {
    setOutlineEmptyOverride(false);
    const tabId = activeNoteId;
    if (!tabId) { setActiveOutlineEmpty(false); return; }
    const handle = getOutlineTab(tabId);
    if (!handle) { setActiveOutlineEmpty(false); return; }
    const evaluate = () => setActiveOutlineEmpty(handle.controller.getEntryCount() === 0);
    evaluate();
    return handle.controller.subscribe(evaluate);
    // tabsVersion：新标签注册晚于 activeNoteId 变化时也要重新评估。
  }, [activeNoteId, outlineTabsVersion, setOutlineEmptyOverride, setActiveOutlineEmpty]);
}
