import React from 'react';
import type { HeadingConfig } from '../lakex/types';
import { BlockMenuAction } from '../BlockContextMenu';
export interface BlockHoverHandleProps {
    containerRef: React.RefObject<HTMLElement | null>;
    editor: any;
    language?: 'zh-cn' | 'en-us';
    /** 暗黑模式：true 时手柄使用暗色配色 */
    dark?: boolean;
    /** 块操作回调（右键菜单动作触发时调用），透传给 BlockContextMenu */
    onBlockAction?: (action: BlockMenuAction, data: {
        blockElement: HTMLElement;
        blockType: string;
        payload?: string;
    }) => void;
    /** 标题配置（anchor / folding）。标题块左侧会渲染锚点/折叠按钮，
     *  手柄需按开启数量左移：0 个开启→不偏移，1 个→20px，2 个→40px */
    heading?: HeadingConfig;
}
export declare const BlockHoverHandle: React.ForwardRefExoticComponent<BlockHoverHandleProps & React.RefAttributes<HTMLDivElement>>;
export default BlockHoverHandle;
