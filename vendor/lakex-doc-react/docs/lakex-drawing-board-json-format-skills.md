# Lakex AI 画板 JSON 格式规范

本文档用于指导 AI 把自然语言描述转换为 Lakex 画板可导入的 JSON。普通图表使用稳定、受控的 AI 中间格式；原生思维导图允许使用受校验的 `plaitValue` 树结构。应用会校验响应，再转换或挂载为原生画板元素。

<!-- AI_RUNTIME_SPEC_START -->

## AI 运行时精简规范

只输出一个合法 JSON 对象，不要 Markdown、代码围栏、解释或注释。

普通画板、流程图、UML、Smart 和 ER 根结构：

`{"version":1,"diagramType":"flowchart","title":"可选标题","nodes":[],"edges":[]}`

节点结构：

`{"id":"唯一ID","shape":"图形","x":80,"y":80,"width":180,"height":64,"text":"文字","style":{"fill":"#E8F1FF","strokeColor":"#5B8FF9","strokeWidth":1.5,"strokeStyle":"solid","fontSize":14,"textColor":"#273142"}}`

连线结构：

`{"id":"唯一ID","source":"节点ID","target":"节点ID","sourceAnchor":"bottom","targetAnchor":"top","label":"可选文字","style":{"lineType":"elbow","strokeColor":"#697586","strokeWidth":1.5,"strokeStyle":"solid","endMarker":"arrow"}}`

允许的 `shape`：

`rectangle,roundRectangle,ellipse,diamond,triangle,parallelogram,trapezoid,pentagon,hexagon,octagon,cloud,text,process,terminal,decision,data,connector,manualInput,preparation,predefinedProcess,document,multiDocument,database,internalStorage,delay,display,offPage,noteSquare,actor,useCase,component,container,note,package,simpleClass,class,interface,object,componentBox,activityClass,branchMerge,port,combinedFragment,template,activation,deletion`

约束：

- `version` 必须是数字 `1`，不能是字符串。
- `diagramType` 必须根据用户意图填写为 `board,flowchart,uml,smart,er` 之一，并严格使用第 8 节对应分类的图形和布局规则。
- ID 只能包含字母、数字、下划线、短横线；全部唯一。
- 最多 80 个节点、120 条连线。
- 节点必须使用 `shape` 和 `text` 字段，不能改成 `type`、`label`。
- 坐标范围 `-5000..5000`；宽 `40..1200`；高 `24..800`。
- 颜色只能是 `#RRGGBB`，填充可为 `transparent`。
- 锚点只能是 `top,right,bottom,left`。
- 线型只能是 `straight,elbow,curve`，箭头只能是 `arrow,none`。
- 描边样式 `strokeStyle` 只能是 `solid,dashed,dotted`，默认 `solid`。
- 每条连线必须引用已存在且不同的 source/target 节点。
- 图形不能重叠；同层节点对齐，间距至少 32；流程图优先从上到下。
- 连线不得穿过任何非起止节点，平行线段至少间隔 24px；分支节点周围预留至少 48px 连线通道。
- `decision` 的“是/否”出口必须使用不同 `sourceAnchor`：纵向主流程通常“是”使用 `bottom`，“否”使用 `left` 或 `right`，并把否分支节点放在对应侧；禁止两条分支共用同一出口后重叠。
- 锚点必须朝向另一个节点：上方来源进入目标用 `targetAnchor:top`，下方来源用 `bottom`，左侧来源用 `left`，右侧来源用 `right`。如果来源中心的 x 落在目标宽度内，禁止从目标 `left/right` 进入；如果来源中心的 y 落在目标高度内，禁止从目标 `top/bottom` 进入。
- 多条连线进入同一节点且来源方向不同时，必须使用不同 `targetAnchor`；例如上方来源进入 `top`、左侧来源进入 `left`，不能为了对齐而让连线横穿目标图形。
- 普通节点推荐 180×64，判断节点推荐 180×110。
- 只要用户要求思维导图、脑图或 mind map，禁止使用 `nodes + edges`，必须返回原生 `plaitValue` 树结构。

思维导图强制根结构：

