# 多维表填色功能预研（暂缓，依赖筛选重构）

> 状态：**260930 已实现，桌面 + 移动只读 + 全门禁 + 隔离 Electron CDP 验收通过；等待用户功能验收。**
> **§1–§8 保留为上一轮预研历史；现行设计以 §9 为准。**
> 本文件是填色功能的独立调研记录，不改变 `BITABLE-OPTIMIZATION-HANDOFF.md` 的专项单一事实来源，也不代表已进入实施队列。
> 调研来源：用户 260930 提供的 3 张操作截图 + 钉钉多维表在线文档；已按项目规则使用 **BrowserSkill + Microsoft Edge** 实测。

## 1. 结论

- **可以实现**：填色属于视图级投影配置，可存进多维表正文 JSON 的 `views[]`，不需要改同步、历史、GC、附件或正文版本。
- **前置依赖已解除**：筛选重构已完成；填色将由 `BitableFilterNode` + `evaluateFilterNode()` 派生，不另造一套条件求值。
- **核心功能可独立于 AI**：手动填色规则是本地纯逻辑；“智能配色”需要模型能力，建议单独立项。

## 2. Edge 实测结论（钉钉多维表）

### 2.1 四种填色方式

| 模式 | 行为 | 条件 |
| --- | --- | --- |
| 单元格 | 命中条件时，只给条件字段对应的单元格着色 | 条件字段 + 操作符 + 值 |
| 整行 | 命中条件时，给该记录的整行数据单元格着色 | 条件字段 + 操作符 + 值 |
| 行侧 | 命中条件时，在记录行最左侧画一条约 3px 的颜色条 | 条件字段 + 操作符 + 值 |
| 整列 | 不套条件，直接给选中的字段整列着色 | 仅选择字段 |

Edge 实测验证：

- `单元格`：`老师 等于 财智-早` 时，只给 `老师` 列命中的单元格着色。
- `整行`：同一条件时，该记录行所有数据单元格着色。
- `行侧`：同一条件时，行内出现 3px 左侧色条，单元格背景不着色。
- `整列`：选择 `日期` 列后，该列所有数据单元格着色，没有操作符和值。

### 2.2 规则顺序

- 面板中的填色规则可以拖动排序。
- 规则列表顺序就是优先级：**后色压前色**。
- 同一个单元格被多条规则命中时，按列表从上到下依次求值，后命中的颜色覆盖前面的颜色。
- 行侧色条与单元格背景是两条独立通道；同一行的行侧色条和单元格背景可以同时存在。

### 2.3 颜色面板

钉钉实际调色板为 **5 行 × 11 列 = 55 个色块**：

- 前四行为同一组色相的渐进加深/提高不透明度。
- 最后一行为更饱和的实色。
- 色相覆盖红、橙、黄、黄绿、绿、青、蓝、靛、紫、粉、灰。
- 当前弹窗还存在“智能配色”入口：自然语言描述 → 生成填色规则；该能力不属于本地规则引擎。

## 3. 推荐的数据模型（待筛选重构后复核）

> 以下是预研草案，不是已冻结协议；筛选重构完成后，应复用新的筛选规则类型，而不是另造一套条件表达式。

```ts
type BitableFillMode = "cell" | "row" | "rowSide" | "column";

interface BitableFillRule {
  id: string;
  /** 稳定的主题色 token，不直接写某个主题下的计算值。 */
  color: string;
  mode: BitableFillMode;
  /** cell/row/rowSide = 条件字段；column = 着色字段。 */
  fieldId: string;
  /** 整列模式不需要。 */
  operator?: BitableFilterOperator;
  /** 整列模式不需要。 */
  value?: string;
}

interface BitableView {
  // 现有字段...
  fillRules?: BitableFillRule[];
}
```

推荐存储口径：

