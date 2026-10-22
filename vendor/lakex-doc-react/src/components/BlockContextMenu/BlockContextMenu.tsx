// src/components/BlockContextMenu/BlockContextMenu.tsx
//
// 编辑器块节点右键上下文菜单组件。
//
// 功能：
//   1. 在块节点上右键时显示操作菜单。
//   2. 根据不同的节点类型显示不同的菜单选项。
//   3. 支持子菜单（如"转化为"、"缩进"、"在下方添加"）。
//
// 用法：
//   <BlockContextMenu
//       visible={visible}
//       position={{ x, y }}
//       blockType="ne-p"
//       blockElement={blockEl}
//       editor={editor}
//       language="zh-cn"
//       onClose={() => setVisible(false)}
//       onAction={(action, data) => handleAction(action, data)}
//   />

import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import './BlockContextMenu.css';

/** 菜单项动作类型 */
export type BlockMenuAction =
  | 'convert'      // 转化为
  | 'aiOutline'    // AI 大纲写作
  | 'delete'       // 删除
  | 'copy'         // 复制
  | 'cut'          // 剪切
  | 'paste'        // 粘贴
  | 'indent'       // 缩进
  | 'outdent'      // 取消缩进
  | 'copyLink'     // 复制当前块链接
  | 'addBefore'    // 在上方添加
  | 'addAfter'     // 在下方添加
  | 'duplicate'    // 复制块
  | 'selectBlock'; // 选中整块

/**
 * LOCAL-CHANGE: 只放行「内核原生命令」实现的块菜单动作（260917）。
 *
 * 背景：`convert` / `addAfter` 的旧实现优先走 `utils/blockDoc.ts` 的「整篇 JSON 读改写」
 * （`getDocument('json')` → 改树 → `setDocument('json')`）。本仓库实测该路径会重写自定义卡
 * （思维导图卡载荷 634B→8859B）并抹掉内核未注册的卡（`board-card`），因此收敛为安全集合：
 * 新增动作前先确认它只用 `kernel/renderer/editor.execCommand`，不得读写整篇 JSON 文档。
 */
export const SAFE_BLOCK_ACTIONS: readonly BlockMenuAction[] = [
  // LOCAL-CHANGE(261005)：放行 aiOutline —— 它本身不碰文档，只把该动作透传给宿主 onBlockAction
  // （BlockHoverHandle 里已有对应 case），宿主据此打开自己的 AI 助手面板。
  'convert', 'delete', 'copy', 'cut', 'indent', 'outdent', 'addAfter', 'aiOutline',
];
const SAFE_BLOCK_ACTION_SET = new Set<string>(SAFE_BLOCK_ACTIONS);

/**
 * LOCAL-CHANGE(261004)：**引用内部**的块，「转化为」要裁剪掉的目标 —— 与云端
 * （Edge 实测，即用户图 2）一致：引用内 11 项（h1–h6 / 正文 / 有序 / 无序 / 任务 / 高亮块），
 * 不出现代码块 / 引用 / 分栏 / 折叠块；引用外仍是完整 15 项。
 */
const QUOTE_HIDDEN_CONVERT_VALUES = new Set(['codeblock', 'quote', 'columns', 'collapse']);
// LOCAL-CHANGE(261005)：转化为网格里「图标 + 文字卡片格」的项 —— 必须按 **value** 判断，不能按下标。
// 引用内会裁掉 quote/columns/collapse/codeblock，下标整体前移，「高亮块」会从下标 11 掉到 10，
// 用「按下标 < 11」判断就会把它降级成纯图标格（用户 261005 实测：「引用里的转化为全变图标了，
// 云端『高亮块』是有文字的」）。云端同款：容器类（高亮块/引用/分栏/折叠块）都带文字标签。
const CARD_CONVERT_VALUES = new Set(['callout', 'quote', 'columns', 'collapse']);

/** 目标块是否位于某个引用**内部**（引用块本身不算「内部」）。 */
function isInsideQuote(blockElement: HTMLElement | null): boolean {
  if (!blockElement) return false;
  if (blockElement.tagName?.toUpperCase() === 'NE-QUOTE') return false;
  return !!blockElement.closest?.('ne-quote');
}

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