`{"plaitValue":[{"id":"mind_root","type":"mind","data":{"topic":{"children":[{"text":"中心主题"}],"type":"paragraph"}},"children":[],"layout":"right","points":[[0,0]]}]}`

思维导图约束：

- 顶层只能放 `type:"mind"` 根节点；所有后代必须是 `type:"mind_child"`。
- 父子关系只通过嵌套 `children` 表达，叶子必须使用 `children:[]`；禁止输出独立 `edges`。
- 每个节点都必须有唯一 `id` 和 `data.topic`；`topic` 必须是 `{"children":[{"text":"文字"}],"type":"paragraph"}`。
- 根节点必须包含 `layout` 和单点 `points`；默认使用 `layout:"right"`、`points:[[0,0]]`。后代节点不要输出 `points`。
- 思维导图响应不要同时输出 `version`、`nodes`、`edges`、`shape`、`x`、`y`、`width` 或 `height`。

<!-- AI_RUNTIME_SPEC_END -->

## 1. 输出要求

1. 只输出一个合法 JSON 对象，不要输出 Markdown 代码块、解释、注释或前后缀。
2. 普通图表根对象必须包含 `version`、`diagramType`、`nodes`、`edges`；原生思维导图必须改用第 7 节的 `plaitValue`。
3. 普通图表的 `version` 固定为 `1`。
4. 所有 `id` 在同一份 JSON 内唯一，只能包含字母、数字、下划线和短横线。
5. 最多 80 个节点、120 条连线。不要生成孤立且没有信息的装饰元素。
6. 坐标单位为画板逻辑像素。建议把图形放在 `x=80..1400`、`y=80..900` 范围内。
7. 图形之间至少保留 32px 间距，避免重叠；同层节点对齐，布局方向保持一致。
8. 节点文本应简洁。中文通常不超过 20 个字，英文通常不超过 60 个字符。
9. 不允许输出 HTML、脚本、图片 URL、data URL、事件、函数或 Drawnix/Plait 私有字段。

## 2. 普通图表根对象

```json
{
  "version": 1,
  "diagramType": "flowchart",
  "title": "可选的图表标题",
  "nodes": [],
  "edges": []
}
```

| 字段      | 类型   | 必填 | 说明                               |
| --------- | ------ | ---- | ---------------------------------- |
| `version` | number | 是   | 固定为 `1`                         |
| `diagramType` | string | 是 | `board,flowchart,uml,smart,er` 之一 |
| `title`   | string | 否   | 图表标题，应用不会把它自动插入画布 |
| `nodes`   | array  | 是   | 节点列表                           |
| `edges`   | array  | 是   | 连线列表                           |

## 3. 节点

```json
{
  "id": "node_start",
  "shape": "terminal",
  "x": 120,
  "y": 120,
  "width": 160,
  "height": 64,
  "text": "开始",
  "style": {
    "fill": "#E8F1FF",
    "strokeColor": "#5B8FF9",
    "strokeWidth": 1.5,
    "strokeStyle": "solid",
    "fontSize": 14,
    "textColor": "#273142"
  }
}
```

### 3.1 节点字段

| 字段     | 类型   | 必填 | 约束                         |
| -------- | ------ | ---- | ---------------------------- |
| `id`     | string | 是   | 唯一，1–64 字符              |
| `shape`  | string | 是   | 必须来自第 3.2 节            |
| `x`      | number | 是   | 左上角 X，范围 `-5000..5000` |
| `y`      | number | 是   | 左上角 Y，范围 `-5000..5000` |
| `width`  | number | 是   | 范围 `40..1200`              |
| `height` | number | 是   | 范围 `24..800`               |
| `text`   | string | 否   | 最多 500 字符                |
| `style`  | object | 否   | 只允许第 3.3 节字段          |

### 3.2 支持的图形

基础图形：

- `rectangle`：矩形
- `roundRectangle`：圆角矩形
- `ellipse`：椭圆
- `diamond`：菱形
- `triangle`：三角形
- `parallelogram`：平行四边形
- `trapezoid`：梯形
- `pentagon`：五边形
- `hexagon`：六边形
- `octagon`：八边形
- `cloud`：云形
- `text`：无边框文本