- 规则属于视图，不属于数据表或记录。
- 只存配置，不复制记录数据。
- 颜色优先存稳定 token（如色相 + 强度），渲染时解析为主题令牌；不要存 DOM 计算后的 `rgb(...)`。
- 删除字段时，应同步清理所有视图中指向该字段的填色规则。
- 历史快照继续随正文 JSON 保存；回收站/锁定文档通过只读 `BitableEditor` 自动读取。

## 4. 推荐实现结构

### 4.1 Core 纯函数

筛选重构完成后，优先复用同一套记录级取值和条件求值：

- `bitableFieldValue(record, field)`：系统时间、关联等字段的记录级取值。
- 新筛选引擎的 `matchesFilter` / `evaluateFilter`：所有操作符和空值语义统一走同一入口。
- 新增填色求值纯函数：
  - `fillRuleMatches(record, rule, ctx)`
  - `fillColorForCell(record, field, view)`
  - `fillColorForRowSide(record, view)`

求值顺序 = `view.fillRules` 顺序，最后一次命中的颜色胜出。

### 4.2 渲染策略

- `单元格`：给条件字段的对应 `<td>` 设置背景。
- `整行`：给该记录所有数据 `<td>` 设置默认背景。
- `行侧`：在记录行最左侧渲染独立色条，不占用单元格背景。
- `整列`：给指定字段的所有记录 `<td>` 设置背景。
- 表头、分组头、汇总行、过滤掉的记录不着色。

### 4.3 样式叠加

需要专门处理的覆盖关系：

- 填色属于视图背景层。
- hover、选中单元格、整列选中必须仍然可见。
- 重复值高亮目前也使用背景，不能让其中一套静默吞掉另一套；建议重复值高亮继续作为更高层的提示，填色作为底层。
- 单选/多选/附件 chip、图片缩略图、进度条、评分星等内容控件继续使用自身颜色，不被填色覆盖。

## 5. 与现有能力的兼容

- `columnTextColors`：列文字颜色，和背景填色可以同时存在。
- `highlightDuplicateFieldIds`：重复值高亮，需明确与填色的叠加层级。
- `filters/sorts/groups`：填色只影响视觉，不改变记录顺序、筛选结果或分组。
- 历史快照 / 回收站 / 锁定文档：桌面端沿用只读 `BitableEditor`，填色应自动生效。
- 移动端：`MobileBitableViewer` 可复用同一 core 填色结果；是否同批支持待筛选重构后决定。
- CSV/JSON 导入导出：D01/D02 当前暂缓；恢复时是否导出 `fillRules` 需另行决定。

## 6. 风险与待定项

1. **筛选重构是前置依赖**：条件操作符、字段值口径、空值语义和筛选配置结构都可能变化；填色不能先绑定旧实现。
2. **AI 智能配色**：需要模型 endpoint、提示词到规则结构的约束、错误回退和 Key 代理方式，建议单独立项。
3. **重复值高亮冲突**：两套背景机制必须明确层级，不能靠后加 CSS 覆盖。
4. **颜色对比度**：实色行侧/单元格背景需要验证白底与深色主题下的文字可读性。
5. **性能**：不能对每个单元格重复求值全部规则；应按记录预计算条件命中结果，再做列投影。
6. **规则级数**：参考实现每条填色规则只有一个条件；是否需要 AND/OR 条件组由筛选重构后的模型决定。

## 7. 暂缓结论

- 现在**只保留本文件，不进入实现、不改正文模型、不新增入口**。
- 筛选重构完成后，重新阅读新版筛选协议，再确认：
  1. 复用哪套筛选规则类型；
  2. 是否支持 AND/OR 条件组；
  3. 智能配色是否接入模型；
  4. 重复值高亮与填色的优先级；
  5. 移动端是否同批显示。
- 届时再决定是并入 `BITABLE-OPTIMIZATION-HANDOFF.md` 的新批次，还是另开实施专项。


## 8. 筛选重构后的复核结论（实施基线）

