# Lakex 编辑器 JSON 数据格式 Skills

## 概述

本文档定义了 Lakex（语雀）编辑器的 **真实 JSON 数据格式** 规范，用于指导 AI 大模型生成和解析编辑器内容。Lakex 编辑器的 `onContentChange` 回调会返回包含多种格式的数据数组，其中 `type: "json"` 的数据即为编辑器的结构化 JSON 表示（内部格式为 `text/lake`）。

> ⚠️ **重要**：编辑器实际导出的 JSON 与"简化 schema"不同——**每个节点都是统一的 `{type, id, name, attrs, ...}` 结构**，文本内容和格式标记都内嵌在节点字段中，而不是扁平的 `{text, bold}` 写法。本文所有示例均为编辑器真实可解析的格式。

> ⚠️ **关于标签名的易错点**：编辑器导出的列表项节点名为 `uli` / `oli` / `tli`（**不是** `ul`/`ol`/`li`）；引用块节点名为 `quote`（**不是** `blockquote`）；超链接是独立的 `link` 元素（**不是**文本节点的 `attrs.link`）；分割线由 `hole` 包裹一个 `card`（`name:"hr"`）组成（**不是**裸的 `hr` 元素）。详见对应章节。

## 核心数据结构

### 文档根结构

```json
{
  "type": "element",
  "id": "u9e39949c",
  "name": "#root",
  "attrs": { "meta": {} },
  "children": []
}
```

### 节点通用字段

| 字段      | 类型                          | 出现于                              | 说明                                                                       |
| --------- | ----------------------------- | ----------------------------------- | -------------------------------------------------------------------------- |
| `type`    | `"element"` \| `"text"` \| `"card"` | 所有节点                        | `element` = 容器/块级节点；`text` = 文本叶子节点；`card` = 卡片节点（如分割线） |
| `id`      | `string`                      | 所有节点                            | 节点唯一 id（通常以 `u` 开头；`card` 类型可能不带 `u` 前缀）                 |
| `name`    | `string`                      | 所有节点                            | 标签名：`element` 用 `#root`/`p`/`h1`/`table`…，`text` 固定 `#text`，`card` 见具体卡片 |
| `attrs`   | `object`                      | 所有节点                            | 节点属性 / 文本格式标记（见下文）                                          |
| `children`| `node[]`                      | 仅 `element`                        | 子节点数组                                                                 |
| `data`    | `string`                      | 仅 `text`                           | 文本内容                                                                   |
| `cardType`| `"block"` \| `"inline"` 等     | 仅 `card` 类型节点                   | 卡片形态（块级/行内）                                                      |

### 节点类型分类

| 分类       | `name` 取值                                              | 描述                                                       |
| ---------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| **文本块** | `p`, `h1`, `h2`, `h3`, `h4`, `h5`, `h6`                 | 段落和标题                                                 |
| **列表项** | `uli`（无序）、`oli`（有序）、`tli`（任务）              | 列表项（注意 **不是** `ul`/`ol`/`li`）                     |
| **引用**   | `quote`                                                 | 引用块（注意 **不是** `blockquote`）                       |
| **代码块** | `codeblock`                                             | 代码块                                                     |
| **行内代码**| `code`                                                  | 行内代码元素（嵌在段落等块级节点内）                       |
| **链接**   | `link`                                                  | 超链接元素（嵌在段落内；注意 **不是** 文本节点的 `attrs.link`） |
| **表格**   | `table`, `thead`, `tbody`, `tr`, `td`, `th`             | 表格                                                       |
| **媒体**   | `image`, `video`, `audio`                               | 图片、视频、音频                                           |
| **分隔**   | `hole` → `card`(`name:"hr"`)                            | 分隔线（由 `hole` 包裹 `card`）                            |
| **卡片**   | `card`(`type:"card"`，如 `name:"mindmap-card"` 等)      | 自定义卡片（思维导图、图表等）                             |

### 文本节点格式（核心）

文本节点是叶子节点，内容放在 `data`，**所有格式标记放在 `attrs` 内**：

```json
{
  "type": "text",
  "id": "ub6920b98",
  "name": "#text",
  "attrs": { "bold": true },
  "data": "加租"
}
```

### 文本格式标记（`attrs` 内）

格式标记都是 `attrs` 上的键，值为布尔或具体取值：

| 标记            | 取值类型        | 说明                                       |
| --------------- | --------------- | ------------------------------------------ |
| `bold`          | `boolean`       | 加粗                                       |
| `italic`        | `boolean`       | 斜体                                       |
| `underline`     | `boolean`       | 下划线                                     |
| `strikethrough` | `boolean`       | 删除线                                     |
| `sup`           | `boolean`       | 上标                                       |
| `sub`           | `boolean`       | 下标                                       |
| `color`         | `string`(颜色)  | 字体颜色，如 `"#DF2A3F"`                    |
| `bgColor`       | `string`(颜色)  | 背景颜色，如 `"#E9E9E9"`                    |
| `fontsize`      | `number`        | 字号，如 `22`                               |

> 多个标记可在同一个文本节点的 `attrs` 中并存（如同时 `bold` 与 `color`）。
>
> ⚠️ **超链接不是文本标记**：真实导出中链接是独立的 `link` 元素（见第 12 节），**不是**文本节点的 `attrs.link` 属性。
>
> ⚠️ **行内代码不是文本标记**：它不是一个 `code: true` 的文本属性，而是一个独立的 `code` 元素（见第 14 节）。

