/** 在编辑器中选中某个块节点（全选其内容） */
export declare function selectBlockInEditor(editor: any, blockElement: HTMLElement): boolean;
/**
 * LOCAL-CHANGE(260917)：把一个块**作为一个整体**覆盖的顶层元素列出来。
 *
 * 云端语义「父项手柄代表整个条目（含子项）」：列表父项 = 自身 + 紧随其后、层级更深的同族项。
 * DOM 里内核把所有列表项都渲染成 `.ne-engine` 的**平级子节点**，嵌套只体现在 `ne-level`
 * （子项 level 更大），所以这里无需读整篇 JSON，纯 DOM 即可算出「父项 + 子项」区间。
 * 非列表块返回自身单元素。
 */
export declare function blockSpanElements(blockElement: HTMLElement | null): HTMLElement[];
/**
 * 选中整块（含列表子项）作为内核选区。
 * 单元素沿用 `selectBlockInEditor`（选中内容）；多元素（列表父项+子项）用跨元素 outer range，
 * 内核把它当「块选区」，`getSelectionContent` / `deleteByRange` / `insertAtSelection` 均按整段处理。
 */
export declare function selectBlockSpanInEditor(editor: any, blockElement: HTMLElement): boolean;
/**
 * LOCAL-CHANGE(260917 Issue 4)：当前 DOM 选区覆盖的顶层块（文档顺序）。
 * 用户跨块拖选时内核会同步模型选区，getSelectionContent / deleteByRange / insertAtSelection
 * 都按整个选区工作 —— 这就是内核原生的「批量」能力，无需自己逐块搬运。
 */
export declare function selectedTopBlocks(): HTMLElement[];
/**
 * 当前是否「多块选区」：覆盖 ≥2 个顶层块，且不属于同一个列表父项整段。
 * 后者（父项 + 子项）按 Issue 3 的「一个整块」处理，不当多选。
 */
export declare function hasMultiBlockSelection(): boolean;
/**
 * LOCAL-CHANGE(260917 Issue 4)：把一组顶层块重新设为内核选区。
 * 用途：点击手柄会先让编辑区失焦、选区被浏览器清掉；菜单动作执行前用它把选区「还原」，
 * 之后 getSelectionContent / deleteByRange / insertAtSelection 仍按整段选区批量工作。
 */
export declare function selectBlocksInEditor(editor: any, blocks: HTMLElement[]): boolean;
/**
 * LOCAL-CHANGE: 把光标**折叠**放到块内容的末尾（不选中内容）。
 *
 * 为什么需要：容器类命令（alert/columns/collapse）是「用新容器**替换选区**」语义 ——
 * 若先把整块内容全选（selectBlockInEditor）再执行，原文本会被空容器替换掉（实测：
 * 高亮块/分栏转换后 DOM、内核模型 JSON、落盘正文三处都没有原文）。
 * 折叠光标执行时命令只改变块结构、内容随块进入容器，文本得以保留。
 */
export declare function collapseCaretAtBlockEnd(editor: any, blockElement: HTMLElement | null): boolean;
/**
 * 「转化为 高亮块/分栏/折叠块/代码块」：一次替换把原文搬进新容器/卡片。
 * 成功返回 true；取不到内容或内核拒绝载荷时返回 false（调用方回退旧行为）。
 */
export declare function convertBlockPreservingContent(editor: any, blockElement: HTMLElement, target: string): boolean;
export declare function runNativeConvert(editor: any, blockElement: HTMLElement, target: string): boolean;
/** 通过 Lakex 复制整块 DOM（列表父项含子项，Issue 3） */
export declare function copyDomBlock(editor: any, blockElement: HTMLElement): boolean;
/**
 * LOCAL-CHANGE: 用内核原生命令删除整块。
 *
 * 替代 `utils/blockDoc.deleteBlock`（整篇 JSON 读改写：`getDocument('json')` → 改树 →
 * `setDocument('json')`；本仓库实测该路径会重写自定义卡并抹掉内核未注册的卡）。
 * 与菜单「删除」项同一实现，剪切也复用它。
 *
 * 优先走 `removeBlockNodesNative`（节点级删除、原位不留空段落）；仅在模型事务不可用时
 * 退回 `deleteByRange`（会在原位留一个空段落，属兜底而非正常路径）。
 */
export declare function deleteBlockByRange(editor: any, blockElement: HTMLElement | null): boolean;
/**
 * LOCAL-CHANGE(260917 / 260918)：原生「移动块」——把 sourceEl（整段）移到 targetEl 前/后。
 *
 * 全程内核原生命令，**不碰** `utils/blockDoc.moveBlock` 的整篇 JSON 读改写
 * （实测会把自定义卡 634B→8859B、并抹掉内核未注册卡）：
 *  - 卡片源 → `moveCard(cardId, modelPosition)`：移动已有节点、**逐字节保真**（含卡 id）；
 *  - 其它块 → `getNodeContent('text/lake')` 取原文 → **先摘掉源节点**
 *    （`removeBlockNodesNative`，节点级删除）→ 再按**删除后**的目标位置 `insertAtPosition`。
 *
 * 顺序与落点口径（260918 改，修「每拖一次多一条空行」）：
 *  - 落点 model position 是 `(父节点, 子索引)` 形式，先插后删会让落点索引位移；先删后插索引天然稳定。
 *  - 删源必须**节点级**：deleteByRange 只删内容，范围覆盖整块时内核会在原位补一个空段落
 *    （实测拖段落 顶层块 63→64、空段落 +1）。详见 `removeBlockNodesNative`。
 *  - 插入仍用 `insertAtPosition`（显式模型位置），不用 `insertAtSelection` —— 折叠光标会被吸附到行内，
 *    导致段落融合丢换行、列表项文本并进目标项。
 */
export declare function moveBlockNative(editor: any, sourceEl: HTMLElement | null, targetEl: HTMLElement | null, before: boolean): boolean;
/**
 * LOCAL-CHANGE: 用内核原生命令在块前/后插入新块（默认段落，可指定标题/引用/分割线）。
 *
 * 替代 `utils/blockDoc.insertBlock`（同上：整篇 JSON 读改写）。实现 = 把光标收到块的
 * 首/尾 → `breakLine`（内核断行，实测在目标块旁立刻生成新的 `ne-p`）→ 需要类型时再对该
 * 新块执行 `style` / `quote` / `hr`（命令生效要求光标落在该块内，断行后光标即在新块里）。
 */
export declare function insertBlockNative(editor: any, blockElement: HTMLElement | null, position: 'before' | 'after', target?: string): boolean;
/** 复制文本到剪贴板（优先 Clipboard API，失败时回退 execCommand） */
export declare function copyText(text: string): Promise<boolean>;