筛选重构完成后，原 §3 草案需要按以下版本实施：

### 8.1 冻结数据模型

```ts
export type BitableFillMode = "cell" | "row" | "rowSide" | "column";

export interface BitableFillRule {
  id: string;
  mode: BitableFillMode;
  color: BitableFillColorToken;
  /** cell / column 要着色的字段；column 模式无 condition。 */
  targetFieldId?: string;
  /** cell / row / rowSide 复用的筛选条件树。 */
  condition?: BitableFilterNode;
}

export interface BitableView {
  // 现有字段...
  fillRules?: BitableFillRule[];
}
```

- 旧草案的 `operator + value` 废弃，统一使用 `BitableFilterNode`。
- `cell` 的条件与着色字段不再隐含绑定；用 `targetFieldId` 明确目标列。
- v1 UI 可以先暴露单条件，core 直接支持完整条件树，后续无需换正文格式。

### 8.2 优先与投影

- 背景通道：`cell` / `row` / `column` 按 `fillRules[]` 顺序求值，最后一次命中获胜。
- 行侧通道：仅 `rowSide` 参与，独立于背景通道，同样最后一次命中获胜。
- 重复值高亮高于填色；hover / 单元格选中 / 整列选中高于两者。
- 被筛选掉的记录、表头、分组头、汇总行、添加入口不着色。
- 先按记录预计算投影，再应用到单元格，禁止按单元格重复跑全部规则。

### 8.3 视觉与色板

- 语雀当前 Lake 版本没有原生“条件填色”入口；本功能属于语雀风格扩展。
- 不照搬钉钉 5×11 色板和第二套交互；使用本仓 `Overlay`、`ln-*`、`--lake-*` 与现有柔和色板。
- 颜色存稳定 token，不存 DOM 计算值；AI 智能配色只生成同结构 token/规则。

### 8.4 实施顺序

1. core：`BitableFillRule` 规范化、token 色板、投影纯函数、单测。
2. 复用筛选规则子编辑器；新增填色规则模式和颜色 UI。
3. BitableEditor 接投影结果；背景与行侧分通道渲染。
4. 做重复值高亮、选择/hover、暗色主题与移动端只读对拍。
5. 回写 `BITABLE-OPTIMIZATION-HANDOFF.md` §11/§12/§13。

## 9. 260930 二次调研与现行实施基线（覆盖 §1–§8 的旧草案）

> 本轮重新使用 BrowserSkill 驱动 Microsoft Edge 打开用户给出的钉钉文档，实际打开/取消填色面板、切换四种模式、打开颜色面板，并读取当前页面加载的钉钉前端 bundle（`we-notable@3.27.2`）做交叉取证。
> 结论：**可以实现，且不需要架构升级**。填色属于视图投影配置，只新增多维表正文 JSON 的 `views[].fillRules`；同步、历史快照、附件、GC、回收站和正文版本均不改。

### 9.1 二次调研证据

本轮从当前钉钉页面与其前端 bundle 独立核对到以下事实：