### 完整文本格式示例（编辑器真实导出）

以下是编辑器对「一段含多种格式的文字」实际生成的 JSON，可作为权威参考：

```json
{
  "type": "element",
  "id": "u9e39949c",
  "name": "#root",
  "attrs": { "meta": {} },
  "children": [
    {
      "type": "element",
      "id": "u608f3e15",
      "name": "p",
      "attrs": {},
      "children": [
        { "type": "text", "id": "u9bf9990d", "name": "#text", "attrs": {}, "data": "这是一段文字，可以设置以下属性" },
        { "type": "text", "id": "ub6920b98", "name": "#text", "attrs": { "bold": true }, "data": "加租" },
        { "type": "text", "id": "u8ab350bc", "name": "#text", "attrs": { "italic": true }, "data": "斜体" },
        { "type": "text", "id": "u9a18d4e8", "name": "#text", "attrs": { "strikethrough": true }, "data": "删除线" },
        { "type": "text", "id": "udeae3715", "name": "#text", "attrs": { "underline": true }, "data": "下划线" },
        { "type": "text", "id": "udacc7ca4", "name": "#text", "attrs": { "sup": true }, "data": "上标" },
        { "type": "text", "id": "ua1bd7cc1", "name": "#text", "attrs": { "sub": true }, "data": "下标 " },
        { "type": "text", "id": "ub0b1acb4", "name": "#text", "attrs": { "color": "#DF2A3F" }, "data": "字体颜色" },
        { "type": "text", "id": "ub8a21ad7", "name": "#text", "attrs": { "bgColor": "#E9E9E9" }, "data": "背景颜色" },
        { "type": "text", "id": "u71d5a1a6", "name": "#text", "attrs": { "fontsize": 22 }, "data": "字体大小" }
      ]
    }
  ]
}
```

### 块级节点通用格式

块级节点为 `type: "element"`，`name` 为标签名，`children` 内放子节点（文本块内放 `text` 节点，容器块内放子块节点）：

```json
{
  "type": "element",
  "id": "u608f3e15",
  "name": "p",
  "attrs": {},
  "children": [ /* text 节点或子块节点 */ ]
}
```

## 节点类型详细规范

### 1. 段落 (Paragraph)

```json
{
  "type": "element",
  "id": "u608f3e15",
  "name": "p",
  "attrs": {},
  "children": [
    { "type": "text", "id": "u9bf9990d", "name": "#text", "attrs": {}, "data": "这是一个普通段落" }
  ]
}
```

**带混合格式的段落：**

```json
{
  "type": "element",
  "name": "p",
  "attrs": {},
  "children": [
    { "type": "text", "name": "#text", "attrs": { "bold": true }, "data": "这是" },
    { "type": "text", "name": "#text", "attrs": { "bold": true }, "data": "粗体" },
    { "type": "text", "name": "#text", "attrs": {}, "data": "和" },
    { "type": "text", "name": "#text", "attrs": { "italic": true }, "data": "斜体" },
    { "type": "text", "name": "#text", "attrs": {}, "data": "混合的段落" }
  ]
}
```

> 💡 相邻文本若格式不同（或一组连续相同格式），编辑器会拆成**多个 `text` 节点**，每个节点只携带自己差异化的 `attrs`。生成时可按格式切换拆分。

### 2. 段落属性（行高 / 对齐 / 缩进）

段落等块级节点的排版属性写在 `p` 的 `attrs` 上，缺省即使用编辑器默认（普通段落无这些键）。这些属性可单独或组合出现。

| 属性        | 取值类型            | 取值示例 / 含义                                              |
| ----------- | ------------------- | ------------------------------------------------------------ |
| `lineHeight`| `number`            | 行高倍数：`1`、`1.15`、`1.5`、`2`（缺省为默认行高）          |
| `alignment` | `string`            | 水平对齐：`"left"`、`"center"`、`"right"`、`"justify"`       |
| `indent`    | `number`            | 缩进层级：`1`、`2`、`3`                                      |

```json
// 行高：lineHeight 为数字倍数
{ "type": "element", "name": "p", "attrs": { "lineHeight": 1.5 }, "children": [ { "type": "text", "name": "#text", "attrs": {}, "data": "行高 1.5" } ] }

// 对齐：alignment 四选一
{ "type": "element", "name": "p", "attrs": { "alignment": "center" }, "children": [ { "type": "text", "name": "#text", "attrs": {}, "data": "居中对齐" } ] }

// 缩进：indent 为层级数字，可与 alignment 共存
{ "type": "element", "name": "p", "attrs": { "alignment": "left", "indent": 2 }, "children": [ { "type": "text", "name": "#text", "attrs": {}, "data": "缩进 2" } ] }
```

> 同一 `p` 可同时带 `alignment` 与 `indent`（如 `{ "alignment": "left", "indent": 1 }`）。

### 3. 标题 (Heading)

```json
{
  "type": "element",
  "name": "h1",
  "attrs": {},
  "children": [
    { "type": "text", "name": "#text", "attrs": {}, "data": "一级标题" }
  ]
}
```

支持的标题级别：`h1` ~ `h6`，分别对应 `name` 为 `h1`…`h6`。

