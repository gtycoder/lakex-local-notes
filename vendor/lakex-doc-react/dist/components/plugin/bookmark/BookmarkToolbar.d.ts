import React from "react";
import "../imageToolbar/ImageToolbar.css";
import { ToolbarLang } from "../i18n";
export interface BookmarkToolbarProps {
    /** 编辑器容器（鼠标事件挂载处） */
    containerRef: React.RefObject<HTMLElement | null>;
    /** lakex 编辑器实例（createOpenEditor 返回值） */
    editor: any;
    language?: ToolbarLang;
    /** 暗黑模式 */
    dark?: boolean;
}
export declare const BookmarkToolbar: (props: BookmarkToolbarProps) => React.ReactPortal;
export default BookmarkToolbar;
