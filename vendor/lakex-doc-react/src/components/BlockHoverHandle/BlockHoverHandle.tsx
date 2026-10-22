// src/components/BlockHoverHandle/BlockHoverHandle.tsx
//
// 编辑器块节点悬浮拖拽手柄组件。
//
// 功能：
//   1. 鼠标悬停在块节点（ne-p / ne-h1~h6 / ne-quote / ne-tli / ne-oli / ne-uli / ne-card 等）上时，
//      在块左侧显示一个 ⋮ 图标（grip handle）。
//   2. 左键点击或右键点击显示上下文菜单（菜单打开期间暂停 mouseout 隐藏逻辑）。
//
// LOCAL-CHANGE(260917)：菜单动作全部改为「内核原生命令」实现（见 blockMenuHelpers 的
// deleteBlockByRange / insertBlockNative / moveBlockNative）；「拖拽移动块」已用**内核原生命令**
// 重新实现：卡片走 moveCard（逐字节保真），其它块走「读-插-删」。不再使用 utils/blockDoc.moveBlock
// 的整篇 JSON 读改写（实测会把自定义卡 634B→8859B、抹掉内核未注册卡）。

import React, { useEffect, useRef, useCallback, useState, forwardRef } from 'react';
import './BlockHoverHandle.css';
import type { HeadingConfig } from '../lakex/types';
import { BlockContextMenu, BlockMenuAction } from '../BlockContextMenu';
import { useBlockContextMenu } from './useBlockContextMenu';
// LOCAL-CHANGE: 不再从 utils/blockDoc 引入 moveBlock/deleteBlock/duplicateBlock/convertBlock/
// insertBlock —— 它们走「整篇 JSON 读改写」，实测会重写自定义卡并抹掉内核未注册的卡。
import {
  selectBlockInEditor,
  runNativeConvert,
  copyDomBlock,
  copyText,
  deleteBlockByRange,
  insertBlockNative,
  moveBlockNative,
  blockSpanElements,
  selectedTopBlocks,
  hasMultiBlockSelection,
  selectBlocksInEditor,
} from './blockMenuHelpers';

/** 支持 hover 检测的块节点标签名集合 */
const BLOCK_TAGS = [
  'NE-P',
  'NE-H1', 'NE-H2', 'NE-H3', 'NE-H4', 'NE-H5', 'NE-H6',
  'NE-QUOTE',
  'NE-TLI',
  'NE-OLI',
  'NE-ULI',
  'NE-CARD',
  'NE-HOLE',
  'NE-ALERT-HOLE',
  "NE-CONTAINER-HOLE",
  'NE-CODEBLOCK',
  'NE-HR',
  'NE-TABLE-HOLE',
  'NE-IMAGE',
  'NE-VIDEO',
  'NE-AUDIO',
  'NE-FILE',
  'NE-CALLOUT',
] as const;

/**
 * 内部虽然包含 p 等基础块，但行操作必须作用于整个结构组件。
 * LOCAL-CHANGE(261004)：**NE-QUOTE 移出结构块**。云端 Edge 实测：引用内部的段落 /
 * 有序 / 无序 / 任务项各自是独立 brick，各自出柄、可单独块编辑（引用内「转化为」菜单
 * 也会裁掉代码块/引用/分栏/折叠，见 BlockContextMenu）。把 NE-QUOTE 当结构块时，
 * hover 引用内任意块都会被上提成外层 ne-quote ⇒ 引用内的列表永远只能整体编辑。
 * 高亮块/分栏/折叠/通用 hole 仍按结构块处理（内部块不单独出柄）。
 */
const STRUCTURAL_BLOCK_TAGS = [
  'NE-ALERT-HOLE',
  'NE-CONTAINER-HOLE',
  'NE-HOLE',
] as const;

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

interface HoverState {
  blockElement: HTMLElement | null;
  blockId: string | null;
  blockType: string | null;
}