1. **入口与载体**：工具条「填色」打开一个锚定在工具条上的配置弹层；弹层内完成规则增删、拖动排序和保存。
2. **四种模式**：`单元格` / `整行` / `行侧` / `整列`。
3. **一行一色**：每行左侧一个颜色块；每行有一个模式选择器、删除键和拖动把手。
4. **单元格模式**：条件字段就是着色字段。切换条件字段时，`formatFieldId` 跟随条件字段更新；没有第二个「目标列」选择器。
5. **整行 / 行侧模式**：只配置条件；命中后分别给整条记录数据行铺色或给行首画色条。
6. **整列模式**：只有颜色 + 模式 + 列字段，没有条件字段、操作符和值。
7. **条件模型**：一条填色规则对应一条筛选规则，复用字段类型对应的操作符和值编辑器；钉钉代码转换 `conditionalFormats[].filters` 时只消费首个条件。
8. **规则上限**：钉钉当前 bundle 的规则上限为 **40 条**。
9. **颜色面板**：钉钉当前是 5×11 的色板；本仓不照搬，改用本仓现有 18 色软色调色板。
10. **排序**：规则存在数组顺序，配置弹层支持纵向拖动排序；弹层说明文案明确「颜色填充将按照条件的顺序排序」。
11. **钉钉源码的实际叠加实现**：`cell / row / column` 三个候选按规则数组下标反向排序，再做 alpha 混色；同一模式内 `filterByRule()` 取首个命中规则，`column` 取首个匹配该列的规则。它并不是简单的“最后一条直接覆盖”。
12. **本仓最终采用钉钉混色语义**：用户看过源码解释后确认上一轮「后色压前色」理解错误，要求直接复刻钉钉。实现固定为：同一模式取首个命中规则，`cell / row / column` 三个候选按原始数组下标做 alpha 混色；`rowSide` 独立。

### 9.2 技术可行性结论

**可以实现，无阻塞项。**

- 当前 `BitableFilterRule`、`filterOperatorsFor()`、`filterValueKindFor()`、`evaluateFilter()` 已经覆盖文本、数字、日期/系统时间、单选、多选、复选、附件/图片、关联等条件口径。
- 当前 `BitableFilterEditor` 已经抽取了字段 / 操作符 / 值三段式编辑；第二轮实现时把单规则编辑器抽成可复用组件即可，不需要复制操作符表或值转换逻辑。
- `BitableView` 本来就把筛选、排序、分组、统计、列文字颜色等展示配置放在视图级；填色也放视图级，不会改变记录数据。
- 表格行已有稳定的 `recordId / fieldId`，可以一次性构建 `recordId + fieldId → background` 投影，再在 `<td>` 上读结果，不需要逐格反复跑规则。
- 现有 `ColorPalette` 已收敛为应用内统一实色卡；固定色阶来自 `src/core/colorPalette.ts` 的内核 70 色，另带最近使用和自定义颜色。Lake 编辑器继续走自己的 `LakeColorBoard` 适配器，二者共享色值源但不改变 Lake 样式。

### 9.3 冻结数据模型

现行设计**撤回上一版 §8.1 的 `targetFieldId` 与完整 `BitableFilterNode` 条件树草案**，改为下面这份与当前 UI、用户要求一致的最小模型：

```ts
export type BitableFillMode = "cell" | "row" | "rowSide" | "column";

export type BitableFillRule =
  | {
      id: string;
      mode: "cell";
      /** 用户选择的实色 hex；渲染时再做透明度与混色。 */
      color: string;
      /** 条件字段 = 着色单元格字段；复用筛选的单规则类型。 */
      condition: BitableFilterRule;
    }
  | {
      id: string;
      mode: "row";
      color: string;
      condition: BitableFilterRule;
    }
  | {
      id: string;
      mode: "rowSide";
      color: string;
      condition: BitableFilterRule;
    }
  | {
      id: string;
      mode: "column";
      color: string;
      /** 整列没有条件，只存被着色的列。 */
      fieldId: string;
    };

export interface BitableView {
  // 现有字段……
  fillRules?: BitableFillRule[];
}
```

模型约束：

- 每行严格一条规则、一条颜色；`cell / row / rowSide` 严格一条 `BitableFilterRule`，不做填色专属操作符、条件值解析或空值语义。
- `cell` 不另存目标列：条件字段就是着色字段，和钉钉当前 UI 的 `formatFieldId = condition.fieldId` 口径一致。
- `column` 不存条件；命中语义是“所有当前可见记录”。
- 同一视图最多 **40** 条填色规则，和当前钉钉实现的上限一致；超过时禁用“添加填色条件”并显示明确提示。
- 删除字段时必须从所有视图的 `fillRules` 中清理：
  - `column.fieldId` 指向该字段的整条规则；
  - `cell / row / rowSide.condition.fieldId` 指向该字段的整条规则。