/** 按块类型分组的菜单配置 */
const MENU_CONFIGS: Record<string, (() => MenuItem[]) | MenuItem[]> = {
  // 段落
  'ne-p': () => [
    { action: 'convert', label: '转化为', icon: <ConvertIcon />, hasSubmenu: true, submenu: getConvertSubmenu() },
    { action: 'delete', label: '删除', icon: <DeleteIcon /> },
    { action: 'copy', label: '复制', icon: <CopyIcon /> },
    { action: 'cut', label: '剪切', icon: <CutIcon />, divider: true },
    { action: 'indent', label: '缩进', icon: <IndentIcon />, hasSubmenu: true, submenu: getIndentSubmenu() },
    { action: 'addAfter', label: '在下方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
  ],
  // 标题
  'ne-h1': () => [
    { action: 'convert', label: '转化为', icon: <ConvertIcon />, hasSubmenu: true, submenu: getConvertSubmenu('ne-h1') },
    { action: 'delete', label: '删除', icon: <DeleteIcon /> },
    { action: 'copy', label: '复制', icon: <CopyIcon /> },
    { action: 'cut', label: '剪切', icon: <CutIcon />, divider: true },
    { action: 'addBefore', label: '在上方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
    { action: 'addAfter', label: '在下方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
  ],
  'ne-h2': () => [
    { action: 'convert', label: '转化为', icon: <ConvertIcon />, hasSubmenu: true, submenu: getConvertSubmenu('ne-h2') },
    { action: 'delete', label: '删除', icon: <DeleteIcon /> },
    { action: 'copy', label: '复制', icon: <CopyIcon /> },
    { action: 'cut', label: '剪切', icon: <CutIcon />, divider: true },
    { action: 'addBefore', label: '在上方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
    { action: 'addAfter', label: '在下方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
  ],
  // 标题 3-6 共用同一菜单
  'ne-h3': () => [
    { action: 'convert', label: '转化为', icon: <ConvertIcon />, hasSubmenu: true, submenu: getConvertSubmenu() },
    { action: 'delete', label: '删除', icon: <DeleteIcon /> },
    { action: 'copy', label: '复制', icon: <CopyIcon /> },
    { action: 'cut', label: '剪切', icon: <CutIcon />, divider: true },
    { action: 'addBefore', label: '在上方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
    { action: 'addAfter', label: '在下方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
  ],
  'ne-h4': () => [
    { action: 'convert', label: '转化为', icon: <ConvertIcon />, hasSubmenu: true, submenu: getConvertSubmenu() },
    { action: 'delete', label: '删除', icon: <DeleteIcon /> },
    { action: 'copy', label: '复制', icon: <CopyIcon /> },
    { action: 'cut', label: '剪切', icon: <CutIcon />, divider: true },
    { action: 'addBefore', label: '在上方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
    { action: 'addAfter', label: '在下方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
  ],
  'ne-h5': () => [
    { action: 'convert', label: '转化为', icon: <ConvertIcon />, hasSubmenu: true, submenu: getConvertSubmenu() },
    { action: 'delete', label: '删除', icon: <DeleteIcon /> },
    { action: 'copy', label: '复制', icon: <CopyIcon /> },
    { action: 'cut', label: '剪切', icon: <CutIcon />, divider: true },
    { action: 'addBefore', label: '在上方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
    { action: 'addAfter', label: '在下方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
  ],
  'ne-h6': () => [
    { action: 'convert', label: '转化为', icon: <ConvertIcon />, hasSubmenu: true, submenu: getConvertSubmenu() },
    { action: 'delete', label: '删除', icon: <DeleteIcon /> },
    { action: 'copy', label: '复制', icon: <CopyIcon /> },
    { action: 'cut', label: '剪切', icon: <CutIcon />, divider: true },
    { action: 'addBefore', label: '在上方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
    { action: 'addAfter', label: '在下方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
  ],
  // 引用块
  'ne-quote': () => [
    { action: 'convert', label: '转化为', icon: <ConvertIcon />, hasSubmenu: true, submenu: getConvertSubmenu() },
    { action: 'delete', label: '删除', icon: <DeleteIcon /> },
    { action: 'copy', label: '复制', icon: <CopyIcon /> },
    { action: 'cut', label: '剪切', icon: <CutIcon />, divider: true },
    { action: 'addBefore', label: '在上方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
    { action: 'addAfter', label: '在下方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
  ],
  // 无序列表项
  'ne-uli': () => [
    { action: 'convert', label: '转化为', icon: <ConvertIcon />, hasSubmenu: true, submenu: getConvertSubmenu() },
    { action: 'delete', label: '删除', icon: <DeleteIcon /> },
    { action: 'copy', label: '复制', icon: <CopyIcon /> },
    { action: 'cut', label: '剪切', icon: <CutIcon />, divider: true },
    { action: 'indent', label: '缩进', icon: <IndentIcon />, hasSubmenu: true, submenu: getIndentSubmenu() },
    { action: 'addAfter', label: '在下方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
  ],
  // 有序列表项
  'ne-oli': () => [
    { action: 'convert', label: '转化为', icon: <ConvertIcon />, hasSubmenu: true, submenu: getConvertSubmenu() },
    { action: 'delete', label: '删除', icon: <DeleteIcon /> },
    { action: 'copy', label: '复制', icon: <CopyIcon /> },
    { action: 'cut', label: '剪切', icon: <CutIcon />, divider: true },
    { action: 'indent', label: '缩进', icon: <IndentIcon />, hasSubmenu: true, submenu: getIndentSubmenu() },
    { action: 'addAfter', label: '在下方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
  ],
  // 任务列表项
  'ne-tli': () => [
    { action: 'convert', label: '转化为', icon: <ConvertIcon />, hasSubmenu: true, submenu: getConvertSubmenu() },
    { action: 'delete', label: '删除', icon: <DeleteIcon /> },
    { action: 'copy', label: '复制', icon: <CopyIcon /> },
    { action: 'cut', label: '剪切', icon: <CutIcon />, divider: true },
    { action: 'indent', label: '缩进', icon: <IndentIcon />, hasSubmenu: true, submenu: getIndentSubmenu() },
    { action: 'addAfter', label: '在下方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
  ],
  // 卡片
  'ne-card': () => [
    { action: 'delete', label: '删除', icon: <DeleteIcon /> },
    { action: 'copy', label: '复制', icon: <CopyIcon /> },
    { action: 'cut', label: '剪切', icon: <CutIcon />, divider: true },
    { action: 'duplicate', label: '复制卡片', icon: <CopyIcon /> },
    { action: 'addBefore', label: '在上方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
    { action: 'addAfter', label: '在下方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
  ],
  // 代码块
  'ne-codeblock': () => [
    { action: 'convert', label: '转化为', icon: <ConvertIcon />, hasSubmenu: true, submenu: getConvertSubmenu() },
    { action: 'delete', label: '删除', icon: <DeleteIcon /> },
    { action: 'copy', label: '复制代码', icon: <CopyIcon /> },
    { action: 'cut', label: '剪切', icon: <CutIcon />, divider: true },
    { action: 'addBefore', label: '在上方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
    { action: 'addAfter', label: '在下方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
  ],
  // 分割线
  'ne-hr': () => [
    { action: 'convert', label: '转化为', icon: <ConvertIcon />, hasSubmenu: true, submenu: getConvertSubmenu() },
    { action: 'delete', label: '删除', icon: <DeleteIcon /> },
    { action: 'addBefore', label: '在上方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
    { action: 'addAfter', label: '在下方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
  ],
  // 图片
  'ne-image': () => [
    { action: 'delete', label: '删除', icon: <DeleteIcon /> },
    { action: 'copy', label: '复制图片', icon: <CopyIcon /> },
    { action: 'cut', label: '剪切', icon: <CutIcon />, divider: true },
    { action: 'addBefore', label: '在上方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
    { action: 'addAfter', label: '在下方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
  ],
  // 表格
  'ne-table': () => [
    { action: 'delete', label: '删除表格', icon: <DeleteIcon /> },
    { action: 'copy', label: '复制表格', icon: <CopyIcon /> },
    { action: 'cut', label: '剪切', icon: <CutIcon />, divider: true },
    { action: 'addBefore', label: '在上方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
    { action: 'addAfter', label: '在下方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
  ],
  // 容器（高亮块 / 分栏 / 折叠块）——与引用同族：可「转化为」其它块
  'ne-alert-hole': () => [
    { action: 'convert', label: '转化为', icon: <ConvertIcon />, hasSubmenu: true, submenu: getConvertSubmenu() },
    { action: 'delete', label: '删除', icon: <DeleteIcon /> },
    { action: 'copy', label: '复制', icon: <CopyIcon /> },
    { action: 'cut', label: '剪切', icon: <CutIcon />, divider: true },
    { action: 'addBefore', label: '在上方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
    { action: 'addAfter', label: '在下方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
  ],
  'ne-container-hole': () => [
    { action: 'convert', label: '转化为', icon: <ConvertIcon />, hasSubmenu: true, submenu: getConvertSubmenu() },
    { action: 'delete', label: '删除', icon: <DeleteIcon /> },
    { action: 'copy', label: '复制', icon: <CopyIcon /> },
    { action: 'cut', label: '剪切', icon: <CutIcon />, divider: true },
    { action: 'addBefore', label: '在上方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
    { action: 'addAfter', label: '在下方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
  ],
  // 默认菜单：**只保留基础项**（不给「转化为」）——未知/图表类块硬转没有意义，
  // 需要「转化为」的块类型必须显式登记（p/h/quote/list/codeblock/容器等）。
  'default': () => [
    { action: 'delete', label: '删除', icon: <DeleteIcon /> },
    { action: 'copy', label: '复制', icon: <CopyIcon /> },
    { action: 'cut', label: '剪切', icon: <CutIcon />, divider: true },
    { action: 'indent', label: '缩进', icon: <IndentIcon />, hasSubmenu: true, submenu: getIndentSubmenu() },
    { action: 'addAfter', label: '在下方添加', icon: <AddIcon />, hasSubmenu: true, submenu: getAddSubmenu() },
  ],
};

/**
 * 解析块菜单 key：卡片按 **data-card-name** 细分（`ne-card:<name>`），其余按标签。
 * 这样不同卡片种类可给不同菜单（图表类默认落在 `ne-card` 的基础菜单 = 无「转化为」）；
 * 需要给某类卡片单独配菜单时，直接在 MENU_CONFIGS 里加 `'ne-card:<name>'` 即可。
 */
function getBlockMenuKey(blockType: string, blockElement: HTMLElement | null): string {
  const el = blockElement;
  if (!el) return blockType;
  const tag = (el.tagName || '').toLowerCase();
  // 块卡（代码块/分割线/图表…）DOM 里是 ne-card 包在 ne-hole 内，菜单要按内部卡片名区分，
  // 否则所有块卡都命中通用菜单，图表类也会错误出现「转化为」。
  const isCardHost = tag === 'ne-card' || tag === 'ne-hole';
  const card = isCardHost ? (tag === 'ne-card' ? el : el.querySelector('ne-card')) : null;
  if (card) {
    const name = card.getAttribute('data-card-name') || 'unknown';
    // 已知可「转化为」的卡片映射到既有配置；其余（图表/自定义/未名）走 ne-card 基础菜单（无「转化为」）。
    const alias: Record<string, string> = { codeblock: 'ne-codeblock', hr: 'ne-hr' };
    return alias[name] || 'ne-card';
  }
  return blockType;
}

/** "转化为" 子菜单 */
function getConvertSubmenu(fromType?: string): MenuItem[] {
  return [
    // LOCAL-CHANGE(261004)：第一级图标网格里「正文」放首位，与云端菜单的「T H1…H6」顺序一致。
    { action: 'convert', label: '正文', value: 'p', icon: <TextIcon /> },
    { action: 'convert', label: 'H1', value: 'h1', icon: getHeadingIcon("h1"), selected: fromType === 'ne-h1' },
    { action: 'convert', label: 'H2', value: 'h2', icon: <H2Icon />, selected: fromType === 'ne-h2' },
    { action: 'convert', label: 'H3', value: 'h3', icon: <H3Icon />, selected: fromType === 'ne-h3' },
    { action: 'convert', label: 'H4', value: 'h4', icon: <H4Icon />, selected: fromType === 'ne-h4' },
    { action: 'convert', label: 'H5', value: 'h5', icon: <H5Icon />, selected: fromType === 'ne-h5' },
    { action: 'convert', label: 'H6', value: 'h6', icon: <H6Icon />, selected: fromType === 'ne-h6' },
    { action: 'convert', label: '有序', value: 'ol', icon: <OrderedListIcon /> },
    { action: 'convert', label: '无序', value: 'ul', icon: <ListIcon /> },
    { action: 'convert', label: '任务', value: 'taskList', icon: <TaskIcon /> },
    // 说明：本项要用 insertCard 落卡（非 style/替换），文本保留情况已知待查（见 docs/LAKEX-CONTRACT.md §5.8）。
    { action: 'convert', label: '代码', value: 'codeblock', icon: <CodeIcon /> },
    { action: 'convert', label: '高亮块', value: 'callout', icon: <CalloutIcon /> },
    { action: 'convert', label: '引用', value: 'quote', icon: <QuoteIcon /> },
    { action: 'convert', label: '分栏', value: 'columns', icon: <ColumnsIcon /> },
    { action: 'convert', label: '折叠块', value: 'collapse', icon: <CollapseIcon /> },
  ];
}

/** "缩进" 子菜单 */
function getIndentSubmenu(): MenuItem[] {
  return [
    { action: 'indent', label: '增加缩进', icon: <IndentIcon /> },
    { action: 'outdent', label: '减少缩进', icon: <OutdentIcon /> },
  ];
}

/** "在下方/上方添加" 子菜单 */
function getAddSubmenu(): MenuItem[] {
  return [
    { action: 'addAfter', label: '段落', value: 'p', icon: <ParagraphIcon /> },
    { action: 'addAfter', label: '标题 1', value: 'h1', icon: <H1Icon /> },
    { action: 'addAfter', label: '标题 2', value: 'h2', icon: <H2Icon /> },
    { action: 'addAfter', label: '标题 3', value: 'h3', icon: <H3Icon /> },
    { action: 'addAfter', label: '引用', value: 'quote', icon: <QuoteIcon /> },
    { action: 'addAfter', label: '代码块', value: 'codeblock', icon: <CodeIcon /> },
    { action: 'addAfter', label: '分割线', value: 'hr', icon: <DividerIcon /> },
  ];
}

function YuqueIcon({ id }: { id: string }) {
  return (
    <svg className="ne-block-yuque-icon" aria-hidden="true">
      <use href={`#${id}`} xlinkHref={`#${id}`} />
    </svg>
  );
}

function getConvertOptionIcon(value: string | undefined, dark: boolean): React.ReactNode {
  const compactIcons: Record<string, string> = {
    h1: 'icon-editor-h1',
    h2: 'icon-editor-h2',
    h3: 'icon-editor-h3',
    h4: 'icon-editor-h4',
    h5: 'icon-editor-h5',
    h6: 'icon-editor-h6',
    p: 'icon-editor-paragraph',
    ol: 'icon-editor-orderedList',
    ul: 'icon-editor-unorderedList',
    taskList: 'icon-editor-taskList',
    codeblock: 'icon-editor-codeblock',
  };
  const cardIcons: Record<string, string> = {
    callout: `icon-高亮块${dark ? '' : '-light'}`,
    quote: `icon-引用${dark ? '' : '-light'}`,
    columns: `icon-分栏${dark ? '' : '-light'}`,
    collapse: `icon-折叠块${dark ? '' : '-light'}`,
  };
  const id = (value && (compactIcons[value] || cardIcons[value])) || '';
  return id ? <YuqueIcon id={id} /> : null;
}

function getCurrentConvertValue(
  blockType: string,
  blockElement: HTMLElement | null,
): string | undefined {
  // Lakex 某些版本会把三种列表的外层都渲染为 ne-tli，真实类型需以内层的 oli/uli/tli 标记为准。
  // ⚠️ LOCAL-CHANGE(261004)：只在**块自身是列表项**时下探 —— 引用 / 高亮块 / 分栏内部也含列表，
  // 原先无条件 querySelector 会把「含列表的引用」误判成 ol/ul（实测：引用第一行手柄的「转化为」
  // 回显成了「有序」，于是点「引用」不会取消引用，反而又包一层）。
  const tagName = (blockElement?.tagName || '').toUpperCase();
  const isListItem = tagName === 'NE-ULI' || tagName === 'NE-OLI' || tagName === 'NE-TLI';
  if (blockElement && isListItem) {
    if (blockElement.matches('ne-oli') || blockElement.querySelector('ne-oli-i, ne-oli-c')) {
      return 'ol';
    }
    if (blockElement.matches('ne-uli') || blockElement.querySelector('ne-uli-i, ne-uli-c')) {
      return 'ul';
    }
    if (blockElement.matches('ne-tli') || blockElement.querySelector('ne-tli-i, ne-tli-c')) {
      return 'taskList';
    }
  }

  const directValues: Record<string, string> = {
    'ne-p': 'p',
    'ne-h1': 'h1',
    'ne-h2': 'h2',
    'ne-h3': 'h3',
    'ne-h4': 'h4',
    'ne-h5': 'h5',
    'ne-h6': 'h6',
    'ne-quote': 'quote',
    'ne-codeblock': 'codeblock',
    'ne-alert': 'callout',
    'ne-alert-hole': 'callout',
    'ne-columns': 'columns',
    'ne-collapse': 'collapse',
  };
  if (directValues[blockType]) return directValues[blockType];

  if (
    blockType === 'ne-hole'
    && blockElement
    && (
      blockElement.getAttribute('data-card') === 'codeblock'
      || blockElement.querySelector('ne-card[data-card-name="codeblock"]')
    )
  ) {
    return 'codeblock';
  }

  if (blockType === 'ne-container-hole' && blockElement) {
    if (blockElement.querySelector('ne-columns')) return 'columns';
    if (blockElement.querySelector('ne-collapse')) return 'collapse';
  }
  return undefined;
}

// ========== SVG 图标组件 ==========
// AI
function AIIcon() {
  return (
    <svg width="16px" height="16px" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
      <path d="M128 17c61.304 0 111 49.696 111 111s-49.696 111-111 111H51c-18.778 0-34-15.222-34-34v-77C17 66.696 66.696 17 128 17Zm0 20c-50.258 0-91 40.742-91 91v77c0 7.732 6.268 14 14 14h77c50.258 0 91-40.742 91-91s-40.742-91-91-91ZM99.805 75.308a12 12 0 0 1 8.23 8.23l24.578 85.79c1.521 5.309-1.55 10.846-6.859 12.367-5.31 1.52-10.846-1.55-12.367-6.86l-3.47-12.109H83.082l-3.469 12.11c-1.495 5.219-6.871 8.275-12.097 6.932l-.27-.073c-5.31-1.521-8.38-7.058-6.86-12.368L84.965 83.54c1.825-6.371 8.47-10.057 14.84-8.231ZM173 75c5.523 0 10 4.477 10 10 0 5.355-4.209 9.727-9.499 9.988L173.5 161.5c0 .172-.004.343-.013.513 5.297.253 9.513 4.627 9.513 9.987 0 5.523-4.477 10-10 10h-20c-5.523 0-10-4.477-10-10s4.477-10 10-10l.512.001a10.166 10.166 0 0 1-.012-.501V95h-.5c-5.523 0-10-4.477-10-10s4.477-10 10-10h20Zm-76.5 40.892-7.688 26.834h15.376L96.5 115.892Z" fill="currentColor" fillRule="nonzero"></path>
    </svg>
  )
}

// 转化为
function ConvertIcon() {
  return (
    <svg width="16px" height="16px" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg" >
      <path d="m66.77 130.998 25.42 6.812c5.334 1.429 8.5 6.912 7.07 12.247-1.429 5.335-6.912 8.5-12.247 7.071l-21.17-5.672C75.695 180.568 103.246 201 135 201c25.226 0 48.234-12.886 61.569-33.76 2.973-4.654 9.157-6.017 13.81-3.043 4.655 2.973 6.017 9.156 3.044 13.81C196.451 204.574 167.123 221 135 221c-39.108 0-73.2-24.314-86.77-59.453l-6.13 22.887c-1.43 5.335-6.914 8.5-12.248 7.071-5.335-1.43-8.5-6.913-7.071-12.247l7.247-27.046c4.288-16.004 20.738-25.502 36.742-21.214ZM122 35c38.662 0 72.359 23.75 86.25 58.135l5.501-20.538c1.43-5.335 6.913-8.5 12.248-7.071 5.334 1.43 8.5 6.913 7.07 12.247l-6.729 25.114c-4.288 16.004-20.738 25.502-36.742 21.213l-23.555-6.311c-5.335-1.43-8.5-6.913-7.071-12.248 1.429-5.334 6.912-8.5 12.247-7.07l19.66 5.266C180.809 75.094 153.499 55 122 55c-26.405 0-50.336 14.129-63.29 36.594-2.759 4.784-8.874 6.426-13.658 3.668-4.785-2.76-6.427-8.874-3.668-13.659C57.874 53.006 88.373 35 122 35Z" fill="currentColor" fillRule="nonzero"></path>
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 1024 1024" fill="none">
      <path d="M872 272a40 40 0 1 1 0 80h-66.24l-24.64 431.744A136 136 0 0 1 655.04 911.68l-9.728.32H378.688A136 136 0 0 1 242.88 783.744L218.24 352H152a40 40 0 1 1 0-80h720zm-146.368 80H298.304l24.448 427.2a56 56 0 0 0 49.152 52.416l6.784.384h266.624a56 56 0 0 0 55.936-52.8L725.632 352zM432 448c22.08 0 40 17.92 40 40v176a40 40 0 1 1-80 0V488c0-22.08 17.92-40 40-40zm160 0c22.08 0 40 17.92 40 40v176a40 40 0 1 1-80 0V488c0-22.08 17.92-40 40-40zm104-336a40 40 0 1 1 0 80H328a40 40 0 1 1 0-80h368z" fill="currentColor"></path>
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 256 256" fill="none">
      <g fill="none" fillRule="evenodd" stroke="currentColor" strokeWidth="20"><rect x="98" y="38" width="120" height="120" rx="20"></rect><path d="M158 157.295V198c0 11.046-8.954 20-20 20H58c-11.046 0-20-8.954-20-20v-80c0-11.046 8.954-20 20-20h39.6"></path></g>
    </svg>
  );
}

function CutIcon() {
  return (
    <svg width="16px" height="16px" viewBox="0 0 1024 1024" fill="currentColor">
      <path d="M891.257 825.643C901.373 835.76 894.26 853 880 853h-90.6a15.87 15.87 0 0 1-11.264-4.65L510.502 580.03l-80.334 80.601C441.812 683.161 448 708.151 448 734c0 88.318-71.682 160-160 160s-160-71.682-160-160 71.682-160 160-160c26.357 0 51.758 6.38 74.494 18.383l80.208-80.386-80.111-80.378C339.855 443.62 314.456 450 288.1 450c-88.318 0-160-71.682-160-160s71.682-160 160-160 160 71.682 160 160c0 25.848-6.188 50.84-17.832 73.369l80.334 80.6 267.559-268.243c2.93-3.072 7.092-4.726 11.339-4.726H880c14.245 0 21.285 17.33 11.264 27.35L578.4 512l312.857 313.643zM288 370c44.1 0 80-35.9 80-80s-35.9-80-80-80-80 35.9-80 80 35.9 80 80 80zm0 444c44.1 0 80-35.9 80-80s-35.9-80-80-80-80 35.9-80 80 35.9 80 80 80z"></path>
    </svg>
  );
}

function IndentIcon() {
  return (
    <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="16" height="16" >
      <path d="M872 594c22.092 0 40 17.908 40 40 0 21.72-17.308 39.392-38.88 39.984L872 674H444c-22.092 0-40-17.908-40-40 0-21.72 17.308-39.392 38.88-39.984L444 594h428zm0-240c22.092 0 40 17.908 40 40 0 21.72-17.308 39.392-38.88 39.984L872 434H444c-22.092 0-40-17.908-40-40 0-21.72 17.308-39.392 38.88-39.984L444 354h428zm0-242c22.092 0 40 17.908 40 40 0 21.72-17.308 39.392-38.88 39.984L872 192H152c-22.092 0-40-17.908-40-40 0-21.72 17.308-39.392 38.88-39.984L152 112h720zm0 722c22.092 0 40 17.908 40 40 0 21.72-17.308 39.392-38.88 39.984L872 914H152c-22.092 0-40-17.908-40-40 0-21.72 17.308-39.392 38.88-39.984L152 834h720zM158.4 362.36l123.12 121.232a25.752 25.752 0 0 1 0 36.816L158.4 641.64c-10.328 10.164-27.068 10.164-37.392 0a25.832 25.832 0 0 1-7.744-18.408V380.768c0-14.38 11.84-26.036 26.44-26.036a26.648 26.648 0 0 1 18.696 7.628z" fill="currentColor"></path>
    </svg>
  );
}

function OutdentIcon() {
  return (
    <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="16" height="16" >
      <path d="M872 594c22.092 0 40 17.908 40 40 0 21.72-17.308 39.392-38.88 39.984L872 674H444c-22.092 0-40-17.908-40-40 0-21.72 17.308-39.392 38.88-39.984L444 594h428zm0-240c22.092 0 40 17.908 40 40 0 21.72-17.308 39.392-38.88 39.984L872 434H444c-22.092 0-40-17.908-40-40 0-21.72 17.308-39.392 38.88-39.984L444 354h428zm0-242c22.092 0 40 17.908 40 40 0 21.72-17.308 39.392-38.88 39.984L872 192H152c-22.092 0-40-17.908-40-40 0-21.72 17.308-39.392 38.88-39.984L152 112h720zm0 722c22.092 0 40 17.908 40 40 0 21.72-17.308 39.392-38.88 39.984L872 914H152c-22.092 0-40-17.908-40-40 0-21.72 17.308-39.392 38.88-39.984L152 834h720zM244.128 362.36l-123.12 121.232a25.752 25.752 0 0 0 0 36.816l123.12 121.232c10.328 10.164 27.068 10.164 37.392 0a25.832 25.832 0 0 0 7.744-18.408V380.768c0-14.38-11.84-26.036-26.44-26.036a26.648 26.648 0 0 0-18.696 7.628z" fill="currentColor"></path>
    </svg>
  );
}

function AddIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function ParagraphIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 3h10M3 7h10M3 11h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function getHeadingIcon(heading: string) {
  return <svg width="16" height="16" aria-hidden="true"><use xlinkHref={`#icon-editor-${heading}`}></use></svg>
}

function H1Icon() {
  return (
    <svg width="16" height="16" viewBox="0 0 256 256" fill="none">
      <path d="M119.4 221.64c3.467-.173 6.023-1.213 7.67-3.12 1.647-1.907 2.47-4.333 2.47-7.28V48.48c0-2.947-.867-5.373-2.6-7.28s-4.333-2.86-7.8-2.86c-3.813 0-6.457.91-7.93 2.73-1.473 1.82-2.21 4.29-2.21 7.41v70.2H43.84v-70.2c0-2.947-.823-5.373-2.47-7.28-1.647-1.907-4.203-2.86-7.67-2.86-3.467 0-6.067.953-7.8 2.86-1.733 1.907-2.6 4.333-2.6 7.28v162.76c0 2.947.867 5.417 2.6 7.41 1.733 1.993 4.333 2.99 7.8 2.99 3.467-.173 6.023-1.213 7.67-3.12 1.647-1.907 2.47-4.333 2.47-7.28v-74.88H109v74.88c0 2.947.867 5.417 2.6 7.41 1.733 1.993 4.333 2.99 7.8 2.99Zm79-140.94c7.56 0 11.7 3.247 11.7 9.5l-.001 116.799L219 207a8 8 0 1 1 0 16h-38a8 8 0 1 1 0-16l10.699-.001V99.1H184.2c-2.507 0-4.415-.523-5.684-1.671l-.177-.168c-1.295-1.296-1.839-3.627-1.839-7.061 0-3.413.62-5.853 2.008-7.328 1.384-1.471 3.445-2.172 6.092-2.172Z"
		fill="currentColor" fillRule="evenodd">
		</path>
    </svg>
  );
}

function H2Icon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <text x="1" y="13" fontSize="11" fontWeight="bold" fill="currentColor" fontFamily="sans-serif">H2</text>
    </svg>
  );
}

function H3Icon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <text x="1" y="13" fontSize="10" fontWeight="bold" fill="currentColor" fontFamily="sans-serif">H3</text>
    </svg>
  );
}

function H4Icon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <text x="1" y="13" fontSize="10" fontWeight="bold" fill="currentColor" fontFamily="sans-serif">H4</text>
    </svg>
  );
}

function H5Icon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <text x="1" y="13" fontSize="10" fontWeight="bold" fill="currentColor" fontFamily="sans-serif">H5</text>
    </svg>
  );
}

function H6Icon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <text x="1" y="13" fontSize="10" fontWeight="bold" fill="currentColor" fontFamily="sans-serif">H6</text>
    </svg>
  );
}

function TextIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 3h10M8 3v10M5.5 13h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}

function QuoteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 9c0-2 1-3 3-3v2c-.5 0-1 .5-1 1s.5 1 1 1v2c-2 0-3-1-3-3zM9 9c0-2 1-3 3-3v2c-.5 0-1 .5-1 1s.5 1 1 1v2c-2 0-3-1-3-3z" fill="currentColor"/>
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="4" cy="4" r="1.2" fill="currentColor"/>
      <circle cx="4" cy="8" r="1.2" fill="currentColor"/>
      <circle cx="4" cy="12" r="1.2" fill="currentColor"/>
      <path d="M7 4h6M7 8h6M7 12h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function OrderedListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <text x="2" y="5.5" fontSize="7" fill="currentColor" fontFamily="sans-serif">1</text>
      <text x="2" y="9.5" fontSize="7" fill="currentColor" fontFamily="sans-serif">2</text>
      <text x="2" y="13.5" fontSize="7" fill="currentColor" fontFamily="sans-serif">3</text>
      <path d="M7 4h6M7 8h6M7 12h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function TaskIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2.5" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M4.5 7.5l2 2 4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M7 7h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M5 3L2 8l3 5M11 3l3 5-3 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function DividerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 8h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function CalloutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M5 7h6M5 10h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function ColumnsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="1.5" stroke="currentColor" strokeWidth="1.1"/>
      <path d="M8 2.5v11" stroke="currentColor" strokeWidth="1.1"/>
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="1.5" stroke="currentColor" strokeWidth="1.1"/>
      <path d="M5.5 5.2L8 7.7l-2.5 2.5M9.5 5.2h2.2M9.5 8h2.2M9.5 10.8h2.2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
      <circle cx="5.5" cy="6.5" r="1.5" fill="currentColor"/>
      <path d="M2 12l3.5-3.5L8 11l2.5-3L14 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function TableIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M2 6.5h12M2 10h12M6.5 3v10" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  );
}

function AiOutlineIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13z" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M5 10l1.4-4h1.2L9 10M5.5 8.5h3M10.5 6v4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export interface BlockContextMenuProps {
  /** 是否显示 */
  visible: boolean;
  /** 菜单位置 */
  position: { x: number; y: number };
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
  onAction?: (action: BlockMenuAction, data: { blockElement: HTMLElement; blockType: string; payload?: string }) => void;
}

export function BlockContextMenu({
  visible,
  position,
  blockType,
  blockElement,
  editor,
  language = 'zh-cn',
  dark = false,
  onClose,
  onAction,
}: BlockContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const submenuRef = useRef<HTMLDivElement>(null);

  // 获取当前块类型的菜单配置
  const getMenuItems = useCallback((): MenuItem[] => {
    const menuKey = getBlockMenuKey(blockType, blockElement);
    const config = MENU_CONFIGS[menuKey] || MENU_CONFIGS[blockType] || MENU_CONFIGS['default'];
    const configured = typeof config === 'function' ? config() : config;
    const currentConvertValue = getCurrentConvertValue(blockType, blockElement);
    const items: MenuItem[] = configured
      // “在上方添加”暂不展示；所有块统一只保留“在下方添加”入口。
      // LOCAL-CHANGE: 再按 SAFE_BLOCK_ACTIONS 收敛到「内核原生命令」动作（见该常量注释）。
      .filter((item) => (
        SAFE_BLOCK_ACTION_SET.has(item.action)
        && item.action !== 'addBefore'
        && (item.action !== 'convert' || currentConvertValue !== undefined)
      ))
      .map((item) => ({
        ...item,
        submenu: item.submenu?.map((subItem) => ({ ...subItem })),
      }));

    const convertIndex = items.findIndex((item) => item.action === 'convert');
    if (convertIndex >= 0) {
      // LOCAL-CHANGE(261004)：引用内部的块按云端裁剪「转化为」（见 QUOTE_HIDDEN_CONVERT_VALUES）。
      const inQuote = isInsideQuote(blockElement);
      items[convertIndex].submenu = items[convertIndex].submenu
        ?.filter((subItem) => !(inQuote && QUOTE_HIDDEN_CONVERT_VALUES.has(subItem.value ?? '')))
        .map((subItem) => ({
          ...subItem,
          icon: getConvertOptionIcon(subItem.value, dark),
          selected: subItem.value === currentConvertValue,
        }));
    }

    // LOCAL-CHANGE(261005)：所有块顶部统一注入「AI 助手」（宿主经 BlockHoverHandle 的
    // onBlockAction 接入自己的 AI 服务）。云端 Lake 只把它给标题用（即上面的「大纲写作法」），
    // 本项目按用户要求对所有块开放；这里只注入菜单项，动作本身不在 vendor 实现。
    items.unshift({ action: 'aiOutline', label: 'AI 助手', icon: <AiOutlineIcon />, divider: true });

    // LOCAL-CHANGE: 不再注入「复制链接」（云端块菜单里没有它，且它不在 SAFE_BLOCK_ACTIONS 内）。

    if (language !== 'en-us') return items;

    const labels: Record<string, string> = {
      '转化为': 'Turn into',
      '大纲写作法': 'AI outline',
      'AI 助手': 'AI assistant',   // LOCAL-CHANGE(261005)：注入项的英文标签
      '删除': 'Delete',
      '删除表格': 'Delete table',
      '复制': 'Copy',
      '复制代码': 'Copy code',
      '复制图片': 'Copy image',
      '复制表格': 'Copy table',
      '剪切': 'Cut',
      '缩进': 'Indent',
      '增加缩进': 'Increase indent',
      '减少缩进': 'Decrease indent',
      '复制链接': 'Copy link',
      '复制卡片': 'Duplicate card',
      '在上方添加': 'Add above',
      '在下方添加': 'Add below',
      '段落': 'Paragraph',
      '正文': 'Text',
      '有序': 'Numbered',
      '无序': 'Bulleted',
      '任务': 'Task',
      '代码': 'Code',
      '标题 1': 'Heading 1',
      '标题 2': 'Heading 2',
      '标题 3': 'Heading 3',
      '引用': 'Quote',
      '无序列表': 'Bulleted list',
      '有序列表': 'Numbered list',
      '任务列表': 'Task list',
      '代码块': 'Code block',
      '分割线': 'Divider',
      '高亮块': 'Callout',
      '分栏': 'Columns',
      '折叠块': 'Toggle',
    };

    return items.map((item) => ({
      ...item,
      label: labels[item.label] || item.label,
      submenu: item.submenu?.map((subItem) => ({
        ...subItem,
        label: labels[subItem.label] || subItem.label,
      })),
    }));
  }, [blockType, blockElement, dark, language]);

  useEffect(() => {
    if (visible) setActiveSubmenu(null);
  }, [visible, blockType]);

  // 点击外部关闭
  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    // 延迟绑定，避免右键事件立即触发关闭
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }, 10);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [visible, onClose]);

  // 调整菜单位置防止溢出屏幕
  useEffect(() => {
    if (!visible || !menuRef.current) return;

    const rect = menuRef.current.getBoundingClientRect();
    const { innerWidth, innerHeight } = window;

    let adjustedX = position.x;
    let adjustedY = position.y;

    if (position.x + rect.width > innerWidth - 8) {
      adjustedX = innerWidth - rect.width - 8;
    }
    if (position.y + rect.height > innerHeight - 8) {
      adjustedY = innerHeight - rect.height - 8;
    }

    menuRef.current.style.left = `${adjustedX}px`;
    menuRef.current.style.top = `${adjustedY}px`;
  }, [visible, position]);

  useLayoutEffect(() => {
    const submenu = submenuRef.current;
    if (!visible || !activeSubmenu || !submenu) return;

    const parentRect = submenu.parentElement?.getBoundingClientRect();
    if (parentRect) {
      const triggerCenterY = parentRect.top + parentRect.height / 2;
      const centeredHeight = Math.max(
        80,
        2 * Math.min(triggerCenterY - 8, window.innerHeight - 8 - triggerCenterY),
      );

      if (submenu.classList.contains('ne-block-card-select-submenu')) {
        // 原生卡片内容负责滚动，外层只限制可居中的可视高度。
        submenu.style.height = `${Math.min(600, centeredHeight)}px`;
      } else {
        submenu.style.maxHeight = `${Math.min(520, centeredHeight)}px`;
      }

      const rect = submenu.getBoundingClientRect();
      submenu.style.left = rect.right > window.innerWidth - 8 ? 'auto' : '100%';
      submenu.style.right = rect.right > window.innerWidth - 8 ? '100%' : 'auto';

      // 触发行中心线与二级弹窗中心线对齐。
      const centeredViewportTop = triggerCenterY - rect.height / 2;
      const maxViewportTop = Math.max(8, window.innerHeight - rect.height - 8);
      const viewportTop = Math.max(8, Math.min(centeredViewportTop, maxViewportTop));
      submenu.style.top = `${viewportTop - parentRect.top}px`;
      submenu.style.bottom = 'auto';
    }
  }, [visible, activeSubmenu]);

  const handleItemClick = useCallback((item: MenuItem) => {
    if (item.disabled) return;

    if (item.hasSubmenu && item.submenu) {
      // 切换子菜单
      setActiveSubmenu(prev => prev === item.action ? null : item.action);
      return;
    }

    // 执行动作
    onAction?.(item.action, {
      blockElement: blockElement!,
      blockType,
      payload: item.value ?? item.label,
    });
    onClose();
  }, [onAction, blockElement, blockType, onClose]);

  const handleSubmenuItemClick = useCallback((parentAction: BlockMenuAction, subItem: MenuItem) => {
    if (subItem.disabled) return;

    const action = parentAction === 'indent' ? subItem.action : parentAction;
    onAction?.(action, {
      blockElement: blockElement!,
      blockType,
      payload: subItem.value ?? subItem.label,
    });
    onClose();
  }, [onAction, blockElement, blockType, onClose]);

  if (!visible) return null;

  const items = getMenuItems();

  return (
    <div
      ref={menuRef}
      className={`ne-block-context-menu${dark ? ' ne-block-context-menu--dark' : ''}`}
      role="menu"
      aria-label={language === 'en-us' ? 'Block actions' : '块操作'}
      onMouseDown={(event) => event.preventDefault()}
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      <div className="ne-block-context-menu-inner">
        {items.map((item, index) => {
          const isActive = activeSubmenu === item.action;
          const hasSubmenu = item.hasSubmenu && item.submenu;
          // LOCAL-CHANGE: 去掉「在下方添加」的 CardSelect 插卡路径——它走 utils/blockDoc.insertBlock
          // 的整篇 JSON 读改写（实测会毁自定义卡），云端块菜单也没有这个入口；现在是普通子菜单。
          const hasFlyout = Boolean(hasSubmenu);

          // LOCAL-CHANGE(261004)：把「转化为」子菜单**整体内联到第一级**，并**沿用原样式**
          // （6 列网格：正文/标题/列表 = 紧凑图标格；高亮块/引用/分栏/折叠块 = 图标 + 文字卡片格）。
          if (item.action === 'convert' && item.submenu) {
            return (
              <React.Fragment key={`convert-${index}`}>
                <div className="ne-block-convert-submenu ne-block-convert-inline" role="group" aria-label={item.label}>
                  {item.submenu.map((subItem, subIndex) => {
                    const convertPresentation = CARD_CONVERT_VALUES.has(subItem.value ?? '') ? 'card' : 'compact';
                    return (
                      <div
                        key={`${subItem.action}-${subIndex}`}
                        className={[
                          'ne-block-menu-item',
                          subItem.disabled ? 'disabled' : '',
                          subItem.selected ? 'selected' : '',
                          'ne-block-convert-item',
                          `ne-block-convert-item--${convertPresentation}`,
                        ].filter(Boolean).join(' ')}
                        role="menuitem"
                        aria-label={subItem.label}
                        aria-disabled={subItem.disabled || undefined}
                        aria-current={subItem.selected ? 'true' : undefined}
                        title={convertPresentation === 'compact' ? subItem.label : undefined}
                        tabIndex={subItem.disabled ? -1 : 0}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleSubmenuItemClick('convert', subItem);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            event.stopPropagation();
                            handleSubmenuItemClick('convert', subItem);
                          }
                        }}
                      >
                        <span className="ne-block-menu-icon">{subItem.icon}</span>
                        <span className="ne-block-menu-label">{subItem.label}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="ne-block-menu-divider" role="separator" />
              </React.Fragment>
            );
          }

          return (
            <React.Fragment key={`${item.action}-${index}`}>
              <div
                className={`ne-block-menu-item ${item.disabled ? 'disabled' : ''} ${isActive ? 'active' : ''}`}
                role="menuitem"
                aria-disabled={item.disabled || undefined}
                tabIndex={item.disabled ? -1 : 0}
                onClick={() => {
                  handleItemClick(item);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleItemClick(item);
                  }
                }}
                onMouseEnter={() => {
                  if (!hasFlyout) return;
                  setActiveSubmenu(item.action);
                }}
                onMouseLeave={() => {
                  if (!hasFlyout) return;
                  setActiveSubmenu(null);
                }}
              >
                <span className="ne-block-menu-icon">{item.icon}</span>
                <span className="ne-block-menu-label">{item.label}</span>
                {hasFlyout && (
                  <span className="ne-block-menu-arrow">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </span>
                )}

                {hasSubmenu && isActive && (
                  <div
                    ref={submenuRef}
                    className={`ne-block-submenu${item.action === 'convert' ? ' ne-block-convert-submenu' : ''}`}
                    role="menu"
                  >
                    {item.submenu!.map((subItem, subIndex) => {
                      const convertPresentation = item.action === 'convert'
                        ? (CARD_CONVERT_VALUES.has(subItem.value ?? '') ? 'card' : 'compact')
                        : null;
                      return (
                        <div
                          key={`${subItem.action}-${subIndex}`}
                          className={[
                            'ne-block-menu-item',
                            subItem.disabled ? 'disabled' : '',
                            subItem.selected ? 'selected' : '',
                            convertPresentation ? 'ne-block-convert-item' : '',
                            convertPresentation ? `ne-block-convert-item--${convertPresentation}` : '',
                          ].filter(Boolean).join(' ')}
                          role="menuitem"
                          aria-label={subItem.label}
                          aria-disabled={subItem.disabled || undefined}
                          aria-current={subItem.selected ? 'true' : undefined}
                          title={convertPresentation === 'compact' ? subItem.label : undefined}
                          tabIndex={subItem.disabled ? -1 : 0}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleSubmenuItemClick(item.action, subItem);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              event.stopPropagation();
                              handleSubmenuItemClick(item.action, subItem);
                            }
                          }}
                        >
                          <span className="ne-block-menu-icon">{subItem.icon}</span>
                          <span className="ne-block-menu-label">{subItem.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {item.divider && (
                <div className="ne-block-menu-divider" role="separator" />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

export default BlockContextMenu;