流程图：

- `process`：处理步骤
- `terminal`：开始或结束
- `decision`：条件判断
- `data`：数据输入或输出
- `connector`：页内连接
- `manualInput`：手动输入
- `preparation`：准备
- `predefinedProcess`：子流程
- `document`：文档
- `multiDocument`：多文档
- `database`：数据库
- `internalStorage`：内部存储
- `delay`：延迟
- `display`：显示
- `offPage`：页外连接
- `noteSquare`：注释

Smart：

- `actor`：角色
- `useCase`：用例
- `component`：组件
- `container`：容器
- `note`：便签
- `package`：包

UML：

- `actor`：角色
- `useCase`：用例
- `component`：组件
- `container`：容器
- `note`：便签
- `package`：包
- `simpleClass`：简单类
- `class`：类
- `interface`：接口
- `object`：对象
- `componentBox`：组件框
- `activityClass`：活动
- `branchMerge`：分支或合并
- `port`：端口
- `combinedFragment`：组合片段
- `template`：模板
- `activation`：激活生命线
- `deletion`：销毁节点

ER：

- `rectangle`：实体
- `roundRectangle`：弱实体
- `diamond`：关系
- `ellipse`：属性
- `parallelogram`：关联实体
- `class`：带字段明细的实体

### 3.3 节点样式

| 字段          | 类型   | 约束                              |
| ------------- | ------ | --------------------------------- |
| `fill`        | string | `#RRGGBB`；透明使用 `transparent` |
| `strokeColor` | string | `#RRGGBB`                         |
| `strokeWidth` | number | `0..8`                            |
| `strokeStyle` | string | `solid`、`dashed`、`dotted`       |
| `fontSize`    | number | `10..72`                          |
| `textColor`   | string | `#RRGGBB`                         |

推荐色板：

- 蓝：填充 `#E8F1FF`，描边 `#5B8FF9`
- 绿：填充 `#EAF8F0`，描边 `#5BB98C`
- 黄：填充 `#FFF6D9`，描边 `#D9A441`
- 橙：填充 `#FFF0E6`，描边 `#E58B50`
- 紫：填充 `#F3EBFF`，描边 `#9B71D1`
- 灰：填充 `#F3F4F6`，描边 `#8B95A5`
- 默认正文色：`#273142`

颜色应表达语义并保持一致。普通流程建议使用同一主色，仅给判断、异常或关键节点使用强调色。

## 4. 连线

```json
{
  "id": "edge_start_to_check",
  "source": "node_start",
  "target": "node_check",
  "sourceAnchor": "bottom",
  "targetAnchor": "top",
  "label": "",
  "style": {
    "lineType": "elbow",
    "strokeColor": "#697586",
    "strokeWidth": 1.5,
    "strokeStyle": "solid",
    "endMarker": "arrow"
  }
}
```

### 4.1 连线字段

| 字段           | 类型   | 必填 | 约束                                        |
| -------------- | ------ | ---- | ------------------------------------------- |
| `id`           | string | 是   | 唯一，1–64 字符                             |
| `source`       | string | 是   | 必须引用存在的节点 ID                       |
| `target`       | string | 是   | 必须引用存在的节点 ID，不能与 `source` 相同 |
| `sourceAnchor` | string | 否   | `top`、`right`、`bottom`、`left`，默认自动  |
| `targetAnchor` | string | 否   | `top`、`right`、`bottom`、`left`，默认自动  |
| `label`        | string | 否   | 最多 120 字符，例如“是”“否”                 |
| `style`        | object | 否   | 见第 4.2 节                                 |

### 4.2 连线样式

| 字段          | 类型   | 约束                         |
| ------------- | ------ | ---------------------------- |
| `lineType`    | string | `straight`、`elbow`、`curve` |
| `strokeColor` | string | `#RRGGBB`                    |
| `strokeWidth` | number | `0.5..8`                     |
| `strokeStyle` | string | `solid`、`dashed`、`dotted`  |
| `endMarker`   | string | `arrow` 或 `none`            |

默认使用 `elbow` 和 `arrow`。流程方向应通过锚点表达，例如纵向流程使用 `bottom -> top`，横向流程使用 `right -> left`。