export const BlockHoverHandle = forwardRef<HTMLDivElement, BlockHoverHandleProps>(({
  containerRef,
  editor,
  language = 'zh-cn',
  dark = false,
  heading,
  onBlockAction,
}, forwardedRef) => {
  const [hoverState, setHoverState] = useState<HoverState>({
    blockElement: null,
    blockId: null,
    blockType: null,
  });
  const [handleStyle, setHandleStyle] = useState<React.CSSProperties>({});
  const [visible, setVisible] = useState(false);

  // Refs
  const hoverStateRef = useRef(hoverState);
  const visibleRef = useRef(visible);
  const hideTimerRef = useRef<number | null>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  // 暂停/恢复 mouseout（菜单打开时不隐藏手柄）
  const mouseoutPausedRef = useRef(false);
  // 鼠标已经进入手柄时，任何来自编辑器容器的延迟隐藏都应失效
  const handleHoveredRef = useRef(false);
  // 拖拽进行中：期间忽略 mouseover/mouseout，避免干扰拖拽并减少重渲染
  const isDraggingRef = useRef(false);
  // 多块选区（Issue 4）：跨多个顶层块拖选。手柄聚合到首块，菜单动作按整个选区批量执行
  const multiSelectionRef = useRef<HTMLElement[] | null>(null);
  // LOCAL-CHANGE(261004)：记录当前被加了 .ne-brick-highlight 的节点。多块选区切换时
  // multiSelectionRef 会被整体覆盖、旧节点再也找不到 ⇒ 高亮永久残留（用户报「选中过一次
  // 背景就不消失」）。每次 setBlockHighlight 先清空上一次记录的节点，再按需重记。
  const highlightedRef = useRef<Set<HTMLElement>>(new Set());

  // ========== 右键上下文菜单：状态 + 点击事件 + 动作处理（封装在 BlockHoverHandle 文件夹） ==========
  const { contextMenuState, showContextMenu, closeContextMenu } = useBlockContextMenu({ hoverHandleRef: handleRef });

  // 处理右键菜单动作
  const handleMenuAction = useCallback(async (action: BlockMenuAction, data: { blockElement: HTMLElement; blockType: string; payload?: string }) => {
    if (!editor || !data.blockElement) return;

    // 多块选区（Issue 4）：点击手柄会让编辑区失焦、选区被清掉 —— 执行动作前先还原整段选区
    const multi = multiSelectionRef.current;
    if (multi && multi.length > 1) {
      selectBlocksInEditor(editor, multi);
    }

    switch (action) {
      case 'delete': {
        // LOCAL-CHANGE: 抽成内核原生命令实现，剪切复用同一份（原实现内联在此）。
        deleteBlockByRange(editor, data.blockElement);
        break;
      }
      case 'copy': {
        if (!copyDomBlock(editor, data.blockElement)) {
          await copyText(data.blockElement.innerText || data.blockElement.textContent || "");
        }
        break;
      }
      case 'cut': {
        const copied = copyDomBlock(editor, data.blockElement)
          || await copyText(data.blockElement.innerText || data.blockElement.textContent || "");
        // LOCAL-CHANGE: 原来是 blockDoc.deleteBlock（整篇 JSON 读改写）。
        if (copied && data.blockElement.isConnected) {
          deleteBlockByRange(editor, data.blockElement);
        }
        break;
      }
      case 'convert': {
        // LOCAL-CHANGE: 只用内核原生命令（原实现先试 blockDoc.convertBlock 的整篇 JSON 读改写，
        // 实测会重写自定义卡）。runNativeConvert 覆盖 正文/标题/引用/三种列表/高亮块/分栏/折叠。
        if (data.payload) {
          const ok = runNativeConvert(editor, data.blockElement, data.payload);
          if (!ok) {
            console.warn('[LakexEditor] 转换块类型失败:', data.payload);
          }
        }
        break;
      }
      case 'indent':
      case 'outdent': {
        try {
          if (!hasMultiBlockSelection()) selectBlockInEditor(editor, data.blockElement);
          editor.execCommand(action);
        } catch {
          console.warn(`[LakexEditor] ${action} 仅适用于支持缩进的块`);
        }
        break;
      }
      case 'addAfter':
      case 'addBefore': {
        // LOCAL-CHANGE: 原来是 blockDoc.insertBlock（整篇 JSON 读改写），改为内核原生命令组合：
        // 光标收到块首/尾 → breakLine → 需要类型时再对该新块执行 style/quote/hr。
        if (data.payload) {
          const ok = insertBlockNative(
            editor,
            data.blockElement,
            action === 'addAfter' ? 'after' : 'before',
            data.payload,
          );
          if (!ok) {
            console.warn('[LakexEditor] 添加块失败:', data.payload);
          }
        }
        break;
      }
      case 'aiOutline':
        // 由业务层接入具体 AI 服务；下方的 onBlockAction 会携带当前块。
        break;
      default:
        console.warn('[LakexEditor] 未处理的菜单动作:', action);
    }

    // 批量动作执行完毕：退出多块选区（选区可能已因删除/转化变化）+ 清掉选中样式
    if (multi && multi.length > 1) {
      multiSelectionRef.current = null;
      setBlockHighlight(false);
      setVisible(false);
      setHoverState({ blockElement: null, blockId: null, blockType: null });
    }

    if (onBlockAction) {
      onBlockAction(action, data);
    }
  }, [editor, onBlockAction]);

  // 给当前 hover 的块节点加/去高亮 class（鼠标移到手柄时高亮对应节点）
  // LOCAL-CHANGE(260917 Issue 3)：列表父项要把整段（含子项）一起高亮，与云端「一个条目」一致。
  const setBlockHighlight = useCallback((show: boolean) => {
    // 先清掉上一次记录的所有节点（跨多块选区切换也不会漏）+ 清掉动态扩展量。
    for (const node of highlightedRef.current) {
      node.classList.remove('ne-brick-highlight');
      node.style.removeProperty('--ln-brick-hl-extend');
    }
    highlightedRef.current.clear();
    if (!show) return;
    const multi = multiSelectionRef.current;
    const targets = multi && multi.length > 1
      ? multi
      : (hoverStateRef.current.blockElement ? blockSpanElements(hoverStateRef.current.blockElement) : []);
    targets.forEach((node, index) => {
      node.classList.add('ne-brick-highlight');
      highlightedRef.current.add(node);
      // **动态入参**：扩展高度 = 与「下一个高亮块」之间的实际空隙（让相邻行连成一片、不留缝）。
      // 判据是结构性的 —— 「下一个高亮块就是它的紧邻兄弟」才补（中间夹着非高亮块就不补），
      // 扩展量取两者真实间距；不用任何固定像素阈值，随行高/段距动态变化。
      // 单行 / 末尾 → 0（就用行高本身，不无谓加高）。
      let extend = 0;
      const next = targets[index + 1];
      if (next && next === node.nextElementSibling) {
        const gap = Math.round(next.getBoundingClientRect().top - node.getBoundingClientRect().bottom);
        if (gap > 0) extend = gap;
      }
      node.style.setProperty('--ln-brick-hl-extend', extend + 'px');
    });
  }, []);

  useEffect(() => { hoverStateRef.current = hoverState; }, [hoverState]);
  useEffect(() => { visibleRef.current = visible; }, [visible]);

  /**
   * 从事件 target 向上查找最近的块节点元素。
   * 可选排除 set：跳过拖拽相关的辅助元素，避免 elementFromPoint 命中自身。
   */
  const findBlockNode = useCallback((
    target: EventTarget | null,
    exclude?: Set<Element>,
  ): HTMLElement | null => {
    let el = target as HTMLElement | null;
    while (el && el !== document.body) {
      if (exclude?.has(el)) {
        el = el.parentElement;
        continue;
      }
      const tagName = el.tagName.toUpperCase();

      const isKnownBlock = tagName && BLOCK_TAGS.includes(tagName as any);
      const isRenderUnit = el.getAttribute?.('ne-role') === 'render-unit';
      if (isKnownBlock || isRenderUnit) {
        // 高亮块、分栏、折叠和块卡片内部都可能包含 ne-p。若先返回
        // 内层段落，菜单会误判为正文并把转换结果嵌进旧容器。
        let structural: HTMLElement | null = el;
        while (structural && structural !== document.body) {
          if (STRUCTURAL_BLOCK_TAGS.includes(structural.tagName.toUpperCase() as any)) {
            return structural;
          }
          structural = structural.parentElement;
        }

        if (el.parentElement) {
          const parent = el.parentElement;
          const ptagName = parent.tagName.toLocaleUpperCase()
          // LOCAL-CHANGE(261004)：父块上提**保留** —— 云端「引用这种容器的第一行手柄就是整个
          // 引用的合并手柄」（点它 → 转化为 → 引用回显 → 取消引用）。所以引用的**首个子块**要
          // 上提成 ne-quote；其余子块不上提（各自出柄、可单独块编辑），这一半由上面
          // STRUCTURAL_BLOCK_TAGS 去掉 NE-QUOTE 保证。
          if (
            BLOCK_TAGS.includes(ptagName as any)
            && parent.firstElementChild?.id === el.id
          ) {
            return parent
          }
        }
        if (tagName === 'NE-CARD' && el.getAttribute("card-type") !== 'block') {
          el = el.parentElement
          continue
        }
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }, []);

  const getBlockTypeName = useCallback((el: HTMLElement): string => {
    return el.tagName?.toLowerCase() || 'unknown';
  }, []);

  /**
   * 解析鼠标所在的块节点。
   * 1) 优先沿 e.target 向上查找；
   * 2) 回退：e.target 可能落在覆盖层（如 ne-inner-overlay-container 内的卡片交互浮层，
   *    与真实块是平级兄弟节点），此时沿 DOM 向上找不到块。改用坐标穿透
   *    elementsFromPoint 找到鼠标下方真正的块节点。
   */
  const resolveBlockNode = useCallback((
    target: EventTarget | null,
    clientX: number,
    clientY: number,
  ): HTMLElement | null => {
    const fromTarget = findBlockNode(target);
    if (fromTarget) return fromTarget;

    if (typeof clientX === 'number' && typeof clientY === 'number') {
      const stack = document.elementsFromPoint(clientX, clientY);
      for (const el of stack) {
        const found = findBlockNode(el);
        if (found) return found;
      }
    }
    return null;
  }, [findBlockNode]);

  const updateHandlePosition = useCallback((blockEl: HTMLElement) => {
    if (!blockEl) return;
    const blockRect = blockEl.getBoundingClientRect();
    // 标题块（NE-H1~H6）左侧会渲染锚点(anchor)/折叠(folding)按钮，需相应左移手柄
    const tag = blockEl.tagName.toUpperCase();
    let offset = 0;
    // 列表项：外层 ne-tli 的 left 是「整块左边界」（不含缩进），缩进在内容元素上。
    // 手柄要贴**项目符号（marker）左缘**：贴内容左缘会把手柄正好画在符号上（符号占的就是内容左侧那一段，
    // 实测 icon 中心落在 marker 内 16px）；贴外层 left 又会让三级项落到最左。marker = ne-*-i。
    let anchorLeft = blockRect.left;
    if (tag === 'NE-ULI' || tag === 'NE-OLI' || tag === 'NE-TLI') {
      const marker = blockEl.querySelector('ne-uli-i, ne-oli-i, ne-tli-i') as HTMLElement | null;
      const content = blockEl.querySelector('ne-uli-c, ne-oli-c, ne-tli-c, [class*="-content"]') as HTMLElement | null;
      const anchorEl = marker || content;
      if (anchorEl) {
        anchorLeft = anchorEl.getBoundingClientRect().left;
      }
    }
    const handleSize = 24;
    const hitAreaWidth = 34;
    if (['NE-H1', 'NE-H2', 'NE-H3', 'NE-H4', 'NE-H5', 'NE-H6'].includes(tag)) {
      const anchor = heading?.anchor ?? false;
      const folding = heading?.folding ?? true;
      offset = (anchor ? 20 : 0) + (folding ? 20 : 0);
    }
    if (tag === 'NE-TABLE-HOLE') {
      offset = 20
    }
    setHandleStyle({
      position: 'fixed',
      left: `${anchorLeft - hitAreaWidth - offset}px`,
      // LOCAL-CHANGE(261004)：手柄**顶对齐块首行**（云端 Edge 实测：列表项块 y=464 →
      // 手柄 y=464；引用块 y=266 → 手柄 y=266）。原实现按块高垂直居中 ⇒ 高块（引用、
      // 多块选区首块）手柄跑到块中间，既与云端不一致，也和其他行的独立手柄产生归属歧义。
      top: `${blockRect.top}px`,
      width: `${hitAreaWidth}px`,
      height: `${handleSize}px`,
      zIndex: 100,
    });
  }, [heading]);

  const showHandle = useCallback((blockEl: HTMLElement) => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    const blockId = blockEl.getAttribute('id') || null;
    const blockType = getBlockTypeName(blockEl);
    setHoverState({ blockElement: blockEl, blockId, blockType });
    updateHandlePosition(blockEl);
    setVisible(true);
  }, [getBlockTypeName, updateHandlePosition]);

  const hideHandle = useCallback(() => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      if (
        handleHoveredRef.current
        || mouseoutPausedRef.current
        || isDraggingRef.current
      ) {
        return;
      }
      setBlockHighlight(false);
      setVisible(false);
      setHoverState({ blockElement: null, blockId: null, blockType: null });
    }, 220);
  }, [setBlockHighlight]);

  // ========== 鼠标悬浮检测 ==========
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseMove = (e: MouseEvent) => {
      // 拖拽进行中：忽略悬浮检测（已在拖拽，无需再显示/隐藏手柄）
      if (isDraggingRef.current) return;
      if (handleRef.current?.contains(e.target as Node)) {
        if (hideTimerRef.current !== null) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
        return;
      }
      

      // 多块选区：只在「松开按键后的普通移动」时判定（拖选中不判定 —— 不能影响跨行选择的性能）。
      // 成立则把聚合手柄落回首块并重新显示 ⇒ 手柄隐藏后再移回来能再次触发
      // （修用户 261004 报的「触发过一次没点，就再也触发不了」）。
      if (e.buttons === 0) {
        const blocks = selectedTopBlocks();
        if (blocks.length >= 2 && hasMultiBlockSelection()) {
          multiSelectionRef.current = blocks;
          if (hideTimerRef.current !== null) {
            clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
          }
          const first = blocks[0];
          setHoverState({ blockElement: first, blockId: first.getAttribute('id'), blockType: getBlockTypeName(first) });
          updateHandlePosition(first);
          setVisible(true);
          return;
        }
        if (multiSelectionRef.current) multiSelectionRef.current = null;
      }

      // ① 先看鼠标是否还在「当前块 ↔ 手柄」的通道上：在通道内就**保持当前块**，不再重新解析。
      // LOCAL-CHANGE(261005)：标题的手柄比正文更靠左（要避开标题左侧的折叠/锚点按钮，offset 最多 +40），
      // 鼠标往手柄走时会经过**引用背景**；引用背景会被解析成 ne-quote ⇒ 手柄跳回首行、该标题行的手柄消失
      // （用户报「引用里标题的句柄点不到、鼠标过去就跳到首行」）。原来这段判断在「没解析到块」的 else 里,
      // 被 ne-quote 抢先 ⇒ 必须提到解析之前。
      const currentBlock = hoverStateRef.current.blockElement;
      const handle = handleRef.current;
      if (currentBlock && handle && visibleRef.current) {
        const blockRect = currentBlock.getBoundingClientRect();
        const handleRect = handle.getBoundingClientRect();
        const corridorLeft = Math.min(handleRect.left, blockRect.left) - 6;
        const corridorRight = Math.max(handleRect.right, blockRect.left) + 6;
        const corridorTop = Math.min(handleRect.top, blockRect.top) - 6;
        const corridorBottom = Math.max(handleRect.bottom, blockRect.bottom) + 6;
        if (
          e.clientX >= corridorLeft
          && e.clientX <= corridorRight
          && e.clientY >= corridorTop
          && e.clientY <= corridorBottom
        ) {
          if (hideTimerRef.current !== null) {
            clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
          }
          return;
        }
      }

      const blockEl = resolveBlockNode(e.target, e.clientX, e.clientY);
      if (blockEl) {
        showHandle(blockEl);
      } else {
        // 从块正文移向行首按钮时会经过左侧 gutter；不在上面的通道内就按常规隐藏。
        hideHandle();
      }
    };

    const handleMouseLeave = (e: MouseEvent) => {
      // 拖拽进行中：忽略
      if (isDraggingRef.current) return;
      if (mouseoutPausedRef.current) return;

      const relatedTarget = e.relatedTarget as Node | null;
      if (relatedTarget && handleRef.current?.contains(relatedTarget)) return;
      if (relatedTarget && container.contains(relatedTarget)) return;
      hideHandle();
    };

    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!container.contains(target)) return;

      // Drawnix owns its canvas context menu. Let the card render its own
      // board-level actions instead of resolving the enclosing `ne-card` and
      // opening the document block menu.
      if (
        target instanceof Element &&
        target.closest(".lakex-drawnix-core")
      ) {
        return;
      }

      const blockEl =
        resolveBlockNode(target, e.clientX, e.clientY) ||
        hoverStateRef.current.blockElement;
      if (blockEl) {
        e.preventDefault();
        e.stopPropagation();
        mouseoutPausedRef.current = true;
        showContextMenu(blockEl, e);
      } else {
        e.preventDefault();
      }
    };

    container.addEventListener('mousemove', handleMouseMove, true);
    container.addEventListener('mouseleave', handleMouseLeave, true);
    // container.addEventListener('contextmenu', handleContextMenu, true);

    return () => {
      container.removeEventListener('mousemove', handleMouseMove, true);
      container.removeEventListener('mouseleave', handleMouseLeave, true);
      // container.removeEventListener('contextmenu', handleContextMenu, true);
      if (hideTimerRef.current !== null) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [containerRef, findBlockNode, resolveBlockNode, showHandle, hideHandle]);

  // ========== 滚动时更新位置 ==========
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (visibleRef.current && hoverStateRef.current.blockElement) {
        updateHandlePosition(hoverStateRef.current.blockElement);
      }
    };

    container.addEventListener('scroll', handleScroll);
    window.addEventListener('scroll', handleScroll);
    window.addEventListener('resize', handleScroll);

    return () => {
      container.removeEventListener('scroll', handleScroll);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [containerRef, updateHandlePosition]);

  // ========== 多块选区（Issue 4）：聚合手柄 ==========
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !editor) return;

    // LOCAL-CHANGE(261004)：**不在 selectionchange 上做多块扫描/高亮** —— 用户口径：
    // 没触达块句柄就不触发块编辑逻辑，且不能影响跨行选择的性能（拖选时每帧 O(块数) 扫描不可接受）。
    // 这里只做一件廉价的事：选区收缩时退出多块选区、清掉可能残留的样式。
    const onSelectionChange = () => {
      const selection = typeof window !== "undefined" ? window.getSelection() : null;
      if (selection && !selection.isCollapsed) return;
      if (!multiSelectionRef.current) return;
      if (handleHoveredRef.current || mouseoutPausedRef.current) return;
      multiSelectionRef.current = null;
      setBlockHighlight(false);
      setVisible(false);
      setHoverState({ blockElement: null, blockId: null, blockType: null });
    };

    // 在编辑区内按下（且不是手柄）= 用户开始新的选择/落光标 ⇒ 退出多块选区 + 清掉块高亮、收起手柄。
    // LOCAL-CHANGE(261004)：原实现只在 `multiSelectionRef` 存在时才清 —— 单块 hover 高亮（触达句柄触发）
    // 时，在别处按下若鼠标**没有再移动**就不会有 mousemove ⇒ hideHandle 不跑 ⇒ 高亮永久残留
    //（用户报「点了块手柄、再点其他位置，背景不消失」）。这里改成：手柄以外的任何按下都无条件清。
    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && handleRef.current?.contains(target)) return;
      multiSelectionRef.current = null;
      setBlockHighlight(false);
      setVisible(false);
      setHoverState({ blockElement: null, blockId: null, blockType: null });
    };

    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('mousedown', onDocumentMouseDown, true);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('mousedown', onDocumentMouseDown, true);
    };
  }, [containerRef, editor, getBlockTypeName, updateHandlePosition, setBlockHighlight]);

  // ========== 拖拽 / 点击逻辑 ==========
  const startDrag = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();

    const blockEl = hoverStateRef.current.blockElement || multiSelectionRef.current?.[0] || null;
    if (!blockEl) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    let dragStarted = false;

    // 被拖拽的原始块（保持原位，仅浅色显示）；列表父项 = 自身 + 子项整段（Issue 3）
    const draggedEl = blockEl;
    const draggedSpan = blockSpanElements(draggedEl);
    // 蓝色插入线指示器：松手后块的落点
    let indicator: HTMLElement | null = null;
    // 跟随鼠标的克隆副本（拖拽预览）
    let ghost: HTMLElement | null = null;
    // 排除集合：让 elementFromPoint 穿过这些元素找到真正的块
    const excludeSet = new Set<Element>();

    // 抓取点相对于整段包围盒左上角的偏移，使克隆副本跟随光标时保持相对位置
    const firstRect = draggedSpan[0].getBoundingClientRect();
    const lastRect = draggedSpan[draggedSpan.length - 1].getBoundingClientRect();
    const srcRect = {
      left: firstRect.left,
      top: firstRect.top,
      width: firstRect.width,
      height: lastRect.bottom - firstRect.top,
      right: firstRect.right,
      bottom: lastRect.bottom,
    } as DOMRect;
    const grabOffsetX = startX - srcRect.left;
    const grabOffsetY = startY - srcRect.top;
    const dragOverlay = handleRef.current?.parentElement ?? document.body;
    // 整段每个节点的原 pointer-events（退出时逐个还原）
    const previousPointerEvents = new Map<HTMLElement, string>();
    for (const node of draggedSpan) previousPointerEvents.set(node, node.style.pointerEvents);
    const previousBodyCursor = document.body.style.cursor;

    /** 蓝色插入线：松手后块的落点 */
    const createIndicator = () => {
      if (indicator) return;
      indicator = document.createElement('div');
      indicator.className = 'ne-block-drag-indicator';
      // 必须挂到 DOM 上才能显示（之前漏了这一步，导致蓝色线不显示）
      dragOverlay.appendChild(indicator);
      excludeSet.add(indicator);
    };

    /** 克隆被拖块，生成跟随鼠标的「副本」预览（无红色边框） */
    const createGhost = () => {
      if (ghost) return;
      if (draggedSpan.length > 1) {
        // 列表父项 + 子项：整段一起做预览（外包一个 ne-engine，让列表样式能命中克隆项）。
        ghost = document.createElement('div');
        ghost.className = 'ne-engine ne-block-drag-ghost';
        for (const node of draggedSpan) {
          const clone = node.cloneNode(true) as HTMLElement;
          clone.removeAttribute('id');
          clone.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
          ghost.appendChild(clone);
        }
      } else {
        ghost = draggedEl.cloneNode(true) as HTMLElement;
        ghost.className = `${draggedEl.className} ne-block-drag-ghost`;
        ghost.removeAttribute('id');
        ghost.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
      }
      ghost.setAttribute('aria-hidden', 'true');
      ghost.setAttribute('contenteditable', 'false');
      ghost.style.cssText = `
        position: fixed;
        left: 0;
        top: 0;
        width: ${srcRect.width}px;
        margin: 0;
        z-index: 1000;
        pointer-events: none;
        box-sizing: border-box;
      `;
      // 预览必须挂在 contenteditable 之外，否则 Lakex 的 MutationObserver
      // 会把克隆节点误认为真实文档变更。
      dragOverlay.appendChild(ghost);
      excludeSet.add(ghost);
    };

    /** 进入拖拽模式：源块浅色、创建指示器与副本 */
    const enterDragMode = () => {
      if (dragStarted) return;
      dragStarted = true;

      // 进入拖拽：暂停 mouseover/mouseout 监听（已在拖拽，无需再处理悬浮）
      isDraggingRef.current = true;

      createIndicator();
      createGhost();

      // 源块（整段，含列表子项）浅色显示 + 穿透，便于 elementFromPoint 找到目标块
      for (const node of draggedSpan) {
        node.classList.add('ne-block-drag-source');
        node.style.pointerEvents = 'none';
        excludeSet.add(node);
      }

      // 拖拽期间强制光标为小手（grab），避免命中穿透元素时变回箭头
      document.body.style.cursor = 'grab';

      // 手柄也加入排除（鼠标在手柄上时不应误判）
      if (handleRef.current) excludeSet.add(handleRef.current);
    };

    /** 退出拖拽模式：恢复样式、清理元素 */
    const exitDragMode = () => {
      for (const node of draggedSpan) {
        node.classList.remove('ne-block-drag-source');
        node.style.pointerEvents = previousPointerEvents.get(node) ?? '';
      }
      // 复位光标
      document.body.style.cursor = previousBodyCursor;
      if (indicator && indicator.parentNode) indicator.remove();
      indicator = null;
      if (ghost && ghost.parentNode) ghost.remove();
      ghost = null;
      excludeSet.clear();
      stopAutoScroll();
      // 结束拖拽：恢复 mouseover/mouseout 监听
      isDraggingRef.current = false;
    };

    let lastInsertInfo: { target: HTMLElement; before: boolean } | null = null;

    const positionIndicator = (clientX: number, clientY: number) => {
      // 用 elementsFromPoint 获取所有元素列表，逐个查找块（跳过排除集中的元素）
      const allEls = document.elementsFromPoint(clientX, clientY);
      let targetBlock: HTMLElement | null = null;
      for (const el of allEls) {
        if (excludeSet.has(el as Element)) continue;
        const found = findBlockNode(el, excludeSet);
        if (found) {
          targetBlock = found;
          break;
        }
      }

      if (!targetBlock || targetBlock === draggedEl || draggedSpan.includes(targetBlock)) {
        // 不在任何有效块上（或落在自身整段内）→ 隐藏指示器
        if (indicator) indicator.style.display = 'none';
        lastInsertInfo = null;
        return;
      }

      if (indicator) indicator.style.display = '';

      const rect = targetBlock.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const insertBefore = clientY < midY;

      // 定位蓝色线：在目标块的顶部边界或底部边界
      const lineTop = insertBefore ? rect.top : rect.bottom;
      indicator!.style.cssText = `
        position: fixed;
        left: ${rect.left}px;
        top: ${lineTop}px;
        width: ${rect.width}px;
        height: 2px;
        background: var(--lakex-editor-text-link, #1677ff);
        border-radius: 1px;
        z-index: 999;
        pointer-events: none;
        transition: top 0.08s ease-out, left 0.08s ease-out, width 0.08s ease-out;
      `;

      lastInsertInfo = { target: targetBlock, before: insertBefore };
    };

    /** 让克隆副本跟随鼠标 */
    const positionGhost = (clientX: number, clientY: number) => {
      if (!ghost) return;
      ghost.style.left = `${clientX - grabOffsetX}px`;
      ghost.style.top = `${clientY - grabOffsetY}px`;
    };

    // 拖到滚动容器上下边缘时自动滚动（长文档拖拽必需；rAF 循环，拖动才启动）
    const scrollContainer = (): HTMLElement | null => {
      const found = containerRef.current?.querySelector?.('.ne-editor-wrap') as HTMLElement | null;
      if (found) return found;
      let p: HTMLElement | null = draggedEl.parentElement;
      while (p) {
        const style = getComputedStyle(p);
        if (/(auto|scroll)/.test(style.overflowY) && p.scrollHeight > p.clientHeight) return p;
        p = p.parentElement;
      }
      return null;
    };
    let lastClientX = startX;
    let lastClientY = startY;
    let autoScrollRaf: number | null = null;
    const tickAutoScroll = () => {
      const sc = scrollContainer();
      if (!sc) { autoScrollRaf = null; return; }
      const rect = sc.getBoundingClientRect();
      const EDGE = 48;
      let delta = 0;
      if (lastClientY < rect.top + EDGE) delta = -Math.max(6, Math.round((rect.top + EDGE - lastClientY) / 3));
      else if (lastClientY > rect.bottom - EDGE) delta = Math.max(6, Math.round((lastClientY - (rect.bottom - EDGE)) / 3));
      if (delta) {
        sc.scrollTop += delta;
        positionIndicator(lastClientX, lastClientY);
      }
      autoScrollRaf = window.requestAnimationFrame(tickAutoScroll);
    };
    const stopAutoScroll = () => {
      if (autoScrollRaf !== null) { window.cancelAnimationFrame(autoScrollRaf); autoScrollRaf = null; }
    };

    // ---- mousemove ----
    const handleMouseMove = (moveEvent: MouseEvent) => {
      // 多块选区：拖拽暂不支持（菜单批量操作仍可用）
      if (multiSelectionRef.current && multiSelectionRef.current.length > 1) return;
      const dx = Math.abs(moveEvent.clientX - startX);
      const dy = Math.abs(moveEvent.clientY - startY);
      if (!moved && (dx > 3 || dy > 3)) {
        moved = true;
        enterDragMode();
        if (autoScrollRaf === null) autoScrollRaf = window.requestAnimationFrame(tickAutoScroll);
      }
      if (!moved) return;
      lastClientX = moveEvent.clientX;
      lastClientY = moveEvent.clientY;
      positionGhost(moveEvent.clientX, moveEvent.clientY);
      positionIndicator(moveEvent.clientX, moveEvent.clientY);
    };

    // ---- mouseup ----
    const handleMouseUp = (upEvent: MouseEvent) => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      // 未达阈值 → 视为点击，弹菜单
      if (!moved) {
        mouseoutPausedRef.current = true;
        const rect = handleRef.current?.getBoundingClientRect();
        showContextMenu(draggedEl, {
          clientX: rect ? rect.left : upEvent.clientX,
          clientY: rect ? rect.bottom : upEvent.clientY,
          preventDefault() {},
          stopPropagation() {},
        } as unknown as MouseEvent);
        return;
      }

      // LOCAL-CHANGE: 原生移动块（卡片 moveCard / 其它块「读-插-删」），不再走 blockDoc 的 JSON 读改写。
      const info = lastInsertInfo;
      exitDragMode();
      if (info && info.target && info.target !== draggedEl) {
        const ok = moveBlockNative(editor, draggedEl, info.target, info.before);
        if (!ok) console.warn('[LakexEditor] 移动块失败（原生路径）');
      }
      setVisible(false);
      setHoverState({ blockElement: null, blockId: null, blockType: null });
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [editor, findBlockNode]);

  // ========== 暴露 __resumeHover 供外部调用 ==========
  useEffect(() => {
    const el = handleRef.current;
    if (el) {
      (el as any).__resumeHover = () => {
        mouseoutPausedRef.current = false;
      };
    }
  });

  // 合并 ref
  const setRefs = useCallback((el: HTMLDivElement | null) => {
    (handleRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    if (typeof forwardedRef === 'function') {
      forwardedRef(el);
    } else if (forwardedRef) {
      (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    }
  }, [forwardedRef]);

  return (
    <>
    <div
      ref={setRefs}
      className={`ne-block-hover-handle${dark ? ' ne-block-hover-handle--dark' : ''}`}
      style={{
        ...handleStyle,
        opacity: (!visible || !hoverState.blockElement) ? 0 : 1,
        pointerEvents: (!visible || !hoverState.blockElement) ? 'none' : 'auto',
      }}
      role="button"
      tabIndex={visible ? 0 : -1}
      aria-label={language === 'en-us' ? 'Click or drag' : '可点击和拖拽'}
      onMouseDownCapture={(event) => {
        // 多块选区：先阻止 mousedown 默认行为（清选区/夺焦），再还原整段选区，保证菜单动作按整段执行
        const multi = multiSelectionRef.current;
        if (multi && multi.length > 1) {
          event.preventDefault();
          selectBlocksInEditor(editor, multi);
        }
      }}
      onMouseDown={(event) => {
        startDrag(event);
      }}
      onContextMenu={(event) => {
        const blockElement = hoverStateRef.current.blockElement;
        if (!blockElement) return;
        event.preventDefault();
        mouseoutPausedRef.current = true;
        showContextMenu(blockElement, event.nativeEvent);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const blockElement = hoverStateRef.current.blockElement;
        if (!blockElement) return;
        event.preventDefault();
        mouseoutPausedRef.current = true;
        const rect = handleRef.current?.getBoundingClientRect();
        showContextMenu(blockElement, {
          clientX: rect?.left ?? 0,
          clientY: rect?.bottom ?? 0,
          preventDefault() {},
          stopPropagation() {},
        } as unknown as MouseEvent);
      }}
      onMouseEnter={() => {
        handleHoveredRef.current = true;
        if (hideTimerRef.current !== null) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
        // 鼠标移到手柄：高亮对应的块节点
        setBlockHighlight(true);
      }}
      onMouseLeave={() => {
        handleHoveredRef.current = false;
        // 鼠标离开手柄：取消选中样式（菜单打开期间保留，观感连续）
        if (!mouseoutPausedRef.current) setBlockHighlight(false);
        hideHandle();
      }}
    >
      <span className="ne-block-handle-inner">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="ne-block-handle-icon"
        >
          <circle cx="6" cy="3" r="1.5" fill="currentColor" />
          <circle cx="6" cy="8" r="1.5" fill="currentColor" />
          <circle cx="6" cy="13" r="1.5" fill="currentColor" />
          <circle cx="10" cy="3" r="1.5" fill="currentColor" />
          <circle cx="10" cy="8" r="1.5" fill="currentColor" />
          <circle cx="10" cy="13" r="1.5" fill="currentColor" />
        </svg>
      </span>
      <span className="ne-block-handle-tooltip" role="tooltip">
        {language === 'en-us' ? 'Click or drag' : '可点击和拖拽'}
      </span>
    </div>

    {/* 右键上下文菜单（与悬浮手柄同属 BlockHoverHandle 逻辑） */}
    <BlockContextMenu
      visible={contextMenuState.visible}
      position={contextMenuState.position}
      blockType={contextMenuState.blockType}
      blockElement={contextMenuState.blockElement}
      editor={editor}
      language={language}
      dark={dark}
      onClose={closeContextMenu}
      onAction={handleMenuAction}
    />
    </>
  );
});

export default BlockHoverHandle;
