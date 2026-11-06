> 来源: https://www.yuque.com/yuque/developer/ndflcx5eprg7gbdl
> 抓取: 2026-09-16 · 语雀开发者文档（本地参考副本，勿再分发）

---

# 前言
可以通过`editor.execCommand('commandName', 参数)`的方式调用文档的命令

# focus 聚焦编辑器
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | 1. position： `'start' | 'end'`聚焦到内容尾部或者头部 |  true | false 表示成功或者失败 |


```javascript
import FocusCommand from "@alipay/lakex-doc/esm/plugin-focus/kernel/commands/focus-command";

// 聚焦到文档尾部
editor.execCommand<typeof FocusCommand>("focus", "end");
```



# style 设置当前段落的样式
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | 1. target `'p'|'h1'|'h2'|'h3|'h4'|'h5'|'h6'` |  true | false 表示成功或者失败 |
| queryCommandValue | - |  返回当前style `'p'|'h1'|'h2'|'h3|'h4'|'h5'|'h6'` |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 选中段落变成h1
editor.execCommand('style', 'h1');
```

# insertText 插入文本
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | 1. `text`要插入的普通文本 |  true | false 表示成功或者失败 |
| queryCommandValue | - |  - |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 在当前选区插入文本，如果是非闭合选区，则会替换选区内容
editor.execCommand('insertText', '123');
```

# alignment 设置段落对齐方式
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | 1. `value`对齐方式`left|right|center|justify|distributed` |  true | false 表示成功或者失败 |
| queryCommandValue | - |  返回当前段落的`left|right|center|justify|distributed` |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 设置当前选区的段落居中对齐
editor.execCommand('alignment', 'center');
```

# bold 切换选中文本的加粗
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | - |  true | false 表示成功或者失败 |
| queryCommandValue | - |  返回当前选中文本是否加粗 |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 切换当前选中文本加粗
editor.execCommand('bold');
```

# italic 切换选中文本的斜体
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | - |  true | false 表示成功或者失败 |
| queryCommandValue | - |  返回当前选中文本是否斜体 |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 切换当前选中文本斜体
editor.execCommand('italic');
```

# underline 切换选中文本的下划线
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | - |  true | false 表示成功或者失败 |
| queryCommandValue | - |  返回当前选中文本是否下划线 |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 切换当前选中文下划线
editor.execCommand('underline');
```

# strikethrough 切换选中文本的中划线
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | - |  true | false 表示成功或者失败 |
| queryCommandValue | - |  返回当前选中文本是否中划线 |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 切换当前选中文本中划线
editor.execCommand('strikethrough');
```

# bgColor 设置选中文本的背景颜色
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | 1. `color` 颜色值，例如： ’#ff0000‘ |  true | false 表示成功或者失败 |
| queryCommandValue | - |  返回当前选中文本背景颜色 |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 设置当前选中文本背景颜色
editor.execCommand('bgColor', '#ff0000');
```

# clearBgColor 清除选区的背景颜色
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | - |  true | false 表示成功或者失败 |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 清除当前选中文本的背景颜色
editor.execCommand('clearBgColor');
```

# breakLine 删除选区内容并换行
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | - |  true | false 表示成功或者失败 |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 删除当前选区内容，并插入一个换行符
editor.execCommand('breakLine');
```

# clearFormat 清除选中文本的格式
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | - |  true | false 表示成功或者失败 |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 清空选中文本的颜色，背景颜色，下划线，中划线，加粗，斜体等
editor.execCommand('clearFormat');
```

# code 创建行内代码块
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | 1. `text` 可选参数，行内代码块文本，如果是闭合选区则必传，如果不是闭合选区，默认取选中的文本 |  true | false 表示成功或者失败 |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 根据当前选中文本创建一个行内代码块
editor.execCommand('code');
```

# color 设置选中文本的颜色
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | 1. color 颜色 ，例如：`'#ff0000'`，支持渐变色(1.10.0 之后)：`'#ff0,#0ff'` |  true | false 表示成功或者失败 |
| queryCommandValue | - |  返回当前选中文本的颜色 |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 设置当前选中文本的颜色
editor.execCommand('color', '#ff0000');
```

# clearColor 清除文本的前景色
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | - |  true | false 表示成功或者失败 |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 清空选中文本的颜色
editor.execCommand('clearColor');
```