### 4.3 防止连线与箭头重叠

- 连线只能在起点和终点处接触节点边界，任何中间线段都不能穿过其他节点。
- 同一节点有多条出边时，优先分配不同的 `sourceAnchor`；同一节点有多条入边时，优先分配不同的 `targetAnchor`。
- 纵向流程的普通步骤使用 `bottom -> top`。判断节点的主分支继续向下，使用 `bottom -> top`；另一分支向左或向右展开，使用 `left -> right` 或 `right -> left`。
- 判断条件的两个出口不得同时使用 `bottom`，否则箭头和“是/否”标签会重叠。默认约定：“是”沿主流程向下，“否”向距离其他节点更远的一侧展开。
- 分支目标节点必须位于出口方向：从 `left` 离开的目标放在判断节点左侧，从 `right` 离开的目标放在右侧，从 `bottom` 离开的目标放在下方。
- `targetAnchor` 必须位于面向来源节点的一侧：来源在上方时连接 `top`，来源在下方时连接 `bottom`，来源在左侧时连接 `left`，来源在右侧时连接 `right`。不得选择需要让最后一段连线穿过目标内部才能到达的锚点。
- 特别注意“斜上方来源”：若来源中心的 x 仍落在目标的 `[x, x + width]` 范围内，应视为上方来源并连接 `top`，不能连接 `left/right`；“斜侧方来源”按相同原则检查 y 投影。
- 同一目标有多条入边时，根据各来源位置分配不同入口。例如失败节点同时接收上方注册流程和左侧校验流程时，应分别使用 `top` 和 `left`，不能共用入口或让其中一条线穿过失败节点。
- 两条平行连线的可见线段至少间隔 24px；连线与非起止节点边缘至少间隔 24px；判断节点与分支目标之间建议保留 80px 以上通道。
- 回流线放在流程外侧，不能逆向穿过主流程节点。回流目标应使用侧边锚点，例如 `top -> left`，不要与主流程的 `bottom -> top` 共用路径。
- “是”“否”等标签必须属于不同连线并跟随各自出口；标签附近至少保留 16px 空白，不要放在两条线的交叉点或重合线段上。

纵向判断分支推荐结构：

```json
[
  {
    "id": "edge_yes",
    "source": "decision_stock",
    "target": "deduct_stock",
    "sourceAnchor": "bottom",
    "targetAnchor": "top",
    "label": "是",
    "style": { "lineType": "elbow", "endMarker": "arrow" }
  },
  {
    "id": "edge_no",
    "source": "decision_stock",
    "target": "sold_out",
    "sourceAnchor": "right",
    "targetAnchor": "left",
    "label": "否",
    "style": { "lineType": "elbow", "endMarker": "arrow" }
  }
]
```

其中 `deduct_stock` 必须位于 `decision_stock` 下方，`sold_out` 必须位于其右侧。若右侧已有节点，则整体镜像到左侧，并改用 `left -> right`。

## 5. 布局规则

- 先确定主方向：流程图优先从上到下，架构图优先从左到右。
- 同一层级使用相同的 `width`、`height` 和对齐线。
- 一般节点建议 `width=160..220`、`height=56..88`。
- 判断节点建议 `width=150..190`、`height=90..120`。
- UML 类图建议 `width=200..280`、`height=120..220`。
- 横向节点中心间距建议 240px，纵向节点中心间距建议 140px。
- 分支汇聚前后留出额外空间，判断分支建议横向中心间距至少 280px，避免连线穿过节点。
- 先放置节点，再按节点位置分配锚点；若连线会穿过节点，应移动分支节点或切换到另一侧，而不是继续输出重叠连线。
- 连线只连接语义相关节点，不要用连线绘制装饰边框。

### 5.1 思维导图

思维导图不使用本节的坐标和连线布局规则，也不允许使用普通 `nodes + edges` 图形模拟。必须直接使用第 7 节的原生 `plaitValue` 树结构，由 Plait Mind 组件根据 `children` 和 `layout` 自动计算节点位置与分支连线。

## 6. 普通流程图中间格式示例