### 4. 无序列表 (Unordered List — `uli`)

无序列表的每一项是一个 `uli` 元素（**不是** `ul`/`li`）。同一列表的多项共享同一个 `list` id，按序相邻排列；列表之间用一个空 `p` 节点隔断。

```json
{
  "type": "element",
  "id": "u08fc5c8e",
  "name": "uli",
  "attrs": {
    "list": "u2fed341c",
    "alignment": "left",
    "indexStyle": {},
    "fid": "uaf5b48bd",
    "indexType": 0,
    "parentIndex": [],
    "index": 0
  },
  "children": [
    { "type": "text", "id": "u9ce3ba8c", "name": "#text", "attrs": {}, "data": "无序列表 1" }
  ]
}
```

**`uli` 的 `attrs` 字段说明：**

| 字段         | 类型       | 说明                                                       |
| ------------ | ---------- | ---------------------------------------------------------- |
| `list`       | `string`   | 列表组唯一 id，**同一列表的所有项共享此值**               |
| `alignment`  | `string`   | 该项对齐方式（`"left"` 等）                                |
| `indexStyle` | `object`   | 编号/符号样式配置（通常 `{}`）                             |
| `fid`        | `string`   | 列表片段 id（列表容器标识）                                |
| `indexType`  | `number`   | 列表类型，`0` = 无序                                        |
| `parentIndex`| `number[]` | 父级项索引数组；顶层为 `[]`，嵌套时如 `[0]`、`[0,1]`     |
| `index`      | `number`   | 当前层级中的位置（从 0 开始）                              |

```json
// 同一列表的第二项：list / fid 一致，index 递增为 1
{
  "type": "element",
  "id": "uc30b7574",
  "name": "uli",
  "attrs": { "list": "u2fed341c", "alignment": "left", "indexStyle": {}, "fid": "uaf5b48bd", "indexType": 0, "parentIndex": [], "index": 1 },
  "children": [ { "type": "text", "id": "u13fd1240", "name": "#text", "attrs": {}, "data": "无序列表 2" } ]
}
```

### 5. 有序列表 (Ordered List — `oli`)

有序列表的每一项是一个 `oli` 元素。`indexType` 区分编号样式（`0`/`1`/`2` 对应三种有序列表样式）；同一列表共享 `list` 与 `fid`，不同列表用不同的 `list` id。

```json
{
  "type": "element",
  "id": "uf375811d",
  "name": "oli",
  "attrs": {
    "list": "u34dfef8c",
    "indexType": 0,
    "fid": "ub13d1cfc",
    "parentIndex": [],
    "index": 0,
    "indexStyle": {}
  },
  "children": [ { "type": "text", "id": "u0281f73e", "name": "#text", "attrs": {}, "data": "有序列表 1" } ]
}
```

**有序列表样式（`indexType`）：**

| `indexType` | 描述           |
| ----------- | -------------- |
| `0`         | 样式 1（如 `1. 2. 3.`） |
| `1`         | 样式 2（如 `1) 2) 3)` 或字母/罗马数字等） |
| `2`         | 样式 3          |

### 6. 嵌套有序列表（层级 / `level` / `parentIndex`）

子项通过在 `attrs` 中设置 `parentIndex` 与 `level` 表达嵌套关系（`parentIndex` 为父项索引路径，`level` 为嵌套深度，从 1 起）：

```json
// 一级子项：parentIndex: [0]（父为第 0 项），level: 1
{
  "type": "element",
  "id": "u881ebbeb",
  "name": "oli",
  "attrs": { "list": "u34dfef8c", "indexType": 0, "fid": "ub13d1cfc", "parentIndex": [0], "index": 0, "indexStyle": {}, "level": 1 },
  "children": [ { "type": "text", "id": "ua959092f", "name": "#text", "attrs": {}, "data": "有序列表 1.1" } ]
}

// 二级子项：parentIndex: [0,1]（父路径为第0项下的第1项），level: 2
{
  "type": "element",
  "id": "ua35a651f",
  "name": "oli",
  "attrs": { "list": "u34dfef8c", "indexType": 0, "fid": "ub13d1cfc", "parentIndex": [0, 1], "index": 0, "indexStyle": {}, "level": 2 },
  "children": [ { "type": "text", "id": "u131b3992", "name": "#text", "attrs": {}, "data": "有序列表 1.2.1" } ]
}
```

> `uli` 同样支持 `parentIndex` 嵌套（见第 4 节字段说明），写法一致。

### 7. 任务列表 (Task List — `tli`)

任务列表每一项是一个 `tli` 元素。未完成项无 `checked`；已完成项带 `checked: true` 及 `version`（时间戳）。

```json
// 未完成任务
{
  "type": "element",
  "id": "u5a0c2abc",
  "name": "tli",
  "attrs": {
    "list": "u24bec4c8",
    "fid": "u14b2e83d",
    "indexType": 0,
    "parentIndex": [],
    "index": 0
  },
  "children": [ { "type": "text", "id": "u7f49ed99", "name": "#text", "attrs": {}, "data": "未完成任务 1" } ]
}

// 已完成任务（checked: true + version 时间戳）
{
  "type": "element",
  "id": "ubadf1ccf",
  "name": "tli",
  "attrs": {
    "list": "u24bec4c8",
    "fid": "u14b2e83d",
    "indexType": 0,
    "parentIndex": [],
    "index": 1,
    "checked": true,
    "version": 1784861831687
  },
  "children": [ { "type": "text", "id": "ubf56ba84", "name": "#text", "attrs": {}, "data": "已完成的任务 2" } ]
}
```

