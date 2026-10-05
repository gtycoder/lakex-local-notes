/**
 * 桌面编辑态的「块悬浮手柄 + 块操作菜单」挂载器（组件来自 vendor `BlockHoverHandle`）。
 *
 * 为什么需要它：我们应用是直接 `Doc.createOpenEditor` 起内核，没走 vendor 的 `LakexEditor`
 * 包装层，而块手柄只在那层被挂载 ⇒ 手柄从未出现过（详见 docs/LAKEX-CONTRACT.md）。
 *
 * 安全边界（260917）：菜单动作全部走内核原生命令（转化/删除/复制/剪切/缩进/在下方添加），
 * vendor 侧的「拖拽移动块」已禁用 —— 它走 `utils/blockDoc` 的整篇 JSON 读改写，实测会重写
 * 自定义卡（思维导图载荷 634B→8859B）并抹掉内核未注册的卡。
 *
 * 261005：块菜单新增「AI 助手」（vendor 注入菜单项 + 透传 `onBlockAction`）——
 * 上下文 = **块句柄覆盖的区域**，落库/替换复用文字浮栏同一套（`aiResultOps`），
 * 即「和 AI 浮窗一样的功能，只是选区换成块」。云端 Lake 只给标题用，本项目对所有块开放（用户要求）。
 */
import { createElement, Fragment, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BlockHoverHandle } from "@dlient/lakex-doc-react";
import type { LakeEditorInstance } from "./lakeRuntime";
import { AiAssistantDialog } from "../ai/AiAssistantDialog";
import { applyAiInsertAfter, applyAiReplace } from "./selectionToolbar/aiResultOps";
import { captureModelRange, type CapturedModelRange } from "./selectionToolbar/aiModelSelection";

const isDarkTheme = () => document.documentElement.dataset.theme === "dark";

/** 把块元素选成内核模型选区（与 vendor `selectBlockInEditor` 同口径：DOM range → `transformDOMRange` → `selection` 命令）。 */
function selectBlockModelRange(editor: unknown, blockElement: HTMLElement): CapturedModelRange | null {
  try {
    const ed = editor as { engine?: { transformDOMRange?: (r: Range) => unknown }; kernel?: { execCommand?: (n: string, a: unknown) => unknown } };
    const domRange = document.createRange();
    domRange.selectNodeContents(blockElement);
    const modelRange = ed.engine?.transformDOMRange?.(domRange);
    if (!modelRange) return null;
    ed.kernel?.execCommand?.("selection", { focus: "end", anchor: "start", ranges: [modelRange] });
    return captureModelRange(editor);
  } catch { return null; }
}

/** 捕获的模型选区是否「没覆盖任何东西」（null 或折叠）—— 折叠时不能当块选区用，否则会退化成「光标处插入」。 */
function isCollapsedRange(range: CapturedModelRange | null): boolean {
  return !range || (range.start.node === range.end.node && range.start.offset === range.end.offset);
}

/** 读当前（vendor 已还原的）块选区内容；拿不到就退回块元素的纯文本。 */
function readBlockSelection(editor: unknown, blockElement: HTMLElement): string {
  try {
    const ed = editor as { execCommand?: (n: string, a: unknown) => unknown };
    const md = ed.execCommand?.("getSelectionContent", "text/markdown");
    if (typeof md === "string" && md.trim()) return md.trim();
  } catch { /* 忽略：退回 DOM 文本 */ }
  return (blockElement.innerText || blockElement.textContent || "").trim();
}

/** 手柄宿主：跟随应用主题（data-theme）切换 dark 配色，避免深色下用浅色手柄；并承载块菜单的 AI 面板。 */
function BlockHandleHost(props: { container: HTMLElement; editor: LakeEditorInstance }) {
  const [dark, setDark] = useState(isDarkTheme);
  /** 块菜单「AI 助手」打开时的上下文：覆盖块的文本 + 模型选区 + 落点。 */
  const [ai, setAi] = useState<{ text: string; range: CapturedModelRange | null; at: { x: number; y: number } } | null>(null);

  useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDarkTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  /**
   * 块菜单动作回调（vendor 透传）。只接 `aiOutline`（= 菜单里的「AI 助手」）。
   *
   * 语义 = 「选区换成块柄覆盖的区域」：多块选区由 vendor 在动作前用 `selectBlocksInEditor` 还原，
   * 单块没有选区 ⇒ 这里自己把整块选成模型选区；随后**原样复用**浮栏的两个落库操作。
   */
  const onBlockAction = useCallback((action: string, data: { blockElement: HTMLElement; blockType: string }) => {
    if (action !== "aiOutline" || !data?.blockElement) return;
    // 多块选区由 vendor 还原（非折叠）⇒ 直接用；折叠（单块、菜单点击把选区压成光标）⇒ 自己把整块选上。
    // 必须先定选区再读内容：getSelectionContent 读的就是当前选区。
    let range = captureModelRange(props.editor);
    if (isCollapsedRange(range)) range = selectBlockModelRange(props.editor, data.blockElement);
    const text = readBlockSelection(props.editor, data.blockElement);
    const rect = data.blockElement.getBoundingClientRect();
    setAi({ text, range, at: { x: rect.right, y: rect.bottom } });
  }, [props.editor]);

  return createElement(
    Fragment,
    null,
    createElement(BlockHoverHandle, {
      containerRef: { current: props.container },
      editor: props.editor,
      language: "zh-cn",
      dark,
      onBlockAction,
    }),
    ai
      ? createElement(AiAssistantDialog, {
        open: true,
        selectionText: ai.text,
        at: ai.at,
        scroller: props.container.querySelector<HTMLElement>(".ne-editor-wrap"),
        container: props.container,
        onClose: () => setAi(null),
        onInsertAfter: (text: string) => { applyAiInsertAfter(props.editor, props.container, ai.range, text); },
        onReplace: (text: string) => { applyAiReplace(props.editor, props.container, ai.range, text); },
      })
      : null,
  );
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