用户描述：“生成一个用户提交工单的流程图，审核通过后进入处理中，不通过则退回修改，最后完成。”

模型在使用 `nodes + edges` 模式时应只返回以下 JSON；这段示例是流程图示例，其他类型必须改用第 8 节对应规范，不适用于原生思维导图 `plaitValue` 模式：

```json
{
  "version": 1,
  "diagramType": "flowchart",
  "title": "工单处理流程",
  "nodes": [
    {
      "id": "start",
      "shape": "terminal",
      "x": 360,
      "y": 80,
      "width": 160,
      "height": 56,
      "text": "开始",
      "style": {
        "fill": "#EAF8F0",
        "strokeColor": "#5BB98C",
        "fontSize": 14,
        "textColor": "#273142"
      }
    },
    {
      "id": "submit",
      "shape": "process",
      "x": 350,
      "y": 190,
      "width": 180,
      "height": 64,
      "text": "提交工单"
    },
    {
      "id": "review",
      "shape": "decision",
      "x": 350,
      "y": 310,
      "width": 180,
      "height": 110,
      "text": "审核通过？",
      "style": {
        "fill": "#FFF6D9",
        "strokeColor": "#D9A441"
      }
    },
    {
      "id": "revise",
      "shape": "process",
      "x": 80,
      "y": 330,
      "width": 180,
      "height": 64,
      "text": "退回修改"
    },
    {
      "id": "processing",
      "shape": "process",
      "x": 350,
      "y": 500,
      "width": 180,
      "height": 64,
      "text": "处理中"
    },
    {
      "id": "done",
      "shape": "terminal",
      "x": 360,
      "y": 630,
      "width": 160,
      "height": 56,
      "text": "完成",
      "style": {
        "fill": "#EAF8F0",
        "strokeColor": "#5BB98C"
      }
    }
  ],
  "edges": [
    {
      "id": "e1",
      "source": "start",
      "target": "submit",
      "sourceAnchor": "bottom",
      "targetAnchor": "top"
    },
    {
      "id": "e2",
      "source": "submit",
      "target": "review",
      "sourceAnchor": "bottom",
      "targetAnchor": "top"
    },
    {
      "id": "e3",
      "source": "review",
      "target": "processing",
      "sourceAnchor": "bottom",
      "targetAnchor": "top",
      "label": "是"
    },
    {
      "id": "e4",
      "source": "review",
      "target": "revise",
      "sourceAnchor": "left",
      "targetAnchor": "right",
      "label": "否"
    },
    {
      "id": "e5",
      "source": "revise",
      "target": "submit",
      "sourceAnchor": "top",
      "targetAnchor": "left"
    },
    {
      "id": "e6",
      "source": "processing",
      "target": "done",
      "sourceAnchor": "bottom",
      "targetAnchor": "top"
    }
  ]
}
```

注意：实际响应不能包含上面的 Markdown 代码围栏，只包含 JSON 对象。若生成原生思维导图，则应改用第 7 节的 `{ "plaitValue": [...] }` 根结构。

<!-- AI_NATIVE_MIND_SPEC_START -->

## 7. AI 原生思维导图 `plaitValue` 规范

`plaitValue` 是思维导图组件和画板卡片使用的原生 Plait 元素数组。普通图表继续使用 `version + nodes + edges`，但 AI 生成思维导图时必须直接返回 `{ "plaitValue": [...] }`。不要套用 `drawnix`、`elements` 或其他持久化包裹结构。

### 7.1 原生思维导图结构

思维导图不是由独立的 `edges` 元素组成，而是由一棵嵌套树组成：