- 复制视图沿用现有 `{...source, id, name}`，`fillRules` 自动随视图复制；删除视图自然删除配置。
- 不进 S3、不进 manifest，不新增正文版本迁移；历史快照读取旧正文时没有 `fillRules` 即为无填色。

### 9.4 求值与优先级语义

填色求值只依赖同一套记录级字段取值与筛选引擎：

- 记录级取值：`bitableFieldValue(record, field)`。
- 单条件判断：`evaluateFilter(field, value, rule.condition, now)`。
- 动态日期：完整复用 `dateFilterRangeFor()` 和现有 15 种日期范围。
- 关联、附件、系统时间等字段不单独解释。

优先级：

1. `fillRules[]` 从前到后求值。
2. 背景通道包含 `cell / row / column`；三类各自取首个命中规则，再把三个候选按原始数组下标混色。
3. 混色算法与钉钉一致：候选按下标逆向做 alpha compositing。CSS 实现用多层 `linear-gradient(fillSurfaceColor(color), ...)`，首层为最上层，视觉结算顺序与钉钉 `mix_colors` 相同。
4. `rowSide` 是独立通道，只和其他 `rowSide` 规则比较优先级；同一个数据行可以同时有背景色和行侧色条。
5. 视图筛选和搜索决定当前实际展示的记录；填色只给已展示记录做投影，不会改变筛选、排序或分组结果。
6. 表头、分组头、汇总栏、添加入口不参与填色。

建议的纯函数入口：

```ts
export interface BitableFillProjection {
  /** "recordId:fieldId" → 最终背景色值。 */
  cellBackground: Map<string, string>;
  /** recordId → 最终行侧色值。 */
  rowSide: Map<string, string>;
}

export function buildBitableFillProjection(
  table: BitableTable,
  view: BitableView | undefined,
  records: readonly BitableRecord[],
  options?: { now?: Date },
): BitableFillProjection;
```

实现时先按规则计算候选下标，再在最终投影里只保留胜出的颜色；禁止在 JSX 里每个 `<td>` 重新遍历 `fillRules`。

### 9.5 UI 落点与复用

工具栏：

- 只在 `activeView.type === "grid"` 显示「填色」入口，放在「行高」之后，不复用到表单/看板/画册/日历。
- 入口复用 `.bt-tool-btn`；有规则时显示数量 badge，数量来自 `fillRules.length`。
- 只读文档隐藏或禁用整个编辑入口，但渲染层仍显示已有填色。

弹层：

- 复用 `BitableEditor` 当前 `Popover` 机制和 `menuAnchor`，新增 `panel === "fill"`；不要另造 Dialog。
- 宽度与筛选面板同级，移动窗口由现有 `max-width` 规则收口。
- 顶部只保留标题与规则说明；视觉使用 `ln-*`、`--lake-*` 和现有面板密度。

每行：

```text
[拖动把手] [颜色块] [模式 SelectMenu] [条件字段] [操作符] [值/日期/多选/关联编辑器] [删除]
                         └────── row / rowSide 使用同一三段式条件编辑器 ──────┘
```

整列模式：

```text
[拖动把手] [颜色块] [整列] [目标列 SelectMenu] [删除]
```

条件编辑器必须把 `BitableFilterEditor.tsx` 里的单规则视图抽成共用组件，至少同时给以下两处使用：

- 现有筛选树中的每条规则；
- 填色规则行中的 `condition`。

抽取时只做职责搬移，不改现有筛选操作符、值类型、日期模式、SelectMenu、DatePicker、关联/多选选择器行为。

颜色选择：