**`tli` 的 `attrs` 字段说明：**

| 字段         | 类型       | 说明                                                       |
| ------------ | ---------- | ---------------------------------------------------------- |
| `list`       | `string`   | 任务列表组唯一 id（同组共享）                              |
| `fid`        | `string`   | 列表片段 id                                                |
| `indexType`  | `number`   | 列表类型（`0` = 任务列表）                                 |
| `parentIndex`| `number[]` | 父级项索引数组（嵌套用，顶层 `[]`）                        |
| `index`      | `number`   | 当前层级中的位置                                           |
| `checked`    | `boolean`  | 是否已完成（仅已完成项出现，值为 `true`）                  |
| `version`    | `number`   | 完成状态时间戳（仅已完成项出现）                           |
| `level`      | `number`   | 嵌套层级（子项出现，如 `1`、`2`）                          |

### 8. 引用块 (Quote — `quote`)

引用块是一个 `quote` 元素（**不是** `blockquote`），其 `children` 内放若干个 `p`（段落）：

```json
{
  "type": "element",
  "id": "ude36cdba",
  "name": "quote",
  "attrs": {},
  "children": [
    {
      "type": "element",
      "id": "ucd86de2c",
      "name": "p",
      "attrs": {},
      "children": [ { "type": "text", "id": "u5727f61d", "name": "#text", "attrs": {}, "data": "这是引用的内容" } ]
    },
    {
      "type": "element",
      "id": "ue7c63785",
      "name": "p",
      "attrs": {},
      "children": [ { "type": "text", "id": "u9f26bba5", "name": "#text", "attrs": {}, "data": "引用内容的第二行" } ]
    }
  ]
}
```

### 9. 代码块 (Codeblock)

```json
{
  "type": "element",
  "name": "codeblock",
  "attrs": {
    "language": "javascript",
    "customStyle": false
  },
  "children": [
    {
      "type": "text",
      "name": "#text",
      "attrs": {},
      "data": "function hello() {\n  console.log('Hello World');\n}"
    }
  ]
}
```

**支持的语言（`attrs.language`）：**

| 语言标识         | 描述         |
| ---------------- | ------------ |
| `javascript`     | JavaScript   |
| `typescript`     | TypeScript   |
| `python`         | Python       |
| `java`           | Java         |
| `cpp`            | C++          |
| `go`             | Go           |
| `rust`           | Rust         |
| `bash`           | Shell        |
| `json`           | JSON         |
| `html`           | HTML         |
| `css`            | CSS          |
| `markdown`       | Markdown     |

### 10. 表格 (Table)

```json
{
  "type": "element",
  "name": "table",
  "attrs": {},
  "children": [
    {
      "type": "element",
      "name": "thead",
      "attrs": {},
      "children": [
        {
          "type": "element",
          "name": "tr",
          "attrs": {},
          "children": [
            { "type": "element", "name": "th", "attrs": {}, "children": [ { "type": "text", "name": "#text", "attrs": {}, "data": "姓名" } ] },
            { "type": "element", "name": "th", "attrs": {}, "children": [ { "type": "text", "name": "#text", "attrs": {}, "data": "年龄" } ] }
          ]
        }
      ]
    },
    {
      "type": "element",
      "name": "tbody",
      "attrs": {},
      "children": [
        {
          "type": "element",
          "name": "tr",
          "attrs": {},
          "children": [
            { "type": "element", "name": "td", "attrs": {}, "children": [ { "type": "text", "name": "#text", "attrs": {}, "data": "张三" } ] },
            { "type": "element", "name": "td", "attrs": {}, "children": [ { "type": "text", "name": "#text", "attrs": {}, "data": "25" } ] }
          ]
        }
      ]
    }
  ]
}
```

### 11. 图片 (Image)

```json
{
  "type": "element",
  "name": "image",
  "attrs": {
    "src": "https://example.com/image.jpg",
    "alt": "图片描述",
    "width": 800,
    "height": 600,
    "layout": "center"
  },
  "children": []
}
```

**图片布局选项（`attrs.layout`）：**

| 值        | 描述  |
| --------- | ----- |
| `left`    | 左对齐 |
| `center`  | 居中  |
| `right`   | 右对齐 |
| `full`    | 全宽  |

### 12. 链接 (Link — `link` 元素)

超链接是**嵌套在段落等块级节点内的 `link` 元素**（**不是**文本节点的 `attrs.link` 属性），`src` 为链接地址，`children` 内用 `text` 节点承载链接文本。`external: true` 表示外链。

```json
{
  "type": "element",
  "name": "p",
  "attrs": {},
  "children": [
    {
      "type": "element",
      "id": "ub7c3be9d",
      "name": "link",
      "attrs": {
        "src": "https://www.google.com",
        "external": true
      },
      "children": [
        { "type": "text", "id": "u2842a91b", "name": "#text", "attrs": {}, "data": "Google" }
      ]
    }
  ]
}
```

**`link` 的 `attrs` 字段说明：**