- 根节点的 `type` 是 `mind`；兼容旧数据时也可能看到 `mindmap`。
- 子孙节点的 `type` 是 `mind_child`，关系由父节点的 `children` 表达。
- 每个节点都必须有唯一 `id`、`data` 和 `children`；叶子节点使用空数组 `children: []`。
- `data.topic` 是 Slate 段落，不是普通字符串，结构固定为 `{ "children": [{ "text": "..." }], "type": "paragraph" }`。
- 根节点通常有 `layout` 和单点 `points`。`points` 是根节点左上角逻辑坐标，格式为 `[[x, y]]`，不是普通图形的 `[[left, top], [right, bottom]]`。
- `layout` 支持 `right`、`left`、`standard`、`upward`、`downward`，以及 `right-bottom-indented`、`right-top-indented`、`left-top-indented`、`left-bottom-indented`。
- `rightNodeCount` 用于 `standard` 布局区分根节点左右分支；没有左右分支时可以省略。不要把它写到子节点上。
- `fill`、`strokeColor`、`strokeWidth`、`strokeStyle`、`shape`、`branchColor`、`branchWidth`、`branchShape`、`isCollapsed`、`manualWidth` 等是可选的原生样式或布局字段，应使用项目已有值，不要创造新的字段名。
- `shape` 的原生思维导图值是 `round-rectangle` 或 `underline`；它与 AI 中间格式的 `roundRectangle` 不是同一个字段值。

最小可用的原生思维导图示例：

```json
{
  "plaitValue": [
    {
      "id": "tnpPz",
      "type": "mind",
      "data": {
        "topic": {
          "children": [{ "text": "中心主题" }],
          "type": "paragraph"
        }
      },
      "children": [
        {
          "id": "ntyaw",
          "type": "mind_child",
          "data": {
            "topic": {
              "children": [{ "text": "1111" }],
              "type": "paragraph"
            }
          },
          "children": []
        },
        {
          "id": "xNewH",
          "type": "mind_child",
          "data": {
            "topic": {
              "children": [{ "text": "22222" }],
              "type": "paragraph"
            }
          },
          "children": []
        }
      ],
      "layout": "right",
      "points": [[0, 0]]
    }
  ]
}
```

带二级分支时，只需继续嵌套 `children`，不要新增 `edges`：

```json
{
  "id": "ntyaw",
  "type": "mind_child",
  "data": {
    "topic": {
      "children": [{ "text": "用户系统" }],
      "type": "paragraph"
    }
  },
  "children": [
    {
      "id": "ntyaw-login",
      "type": "mind_child",
      "data": {
        "topic": {
          "children": [{ "text": "登录" }],
          "type": "paragraph"
        }
      },
      "children": []
    }
  ]
}
```

### 7.2 原生思维导图与 AI 格式的转换边界

保存或恢复卡片时读取 `value.plaitValue`。调用 AI 时，普通图表使用 `nodes + edges`，需要通过 `convertAIBoardDocument` 转换；原生思维导图可以直接使用 `{ "plaitValue": [...] }`，应用只做安全校验、字段规范化和容器提取，然后通过原生 Mind 插入流程挂载。不要把 `mind_child` 拆成普通几何节点或独立 `edges`；必须保持父子嵌套结构，否则会出现 `mind element has not been mounted` 或无法计算节点边界的问题。

两种响应格式的处理边界如下：

| AI 响应根结构 | 适用场景 | 应用处理 |
| --- | --- | --- |
| `{ "version": 1, "diagramType": "...", "nodes": [], "edges": [] }` | 普通画板、流程图、UML、Smart、ER | 按 `diagramType` 校验图形集合，再转换为 geometry / arrow-line 元素 |
| `{ "plaitValue": [{ "type": "mind", "children": [...] }] }` | 所有思维导图、脑图、mind map 请求 | 提取并校验原生树，直接挂载为 `mind` 元素 |

因此，你给出的 `plaitValue` 不需要再转换成 `nodes + edges`；只需要保留完整的 `mind` / `mind_child` 树结构，并作为 AI 响应的根对象返回。

<!-- AI_NATIVE_MIND_SPEC_END -->

<!-- AI_DIAGRAM_TYPE_SPEC_START -->

## 8. 流程图、UML、Smart 与 ER 分类规范

除原生思维导图外，AI 必须先识别用户需要的图表类型，并在根对象中填写对应的 `diagramType`。除非用户明确要求混合图，否则禁止跨分类借用图形；存在对应语义图形时，不能用普通矩形代替。

类型选择优先级：