- 复用统一 `ColorPalette` 和 `Popover`，不新增第二套色板浮层。
- 固定色卡为内核 7×10 实色阶；额外提供最近使用和原生自定义颜色。
- 行侧、整行、单元格、整列不限制可选色；用户根据实时预览自行选择深浅。
- 模式切换不重映射、不自动换色；当前颜色原样保留。
- 填色只存用户选中的实色 hex；背景渲染时再通过 `fillSurfaceColor()` 转为低透明度叠层，行侧保持原色。

排序：

- 每条规则有拖动把手；拖动只重排当前视图的 `fillRules` 数组。
- 列表顺序参与候选优先级和混色；文案明确说明“颜色按规则顺序混合”。
- 重排后立即重新计算投影并写正文；取消编辑时随弹层草稿一起丢弃。
- 所有 `SelectMenu` 共用“唯一打开”事件；打开任一下拉会收起其它下拉，点击弹层空白或其它触发器也会自动收起，不能出现多个下拉同时悬浮。

### 9.6 统一色值源与 Lake 适配器

- `src/core/colorPalette.ts` 保存内核 7×10 实色阶，是应用内唯一固定色值源。
- `ColorPalette` 服务于应用内选项色、进度色、列文字色和填色；三者共用 70 色 + 最近使用 + 自定义。
- 应用内统一色板按 260930 现场反馈收小：浮层宽 **296px**，色块高 **22px**、间距/内距同步收紧；只改应用内 `ColorPalette`，Lake `LakeColorBoard` 的视觉与渐变色仍保持不变。
- 所有应用内色卡顶部统一默认项：文字类显示「默认色」并清自定义文字色；背景/选项/填色类显示「无背景色」。填色规则的「无背景色」用持久哨兵 `transparent` 保留规则与顺序，但跳过投影，后续选回颜色即可恢复。
- 同一个 `ColorPalette` 必须按位置显式分流：列文字是子菜单，选色后保持、点空白才关；填色是普通浮层，点填色面板其它位置立即关闭。两者通过 `closeOnNestedOverlay` 显式区分，禁止在共享组件里写死一种行为。
- 最近使用区使用与固定色卡一致的 22×22 小色块；不得继承固定色卡的 `width:100%` 被 flex 拉成大色条。
- 最近使用按入口独立分桶并写入 `localStorage`：选项、进度、列文字各自维护；填色只分两桶——`cell / row / column` 共用“最近背景色”，`rowSide` 单独维护。
- `LakeColorBoard.tsx` 只复用同一色阶数据；Lake 原有的默认/无填充、渐变色、最近使用、更多颜色和内核 CSS 类保持不变。
- Lake「更多颜色」的原生 color input 必须覆盖整行透明命中层；不得使用 `1px + pointer-events:none`，否则视觉在但点击无法弹出系统取色器。
- Lake 正文选区必须使用半透明选区色（统一映射 `--lakex-editor-selection: var(--lake-select-bg)`），不得继续用不透明的 `--lake-accent-tint`。跨多个 `ne-text` 拖选时，浏览器把高亮画在父级上；给有背景的 `ne-text` 单独写 `::selection` 无法阻止父级高亮覆盖。半透明层可让原背景透出，云端 Yuque 实测也是 `rgba(27,162,227,.2)` 这一机制，而不是逐元素特判。
- 应用内不复制内核的渐变色；只有 Lake 编辑器显示渐变色。
- 选项 chip 根据背景亮度自动选深/浅文字，避免全量色卡下文字不可读。

### 9.7 背景与状态叠加

渲染时必须保持以下层级：

1. 记录底色（当前面板/表格底）。
2. 填色背景（`cell / row / column` 的最终胜出颜色）。
3. 重复值高亮。
4. 整行 hover / 选中行。
5. 单元格选中环、整列选中环。

`rowSide` 使用独立通道。钉钉原始实测约 3px；本仓 260930 按用户要求试宽为 **6px**，不占用背景色通道。填色不得覆盖单选/多选 chip、评分星、进度条、链接图标、附件缩略图等控件自身的颜色。

实现建议：