| 字段       | 类型      | 说明                              |
| ---------- | --------- | --------------------------------- |
| `src`      | `string`  | 链接地址（URL）                   |
| `external` | `boolean` | 是否外链（`true` = 外链）         |

### 13. 分隔线 (Horizontal Rule — `hole` → `card`)

分割线由 `hole` 元素包裹一个 `card` 节点（`name: "hr"`，`cardType: "block"`）组成（**不是**裸的 `hr` 元素）：

```json
{
  "type": "element",
  "id": "uf8d5077d",
  "name": "hole",
  "attrs": {},
  "children": [
    {
      "type": "card",
      "id": "B3ees",
      "name": "hr",
      "attrs": { "value": {}, "cardType": "block" },
      "cardType": "block"
    }
  ]
}
```

> 注意该 `card` 节点的 `type` 为 `"card"`（而非 `"element"`），这是编辑器卡片节点的统一形态。`value` 一般为 `{}`。

### 14. 行内代码 (Inline Code)

行内代码是**嵌套在段落等块级节点内的 `element` 子节点**，`name` 为 `"code"`，内部用 `text` 节点承载代码文本。代码文本自身仍可带格式标记（如 `color`、`bold`）。

```json
{
  "type": "element",
  "name": "p",
  "attrs": {},
  "children": [
    {
      "type": "text",
      "name": "#text",
      "attrs": {},
      "data": "以下是一段行业代码的演示\n"
    },
    {
      "type": "element",
      "name": "code",
      "attrs": {},
      "children": [
        { "type": "text", "name": "#text", "attrs": {}, "data": "background: " },
        { "type": "text", "name": "#text", "attrs": { "color": "#1890FF" }, "data": "var" },
        { "type": "text", "name": "#text", "attrs": { "color": "#9254DE" }, "data": "(" },
        { "type": "text", "name": "#text", "attrs": {}, "data": "--lakex-editor-border-secondary, " },
        { "type": "text", "name": "#text", "attrs": { "bold": true }, "data": "#d9d9d9" },
        { "type": "text", "name": "#text", "attrs": { "color": "#9254DE" }, "data": ")" },
        { "type": "text", "name": "#text", "attrs": {}, "data": ";" }
      ]
    }
  ]
}
```

> 注意区分「行内代码」(`name: "code"` 的 `element`) 与「代码块」(`name: "codeblock"` 的 `element`，见第 9 节)。两者都是 `element` 节点，只是 `name` 不同、用途不同。

### 15. 文本格式标记（组合）

```json
{
  "type": "element",
  "name": "p",
  "attrs": {},
  "children": [
    { "type": "text", "name": "#text", "attrs": { "bold": true }, "data": "粗体" },
    { "type": "text", "name": "#text", "attrs": { "italic": true }, "data": "斜体" },
    { "type": "text", "name": "#text", "attrs": { "underline": true }, "data": "下划线" },
    { "type": "text", "name": "#text", "attrs": { "strikethrough": true }, "data": "删除线" },
    { "type": "text", "name": "#text", "attrs": { "color": "#DF2A3F" }, "data": "带颜色的文字" }
  ]
}
```

> 行内代码请用第 14 节的 `name: "code"` 元素表示，不要写成文本 `attrs` 里的 `code: true`。超链接请用第 12 节的 `name: "link"` 元素表示，不要写成文本 `attrs.link`。

### 16. 自定义卡片 (Custom Card)

#### 思维导图卡片 (MindMap)

```json
{
  "type": "element",
  "name": "card",
  "attrs": {
    "value": {
      "$name": "mindmap-card",
      "markdown": "- 中心主题\n  - 分支1\n    - 子分支1\n  - 分支2\n    - 子分支2",
      "cardHeight": 400
    }
  },
  "children": []
}
```

#### 文本绘图卡片 (TextToDiagram)

```json
{
  "type": "element",
  "name": "card",
  "attrs": {
    "value": {
      "$name": "text-to-diagram",
      "code": "graph TD\n    A[开始] --> B{条件}\n    B -->|是| C[执行]\n    B -->|否| D[结束]",
      "type": "mermaid",
      "cardHeight": 300,
      "showEditor": true,
      "showPreview": true
    }
  },
  "children": []
}
```

**支持的图表类型（`attrs.value.type`）：**

| 类型          | 描述         |
| ------------- | ------------ |
| `mermaid`     | Mermaid 图表 |
| `flowchart`   | 流程图       |
| `plantuml`    | PlantUML     |
| `graphviz`    | Graphviz     |

> 块级卡片（如上面思维导图/图表）通常也以 `hole` 元素包裹 `card`（`type:"card"`、`cardType:"block"`）的形式出现，与第 13 节分割线的结构一致。

## 复合文档示例

### 完整文档示例（真实 JSON 格式，覆盖本次新增节点）

以下示例整合了行高、对齐、缩进、有序/无序/任务列表、引用、链接、分割线等真实导出形态：

