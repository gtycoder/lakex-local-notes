import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { getOutlineTab } from "../features/outline/registry";

export interface UseOutlineSyncOptions {
  activeNoteId: string | null;
  outlineTabsVersion: number;
  setOutlineSwitching: Dispatch<SetStateAction<boolean>>;
  setOutlineEmptyOverride: Dispatch<SetStateAction<boolean>>;
  setActiveOutlineEmpty: Dispatch<SetStateAction<boolean>>;
}

/** 大纲同步：订阅活动大纲变化（面包屑刷新）、tab 切换动画、空大纲评估（从 App.tsx 抽出）。 */
export function useOutlineSync({
  activeNoteId, outlineTabsVersion, setOutlineSwitching, setOutlineEmptyOverride, setActiveOutlineEmpty,
}: UseOutlineSyncOptions) {
  // 面包屑大纲路径：订阅活动文档大纲变化（滚动切换标题时刷新）
  const [, forceOutlineRender] = useState(0);
  useEffect(() => {
    const handle = getOutlineTab(activeNoteId);
    if (!handle) return;
    return handle.controller.subscribe(() => forceOutlineRender((v) => v + 1));
  }, [activeNoteId, outlineTabsVersion]);

  // 切换标签时，大纲数据会在编辑器注册后异步更新；期间禁止壳层 grid 动画，
  // 避免“旧列宽 → 新列宽”与正文淡入同时发生，造成 tab 切换时主区横向抖动。
  useEffect(() => {
    setOutlineSwitching(true);
    const timer = window.setTimeout(() => setOutlineSwitching(false), 220);
    return () => window.clearTimeout(timer);
  }, [activeNoteId, setOutlineSwitching]);

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
