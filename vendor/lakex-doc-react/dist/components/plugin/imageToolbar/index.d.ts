/**
 * ImageToolBar 插件
 * ------------------------------------------------------------------
 * 图片卡片浮动操作栏的配置入口。
 *
 * 注意：按钮定义已全部迁移到 ImageToolbar.tsx 内部（TOOLBAR_ITEMS 数组），
 * 本插件仅负责向 lakex 框架注入「关闭原生坏通道」的配置。
 *
 * 实际可见的工具栏由 <ImageToolbar> React 组件渲染（仿 BlockHoverHandle 模式）。
 */
import type { ImageConfig } from "../../lakex/types";
export interface ImageToolbarPluginOptions {
    /** （保留扩展点，当前未使用） */
    [key: string]: any;
}
/**
 * 生成 ImageToolBar 插件配置（可直接展开进 ImageConfig）。
 *
 * @returns 包含 `showMiniToolbarWhen: "never"` 的 ImageConfig 片段
 *         （原生 cardToolbar focus 路径是空桩，设为 never 避免冲突）
 */
export declare function createImageToolbarPlugin(_options?: ImageToolbarPluginOptions): Pick<ImageConfig, "showMiniToolbarWhen" | "miniToolbar">;
export default createImageToolbarPlugin;