```json
{
  "type": "element",
  "id": "u9e39949c",
  "name": "#root",
  "attrs": { "meta": {} },
  "children": [
    { "type": "element", "id": "YzbPm", "name": "h3", "attrs": {}, "children": [ { "type": "text", "id": "u1e97c6f1", "name": "#text", "attrs": {}, "data": "行高" } ] },
    { "type": "element", "id": "u1e564f30", "name": "p", "attrs": {}, "children": [ { "type": "text", "id": "u11d3dbf8", "name": "#text", "attrs": {}, "data": "默认行高" } ] },
    { "type": "element", "id": "u76131a23", "name": "p", "attrs": { "lineHeight": 1 }, "children": [ { "type": "text", "id": "u1ae9b010", "name": "#text", "attrs": {}, "data": "行高 1" } ] },
    { "type": "element", "id": "u2640345b", "name": "p", "attrs": { "lineHeight": 1.5 }, "children": [ { "type": "text", "id": "u769376b1", "name": "#text", "attrs": {}, "data": "行高 1.5" } ] },
    { "type": "element", "id": "nJG8j", "name": "h3", "attrs": {}, "children": [ { "type": "text", "id": "ufdc6ec15", "name": "#text", "attrs": {}, "data": "对齐设置：" } ] },
    { "type": "element", "id": "u78099a67", "name": "p", "attrs": { "alignment": "center" }, "children": [ { "type": "text", "id": "ud50c0291", "name": "#text", "attrs": {}, "data": "居中对齐" } ] },
    { "type": "element", "id": "u4f5b81bd", "name": "p", "attrs": { "alignment": "right" }, "children": [ { "type": "text", "id": "u84a5abdd", "name": "#text", "attrs": {}, "data": "右对齐" } ] },
    { "type": "element", "id": "uf17bc551", "name": "p", "attrs": { "alignment": "left", "indent": 1 }, "children": [ { "type": "text", "id": "u5fccb267", "name": "#text", "attrs": {}, "data": "缩进 1" } ] },
    { "type": "element", "id": "IvP82", "name": "h3", "attrs": {}, "children": [ { "type": "text", "id": "u104c7344", "name": "#text", "attrs": {}, "data": "无序列表：" } ] },
    { "type": "element", "id": "u08fc5c8e", "name": "uli", "attrs": { "list": "u2fed341c", "alignment": "left", "indexStyle": {}, "fid": "uaf5b48bd", "indexType": 0, "parentIndex": [], "index": 0 }, "children": [ { "type": "text", "id": "u9ce3ba8c", "name": "#text", "attrs": {}, "data": "无序列表 1" } ] },
    { "type": "element", "id": "uc30b7574", "name": "uli", "attrs": { "list": "u2fed341c", "alignment": "left", "indexStyle": {}, "fid": "uaf5b48bd", "indexType": 0, "parentIndex": [], "index": 1 }, "children": [ { "type": "text", "id": "u13fd1240", "name": "#text", "attrs": {}, "data": "无序列表 2" } ] },
    { "type": "element", "id": "ua2572bd5", "name": "p", "attrs": {}, "children": [] },
    { "type": "element", "id": "HxjQr", "name": "h3", "attrs": {}, "children": [ { "type": "text", "id": "u0532bab0", "name": "#text", "attrs": {}, "data": "有序列表：" } ] },
    { "type": "element", "id": "uf375811d", "name": "oli", "attrs": { "list": "u34dfef8c", "indexType": 0, "fid": "ub13d1cfc", "parentIndex": [], "index": 0, "indexStyle": {} }, "children": [ { "type": "text", "id": "u0281f73e", "name": "#text", "attrs": {}, "data": "有序列表 1" } ] },
    { "type": "element", "id": "u881ebbeb", "name": "oli", "attrs": { "list": "u34dfef8c", "indexType": 0, "fid": "ub13d1cfc", "parentIndex": [0], "index": 0, "indexStyle": {}, "level": 1 }, "children": [ { "type": "text", "id": "ua959092f", "name": "#text", "attrs": {}, "data": "有序列表 1.1" } ] },
    { "type": "element", "id": "ub88721c2", "name": "oli", "attrs": { "list": "u34dfef8c", "indexType": 0, "fid": "ub13d1cfc", "parentIndex": [], "index": 1, "indexStyle": {} }, "children": [ { "type": "text", "id": "u8724ce0b", "name": "#text", "attrs": {}, "data": "有序列表 2" } ] },
    { "type": "element", "id": "uefe352c3", "name": "p", "attrs": {}, "children": [] },
    { "type": "element", "id": "yHnep", "name": "h3", "attrs": {}, "children": [ { "type": "text", "id": "u457dcdf7", "name": "#text", "attrs": {}, "data": "任务列表" } ] },
    { "type": "element", "id": "u5a0c2abc", "name": "tli", "attrs": { "list": "u24bec4c8", "fid": "u14b2e83d", "indexType": 0, "parentIndex": [], "index": 0 }, "children": [ { "type": "text", "id": "u7f49ed99", "name": "#text", "attrs": {}, "data": "未完成任务 1" } ] },
    { "type": "element", "id": "ubadf1ccf", "name": "tli", "attrs": { "list": "u24bec4c8", "fid": "u14b2e83d", "indexType": 0, "parentIndex": [], "index": 1, "checked": true, "version": 1784861831687 }, "children": [ { "type": "text", "id": "ubf56ba84", "name": "#text", "attrs": {}, "data": "已完成的任务 2" } ] },
    { "type": "element", "id": "u87c158d0", "name": "p", "attrs": {}, "children": [] },
    { "type": "element", "id": "gV0CI", "name": "h3", "attrs": {}, "children": [ { "type": "text", "id": "u1f1f5115", "name": "#text", "attrs": {}, "data": "链接" } ] },
    { "type": "element", "id": "u3a6132ac", "name": "p", "attrs": {}, "children": [ { "type": "element", "id": "ub7c3be9d", "name": "link", "attrs": { "src": "https://www.google.com", "external": true }, "children": [ { "type": "text", "id": "u2842a91b", "name": "#text", "attrs": {}, "data": "Google" } ] } ] },
    { "type": "element", "id": "DgspT", "name": "h3", "attrs": {}, "children": [ { "type": "text", "id": "u3cd4936b", "name": "#text", "attrs": {}, "data": "引用" } ] },
    { "type": "element", "id": "ude36cdba", "name": "quote", "attrs": {}, "children": [ { "type": "element", "id": "ucd86de2c", "name": "p", "attrs": {}, "children": [ { "type": "text", "id": "u5727f61d", "name": "#text", "attrs": {}, "data": "这是引用的内容" } ] }, { "type": "element", "id": "ue7c63785", "name": "p", "attrs": {}, "children": [ { "type": "text", "id": "u9f26bba5", "name": "#text", "attrs": {}, "data": "引用内容的第二行" } ] } ] },
    { "type": "element", "id": "U5BTK", "name": "h3", "attrs": {}, "children": [ { "type": "text", "id": "u2bd39b0d", "name": "#text", "attrs": {}, "data": "分割线" } ] },
    { "type": "element", "id": "uf8d5077d", "name": "hole", "attrs": {}, "children": [ { "type": "card", "id": "B3ees", "name": "hr", "attrs": { "value": {}, "cardType": "block" }, "cardType": "block" } ] }
  ]
}
```

