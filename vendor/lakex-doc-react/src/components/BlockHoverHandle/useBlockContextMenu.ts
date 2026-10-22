// src/components/BlockHoverHandle/useBlockContextMenu.ts
//
// 块右键上下文菜单的「状态 + 点击事件处理」逻辑。
//
// 与 BlockHoverHandle 组件配套使用：BlockHoverHandle 负责检测悬浮/右键并派发
// onContextMenu 事件，本 hook 接收该事件、维护菜单显隐状态，并在菜单关闭时
// 恢复悬浮手柄的 mouseout 监听（调用手柄 DOM 上的 __resumeHover）。
//
// 迁移自 LakexEditor.tsx，目的是把「右键菜单点击事件相关代码」收敛到
// BlockHoverHandle 文件夹内，与触发事件的组件就近维护。

import { useCallback, useState } from 'react';
import type { RefObject } from 'react';

/** 右键菜单状态 */
export interface BlockContextMenuState {
  visible: boolean;
  position: { x: number; y: number };
  blockType: string;
  blockElement: HTMLElement | null;
}

export interface UseBlockContextMenuOptions {
  /** 悬浮手柄 DOM ref，菜单关闭时调用其 __resumeHover 以恢复 mouseout 监听 */
  hoverHandleRef?: RefObject<HTMLElement | null>;
}

export function useBlockContextMenu(options?: UseBlockContextMenuOptions) {
  const hoverHandleRef = options?.hoverHandleRef;

  const [contextMenuState, setContextMenuState] = useState<BlockContextMenuState>({
    visible: false,
    position: { x: 0, y: 0 },
    blockType: '',
    blockElement: null,
  });

  /** 显示右键菜单（作为 BlockHoverHandle 的 onContextMenu 回调） */
  const showContextMenu = useCallback((
    blockElement: HTMLElement,
    event: MouseEvent
  ) => {
    event.preventDefault();
    event.stopPropagation();

    setContextMenuState({
      visible: true,
      position: { x: event.clientX, y: event.clientY },
      blockType: blockElement.tagName.toLowerCase(),
      blockElement,
    });
  }, []);

  /** 关闭右键菜单（同时恢复悬浮手柄的 mouseout 监听） */
  const closeContextMenu = useCallback(() => {
    setContextMenuState((prev) => ({ ...prev, visible: false }));
    // 菜单关闭后恢复手柄的 mouseout 监听，让图标可以正常隐藏
    const handleEl = hoverHandleRef?.current;
    if (handleEl && typeof (handleEl as any).__resumeHover === 'function') {
      (handleEl as any).__resumeHover();
    }
  }, [hoverHandleRef]);

  return { contextMenuState, showContextMenu, closeContextMenu };
}

export default useBlockContextMenu;
