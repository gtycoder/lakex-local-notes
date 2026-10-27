import React from 'react';
/** 菜单项动作类型 */
export type BlockMenuAction = 'convert' | 'aiOutline' | 'delete' | 'copy' | 'cut' | 'paste' | 'indent' | 'outdent' | 'copyLink' | 'addBefore' | 'addAfter' | 'duplicate' | 'selectBlock';
/**
 * LOCAL-CHANGE: 只放行「内核原生命令」实现的块菜单动作（260917）。
 *
 * 背景：`convert` / `addAfter` 的旧实现优先走 `utils/blockDoc.ts` 的「整篇 JSON 读改写」
 * （`getDocument('json')` → 改树 → `setDocument('json')`）。本仓库实测该路径会重写自定义卡
 * （思维导图卡载荷 634B→8859B）并抹掉内核未注册的卡（`board-card`），因此收敛为安全集合：
 * 新增动作前先确认它只用 `kernel/renderer/editor.execCommand`，不得读写整篇 JSON 文档。
 */
export declare const SAFE_BLOCK_ACTIONS: readonly BlockMenuAction[];
/** 菜单项定义 */
export interface MenuItem {
    /** 动作类型 */
    action: BlockMenuAction;
    /** 显示标签 */
    label: string;
    /** 稳定的动作参数（不随中英文标签变化） */
    value?: string;
    /** 图标（SVG 或 null） */
    icon?: React.ReactNode | null;
    /** 是否有子菜单 */
    hasSubmenu?: boolean;
    /** 子菜单项 */
    submenu?: MenuItem[];
    /** 是否禁用 */
    disabled?: boolean;
    /** 当前块正在使用该格式 */
    selected?: boolean;
    /** 在当前菜单项后显示分隔线 */
    divider?: boolean;
}
export interface BlockContextMenuProps {
    /** 是否显示 */
    visible: boolean;
    /** 菜单位置 */
    position: {
        x: number;
        y: number;
    };
    /** 当前块的类型（tagName 小写） */
    blockType: string;
    /** 当前块的 DOM 元素 */
    blockElement: HTMLElement | null;
    /** lakex editor 实例 */
    editor: any;
    /** 语言设置 */
    language?: 'zh-cn' | 'en-us';
    /** 暗黑模式 */
    dark?: boolean;
    /** 关闭回调 */
    onClose: () => void;
    /** 菜单动作回调 */
    onAction?: (action: BlockMenuAction, data: {
        blockElement: HTMLElement;
        blockType: string;
        payload?: string;
    }) => void;
}
export declare function BlockContextMenu({ visible, position, blockType, blockElement, editor, language, dark, onClose, onAction, }: BlockContextMenuProps): import("react/jsx-runtime").JSX.Element;
export default BlockContextMenu;