## JSON 生成规范

### 规则总结

1. **根节点固定为 `{ "type": "element", "name": "#root", "attrs": { "meta": {} }, "children": [...] }`**（不是 `type: "doc"`）。
2. **每个节点都带 `type` / `id` / `name` / `attrs`** 四个基础字段；`element` 额外有 `children`，`text` 额外有 `data`；`card` 类型额外有 `cardType`。
3. **块级标签写在 `name` 上**（`p`/`h1`/`table`/`image`/`uli`/`oli`/`tli`/`quote`/`link`/`code`/`codeblock`/`card`…），而不是 `type` 上。
4. **文本内容与格式标记分离**：
   - 文本写在 `text` 节点的 **`data`** 字段；
   - 加粗/斜体/颜色等写在 `text` 节点的 **`attrs`** 内（如 `attrs: { "bold": true, "color": "#DF2A3F" }`）。
5. **段落排版属性**：`lineHeight`（数字倍数）、`alignment`（`left`/`center`/`right`/`justify`）、`indent`（数字层级）写在 **`p` 的 `attrs`** 上，缺省即默认。
6. **行内代码是独立元素**：用 `{ "type": "element", "name": "code", "attrs": {}, "children": [ text... ] }` 表示，**不是**文本节点的 `code: true` 属性。代码块用 `name: "codeblock"`。
7. **超链接是独立元素**：用 `{ "type": "element", "name": "link", "attrs": { "src": "...", "external": true }, "children": [ text... ] }` 表示，**不是**文本节点的 `attrs.link` 属性。
8. **列表项用 `uli` / `oli` / `tli`**（**不是** `ul`/`ol`/`li`）：
   - 同一列表项共享 `list` 与 `fid`；`index` 同级递增；`indexType` 区分列表样式（`0` 无序/`1`/`2` 有序样式，任务列表为 `0`）。
   - 嵌套通过 `parentIndex`（`number[]`，父项索引路径）与 `level`（`1`/`2`…）表达。
   - 完成的任务项加 `checked: true` 与 `version`（时间戳）。
   - 不同列表之间用一个空 `p` 节点（`children: []`）隔断。
9. **引用块用 `name: "quote"`**（**不是** `blockquote`），其 `children` 内放若干 `p`。
10. **分隔线用 `hole` 包裹 `card`**（`type:"card"`、`name:"hr"`、`cardType:"block"`），**不是**裸的 `hr` 元素。
11. **空块 / 自闭合块**（如 `image`、`card`、`hole` 内的 `card`）仍需 `attrs: {}` 与 `children: []`（或对应结构）。
12. **遵循标准 JSON 规范**：数组/对象末尾不加逗号，使用双引号。

### 错误示例

```json
// ❌ 错误：使用了简化 schema（text 字段 + type 即标签），与真实格式不符
{ "type": "p", "children": [ { "text": "段落内容", "bold": true } ] }

// ❌ 错误：文本节点缺 type/name/data，且把格式标在顶层
{ "type": "p", "children": [ { "content": "文本", "bold": true } ] }

// ❌ 错误：根节点写成 type:"doc"
{ "type": "doc", "children": [...] }

// ❌ 错误：格式标记值类型错误
{ "type": "text", "name": "#text", "attrs": { "bold": "true" }, "data": "内容" }

// ❌ 错误：列表用 ul/ol/li（真实为 uli/oli/tli）
{ "type": "element", "name": "ul", "attrs": {}, "children": [ { "type": "element", "name": "li", "attrs": {}, "children": [ { "type": "text", "name": "#text", "attrs": {}, "data": "项" } ] } ] }

// ❌ 错误：引用用 blockquote（真实为 quote）
{ "type": "element", "name": "blockquote", "attrs": {}, "children": [ { "type": "element", "name": "p", "attrs": {}, "children": [ { "type": "text", "name": "#text", "attrs": {}, "data": "引用" } ] } ] }

// ❌ 错误：链接写成文本属性 attrs.link（真实为 link 元素）
{ "type": "element", "name": "p", "attrs": {}, "children": [ { "type": "text", "name": "#text", "attrs": { "link": "https://example.com" }, "data": "访问" } ] }

// ❌ 错误：分割线写成裸 hr 元素（真实为 hole 包裹 card）
{ "type": "element", "name": "hr", "attrs": {}, "children": [] }

// ❌ 错误：行内代码写成了文本属性 code:true（应为 name:"code" 的 element）
{ "type": "element", "name": "p", "attrs": {}, "children": [ { "type": "text", "name": "#text", "attrs": { "code": true }, "data": "var(--x)" } ] }
```

