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
export function createImageToolbarPlugin(
  _options?: ImageToolbarPluginOptions
): Pick<ImageConfig, "showMiniToolbarWhen" | "miniToolbar"> {
  return {
    // 框架原生 cardToolbar 的 focus 路径在当前构建里是空桩（getToolbarControllerConfig 返回 undefined），
    // 只有 mouseenter 才渲染；为避免与自定义组件重复/走坏掉的焦点路径，原生默认设为 'never'。
    // 实际可见的工具栏由 components/plugin/imageToolbar/ImageToolbar.tsx 负责。
    showMiniToolbarWhen: "never",
    miniToolbar: [],
  };
}

export default createImageToolbarPlugin;