- 用 `data-fill-bg="<token>"` / `data-fill-side="<token>"` 与 CSS 变量映射颜色，避免把颜色 hex 写进 JSX inline style。
- `.bt-td` 读 `--bt-fill-bg`，行侧只读 `--bt-fill-side`；hover / selected / in-highlight 规则改为在该背景之上叠加，而不是用新覆盖层把它们压掉。
- CSS 文件建议新增 `bitableFillRules.css`，并在 `src/styles/cssLayers.test.ts` 登记 FILES/BASELINE；不要继续把声明塞进已接近基线的 `bitableEditor.css`。

### 9.8 性能预算

- 规则数上限 40；规则只在视图配置变更、记录变更、筛选结果变化时重新投影。
- 先把 `records × rules` 求值收敛到一次 `useMemo`，得到 `recordId / fieldId → token` 投影；表格渲染只做 Map 查找。
- `row` 模式按记录求值一次后写整行候选；`column` 模式不做逐记录条件求值。
- 不对每个 `<td>` 调用 `evaluateFilter`；不把中间结果写入正文或缓存到 localStorage。
- 当前量级下这是纯展示投影，不触发附件、同步、图片解码或网络请求。

### 9.9 明确边界 / 不做项

- 不做 AI「智能配色」：当前钉钉入口会走远端模型；本仓没有该功能的 endpoint、Key 代理和产品语义，暂不纳入。
- 不做文字颜色填色，只做背景色和行侧色。
- 不做条件组/AND/OR 填色；每行一个条件，和「一行一个颜色」的 UI 约束一致。
- 不改变记录值、不复制记录数据、不影响筛选结果或排序。
- 不在看板 / 画册 / 日历 / 表单中应用填色；首批只在表格视图生效。
- 移动端复用同一投影显示背景与行侧，不提供编辑入口；本批已完成构建与静态渲染单测，Android 模拟器截图验收仍可补做。

### 9.10 实施批次（建议）

1. **core**：新增 `BitableFillRule` / `BitableFillMode` / token 校验与 normalize、字段删除清理、`buildBitableFillProjection` 和单测。
2. **条件编辑器复用**：从 `BitableFilterEditor.tsx` 抽出 `BitableFilterRuleEditor`，原筛选树不改行为；新增源码护栏确保填色直接复用它。
3. **填色面板**：新增 `BitableFillEditor.tsx`，接入工具栏 `panel === "fill"`、规则增删、模式切换、颜色、拖动排序、40 条上限。
4. **渲染与主题**：新增 `bitableFillRules.css` 与 `--lake-fill-*`，在桌面临格/行和移动只读表格上落投影；验证背景、行侧、hover、选中、重复值高亮和暗色主题。
5. **验收**：core 单测 + 组件挂载护栏 + 全量门禁 + Electron CDP 真实验收；Edge 钉钉页面只作为交互语义对照，不作为本仓运行时。

### 9.11 验收清单

- [ ] 单元格：条件字段自身着色，其他列不变。
- [ ] 整行：命中记录的全部数据单元格着色，表头/汇总/添加入口不着色。
- [ ] 行侧：命中记录出现 6px 色条，背景通道不被误改。
- [ ] 整列：整列记录着色，不需要条件。
- [ ] 规则顺序：拖动后仍按钉钉候选索引做 alpha 混色；同一规则重复编辑不产生第二套操作符文案。
- [ ] 日期动态范围、系统时间、单选、多选、复选、附件、关联筛选值均复用现有控件。
- [ ] 删除字段后所有视图的填色配置同步清理，不留下悬空 badge 或空规则。
- [ ] 只读 / 回收站 / 锁定文档仍显示已有填色，但不能编辑规则。
- [ ] 浅色、深色、暖色三主题下文字与色块可辨识；重复值高亮、hover、选中态优先级正确。
- [ ] 新增 CSS 文件已登记 `cssLayers`，没有新增 `!important` 或颜色字面量。