### 正确示例

```json
// ✅ 正确：完整 element 结构 + text 节点的 attrs 承载格式
{
  "type": "element",
  "name": "p",
  "attrs": {},
  "children": [
    { "type": "text", "name": "#text", "attrs": { "bold": true }, "data": "段落内容" }
  ]
}

// ✅ 正确：段落属性（行高/对齐/缩进）
{
  "type": "element",
  "name": "p",
  "attrs": { "alignment": "center", "lineHeight": 1.5, "indent": 1 },
  "children": [ { "type": "text", "name": "#text", "attrs": {}, "data": "排版段落" } ]
}

// ✅ 正确：无序列表项 uli（共享 list/fid，index 递增）
{
  "type": "element",
  "name": "uli",
  "attrs": { "list": "u2fed341c", "alignment": "left", "indexStyle": {}, "fid": "uaf5b48bd", "indexType": 0, "parentIndex": [], "index": 0 },
  "children": [ { "type": "text", "name": "#text", "attrs": {}, "data": "项 1" } ]
}

// ✅ 正确：引用用 quote 元素
{
  "type": "element",
  "name": "quote",
  "attrs": {},
  "children": [ { "type": "element", "name": "p", "attrs": {}, "children": [ { "type": "text", "name": "#text", "attrs": {}, "data": "引用内容" } ] } ]
}

// ✅ 正确：链接是 name:"link" 的元素
{
  "type": "element",
  "name": "p",
  "attrs": {},
  "children": [ { "type": "element", "name": "link", "attrs": { "src": "https://example.com", "external": true }, "children": [ { "type": "text", "name": "#text", "attrs": {}, "data": "访问" } ] } ]
}

// ✅ 正确：分割线用 hole 包裹 card
{
  "type": "element",
  "name": "hole",
  "attrs": {},
  "children": [ { "type": "card", "id": "B3ees", "name": "hr", "attrs": { "value": {}, "cardType": "block" }, "cardType": "block" } ]
}

// ✅ 正确：行内代码是 name:"code" 的 element，内嵌在段落中
{
  "type": "element",
  "name": "p",
  "attrs": {},
  "children": [
    { "type": "text", "name": "#text", "attrs": {}, "data": "示例：" },
    { "type": "element", "name": "code", "attrs": {}, "children": [ { "type": "text", "name": "#text", "attrs": {}, "data": "var(--x)" } ] }
  ]
}
```

## 与 LakexEditor 组件的集成

### 设置初始内容

```tsx
import { LakexEditor } from '@dlient/lakex-doc-react';
import '@dlient/lakex-doc-react/style.css';

const initialContent = {
  type: 'json' as const,
  text: JSON.stringify({
    type: 'element',
    name: '#root',
    attrs: { meta: {} },
    children: [
      {
        type: 'element',
        name: 'p',
        attrs: {},
        children: [ { type: 'text', name: '#text', attrs: {}, data: 'Hello World' } ]
      }
    ]
  })
};

<LakexEditor content={initialContent} />
```

### 获取内容变化

```tsx
<LakexEditor
  onContentChange={(contents) => {
    const jsonContent = contents.find(c => c.type === 'json');
    if (jsonContent) {
      const document = JSON.parse(jsonContent.text);
      // document 即为 { type:"element", name:"#root", attrs, children } 结构
      console.log('Document JSON:', document);
    }
  }}
/>
```

## 扩展指南

### 创建自定义卡片类型

1. 定义卡片配置（参考 README 中的自定义卡片章节）
2. 在 `slash.ts` 中注册卡片
3. JSON 格式使用 `element`(`name:"card"`) + `attrs.value.$name` 标识；块级卡片通常以 `hole` 包裹 `card`(`type:"card"`)

### 新增节点类型

如需支持新的节点类型，请按照以下格式扩展（注意 `name` 承载标签名）：

```json
{
  "type": "element",
  "name": "custom-node-type",
  "attrs": { "customProperty": "value" },
  "children": []
}
```

***

**版本**: 2.2（依据编辑器真实导出 JSON 修正：列表为 `uli`/`oli`/`tli`、引用为 `quote`、链接为 `link` 元素、分割线为 `hole`→`card`；新增段落属性 `lineHeight`/`alignment`/`indent`、任务列表 `checked`/`version`、有序列表 `indexType`/`level`/`parentIndex` 规范）\
**适用编辑器**: @dlient/lakex-doc-react v0.1+\
**更新时间**: 2026-07-24
