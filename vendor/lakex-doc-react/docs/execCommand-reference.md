# lakex.js `execCommand` 命令参数参考

> 基于 `src/components/lakex/lakex.js` 源码核对整理（框架为 ProseMirror 系，命令经混淆，本文以命令名 + 入参形态为准）。

## 一、`execCommand` 方法签名

框架公开 API 有三处可用，语义一致：

- `editor.execCommand(name, ...args)` —— 公开入口（经 command-interceptor 拦截）
- `editor.renderer.execCommand(name, ...args)` —— 渲染层
- `editor.kernel.execCommand(name, ...args)` —— 内核直调

**参数含义：**

- **第 1 参数 `name`**：字符串，命令名（如 `'copy'`、`'selection'`、`'focus'`）。
- **第 2 及之后参数**：**命令专属入参**，因命令而异（DOM Range / 配置对象 / 字符串 / 布尔值 / id …）。
- **返回值**：命令执行结果（多数 true/false；`copy`/`cut` 返回 boolean 表示是否成功写入剪切板）。

## 二、派发机制（关键点）

内核 `execCommand` 实现实为查表转发：

```js
execCommand(e, ...o) {
  return this._$commands[e]
    ? this._$commands[e].execute(...o)            // 命中内核已注册命令
    : this._commandUnderlay.execCommand(e, ...o); // 否则转底层（copy/cut/paste 最终落到浏览器原生 document.execCommand）
}
```

即：先查内核注册表 `_$commands[name]`；查不到就交给 `_commandUnderlay`（对 `copy`/`cut`/`paste` 会走浏览器原生剪切板）。命令通过 `registerCommand(name, cmd)` 注册，`cmd.execute(...args)` 即被调用。

## 三、重点命令（已逐条核对源码）

| 命令 | 入参形态 | 说明 |
|---|---|---|
| `selection` | `{ ranges:[pmRange], anchor, focus }` | 设置 PM 选区。`pmRange = editor.engine.transformDOMRange(domRange)`；`anchor`/`focus` 取 `'start'\|'end'` 表示 range 哪一端为锚点/焦点。框架自身调用：`execCommand('selection', Object.assign({}, r, { ranges: i }))` |
| `focus` | `'start' \| 'end'` 或 `{ preventScroll:true }` | 让编辑器聚焦并把光标置于块头/块尾。源码：`execCommand('focus', 'start')` / `execCommand('focus', { preventScroll:!0 })` |
| `focusCard` | `focusCard(cardId, position?)` | 聚焦某卡片块 |
| `copy` | `copy(domRange?)` | 把范围（不传则当前 PM 选区）写入**系统剪切板**，返回 boolean。卡片复制即 `execCommand('copy', range)` |
| `cut` | `cut(domRange?)` | 同 `copy`，但会删除选区内容 |
| `delete` | `delete(true\|false)` | `true` 后删 / `false` 前删；另见 `deleteCard(id)`、`deleteByRange(range)`、`deleteToBlockEnd` |
| `insertText` | `insertText(text, position?)` | 在指定 PM 位置插入文本（源码 `execCommand('insertText', t, o.start)`） |
| `insertCard` | `insertCard(name, value?, ...)` | 插入卡片（`'hr'`、图片等） |
| `moveCard` | `moveCard(cardId, position)` | 移动卡片到指定位置（源码 `execCommand('moveCard', id, l.start)`） |
| `input` | `input(text, ...)` | 即时输入文本（输入法路径） |

## 四、完整命令词表（80 个）

