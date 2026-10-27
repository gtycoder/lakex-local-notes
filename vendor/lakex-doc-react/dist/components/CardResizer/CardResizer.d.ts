import React from 'react';
export interface CardResizerProps {
    /** 当前高度（px），同时作为包裹容器的高度 */
    height: number;
    /** 高度变化回调，参数为已经 clamp 到 [min, max] 的新高度 */
    onResize: (height: number) => void;
    /** 最小高度，默认 30 */
    min?: number;
    /** 最大高度，默认 Number.MAX_SAFE_INTEGER（不限） */
    max?: number;
    /** 附加到根包裹节点的自定义类名 */
    className?: string;
    /** 被包裹的内部组件（如 MindMap） */
    children?: React.ReactNode;
    /** 选中态下按 Delete / Backspace（焦点不在输入框时）触发，参数为触发按键的 DOM 事件目标，便于上层定位并删除卡片 */
    onDelete?: (target: EventTarget | null) => void;
    /**
     * Allows interactive card content to keep Delete / Backspace for itself.
     * Return false to prevent the resizer from deleting the surrounding card.
     */
    shouldHandleDeleteShortcut?: (event: KeyboardEvent) => boolean;
    /**
     * Interactive areas such as canvases do not necessarily take DOM focus.
     * Remember the last pointer target in this selector and leave Delete /
     * Backspace to that area until the user clicks another part of the card.
     */
    deleteShortcutExclusionSelector?: string;
}
export interface CardResizerState {
    /** 是否正在拖动高度 */
    dragging: boolean;
    /** 是否处于选中态（点击卡片后为真，显示边框 + 常显拖动条） */
    selected: boolean;
}
export declare class CardResizer extends React.Component<CardResizerProps, CardResizerState> {
    static defaultProps: {
        min: number;
        max: number;
    };
    private startY;
    private startHeight;
    private interactiveDeleteScopeActive;
    private rootRef;
    constructor(props: CardResizerProps);
    componentDidMount(): void;
    componentWillUnmount(): void;
    private handleDocKeyDown;
    private handleClick;
    private handlePointerDownCapture;
    private handleDocMouseDown;
    private handleMouseDown;
    private handleMouseMove;
    private handleMouseUp;
    render(): React.ReactNode;
}
export default CardResizer;
