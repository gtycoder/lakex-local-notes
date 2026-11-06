> 来源: https://www.yuque.com/yuque/developer/ratg8q2cdsdvpp1t
> 抓取: 2026-09-16 · 语雀开发者文档（本地参考副本，勿再分发）

---

修改工具栏的方法是在创建编辑器的时候传入配置。工具栏分`table`选区的工具栏和默认工具栏，`table`选区工具栏只有光标位于`table`的时候才展示。

`"|"`表示分隔符

```javascript
const { createOpenEditor, toolbarItems } = window.Doc;
// 创建编辑器
const editor = createOpenEditor(document.getElementById('root'), {
  input: {},
  image: {
    isCaptureImageURL() {
      return false;
    },
  },
  toolbar: {
    agentConfig: {
      default: {
        items: [
          toolbarItems.cardSelect,
          '|',
          toolbarItems.undo,
          toolbarItems.redo,
          toolbarItems.formatPainter,
          toolbarItems.clearFormat,
          '|',
          toolbarItems.style,
          toolbarItems.fontsize,
          toolbarItems.bold,
          toolbarItems.italic,
          toolbarItems.strikethrough,
          toolbarItems.underline,
          toolbarItems.mixedTextStyle,
          '|',
          toolbarItems.color,
          toolbarItems.bgColor,
          '|',
          toolbarItems.alignment,
          toolbarItems.unorderedList,
          toolbarItems.orderedList,
          toolbarItems.indent,
          toolbarItems.lineHeight,
          '|',
          toolbarItems.taskList,
          toolbarItems.link,
          toolbarItems.quote,
          toolbarItems.hr,
        ]
      },
      // table选区工具栏
      table: {
        items: [
          toolbarItems.cardSelect,
          '|',
          toolbarItems.undo,
          toolbarItems.redo,
          toolbarItems.formatPainter,
          toolbarItems.clearFormat,
          '|',
          toolbarItems.style,
          toolbarItems.fontsize,
          toolbarItems.bold,
          toolbarItems.italic,
          toolbarItems.strikethrough,
          toolbarItems.underline,
          toolbarItems.mixedTextStyle,
          '|',
          toolbarItems.color,
          toolbarItems.bgColor,
          toolbarItems.tableCellBgColor,
          toolbarItems.tableBorderVisible,
          '|',
          toolbarItems.alignment,
          toolbarItems.tableVerticalAlign,
          toolbarItems.tableMergeCell,
          '|',
          toolbarItems.unorderedList,
          toolbarItems.orderedList,
          toolbarItems.indent,
          toolbarItems.lineHeight,
          '|',
          toolbarItems.taskList,
          toolbarItems.link,
          toolbarItems.quote,
          toolbarItems.hr,
        ],
      }
    }
  }
});
```

### 完整的工具栏按钮
```javascript
toolbarItems.cardSelect // 插入面板
toolbarItems.undo // 撤销
toolbarItems.redo // 重做
toolbarItems.formatPainter // 格式刷
toolbarItems.clearFormat // 清除格式
toolbarItems.style // 设置标题和正文
toolbarItems.fontsize // 字号
toolbarItems.bold // 加粗
toolbarItems.italic // 斜体
toolbarItems.strikethrough // 删除线
toolbarItems.underline // 下划线
toolbarItems.mixedTextStyle // 更多文本样式
toolbarItems.color // 字体颜色
toolbarItems.bgColor // 背景颜色
toolbarItems.alignment // 对齐样式
toolbarItems.unorderedList // 无序列表
toolbarItems.orderedList // 有序列表
toolbarItems.indent // 缩进调整
toolbarItems.lineHeight // 行高
toolbarItems.taskList // 任务列表
toolbarItems.link // 超链接
toolbarItems.quote // 引用
toolbarItems.hr // 分割线

// 表格专用
toolbarItems.tableCellBgColor // 单元格背景颜色
toolbarItems.tableBorderVisible // 单元格是否显示边框
toolbarItems.tableVerticalAlign // 垂直对齐
toolbarItems.tableMergeCell // 合并单元格
```







