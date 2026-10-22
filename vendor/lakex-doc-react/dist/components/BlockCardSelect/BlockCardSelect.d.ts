export interface BlockCardSelectProps {
    config: {
        groups?: unknown[];
        [key: string]: unknown;
    } | null;
    dark?: boolean;
    language?: 'zh-cn' | 'en-us';
    overlayContainer?: HTMLElement;
    themeSelector?: string;
    onCancel?: () => void;
    onSelect: (item: any, ...args: any[]) => void;
}
/**
 * 行菜单专用的 CardSelect 实例。
 *
 * 这里只复用 Lakex 导出的菜单视图与已经解析好的卡片定义，不复用工具栏
 * “+”按钮的 Popover、锚点或开关状态，因此两个入口互不影响。
 */
export declare function BlockCardSelect({ config, dark, language, overlayContainer, themeSelector, onCancel, onSelect, }: BlockCardSelectProps): import("react/jsx-runtime").JSX.Element;
export default BlockCardSelect;