# wordCount 获取当前文档的字数统计
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| queryCommandValue | - |  获取当前文档的字数统计 |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 在当前选区进行全选操作，默认会选择容器，再次执行全选会向上继续全选
editor.queryCommandValue('wordCount');
```

# isEmpty 判断当前文档是否为空
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| queryCommandValue | - |  `true|false` 文档是否是空 |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 判断当前文档是否是空
editor.queryCommandValue('isEmpty');
```

# delete 删除选区内容
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | - |  true | false 表示成功或者失败 |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 删除选区的内容
editor.execCommand('delete');
```

# fontsize 设置选中文字的字号
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | 1. `fontSize`字号大小 ，例如： 12，取值区间`[12, 13,14,15,16,19,22,24,29,32,40]` |  true | false 表示成功或者失败 |
| queryCommandValue | - |  返回当前选中文本的字号<br/>`[12, 13,14,15,16,19,22,24,29,32,40]` |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 设置当前选中文本的字号
editor.execCommand('fontsize', 22);
```

# defaultFontsize 设置正文的默认字号
:::success
需要注意，如果执行`setDocument`会重新读取参数中的`meta`信息覆盖掉当前的默认字号。通常不需要执行该命令，建议默认字号通过配置传入。参考：[默认字号（defaultFontsize）](https://yuque.antfin-inc.com/lark/lakex-doc/hax78tz7qkt1odvy)

:::

| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | 1. `fontSize`字号大小 ，例如： 12，取值区间`[12, 13,14,15,16,19,22,24,29,32,40]` |  true | false 表示成功或者失败 |
| queryCommandValue | - |  返回当前文档的默认字号<br/>`[12, 13,14,15,16,19,22,24,29,32,40]` |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 设置当前文档的默认字号
editor.execCommand('defaultFontsize', 22);
```

# clearDefaultFontsize 清除默认字号
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | - |  true | false 表示成功或者失败 |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 清空文档的默认字号
editor.execCommand('clearDefaultFontsize');
```

# redo 重做撤销的命令
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | - |  true | false 表示成功或者失败 |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 执行重做撤销的命令
editor.execCommand('redo');
```

# undo 撤销命令
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | - |  true | false 表示成功或者失败 |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 撤销最近执行的命令
editor.execCommand('undo');
```

# indent 增加缩进和行首缩进
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | - |  true | false 表示成功或者失败 |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 如果段落未行首缩进，首先执行行首缩进，如果已经行首缩进，则执行段落缩进
editor.execCommand('indent');
```

# outdent 减少缩进和段落头部空两个字符
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | - |  true | false 表示成功或者失败 |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 有缩进优先减少缩进，没有缩进有行首缩进，则去除行首缩进
editor.execCommand('outdent');
```

# selectAll 全选
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | - |  true | false 表示成功或者失败 |
| queryCommandState | - | `-1 | 0` 表示当前命令是否可用 |


```javascript
// 在当前选区进行全选操作，默认会选择容器，再次执行全选会向上继续全选
editor.execCommand('selectAll');
```

# insertAtSelection 在当前选区插入<font style="background:#F8CED3;color:#70000D">1.3.0-beta.8</font>
如果选区非折叠，被选中的内容将会被替换为插入内容。

| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | 1. `<font style="color:#117CEE;">string</font>`数据格式，例如： 支持格式`text/html`、`text/markdown`，`text/plain`，`text/lake`等<br/>2. `<font style="color:#117CEE;">string</font>`数据字符串 | 插入的节点对象。<br/>如果失败将返回`null` |
| queryCommandValue | - | - |
| queryCommandState | - | - |


```javascript
editor.execCommand(
      'insertAtSelection',
      'text/html',
      '<b>strong</b>',
    );
```

# getNodeContent 获取节点指定格式数据<font style="background:#F8CED3;color:#70000D">1.3.0-beta.8</font>
| 方法名称 | 参数列表 | 返回结果 |
| --- | --- | --- |
| execCommand | 1. `<font style="color:#117CEE;">string</font>`节点id<br/>2. `<font style="color:#117CEE;">string</font>`数据格式，例如： 支持格式`text/html`、`text/markdown`，`text/plain`，`text/lake`等 | 对应格式的字符串<br/>如果失败将返回空字符串 |
| queryCommandValue | - | - |
| queryCommandState | - | - |


```javascript
editor.execCommand(
      'getNodeContent',
      '123',
      'text/html',
    );
```

