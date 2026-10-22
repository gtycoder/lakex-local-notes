import type { RefObject } from 'react';
/** 右键菜单状态 */
export interface BlockContextMenuState {
    visible: boolean;
    position: {
        x: number;
        y: number;
    };
    blockType: string;
    blockElement: HTMLElement | null;
}
export interface UseBlockContextMenuOptions {
    /** 悬浮手柄 DOM ref，菜单关闭时调用其 __resumeHover 以恢复 mouseout 监听 */
    hoverHandleRef?: RefObject<HTMLElement | null>;
}
export declare function useBlockContextMenu(options?: UseBlockContextMenuOptions): {
    contextMenuState: BlockContextMenuState;
    showContextMenu: (blockElement: HTMLElement, event: MouseEvent) => void;
    closeContextMenu: () => void;
};
export default useBlockContextMenu;