- 操作步骤、审批、业务流转、条件分支、异常回退：`flowchart`。
- 用例图、类图、组件图、活动图、时序或系统建模：`uml`。
- 角色协作、概念关系、系统模块、容器和便签式架构表达：`smart`。
- 数据库表、实体、属性、主外键和实体关系：`er`。
- 只是自由排版、信息卡片或无法归入以上类型：`board`。
- 思维导图、脑图、mind map 不使用 `diagramType`，必须改用第 7 节的原生 `plaitValue`。

### 8.1 流程图 `flowchart`

只使用 `process,terminal,decision,data,connector,manualInput,preparation,predefinedProcess,document,multiDocument,database,internalStorage,delay,display,offPage,noteSquare,text`。

- 开始和结束必须使用 `terminal`；普通操作使用 `process`；条件分支使用 `decision`，不能用普通 `diamond` 代替。
- 输入输出使用 `data`，数据存储按语义使用 `database` 或 `internalStorage`，可复用流程使用 `predefinedProcess`。
- 主流程优先自上而下。判断节点的不同出口必须使用不同锚点，并在连线 `label` 中明确“是/否”“成功/失败”等条件。
- 流转线默认 `endMarker:"arrow"`；注释线才允许 `endMarker:"none"`。

### 8.2 UML `uml`

只使用 `actor,useCase,component,container,note,package,simpleClass,class,interface,object,componentBox,activityClass,branchMerge,port,combinedFragment,template,activation,deletion,text`。

按 UML 子类型选择图形：

- 用例图：参与者用 `actor`，用例用 `useCase`，系统边界用 `container`。
- 类图：类用 `class` 或 `simpleClass`，接口用 `interface`，实例用 `object`，泛型定义用 `template`。`class/interface` 的 `text` 第一行是名称，后续行是属性或方法。
- 组件图：组件用 `component` 或 `componentBox`，分组用 `package/container`，接口连接点用 `port`。
- 活动图：活动使用 `activityClass`，判断或汇合使用 `branchMerge`。
- 时序表达：参与对象使用 `actor/object`，生命期激活使用 `activation`，组合条件使用 `combinedFragment`，销毁点使用 `deletion`。

UML 连线的 `label` 应写明关系语义，如“继承”“实现”“依赖”“关联”“包含”。继承、实现或有向依赖使用 `endMarker:"arrow"`；普通关联使用 `endMarker:"none"`。同一层的类或组件应对齐，并为关系文字预留空间。

### 8.3 Smart `smart`

只使用 `actor,useCase,component,container,note,package,text`。

- 人员或外部参与方使用 `actor`，目标或能力使用 `useCase`，模块使用 `component`，边界或系统域使用 `container`。
- 同一业务域用 `package` 分组，补充说明使用 `note`，不能把便签作为流程节点。
- Smart 图用于高层概念、协作和架构关系，不应混入流程图的 `decision/process` 或 UML 类明细图形。
- 布局优先从左到右：角色在左、能力或组件居中、容器或系统边界在右；关联线通常使用 `endMarker:"none"`，存在明确方向时才使用箭头。

### 8.4 ER `er`

只使用 `rectangle,roundRectangle,diamond,ellipse,parallelogram,class,text`。

- 实体使用 `rectangle`；弱实体使用 `roundRectangle`；关系使用 `diamond`；属性使用 `ellipse`；关联实体使用 `parallelogram`。
- 需要展示表字段时使用 `class`：第一行是实体名，后续每行一个字段，可用 `PK`、`FK` 标记主键和外键。
- ER 关系线使用 `endMarker:"none"`。基数写入 `label`，使用 `1:1`、`1:N`、`M:N`、`0..1` 或 `0..N` 等明确标记。
- 实体按主要关系横向或网格排布；关系菱形位于关联实体之间，属性靠近所属实体。禁止连线穿过其他实体或属性。
- 关系节点必须同时连接至少两个实体；属性只能连接所属实体，不得形成独立业务流程。

### 8.5 分类校验

应用会根据 `diagramType` 校验每个节点的 `shape`。如果 UML、Smart、ER 或流程图使用了其他分类的图形，整份 AI 响应会被拒绝；因此必须先选类型，再生成节点和连线。

<!-- AI_DIAGRAM_TYPE_SPEC_END -->
