/**
 * 桌面编辑态的「块悬浮手柄 + 块操作菜单」挂载器（组件来自 vendor `BlockHoverHandle`）。
 *
 * 为什么需要它：我们应用是直接 `Doc.createOpenEditor` 起内核，没走 vendor 的 `LakexEditor`
 * 包装层，而块手柄只在那层被挂载 ⇒ 手柄从未出现过（详见 docs/LAKEX-CONTRACT.md）。
 *
 * 安全边界（260917）：菜单动作全部走内核原生命令（转化/删除/复制/剪切/缩进/在下方添加），
 * vendor 侧的「拖拽移动块」已禁用 —— 它走 `utils/blockDoc` 的整篇 JSON 读改写，实测会重写
 * 自定义卡（思维导图载荷 634B→8859B）并抹掉内核未注册的卡。
 */
import { createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BlockHoverHandle } from "@dlient/lakex-doc-react";
import type { LakeEditorInstance } from "./lakeRuntime";

const isDarkTheme = () => document.documentElement.dataset.theme === "dark";

/** 手柄宿主：跟随应用主题（data-theme）切换 dark 配色，避免深色下用浅色手柄。 */
function BlockHandleHost(props: { container: HTMLElement; editor: LakeEditorInstance }) {
  const [dark, setDark] = useState(isDarkTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDarkTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return createElement(BlockHoverHandle, {
    containerRef: { current: props.container },
    editor: props.editor,
    language: "zh-cn",
    dark,
  });
}

/**
 * 在编辑器挂载点旁挂一个手柄宿主，返回清理函数（卸载 React 根 + 移除宿主）。
 *
 * @param hostParent 宿主父节点：随下次创建被清空的编辑器挂载容器（见 createLakeDocument 的 element）
 * @param container 手柄监听鼠标事件的容器：编辑器实例自身挂载点（`.lake-editor-mount`）
 */
export function mountBlockHoverHandle(
  hostParent: HTMLElement,
  container: HTMLElement,
  editor: LakeEditorInstance,
): () => void {
  const host = document.createElement("div");
  host.className = "lake-block-handle-host";
  hostParent.appendChild(host);
  const root = createRoot(host);
  root.render(createElement(BlockHandleHost, { container, editor }));
  return () => {
    try {
      root.unmount();
    } catch {
      /* 忽略：编辑器销毁路径不应抛错 */
    }
    host.remove();
  };
}