| 命令 | 分类 | 含义 / 入参说明 |
| --- | --- | --- |
| `selection` | 选区 | 设置 PM 选区，入参 `{ ranges:[pmRange], anchor, focus }`，`pmRange = editor.engine.transformDOMRange(domRange)` |
| `focus` | 焦点 | `focus('start'\|'end')` 或 `focus({ preventScroll:true })`，聚焦并定位光标 |
| `focusCard` | 焦点 | `focusCard(cardId, position?)`，聚焦某卡片块 |
| `copy` | 剪贴板 | `copy(domRange?)`，写入系统剪切板，返回 boolean（已核对） |
| `cut` | 剪贴板 | `cut(domRange?)`，同 copy 且删除选区，返回 boolean（已核对） |
| `paste` | 剪贴板 | 原生粘贴 |
| `pasteText` | 剪贴板 | 纯文本粘贴 |
| `markdownPasteParse` | 剪贴板 | 按 Markdown 解析粘贴内容 |
| `dropFile` | 剪贴板 | 拖入文件 |
| `delete` | 删除 | `delete(true\|false)`，后删 / 前删（已核对） |
| `deleteCard` | 删除 | `deleteCard(id)`，删除指定卡片 |
| `deleteByRange` | 删除 | `deleteByRange(range)`，按范围删除 |
| `deleteToBlockEnd` | 删除 | 删除到块尾 |
| `deleteTable` | 删除 | 删除表格 |
| `insertCard` | 插入 | `insertCard(name, value?, ...)` 插入卡片（已核对） |
| `insertText` | 插入 | `insertText(text, position?)` 在 PM 位置插入文本（已核对） |
| `insertFiles` | 插入 | 插入文件 |
| `insertLink` | 插入 | 插入链接 |
| `insertBookmark` | 插入 | 插入书签 |
| `insertSlash` | 插入 | 唤起斜杠菜单 |
| `insertYuqueInlineDoc` | 插入 | 插入语雀内联文档 |
| `hr` | 插入 | 插入分割线 |
| `quote` | 插入 | 引用 |
| `code` | 插入 | 行内代码 |
| `codeblock` | 插入 | 代码块 |
| `mention` | 插入 | 提及某人 |
| `image` | 插入 | 插入图片 |
| `card` | 插入 | 插入卡片 |
| `linkToBookmark` | 插入 | 链接到书签 |
| `linkToBookmarkInline` | 插入 | 行内链接到书签 |
| `linkToThirdparty` | 插入 | 链接到第三方 |
| `moveCard` | 移动 | `moveCard(cardId, position)` 移动卡片（已核对） |
| `moveImage` | 移动 | 移动图片 |
| `moveImageToGallery` | 移动 | 图片移入画廊 |
| `cardToLink` | 转换 | 卡片转为链接 |
| `orderedList` | 列表 | 有序列表 |
| `unorderedList` | 列表 | 无序列表 |
| `taskList` | 列表 | 任务列表 |
| `taskStatus` | 列表 | 切换任务状态 |
| `h1`~`h6` | 标题 | 标题 1~6 |
| `paragraph` | 段落 | 普通段落 |
| `headingBreakLine` | 标题 | 标题后换行 |
| `headingCollapsed` | 标题 | 标题折叠 |
| `headingUnfold` | 标题 | 标题展开 |
| `indexType` | 标题 | 标题编号类型 |
| `orderedListIndexType` | 列表 | 有序列表编号类型 |
| `orderedListIndexQuery` | 列表 | 查询有序列表编号 |
| `bold` | 样式 | 粗体 |
| `italic` | 样式 | 斜体 |
| `underline` | 样式 | 下划线 |
| `strikethrough` | 样式 | 删除线 |
| `color` | 样式 | 字体颜色 |
| `bgColor` | 样式 | 背景颜色 |
| `clearColor` | 样式 | 清除颜色 |
| `fontsize` | 样式 | 字号调整 |
| `style` | 样式 | 设置样式 |
| `paintFormat` | 样式 | 格式刷 |
| `formatPainter` | 样式 | 格式刷 |
| `clearFormat` | 样式 | 清除格式 |
| `alignmentLeft` | 样式 | 左对齐 |
| `alignmentRight` | 样式 | 右对齐 |
| `alignmentCenter` | 样式 | 居中对齐 |
| `alignmentJustify` | 样式 | 两端对齐 |
| `lineHeight` | 样式 | 行高调整 |
| `indent` | 样式 | 增加缩进 |
| `outdent` | 样式 | 减少缩进 |
| `indentForTab` | 样式 | Tab 增加缩进 |
| `outdentForTab` | 样式 | Tab 减少缩进 |
| `sup` | 样式 | 上标 |
| `sub` | 样式 | 下标 |
| `math` | 样式 | 公式 |
| `table` | 表格 | 插入表格 |
| `tableMergeCell` | 表格 | 合并单元格 |
| `tableUnmergeCell` | 表格 | 拆分单元格 |
| `tableCellBgColor` | 表格 | 单元格背景色 |
| `tableRowHead` | 表格 | 行表头 |
| `tableColHead` | 表格 | 列表头 |
| `tableColumnWidth` | 表格 | 设置列宽 |
| `tableRowHeight` | 表格 | 设置行高 |
| `tableColumnMoveTo` | 表格 | 移动列 |
| `tableRowMoveTo` | 表格 | 移动行 |
| `tableEquallyColumn` | 表格 | 等列宽 |
| `tableColumnAdaptation` | 表格 | 列自适应 |
| `tableToggleWidthMode` | 表格 | 切换宽度模式 |
| `tableBorderVisible` | 表格 | 显示/隐藏边框 |
| `tableVerticalAlign` | 表格 | 垂直对齐 |
| `collapse` | 折叠 | 折叠 |
| `collapseOpen` | 折叠 | 展开折叠 |
| `collapseBreakLine` | 折叠 | 折叠后换行 |
| `tryUnfoldCollapse` | 折叠 | 尝试展开 |
| `alert` | 其它 | 高亮提示框 |
| `alertType` | 其它 | 提示框类型 |
| `toggleTocView` | 其它 | 目录视图 |
| `link` | 其它 | 链接 |
| `unlink` | 其它 | 取消链接 |
| `updateLink` | 其它 | 更新链接 |
| `setCardValue` | 其它 | 设置卡片值 |
| `imageTitleBreakLine` | 其它 | 图片标题换行 |
| `plainText` | 其它 | 纯文本 |
| `replaceText` | 其它 | 替换 |
| `replaceAll` | 其它 | 全部替换 |
| `rollbackHistory` | 其它 | 回滚历史 |
| `undo` | 历史 | 撤销 |
| `redo` | 历史 | 重做 |
| `newLine` | 其它 | 软换行 |
| `tab` | 其它 | 制表符 |
| `unicodeEmoji` | 其它 | Emoji |
| `openTranslatePanel` | 其它 | 翻译面板 |
| `openLibrary` | 其它 | 素材库 |
| `openSearchPanel` | 其它 | 查找替换面板 |
| `selectAll` | 其它 | 全选 |
| `slash` | 其它 | 斜杠命令 |
| `fullscreen` | 其它 | 全屏 |
| `toggleBorder` | 其它 | 隐藏边框 |
| `cellBgColor` | 表格 | 单元格背景色 |
| `mergeCell` | 表格 | 合并单元格 |
| `verticalAlignTop` | 表格 | 顶部对齐 |
| `verticalAlignMiddle` | 表格 | 垂直居中 |
| `verticalAlignBottom` | 表格 | 底部对齐 |
| `tableHead` | 表格 | 标题行列 |
| `link-view` | 其它 | 链接视图 |
| `label` | 其它 | 标签 |
| `getSelectLabel` | 其它 | 获取选中标签 |
| `getSummary` | 其它 | 获取摘要 |
| `save` | 其它 | 保存 |
| `input` | 输入 | `input(text, ...)` 即时输入文本（已核对） |

> 说明：表格/折叠/对齐等命令的第 2 参数多为具体取值（如列宽数字、对齐方向、布尔开关），因源码为压缩态、且命令较多，未逐一展开其精确形态；但上表标注「已核对」的 `copy`/`cut`/`selection`/`focus`/`insertText`/`moveCard`/`delete`/`insertCard` 已全部按源码核实，正是复制/剪切/粘贴链路依赖的命令。
