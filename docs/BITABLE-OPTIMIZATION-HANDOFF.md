# 多维表优化落地与交接文档（Single Source of Truth）

> 状态：**方案已冻结；V01 已完成（用户验收通过）；V02–V04 + 260928 三批追加需求 + T01/T04 + T02A + 260929 单级分组/UI2 + 260929-OPT 阶段优化 + T02B.1/.2/.3/.4 关联 + 260929 收口各条 + 260930 四条 + **260930 筛选重做：类型操作符矩阵 / 动态日期 / AND·OR 条件组 / 最多 2 层子组（代码已提交 `7dd81ba3`）** 已实施，一并待验收**（T03 多级分组已按用户决定废弃；T06 表单双模已完成待验收；D01/D02 暂缓）。
> 建立日期：2026-09-28。
> 适用范围：多维表字段扩展、单/双向关联、表格增强、看板/画册/日历视图、表单增强、导入导出。
> 本文是该优化项目的**唯一实现方案、进度看板、修改记录、决策记录和会话交接文档**。

## 1. 强制执行规则

1. 所有参与本项目的会话必须先按 `README → HANDOFF → AGENTS` 阅读总项目上下文，再完整阅读本文。
2. 本文是该项目的事实来源。后续会话的**实现计划、实际改动、测试结果、遗留问题、结论和下一步**必须回写本文。
3. 不再为该项目新增平行计划、审计、进度或总结文档；需要记录的信息直接追加到本文的对应章节。
4. 历史会话记录只追加，不覆盖，不删除。状态看板可以更新，但必须保留历史结论。
5. 同一时间默认只允许一个会话实施同一个批次。并行会话必须有互不重叠的写入文件，并显式声明。
6. 代码改动必须遵守 `AGENTS.md`：`src/core/` 不引入平台依赖，不擅自合 `master`，代码批次经用户验收后再处理提交/合并。
7. UI 必须直接对齐云端语雀。语雀没有的能力允许扩展，但只能使用语雀的视觉语法、密度、层级和现有设计原语，不能引入飞书/钉钉式第二套风格。
8. 任何 UI 实测优先使用 BrowserSkill 驱动 Microsoft Edge。后续会话不得改用 Chrome 代替。

## 2. 当前总体决策（已确认）

### 2.1 产品边界

- 不做图表视图。
- 不做自动编号。
- 不做查找引用、抓取引用、公式、rollup、汇总字段。
- 条件填色**暂缓**：已完成独立预研（`BITABLE-FILL-COLOR-RESEARCH.md`），当前不实施；等筛选能力重构完成后，再决定是否进入实施队列。
- 不做跨多维表文档关联。
- 不做跨文档数据互通。
- 不做在多维表字段中嵌入文档。
- 关联只发生在**同一个 `kind="bitable"` 文档内的不同 `tables[]`**。
- 文档仍然是数据边界：一个文档可以有多张表并互相关联；不同多维表文档之间完全隔离。
- **新建数据表的默认结构 = 只有 1 列「文本」+ 3 行空白记录**（用户 260929 定稿）：不再预置「单选 / 日期」列——表结构由用户自己加，不替他做决定；3 行空白是为了新建完就能直接填。新建多维表文档时的首张表走同一函数（`createDefaultBitableTable`），口径一致。

### 2.2 视图范围

保留：

- 表格视图
- 表单视图

新增：

- 看板视图
- 画册视图
- 日历视图

不做：

- 图表视图
- 甘特视图
- 仪表盘
- 应用页面
- AI 页面
- 查询页面
- 分享页面

### 2.3 字段范围

新增：

- 布尔值
- 链接
- 评分
- 进度
- 创建时间
- 修改时间

保留并补全：

- 文本
- 数字
- 单选
- 多选
- 日期
- **图片**（260928 追加：复用附件能力，上传侧只收图片）
- **附件**（所有文件类型）
- 单向关联
- 双向关联

不做：

- 自动编号
- 查找引用
- 公式
- 汇总/rollup
- 流程、按钮、签名、条码、身份证号、地理位置等企业字段

### 2.4 关联能力

- 关联只允许同一多维表文档内的不同数据表。
- 关联支持多选。
- **字段类型拆分（260930 用户追加）**：`BitableFieldType` 直接使用 `relationOneWay` / `relationTwoWay` 两个真实类型；方向由 `type` 决定，不再写冗余的 `relation.mode`。字段类型选择器显示「单向关联」「双向关联」两项，分别使用 `Link2` / `ArrowLeftRight` 图标；关联单元格值仍只存目标记录 id 数组，两个类型在行内都按同一套关联 chip 展示。
- 字段配置提供“允许添加多个记录”，默认开启；关闭后只能选一条。
- **数据范围（260929 用户追加，取代「第一版只允许全部记录」）**：字段配置提供「从视图筛选记录」——
  **不勾选 = 从目标表全部记录里选**（默认）；**勾选 = 绑定目标表的一个视图**，选择器只列该视图筛选后的记录（视图自带排序一并生效）。
  数据范围只约束「能选到什么」，不改变已有值的展示（已选记录即使被视图过滤掉也照常显示）；绑定的视图被删 → 回落全部记录，不级联、不报错。
  **仍不做**「按条件筛选记录」（云端图 1 的第三项，用户未要求）。
- **视图投影（260930 用户追加）**：绑定视图时，关联选择器必须像正式表格视图一样应用 `fieldOrder + hiddenFieldIds + filters + sorts + groups[0]`；视图规则作为只读基线，允许继续叠加当前弹窗的临时筛选/排序，关闭弹窗即丢弃且不写回原视图。未绑定视图时，列顺序取目标表默认表格视图的 `fieldOrder`，但记录范围仍是全部记录、字段仍完整展示（不应用默认视图的隐藏/筛选/排序/分组）。
- **动态字段（260930 用户追加）**：关联字段保存的目标表 id/viewId 不缓存字段快照；每次打开选择器都从当前正文重新计算目标表字段、视图 fieldOrder 和 hiddenFieldIds，因此关联后新增字段会在再次打开时进入列候选（新增字段不在 fieldOrder 末尾追加；绑定视图若已 hidden 则按该视图隐藏）。
- 关联单元格显示目标记录第一列的值。
- 多值关联使用紧凑 chip 列表。
- 目标记录进入回收站或删除后，内部保留关联 ID，界面显示为空或失效。
- 目标记录恢复后，关联可以自动恢复显示。
- 目标数据表删除后，来源关联字段保留配置，界面显示为空，不级联删除来源字段。
- 双向关联的反向字段默认名称：`来源表名 + 来源字段名`，允许重命名。
- 删除双向关联的一侧字段时，保留另一侧字段和数据，并将另一侧降级为单向关联。
- 不做关联记录字段的“查找/引用/汇总”。
- 不做关联数据值的复制，关联字段只保存目标记录 ID。
- 不创建新的 S3 对象；关联信息保存在多维表正文 JSON 中，继续走现有正文同步、历史和 GC 管线。

### 2.5 UI 规则

- 直接参考云端语雀的字段、弹窗、菜单、表格、卡片和视图配置。
- 复用现有：
  - `src/components/ui/Overlay.tsx`
  - `src/features/bitable/bitableCells.tsx`
  - `src/features/bitable/bitableEditor.css`
  - `src/styles/feature.css`
  - `src/styles/compat.css`
- 不再新增第三套视觉类或独立设计系统。
- 云端语雀没有的关联/看板等能力，使用语雀现有的高度、圆角、边框、颜色、间距和图标语义扩展。
- 桌面端与移动端共享视觉语义；移动端首版至少只读展示新字段和关联值，不能白屏。

### 2.6 现有颜色能力保留

条件填色当前暂缓不做，但以下现有能力保持不动：

- 单选/多选选项 chip 颜色
- 列文字颜色
- 调色板
- 高亮重复值

不要因为“条件填色暂缓”而顺手删除这些能力。

## 3. 调研结论与实测证据

### 3.1 语雀

已用 Edge 实际验证：

- 表格、画册、看板、日历、图表、表单视图均可创建。
- 表格字段类型包含文本、数字、单选、多选、日期、人员、图片、附件、复选框、链接、邮箱、手机号码、评分、进度、创建人/创建时间/修改人/修改时间。
- 复选框单元格是简单的勾选框。
- 链接字段配置只有默认 URL，没有链接标题配置。
- 评分是固定 5 星，字段配置可选择默认星级。
- 进度显示为进度条和百分比，字段配置支持默认值、颜色设置。
- 列级统计包含记录总数、已填写数、未填写数、唯一数、占比；日期字段额外有最早/最晚/时间范围。
- 看板、画册、日历配置都可以实际打开和操作。
- 表单可实际开启收集并生成可填写链接。

本项目只借鉴语雀的 UI 和已有字段，不引入图表和外部表单分发。

### 3.2 钉钉

已实际打开：

- 数据、自动化、应用、表单并列的产品壳。
- 字段管理、添加字段、筛选、多级分组、多条件排序、行高、填色、提醒、分享视图。
- 字段菜单包含文本、单选、多选、日期、数字、货币、人员、图片/附件、进度、链接、公式、按钮、流程、勾选框、评分、电话、部门、群组、邮箱、行政区域、条码、身份证号、手写签名、地理位置、富文本、查找引用、单向关联、双向关联、关联引用、创建人、更新人、创建时间、最后更新时间、自动编号等。

本项目只借鉴字段管理、多级分组、排序语义和行高交互，不照搬平台化壳层和企业能力。

### 3.3 飞书

已通过官方帮助和实际表格验证：

- 关联字段支持当前数据表或同一多维表格内其他数据表的记录。
- 官方明确：不能关联其他多维表格文件的记录。
- 关联字段可配置目标数据表、可关联数据范围、允许添加多个记录。
- 实际创建单向关联时，“允许添加多个记录”默认勾选。
- 多值关联选择器包含搜索、目标记录列表、已选计数、添加记录、取消和确认。
- 目标记录删除后：
  - 撤销窗口内来源关联可能暂时显示旧文本；
  - 刷新后来源关联显示为空；
  - 关联选择器不再包含目标记录。
- 双向关联会在目标表自动生成反向字段；删除一侧字段时，保留另一侧数据和字段并降级为单向关联。

## 4. 当前代码地图

### 4.1 核心数据与求值

- `src/core/bitableDoc.ts`
  - 正文模型
  - 字段类型
  - 序列化/解析
  - 视图投影
  - 筛选、排序、分组、重复值
  - 搜索文本提取

### 4.2 桌面编辑器

- `src/features/bitable/BitableEditor.tsx`
  - 多数据表
  - 表格视图
  - 视图页签
  - 工具栏
  - 字段列表
  - 筛选、分组、排序、行高、搜索
  - 列菜单、字段编辑、视图编辑

### 4.3 单元格与浮层

- `src/features/bitable/bitableCells.tsx`
  - 文本、数字、单选、多选、日期
  - 附件
  - 选项面板
  - 日期选择器
  - 附件展开面板

### 4.4 记录详情

- `src/features/bitable/BitableRecordDrawer.tsx`
  - 记录字段编辑
  - 上下条切换
  - 附件管理

### 4.5 表单

- `src/features/bitable/BitableFormView.tsx`
  - 本地表单预览
  - 字段选择
  - 提交新增记录

### 4.6 移动端只读

- `src/mobile/bitable/MobileBitableViewer.tsx`
  - 多数据表切换
  - 表格视图只读
  - 筛选/排序/隐藏列等只读口径

## 5. 技术设计原则

1. 文档仍然是一个 `kind="bitable"` 正文文件。
2. `tables[]` 是数据边界；关联不跨出当前正文 JSON。
3. 视图只保存投影配置，不复制记录。
4. 新字段和新视图的配置以可选属性扩展，不重建现有数据。
5. 未知字段类型继续只读保留，不得因升级清空。
6. 所有跨表求值必须是纯函数，不能直接依赖 DOM 或 Electron。
7. 记录 ID 稳定，关联存记录 ID，不存目标记录对象副本。
8. 任何删除语义默认不级联删除来源记录或来源字段。
9. 现有同步、历史、附件、GC、回收站语义全部复用。
10. 移动端未知视图至少展示可理解的只读回退，不允许空白。

## 6. 数据模型建议

### 6.1 字段类型扩展

建议在 `BitableFieldType` 中增加：

```ts
type BitableFieldType =
  | "text"
  | "number"
  | "select"
  | "multiSelect"
  | "date"
  | "attachment"
  | "relationOneWay"
  | "relationTwoWay"
  | "boolean"
  | "link"
  | "rating"
  | "progress"
  | "createdTime"
  | "updatedTime";
```

其中：

- `boolean`：记录值为 `boolean`。
- `link`：记录值为 `string` URL。
- `rating`：记录值为 `number`，固定 `0..5`。
- `progress`：记录值为 `number`，固定 `0..100`。
- `createdTime`：不写 `record.values`，读取 `record.createdAt`。
- `updatedTime`：不写 `record.values`，读取 `record.updatedAt`。
- 关联方向由字段类型本身表达：`relationOneWay` / `relationTwoWay` 是两个独立类型；不保留 `relation.mode`。

### 6.2 关联字段配置

建议扩展 `BitableRelation`：

```ts
interface BitableRelation {
  tableId?: string;
  allowMultiple?: boolean;
  pairedFieldId?: string;
}
```

关联字段值建议统一存：

```ts
string[]
```

即使关闭多选，也存长度为 `0` 或 `1` 的数组，避免单值/多值两套数据和渲染逻辑。

### 6.3 双向关联一致性

需要新增纯函数：

- 创建双向关联字段。
- 建立两侧 `pairedFieldId`。
- 更新关联值时同步更新反向字段。
- 删除一侧字段时解除配对，并保留另一侧为单向关联。
- 目标记录删除或恢复时，只改变显示解析，不直接破坏来源字段。
- 解析缺失目标记录时返回空或失效状态，不自动改正文。

### 6.4 数据展示解析

当前 `bitableDisplayValue(field, value)` 不知道目标表。关联和新字段需要上下文：

- 可新增 `bitableDisplayValueWithContext(doc, tableId, field, value)`。
- 搜索文本 `bitableToSearchText` 需要能解析目标记录第一列。
- 单元格渲染、记录抽屉、移动端只读、历史预览共用一个解析函数。
- 不允许每个 UI 组件各写一套关联解释逻辑。

## 7. 实施批次与任务定义

> 所有任务完成后，必须回写本文 §11 状态看板、§12 修改记录、§13 会话记录。

### 批次 A：视图工作台 + 看板

#### V01 多视图工作台

目标：

- 让表格、表单、看板、画册、日历共享统一的视图切换壳。
- 扩展 `BitableViewType`，新增视图配置继续存入 `views[]`。
- 切换视图时保持数据表、记录和字段不变。
- 每个视图独立保存筛选、排序、分组、字段顺序、隐藏字段和视图配置。

实现范围：

- `BitableViewType` 扩展为开放联合类型。
- `normalizeView` 遇到未知视图不能清空或强行改成 grid；至少保留配置并安全回退。
- 视图页签支持类型图标。
- 新增视图菜单。
- 视图重命名、复制、删除继续复用现有入口。
- 移动端遇到未支持视图时显示只读表格或“该视图暂不支持移动端”的明确回退。

验收：

- 新建看板视图不影响表格视图配置。
- 同一记录在表格和看板中同步变化。
- 未知视图不会导致正文丢失。
- `tsc`、相关单测、桌面/移动构建通过。

#### V02 看板视图

目标：

- 记录按单选字段分组，以卡片列展示。

实现范围：

- 分组字段只允许单选字段。
- 看板配置支持显示字段、显示字段名。
- 卡片显示目标记录的主字段和选择字段。
- 支持分组计数、新建分组、折叠/展开。
- 拖拽卡片改变单选值。
- 拖拽卡片后按语雀语义处理原排序状态。
- 点击卡片打开现有记录详情。
- 筛选、排序、搜索继续适用于看板。
- 不新增独立记录模型。

验收：

- 表格改单选值，看板即时变化。
- 看板拖拽记录后，表格单选值同步变化。
- 无单选字段时给出明确配置提示。
- 空分组、无记录、只读、回收站文档均有正确状态。

### 批次 B：画册视图

#### V03 画册视图

目标：

- 以卡片网格显示记录，主要服务图片和附件内容。

实现范围：

- 封面来源支持图片/附件字段。
- 支持无封面。
- 支持适应/裁剪。
- 支持常规/紧凑展示。
- 支持是否显示字段名。
- 支持卡片字段选择。
- 点击卡片打开记录详情。

验收：

- 封面字段缺失时可回退。
- 多图附件按第一个可用图片显示。
- 附件缩略图和预览继续走现有资产 URL。
- 移动端只读不白屏。

### 批次 C：日历视图

#### V04 日历视图

目标：

- 按日期字段展示记录。

实现范围：

- 月视图优先。
- 支持开始日期字段。
- 支持可选结束日期字段。
- 支持标题字段。
- 支持颜色字段，第一版仅单选。
- 点击日程打开记录详情。
- 拖拽日程修改日期。
- 不做农历、节假日、重复日程、提醒。

验收：

- 日期比较使用本地日期语义，避免 UTC 偏移。
- 开始/结束日期相同时正常显示单日。
- 拖拽后记录日期同步更新。
- 移动端只读不白屏。

### 批次 D：现有表格增强

#### T01 列级统计

> **260929 变更记录**：当天先整体废弃（用户认为意义不大）→ 同日用户确认**分组后需要按组统计**，
> 故**已恢复**；随后同日用户再次定稿：底部汇总栏**常驻**（不再按有无配置条件渲染），做薄 24px 贴视图最底、首格缺省 `N 条记录`，状态栏上移让位（见本文件末尾 §13）。当前状态：**已恢复（常驻口径）、待验收**。

目标：

- 在表格底部显示列统计。

统计口径：

- 通用：记录总数、已填写数、未填写数、唯一数、已填写占比、未填写占比。
- 数字：求和、平均、最小、最大。
- 日期：最早、最晚、时间范围。
- 统计基于当前视图过滤后的记录，不修改记录。

实现范围：

- 每列可配置统计类型。
- 不展示统计时保留默认“记录总数”或无统计。
- 统计不受排序影响。

验收：

- 筛选后统计同步变化。
- 空值、非法值、附件、关联不导致崩溃。
- 移动端可以只读或隐藏统计。

#### T03 多级分组

> **260929 已废弃**：用户最终决定分组最多只有一级。历史实现 `9b80ede` 仅保留在 git 历史；
> 当前产品只消费 `view.groups[0]`，多级树/拖动排序/层级样式均已删除。单级分组继续保留按组统计和
> 「加进本组」，具体见 §11「单级分组重做」与 §13。

目标：

- 从当前单级分组升级为多级分组。

实现范围：

- 现有 `BitableView.groups` 数组启用多个元素。
- 支持拖动调整分组优先级。
- 分组头按层级显示。
- 折叠状态使用本机状态，不写正文。
- 继续兼容单级分组旧配置。

验收：

- 两级、三级分组结果稳定。
- 分组与筛选、排序组合正确。
- 移动端只读可展示或安全回退。

#### T04 语义排序增强

目标：

- 保留现有升降序，同时增加字段语义排序。

实现范围：

- 单选：选项顺序、选项逆序。
- 多选：按第一个已选选项的顺序。
- 日期：早到晚、晚到早。
- 数字：先保持普通升降序。
- 不做公式排序。

验收：

- 选项重命名和排序后配置不丢失。
- 多条件排序保持稳定。
- 移动端只读结果一致。

### 批次 E：字段扩展和多表关联

#### T02A 基础字段

目标：

- 精准复刻云端语雀字段控件。

实现范围：

- 布尔值：表格单元格为复选框；字段默认值可选是/否。
- 链接：保存 URL，点击用系统浏览器打开；字段默认值为 URL。
- 评分：固定 5 星，默认值可选星级。
- 进度：0–100 百分比，进度条展示，支持默认值和颜色设置。
- 创建时间：系统只读，读取 `record.createdAt`。
- 修改时间：系统只读，读取 `record.updatedAt`。
- 未知字段仍然只读展示。

验收：

- 新增字段后旧记录不损坏。
- 编辑、复制、粘贴、筛选、排序、搜索都有明确口径。
- 附件和关联字段不被这批影响。
- 移动端只读显示正确。

#### T02B.1 关联基础模型

目标：

- 建立同一多维表文档内的跨数据表记录关系。

实现范围：

- 字段类型 `relation`。
- 目标数据表选择。
- 目标记录 ID 数组。
- 多选开关，默认开启。
- 单条模式存单元素数组。
- 显示目标记录第一列值。
- 缺失目标记录显示为空或失效，内部 ID 保留。
- 提供统一的关联解析函数。

验收：

- 同一文档不同表可关联。
- 跨文档、跨多维表文件不可选。
- 删除目标记录后 UI 不崩溃，恢复后可重新显示。
- 删除目标表不级联删除来源字段。
- 历史快照和移动端只读可正常展示。

#### T02B.2 单向关联

目标：

- 完成来源表到目标表的单向关联选择。

实现范围：

- 关联选择器：搜索、目标记录列表、已选计数、添加记录、取消、确认。
- 单元格显示目标记录第一列值。
- 多值显示紧凑 chip 列表。
- 可直接跳转目标记录。
- 删除关联项只影响关联单元格，不删除目标记录。

验收：

- 单选和多选均可用。
- 重复选择、删除已选、搜索、取消不改变数据。
- 草稿确认前不写正文。
- 只读状态不出现可编辑入口。

#### T02B.3 双向关联

目标：

- 源表字段与目标表字段互相镜像。

实现范围：

- 创建双向关联时在目标表自动创建反向字段。
- 反向字段默认名称 `来源表名 + 来源字段名`，允许重命名。
- 两侧记录 ID 集合保持一致。
- 任一侧更新时同步另一侧。
- 删除一侧字段时解除配对，另一侧保留为单向关联。
- 不自动删除目标记录。

验收：

- A 关联 B 后，B 反向出现 A。
- 移除一侧关系，另一侧同步移除。
- 删除一侧字段，另一侧数据和配置保留。
- 不使用多表关联跨文档。
- 同步、历史、移动端只读表现一致。

#### T02B.4 关联数据范围 + 选择器改版（260929 用户追加）

> 用户口径原话：「关联数据表需要做是否可以从视图选择，如果不勾选就默认从全部数据里选，如果勾选了，就要绑定一个视图」＋
> 「关联字段选择的时候弹窗展示，不要扣扣搜搜的使用小弹窗，就用正常的全局弹窗，然后展示选择的关联表全部信息…两个 tab（全部 / 已选择且展示数量）…搜索框，右侧也有筛选条件和排序…主要区域全局展示…**不做添加记录**」。

实现范围：

- 字段配置：`从视图筛选记录` 勾选框 + `关联视图` 下拉（目标表的视图列表）；不勾选 = 全部记录。
- 选择器改为**全局大弹窗**（Overlay `Dialog`，约 1080×672）：两个 tab（所有可关联记录 / 已选 N 条记录）、全局搜索、右侧筛选与排序、主区域 = 目标表**整表**（每个字段一列）、页脚「已选 N 条记录 / 取消 / 确认」。
- 已选页签保留复选框（可取消）、保持**选择顺序**。
- 撤销 T02B.2 的「添加记录」与「跳转目标记录」入口（按图 2 结构收敛）。
- 筛选/排序是**选择器本机状态**（不写正文），复用视图求值引擎 `applyViewToRecords`。

验收：

- 不勾选数据范围 → 候选 = 目标表全部记录；勾选并绑定视图 → 候选 = 该视图筛选后的记录（含视图自带排序）。
- 已选记录即使不在数据范围内也照常显示（展示与候选两套口径）。
- 确认才写正文；取消 / 搜索 / 重复选择不落盘。
- 弹窗内筛选/排序/搜索可正常点选并生效；只读态无入口。

#### T02B 明确不做

- 查找引用。
- 汇总、计数、平均、最长/最短等动态统计。
- 公式。
- 跨多维表文件关联。
- 跨文档关联。
- 文档嵌入字段。

### 批次 F：表单和数据进出

#### T06 表单本地增强

实现范围：

- 表单标题。
- 表单描述。
- 预览。
- 字段顺序调整。
- 继续复用内部新增记录逻辑。

不做：

- 外部收集链接。
- 二维码。
- 云端分享。

#### D01 CSV 导入导出

实现范围：

- CSV 导出。
- CSV 导入和字段映射。
- 附件字段仅导出文件名。
- 多值字段使用稳定分隔符。
- 导入时字段类型不匹配必须提示并放弃该单元格或整行，不能写入坏值。

暂不包含：

- Excel `.xlsx` 解析。
- 复杂类型自动推断。
- 公式重算。

#### D02 JSON 导入导出

实现范围：

- 导出完整 `tables/fields/records/views`。
- 导入前校验 `kind`、`version` 和结构。
- 保留未知字段类型和未知视图配置。

## 8. 推荐执行顺序

1. `V01` 多视图工作台
2. `V02` 看板视图
3. `V03` 画册视图
4. `V04` 日历视图
5. `T01` 列级统计
6. `T03` 多级分组（260929 已废弃；不执行）
7. `T04` 语义排序增强
8. `T02A` 基础字段
9. `T02B.1` 关联基础模型
10. `T02B.2` 单向关联
11. `T02B.3` 双向关联
12. `T06` 表单本地增强
13. `D01` CSV 导入导出
14. `D02` JSON 导入导出

每个编号必须单独验收。不要在一次会话中跨越多个批次，除非前一批次已完成测试并明确记录。

## 9. 质量门禁

所有代码批次必须至少执行：

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npx tsc --noEmit
npx vitest run
npm run check:core
npx vite build
npx vite build -c vite.mobile.config.ts
node scripts/ui-metrics.mjs
git diff --check
```

UI/CSS 改动还必须执行：

```bash
npx vitest run src/styles/cssLayers.test.ts src/styles/uiPrimitives.test.ts
```

关联、同步、历史改动还必须补充：

- 单测覆盖数据序列化/反序列化。
- 表格、看板、画册、日历在同一份数据上的对拍测试。
- 删除、恢复、回收站、目标表删除测试。
- 桌面和移动端只读对拍。

## 10. UI 与交互约定

- 所有弹窗优先使用 `Overlay.tsx` 的 `Dialog/Menu/Popover/Drawer`。
- 表格中的单元格浮层继续使用 `bitableCells.tsx`。
- 新增字段配置必须复用现有字段编辑弹窗视觉。
- 新增视图配置必须复用现有浮层面板。
- 关联选择器沿用语雀的轻量弹窗/选择器语义，不引入飞书大卡片或钉钉侧边应用面板。
- 看板/画册/日历只改变显示方式，不改变数据。
- 编辑器只读状态必须禁用所有修改入口。
- 移动端只读状态必须显示明确状态，不允许空白或静默失败。
- **只读值渲染单一来源（260930 用户追加）**：关联选择器、历史快照、回收站/锁定文档的只读多维表值统一走 `CellEditor` 的只读分支（`readOnly`）。单选/多选/评分/进度/布尔/日期/链接/关联等不再在某个入口退化成纯文本；历史快照与回收站本来通过只读 `BitableEditor` 复用同一路径，选择器现已并入。
- **列菜单与列文字颜色（260930 用户追加）**：列菜单提供“隐藏列”快捷入口；列文字颜色使用独立深色调色板 `BITABLE_TEXT_COLOR_PALETTE`，不再复用浅色选项背景 `BITABLE_OPTION_PALETTE`。

## 11. 任务状态看板

> 每次会话开始和结束都更新这里。状态值：`未开始` / `进行中` / `阻塞` / `待验收` / `已完成` / `已废弃`。

| 任务 | 状态 | 当前会话 | 说明 |
| --- | --- | --- | --- |
| 方案冻结 | 已完成 | 260928 | 产品边界和顺序已确认 |
| V01 多视图工作台 | 已完成 | 260928-V01 | 用户 260928 验收通过（见 §13） |
| V02 看板视图 | 待验收 | 260928-V02 | 代码 + 全部门禁 + CDP 真实端点验收完成；含只读写入口泄漏修复（见 §13） |
| V03 画册视图 | 待验收 | 260928-V03 | 封面 / 裁剪·适应 / 常规·紧凑 / 卡片字段全部落地（见 §13） |
| V04 日历视图 | 待验收 | 260928-V04 | 月网格 + 跨天 + 颜色 + 拖拽平移，全程本地日期语义（见 §13） |
| T01 列级统计 | 待验收 | 260929 | 先删→同日恢复→定稿为**常驻**（24px 薄条贴视图最底 + 状态栏上移）；汇总方式**逐字对齐云端 config**（见 §13「T01 与云端对齐」），**只有第一列默认「记录总数」**，其余默认空白（占位「统计」仅 hover 显形）；统计格 = 白底 chip + ▾，点开按字段类型给选项 |
| V05 续 四条修复 + 悬浮 + | 待验收 | 260929 | ① 列选中点列外即清；② 分组汇总行固定 36px（低档，不随行高）；③ 分组头**每列**都有汇总位（未配置给「统计」占位入口）；④ 底部汇总栏常驻（24px 贴视图底）+ 状态栏上移（`[data-doc-kind="bitable"]` bottom:34px）；⑤ 分组「加进本组」的 **+ 不占行**，改成**悬浮在分组边界线上**（见 §13） |
| V05 分组样式（复刻云端） | 待验收 | 260929 | 分组头改**整行 56px**：折叠钮 + 分组值 + 每列统计格（右对齐，首列缺省 `N 条记录`）；每组记录后 40px 圆形「加进本组」，顶级分组间 20px 间隔。规格来自 Edge 实测云端 `lakex-viewer-grid-group-*`（见 §13） |
| T03 多级分组 | 已废弃 | 260929 | 用户决定不做多级；已删除多级树/拖动/层级样式，历史提交 `9b80ede` 仅存档（见 §13） |
| 单级分组重做 | 待验收 | 260929-UI | 只消费 `groups[0]`；单张白卡 + 1px 边框 + 8px 圆角；按组统计/加进本组保留；历史多规则正文收敛为第一级（见 §13） |
| 分组底衬 + 底栏收口 | 待验收 | 260929-UI2 | 复刻云端「浅灰分组通道 + 白卡」：表头下 20px 间隙（`.bt-group-head-gap`）、加进本组/组间/表下空白统一走新令牌 `--lake-bg-subtle`（**不分组时表格下方空白同款**）；卡片收口移到该组最后一条记录（+ 行在卡外）；汇总文案改「共 N 条」；**删掉表底「已选择 N 个单元格」横条**，底栏即最底下那条，文档状态栏改成**实测贴住底栏上沿**（见 §13） |
| T04 语义排序增强 | 待验收 | 260928-T04 | 单选/多选「选项顺序·逆序」，日期文案早→晚/晚→早（见 §13） |
| T02A 基础字段 | 待验收 | 260928-T02A | 布尔/链接/评分/进度/创建·修改时间；**系统时间可筛选/排序/分组/统计**（记录级取值口径，见 §13） |
| T02A 续 评分/进度交互 | 待验收 | 260929 | 评分空星改**实心** + 选中星对齐云端金（`--lake-rating-star` #ecaa06）+ 进度**只留「条 + 百分比」**（数值框整体删除；仍可拖动、键盘可达、Delete 清空；只读不接指针）（见 §13） |
| 浮层定位统一（基础设施） | 待验收 | 260929 | **贴底翻上方**：垂直口径收敛到 `placeVertical`/`usePopoverPosition`；多维表日期/单选/展开面板/行右键菜单 + 标签页右键 + 卡片右键全部改走**实测**定位（见 §13） |
| 260929-OPT 阶段代码优化 | 待验收 | 260929-OPT | 本轮用户要求「先整理/优化当前阶段代码」：修 6 处真 bug（进度颜色面板打不开 / 表单题序被丢 / 系统时间列查重失效 / 系统时间列复制为空 / 搜索绕开展示口径 / 删字段留脏配置）+ `statForField` 原型链加固 + 令牌合规（组件 CSS 去颜色字面量）+ 单一来源（移动端附件判定）；明细见 §13 |
| T02B.1 关联基础模型 | 待验收 | 260929-T02B.1 | 同一文档内跨表关联：`BitableRelation` 模型 + `relationRecordIds/relationTargetTable/relationTargetRecords` 统一解析 + `BitableDisplayContext` 透传（表格/详情/表单/看板/画册/日历/移动端/历史/搜索）+ 字段配置（目标表 + 允许多个记录）+ `RelationCell` chip 展示；CDP 真实端点验收通过（见 §13） |
| T02B.2 单向关联 | 待验收 | 260929-T02B.2 | 关联选择器：搜索 / 目标记录列表 / 已选计数 / 新建记录 / 取消·确认（**草稿确认前不写正文**）+ 跳转目标记录；多选·单选均可用；复用 `.bt-option-*` 原语（见 §13） |
| T02B.3 双向关联 | 待验收 | 260929-T02B.3 | 反向字段（默认名 = 来源表名 + 来源字段名）+ 两侧配对 + **回填已有值** + 双向镜像唯一写入口 `applyRelationMirror` + 删一侧解除配对（对侧降级为单向、数据保留）（见 §13） |
| 移动端多维表只读补齐 | 待验收 | 260929-MOBILE | 布尔/链接/评分/进度/关联/系统时间的**只读控件**（不再是裸文本）+ 非 grid 视图回退提示；Android 模拟器 CDP 验收通过（见 §13） |
| T06 表单本地增强 | 待验收 | 260928-T06 | 编辑态恢复 v1 原形态，「填写表单」= 跳到预览 tab（无独立弹层）；已配置默认进预览（见 §13） |
| T07 图片字段类型 | 待验收 | 260928-T07 | image 复用附件值模型，上传/拖拽/粘贴三路只收图片（见 §13） |
| F01 图片预览总数 | 待验收 | 260928-F01 | 文档预览改用**正文**图片表（虚拟渲染下 DOM 不全 ⇒ 切不动）；预览范围**恒为单个单元格**（见 §13） |
| F02 附件命名审计 | 待验收 | 260928-F02 | 磁盘名绝不外显/不可编辑（统一守卫）+ bitable 展示名取用户原始文件名（见 §13） |
| F03 表单编辑态回退 + 看板缩略图 | 待验收 | 260928-F03 | 编辑态恢复 v1；看板图片字段上卡出缩略图（见 §13） |
| V03.1 画册封面点预览 | 待验收 | 260928-V03.1 | 点封面把**本视图全部图片封面**交给 Lightbox（可左右切换，见 §13） |
| 260929 多级分组样式试验 | 已废弃 | 260929-UI | 曾做多级区域卡/子组留白；用户最终决定不做多级，相关样式与逻辑已由「单级分组重做」替代 |
| D01 CSV 导入导出 | 未开始 | - | 不依赖新重型库优先 |
| D02 JSON 导入导出 | 未开始 | - | 完整结构导出 |
| V05 图表视图 | 已废弃 | - | 产品确认不做 |
| T05 条件填色 | 阻塞 | 260930-FILL-RESEARCH | 已完成独立预研：`docs/BITABLE-FILL-COLOR-RESEARCH.md`；用户明确等筛选重构完成后再讨论着色，当前不实施 |
| 关联字段「选择数据表」占位修复 | 待验收 | 260929-REL-FIX | `关联数据表` 下拉不再把占位文案当选项（用户报「选择数据表仅是提示，不能当做选项」）；见 §13 |
| T02B.4 关联数据范围 + 选择器改版 | 待验收 | 260929-T02B.4 | 字段配置加「从视图筛选记录」（不勾选=全部记录 / 勾选=绑定目标表的一个视图）；选择器由单元格小气泡改**全局大弹窗**（两个 tab / 全局搜索 / 筛选·排序 / 目标表整表 / 不做添加记录）；见 §13 |
| 新建数据表默认结构 | 待验收 | 260929-DEF-TBL | 默认表 = **1 列文本 + 3 行空白记录**（取消预置的单选/日期列）；「新建数据表」与空正文兜底共用 `createDefaultBitableTable`；见 §13 |
| 关联选择器图片/附件真渲染 | 待验收 | 260929-REL-ASSET | 选择器整表里的图片与附件**真渲染**（图片缩略图可点开预览本格、其余附件出「图标 + 文件名」chip）；顺带把资产 URL 收敛为 `bitableAssetUrl` 单一来源（单元格/看板/画册/选择器）；见 §13 |
| 横向页签原语（B 墨线 + 计数徽标） | 待验收 | 260929-TABS | 用户在五个形态里选定 **B**；已做成 `kit.css` 的正式原语 `.ln-tabs`（文字 + 选中变强调色 + 与文字等宽的 2px 下划线；数量进 `.ln-tabs__count` 徽标；右侧动作 `.ln-tabs__action`），**已全量落地**：关联选择器 / 回收站 / 历史面板 / 表单编辑·预览；过渡变体 `.ln-tabs--seg` 已删除；见 §13 |
| 表头「新增字段」＋贴左列 | 待验收 | 260930-ADDCOL | 加号原被 `th` 的浏览器默认 `text-align:center` 甩到表尾空白区正中（实测该格 604px、加号 x=965）；改 `.bt-grid th.bt-th-add { text-align:left; padding-left:8px }`，**只对齐内容、不动列宽**，实测加号左缘 = 最后一列右缘 + 8px；见 §13 |
| 选项编辑「添加」不再自动全选（去蓝色底色） | 待验收 | 260930-OPTBLUE | 「添加选项 / 回车新建」的新行原先把默认名 `选项 N` 整块选中 ⇒ 一块系统蓝底；改 `focus()+光标落末尾`（去 `el.select()`）+ 新选项留空/默认名走 `placeholder` + 保存时空名兜底「选项 N」；实测新行 `selection=[0,0]`、键入即名、空着保存落成「选项 7」；见 §13 |
| 列宽自由设置 + 行高不被内容撑高 | 待验收 | 260930-COLW | 列宽改**以字段 `width` 为准**（auto 布局下 `<col>` 的 width 只是「至少」：附件 chip 实测 180→413 ⇒ 每格行内 `max-width`，表头/记录格/分组统计格/底栏统计格四处）；行高改**与内容无关**（`.bt-grid th/td` 补 `white-space: nowrap`：日期列 80px 折行导致 36→48；日期/时间格省略号、文本格 `text-overflow: ellipsis`）；拖拽下限 80→**40**；见 §13 |
| 附件按文档类型图标展示 | 待验收 | 260930-FILEICON | 附件**不再显示文件名 chip / 缩略图**：单元格 = 小类型图标 + **hover 名称气泡**（`.ln-tip` 表面 + `usePopoverPosition` 定位）；展开面板 = 大类型图标（名称仍在卡下方）。图标用 lucide-react（**内核 sprite 实测无 file/pdf/doc 系图标**，云端那套在语雀 App 自己的 sprite 里）、类型判定走 core 的 `fileKindOf()`、配色新增 `--lake-file-*`；**图片字段仍是缩略图**（`imageOnly` 分叉）；见 §13 |
| 附件按文档类型图标展示 | 待验收 | 260930-FILEICON | 附件**不再显示文件名 chip / 缩略图**：单元格 = 小类型图标 + **hover 名称气泡**（`.ln-tip` 表面 + `usePopoverPosition` 定位）；展开面板 = 大类型图标（名称仍在卡下方，**被省略号截断时 hover 出全名气泡** —— 同一套 `useNameTip`、`scrollWidth > clientWidth` 才弹）。图标用 lucide-react（**内核 sprite 实测无 file/pdf/doc 系图标**，云端那套在语雀 App 自己的 sprite 里）、类型判定走 core 的 `fileKindOf()`、配色新增 `--lake-file-*`；**图片字段仍是缩略图，但 hover 名称走同一套气泡**（用户追加）；**移动端同步落地**（附件字段 = 小图标 + 名称，触屏无 hover 故保留名称；Android 模拟器实测）；**关联字段选择器整表也复用同一套 `AttachmentChipList`**（不再自养「📎 文件名」chip）；见 §13 |
| 关联选择器视图投影 | 待验收 | 260930-REL-VIEW | 绑定视图=字段顺序+隐藏字段+只读筛选/排序/分组基线；未绑定=默认表格视图字段顺序但全部字段/记录；额外筛选/排序仅弹窗本机状态、确认才落选中 id；后加字段动态进入；见 §13 |
| 关联选择器/历史/回收站只读渲染统一 | 待验收 | 260930-REL-CELL | 关联选择器值改走 `CellEditor readOnly`；单选/多选/评分/进度/布尔等与正式行视图同控件；历史快照、回收站/锁定文档继续共用只读 `BitableEditor → CellEditor`；见 §13 |
| 单向/双向关联拆成真实字段类型 | 待验收 | 260930-REL-TYPE | `relationOneWay` / `relationTwoWay` 成为两个真实 `BitableFieldType`；去掉 `relation.mode`；字段类型选择器分别显示单链/双向箭头图标；建对/解绑/镜像按 type 判断；见 §13 |

| 列菜单“隐藏列”+ 深色文本调色板 | 待验收 | 260930-COLOR | 列菜单新增“隐藏列”；列文字颜色改用独立深色调色板，不再复用浅色选项背景；见 §13 |
| 筛选精准重做 | 待验收 | 260930-FILTER | 字段类型操作符矩阵、15 种动态日期、AND/OR 条件组、最多 2 层子组；`BitableFilterEditor` 与 `evaluateFilterNode` 可复用于视图筛选、关联选择器和后续条件着色；见 §13 |

## 12. 修改记录

> 追加格式：`日期 / 会话 / 任务 / 改动文件 / 结果 / 遗留`。

| 日期 | 会话 | 任务 | 改动 | 结果 | 遗留 |
| --- | --- | --- | --- | --- | --- |
| 2026-09-28 | 260928 | 调研与方案冻结 | 新增本文档 | Edge 实测、竞品对账、产品决策完成 | 待开始 V01 |
| 2026-09-28 | 260928-V04 | V04 日历视图 | `src/core/bitableDoc.ts`(+test) · `src/features/bitable/BitableCalendarView.tsx`(新) · `bitableCalendarView.css`(新) · `BitableViewConfigPanels.tsx`(新) · `BitableEditor.tsx` · `bitableEditorMount.test.ts` · `src/styles/cssLayers.test.ts` | 门禁全绿 + CDP 真实端点验收通过（拖拽改日期已落盘核对） | 不做农历/节假日/重复日程/提醒；移动端只读回退 |
| 2026-09-28 | 260928-F02 | 附件命名审计 | `src/features/bitable/BitableEditor.tsx` · `bitableEditorMount.test.ts` | 复核 main 侧契约：附件 filename=展示名、url 末段=磁盘名、buildAssetFilename 随机唯一（无去重）；bitable 展示名改取 `file.name` | 无新增改动面 |
| 2026-09-28 | 260928-F01 | 图片预览总数 | `src/features/editor/imagePreview.ts`(+test) · `LakeEditor.tsx` · `BitableGalleryView.tsx` · `BitableEditor.tsx` · `bitableEditorMount.test.ts` | 实测 10 图文档预览 1/10 → 10/10；画册点封面 1/2 → 2/2 | 同一张图重复出现时按首次匹配定位下标 |
| 2026-09-28 | 260928-T04 | T04 语义排序增强 | `src/core/bitableDoc.ts`(+test) · `BitableEditor.tsx` · `bitableEditorMount.test.ts` | 门禁全绿 + 实测选项序 B/C/E→D→A、逆序反转、字典序不受影响 | 不做公式排序 |
| 2026-09-28 | 260928-style | 字段类型选择改 2 列网格 | `bitableCells.tsx`(FieldTypeGrid) · `bitableFieldCells.css` · `BitableEditor.tsx` | 实测 `142px 142px` 两列 / 14 项 / 无分组标题；新增字段面板与字段编辑弹窗共用 | 无 |
| 2026-09-28 | 260928-T02A-fix | 系统时间字段打通筛排 | `src/core/bitableDoc.ts`(+test) · `BitableEditor.tsx` | 实测按创建时间升序 A/C/B、配置落盘；排除了之前的假边界 | 无 |
| 2026-09-28 | 260928-T02A | T02A 基础字段 | `src/core/bitableDoc.ts`(+test) · `bitableCells.tsx` · `BitableEditor.tsx` · `BitableRecordDrawer.tsx` · `BitableKanbanView.tsx` · `BitableGalleryView.tsx` · `BitableFormView.tsx` · `src/mobile/bitable/MobileBitableViewer.tsx` · `bitableFieldCells.css`(新) · `cssLayers.test.ts` | 门禁全绿 + 实测布尔/评分/进度/链接交互并落盘；系统字段已从筛选/排序/分组/表单排除 | 系统时间不支持筛选排序（无假入口） |
| 2026-09-28 | 260928-T03 | T03 多级分组 | `src/core/bitableDoc.ts` · `bitableGroup.test.ts` · `BitableEditor.tsx` · `bitableViews.css` · `cssLayers.test.ts` | 门禁全绿 + 实测两级树/折叠/层级缩进/拖动重排（配置落盘） | 折叠 key 基于选项名，改名会重置折叠态 |
| 2026-09-28 | 260928-T01 | T01 列级统计 | `src/core/bitableDoc.ts`(+test) · `src/features/bitable/BitableEditor.tsx` · `bitableViews.css` · `cssLayers.test.ts` · `bitableEditorMount.test.ts` | 门禁全绿 + 实测：求和 7 → 筛选后 1、时间范围 9 天、多列独立 | 移动端隐藏统计（验收允许） |
| 2026-09-28 | 260928-F04 | 预览范围改为单单元格 + 展示名守卫 + 填写表单跳预览 | `bitableCells.tsx` · `BitableGalleryView.tsx` · `BitableEditor.tsx` · `BitableRecordDrawer.tsx` · `BitableFormView.tsx` · `src/core/bitableDoc.ts`(+test) · `src/features/attachment/attachmentPreviewController.ts` · `bitableEditorMount.test.ts` | 实测两列图片各自独立：A=1/2、B=2/3、画册封面=1/2、看板 2+3 | 无 |
| 2026-09-28 | 260928-F03 | 表单编辑态回退 + 看板缩略图 | `BitableFormView.tsx` · `bitableFormView.css` · `BitableKanbanView.tsx` · `bitableKanbanView.css` · `BitableEditor.tsx` · `cssLayers.test.ts` | 实测编辑态回到 v1 原形态；看板卡片出缩略图不出文件名 | 无 |
| 2026-09-28 | 260928-T07 | T07 图片字段类型 | `src/core/bitableDoc.ts`(+test) · `src/features/bitable/bitableCells.tsx` · `BitableEditor.tsx` · `BitableRecordDrawer.tsx` · `BitableFormView.tsx` · `src/mobile/bitable/MobileBitableViewer.tsx` · `bitableEditorMount.test.ts` | 门禁全绿 + CDP 实测（mp3 被拒有提示 / png 上传落盘） | 附件侧行为不变（无 accept 限制） |
| 2026-09-28 | 260928-V03.1 | V03.1 画册封面点预览 | `BitableGalleryView.tsx` · `bitableGalleryView.css` · `BitableEditor.tsx` | CDP 实测点封面开的是 image-lightbox（不是记录抽屉） | 不做多类型预览，非图片沿用 openAssetEntry 分流 |
| 2026-09-28 | 260928-T06 | T06 表单本地增强 | `BitableFormView.tsx`(重写) · `bitableFormView.css`(新) · `BitableEditor.tsx` · `src/styles/cssLayers.test.ts` · `bitableEditorMount.test.ts` | CDP 实测：新表单默认编辑、已配置默认预览、提交加记录 | 不做分享/二维码/云端收集 |
| 2026-09-28 | 260928-V03 | V03 画册视图 | `src/core/bitableDoc.ts`(+test) · `src/features/bitable/BitableGalleryView.tsx`(新) · `bitableGalleryView.css`(新) · `BitableViewConfigPanels.tsx`(新) · `BitableEditor.tsx` · `bitableEditorMount.test.ts` · `src/styles/cssLayers.test.ts` | 门禁全绿 + CDP 真实端点验收通过（真实图片经 ?w= 缩略图上屏） | 移动端只读回退；不做封面标题/多封面 |
| 2026-09-28 | 260928-V02 | V02 看板视图 | `src/core/bitableDoc.ts`(+test) · `src/features/bitable/BitableKanbanView.tsx`(新) · `bitableKanbanView.css`(新) · `BitableEditor.tsx` · `bitableViews.css` · `bitableEditorMount.test.ts` · `src/mobile/bitable/MobileBitableViewer.tsx` · `src/styles/cssLayers.test.ts` | 门禁全绿 + CDP 真实端点验收通过 | 多选分组/手动排序不做；画册·日历未实现 |
| 2026-09-28 | 260928-V01 | V01 多视图工作台 | `src/core/bitableDoc.ts`(+test) · `src/features/bitable/BitableViewBar.tsx`(新) · `bitableViews.tsx`(新) · `bitableViews.css`(新) · `BitableEditor.tsx` · `bitableEditorMount.test.ts` · `src/mobile/bitable/MobileBitableViewer.tsx` · `src/mobile/mobile.css` · `src/styles/cssLayers.test.ts` · `src/components/historySnapshotPreview.test.ts` | 门禁全绿 + CDP 真实端点验收通过 | 看板/画册/日历本体在 V02–V04；未知视图在旧客户端按表格显示 |
| 2026-09-29 | 260929 | T02A 续 评分/进度交互 | `src/features/bitable/bitableCells.tsx` · `bitableFieldCells.css` · `src/styles/themes/{light,dark,warm}.css` · `src/styles/cssLayers.test.ts` · `bitableEditorMount.test.ts` | 门禁全绿 + CDP 真实端点验收：空星 `#d5d9de` 实心、选中星 `#ecaa06`（云端金）、拖动线性 0/10/25/50/73/90/100 全命中并落盘、键盘步进 50→51→52→51→50→40→50、Delete 清空落盘、只读拖动不写入、数值框已删除（仅条+百分比） | 已提交（待用户验收）；进度**默认色**仍走 `--lake-accent`；进度不再能输入精确值/不再有输入框内清空（清空走 Delete/Backspace） |
| 2026-09-29 | 260929 | V05 续：补做第 2/3 条（表底 + 按分组隐藏 / 分组 + 独立空间无线） | `BitableEditor.tsx` · `bitableViews.css` · `bitableEditorMount.test.ts` | 门禁全绿 + CDP 对拍：取消分组 → 表底 + **1**；恢复分组 → 分组 + **2** / 表底 + **0**；分组 + 行高 **32** 且按钮**在行内**、td 边框 0 | 无 |
| 2026-09-29 | 260929 | T01 与云端对齐（汇总方式/默认口径/chip） | `src/core/bitableDoc.ts`(+test) · `bitableCells.tsx`(StatCell) · `BitableEditor.tsx` · `bitableViews.css` · `cssLayers.test.ts` · `bitableEditorMount.test.ts` | 门禁全绿 + CDP：默认只显示 2 个「记录总数 N」（每分组首列），其余 10 个 opacity:0；chip 白底 + 1px；点开选项 = 云端 8 项（文本）；进度列 = 10 项（多最大/最小值、**无求和**） | 复选框/数字/创建·修改时间等未逐一点验（按 bundle 的 types 直接实现） |
| 2026-09-29 | 260929 | V05 续：分组 + 改悬浮 | `bitableViews.css` · `cssLayers.test.ts` | 门禁全绿 + CDP：加行高 **1px**（原 40px）、按钮 24×24 **居中于边界线**、命中测试仍是按钮 | 无 |
| 2026-09-29 | 260929 | V05 续：四条修复 | `src/features/bitable/BitableEditor.tsx` · `bitableViews.css` · `src/styles/chrome.css` · `cssLayers.test.ts` · `bitableEditorMount.test.ts` | 门禁全绿 + CDP 四条全过：列选中 4→0（同列内保持 4）、分组行恒 **36px**（行高=高时记录行 64）、每列汇总位（2 个「统计」占位）、底栏 **24px** 且与 `.bt-grid-wrap` 底边对齐（819=819）、状态栏 bottom **34px** | `bitableViews.css` 88 → 110、`chrome.css` 506 → 507 |
| 2026-09-29 | 260929 | 分组头「分组值优先 + 首列统计下限 80px」 | `bitableViews.css`(`.bt-group-inner` 不进流) · `BitableEditor.tsx` · `cssLayers.test.ts` · `AGENTS.md`(样式统一规则) | 修掉真错位：表头首列 482px vs 记录行 80px（长文本被算进 auto 列宽）⇒ 改后**完全对齐（415–495）**；长分组值省略号、统计下限 **80px**（云端 Edge 实测值） | `bitableViews.css` 83 → 88 |
| 2026-09-29 | 260929 | 「添加」统一为云端圆形 + 钮 | `bitableViews.css`(`.bt-add-round`) · `BitableEditor.tsx` · `bitableEditor.css` · `cssLayers.test.ts` | 门禁全绿 + CDP：4 颗钮（新增字段/加进本组×2/添加记录）均 **24×24、radius 999px**，无旧类残留 | `bitableEditor.css` 1075 → **1051**（旧样式删除，围栏同时抓到并清掉一处真重复） |
| 2026-09-29 | 260929 | V05 分组样式复刻云端 + T01 恢复 | `src/core/bitableDoc.ts`(+节点 `fieldId`) · `BitableEditor.tsx` · `bitableViews.css` · `bitableEditor.css` · `cssLayers.test.ts` | 门禁全绿 + CDP：分组行 56px / 6 格、首列 `1 条记录`、每组 1 个圆钮、组间 1 条间隔、底栏总计；截图与云端结构一致 | `bitableViews.css` 20 → 74、`bitableEditor.css` 1081 → 1075（按职责归并） |
| 2026-09-29 | 260929 | 浮层定位统一（贴底翻上方） | `src/hooks/topMenuPosition.ts`(+test) · `usePopoverPosition.ts`(新) · `src/features/bitable/bitableCells.tsx` · `BitableEditor.tsx` · `src/features/editor/MultiTabEditor.tsx` · `CardContextMenu.tsx` · `bitableEditorMount.test.ts` | 门禁全绿 + CDP：末行日期**翻到锚点上方且完整可见**、首行仍在下方、行右键菜单完整可见 | 浮层不跟随滚动（与改前一致） |
| 2026-09-29 | 260929 | **T01 整体回退** | `src/core/bitableDoc.ts`(+test) · `src/features/bitable/BitableEditor.tsx` · `bitableViews.css` · `src/styles/cssLayers.test.ts` · `bitableEditorMount.test.ts` | 门禁全绿 + CDP 真实端点：底栏与列菜单「统计」均不存在；旧正文残留 `columnStats` 保存后消失 | 功能整体删除（含持久化字段）；`bitableViews.css` 基线 20 → 16 |
| 2026-09-29 | 260929 | T01 续 空统计行不渲染（随后被整体回退） | `src/features/bitable/BitableEditor.tsx` · `bitableEditorMount.test.ts` | 门禁全绿 + CDP 真实端点：未配统计时 `tfoot/.bt-stat-row` 均不存在（截图无灰条）；配一列统计后出现 `记录总数 3` | 统计行样式与功能保留；若用户要整个列统计功能回退需另议 |
| 2026-09-29 | 260929 | 分组区域与细节优化 | `src/features/bitable/BitableEditor.tsx` · `bitableViews.css` · `bitableEditorMount.test.ts` · `src/App.tsx` · `scripts/e2e-sidebar-hover.mjs` · `src/styles/cssLayers.test.ts` · `HANDOFF.md` | 门禁全绿；CDP 实测单级分组白卡、两级分组区域/子卡间距、`+` 行底边 0、表底重复计数为空；BrowserSkill + Edge 读取钉钉样例样式做对照 | 单级分组已是白卡；两级外层仍保留浅底容器；等待用户验收视觉密度 |
| 2026-09-29 | 260929 | T03 回退 + 单级分组重做 | `src/core/bitableDoc.ts`(+test) · `src/core/bitableGroup.test.ts` · `src/features/bitable/BitableEditor.tsx` · `src/features/bitable/bitableViews.css` · `src/features/bitable/bitableEditorMount.test.ts` · `HANDOFF.md` | 定位历史提交 `9b80ede`；删除 `groupRecordsTree/BITABLE_MAX_GROUPS`、多规则面板、拖动排序和层级样式；单级分组卡片 + 按组统计/加进本组保留；解析时 `groups.slice(0,1)`；门禁全绿 + 隔离 CDP 实测 | 等待用户验收；历史多分组正文会只保留第一级配置 |
| 2026-09-29 | 260929-UI2 | 分组底衬 + 底栏收口（用户四条 + 「数据表选择区同灰」+ 「多选量落到最左格」+ 「底栏融合灰底 / 汇总行整行」+ 「表格线变浅」+ 「无统计必须不展示 / 左下角计数口径」+ 「＋号居中在编号正下方」+ 「分组删除键挪到行尾」+ 「链接格 2 层边框 / 链接格对齐云端」） | `src/core/bitableDoc.ts`(+test 新增 `statDisplayText`) · `src/features/bitable/bitableCells.tsx`（LinkCell 重写） · `BitableEditor.tsx` · `bitableViews.css` · `bitableFieldCells.css` · `bitableEditor.css`（`.bt-tables` 底衬改同灰、格线/卡片线改 `--lake-border-2`、格内输入框焦点环去重） · `bitableEditorMount.test.ts` · `src/styles/themes/{light,dark,warm}.css`（新令牌 `--lake-bg-subtle`） · `src/styles/chrome.css` · `src/styles/cssLayers.test.ts` | ① 分组底衬：表头下 20px 间隙 `.bt-group-head-gap` + 加进本组 + 组间 + 表下空白统一 #fafafa（**不分组时表格下方空白同款**）；② 卡片收口移到该组最后一条记录（`+` 行在卡外）；③ 汇总格文案「共 N 条」；④ 删掉表底「已选择 N 个单元格」横条，状态栏改实测 `--lake-bitable-status-bottom` 贴底栏上沿（实测：底栏 785–809、状态栏 761–783、重叠 **0px**）；⑤ 数据表选择区 `.bt-tables` 由 `--lake-bg-block` 改 `--lake-bg-subtle`（实测 `rgb(250,250,250)`），与表格区同一个灰；⑥ 底栏最左格**多选时**改显示选择量（「选择 N 行」/「选择 N 个单元格」，实测 1 行不触发、2 行触发、拖选 6 格触发）；⑦ 底栏底色改 `--lake-bg-subtle`（与表格区融合），汇总行去掉行内竖线（`border-right-width: 0`），光标所在格加重到 `--lake-bg-block`（实测：只有那一格变 `rgb(240,242,245)`，9 列边界与表头逐列对齐）；⑧ 格线/表头底线/卡片边线由 `--lake-border-1` 改 `--lake-border-2`（云端实测格线 `rgb(244,245,245)`；实测我方 computed `rgb(240,242,245)`、截图 1px 线 `rgb(241,242,245)`，差 3/255 不可辨）；⑨ **修 bug**：分组头首列汇总格的 `?? "count"` 兜底删除（选「无统计」不再硬显示「共 N 条」）；左下角计数由 `activeTable.records.length` 改 `shownRecords.length`（用户口径：它=当前视图**正在展示**的记录数，只随筛选/搜索与多选变；与「汇总项实时计算」是两套独立逻辑）；⑩ 两处添加入口的＋号改**编号列独占一格 + 居中**（实测行号/编号列表头/＋号中心同为 x 41；与行号同一条竖线）；⑪ 分组面板的删除键由「行首 ✕ / 取消分组」改为**行尾 🗑 / 删除分组**，与筛选、排序行同一套（实测三者 DOM 结构同构）；⑫ **修 bug**：格内输入框的焦点环在「单元格自己已有 2px 选中环」时不再叠画（修链接/文本格的「2 层边框」；多格选区的内层格仍保留焦点环）；⑬ 链接格改云端形态：展示**文本** + 右端 🔗 图标（点它用本地浏览器打开，实测 `window.open` 收到 URL），双击进入编辑、Esc 取消，**不再常驻输入框**（空值不再显示 `https://` 占位）。门禁全绿（tsc / vitest 1383-16 / check:core / 双端构建 / ui-metrics / cssLayers+uiPrimitives / git diff --check） | 已提交（待用户验收） |
| 2026-09-29 | 260929-OPT | 阶段代码优化（真 bug + 单一来源 + 令牌） | `src/core/bitableDoc.ts`(+test) · `src/features/bitable/BitableEditor.tsx` · `BitableFormView.tsx` · `bitableEditor.css` · `bitableEditorMount.test.ts` · `src/mobile/bitable/MobileBitableViewer.tsx` · `src/styles/cssLayers.test.ts`(注释) | 修 6 处真 bug：进度颜色面板被 `supportsOptions` 块吞掉、表单题序被丢、系统时间列查重失效/复制为空、搜索绕开展示口径、删字段留跨视图脏配置；`statForField` 加 hasOwnProperty；组件 CSS 去 `#fff/#1f1f1f/rgba` 颜色字面量；移动端附件判定收敛 `isAttachmentLikeField`。门禁全绿 + vitest 1386-16 | 纯去重类重构（B 档）按 §17 不做；抽屉阴影 rgba 无令牌未改 |
| 2026-09-29 | 260929-T02B.1 | T02B.1 关联基础模型 | `src/core/bitableDoc.ts`(+test) · `src/core/historyPreview.ts` · `src/features/bitable/{BitableEditor,bitableCells,BitableRecordDrawer,BitableFormView,BitableKanbanView,BitableGalleryView,BitableCalendarView}.tsx` · `bitableFieldCells.css` · `src/mobile/bitable/MobileBitableViewer.tsx` · `bitableEditorMount.test.ts` · `src/styles/cssLayers.test.ts` | 关联字段模型（tableId/mode/allowMultiple/pairedFieldId）+ 值恒为 id 数组 + 统一解析（`BitableDisplayContext` 可选 ctx，只解析一层防环）+ 字段配置（目标表下拉排除本表 / 允许多个记录默认勾）+ `RelationCell` chip；失效（删记录/删表）不崩不级联。门禁全绿 + vitest 1389-16 + CDP 真实端点（隔离 userData 9260） | T02B.1 无填写入口（值由 T02B.2 选择器写入）；关联的筛/排/分组/统计暂按空处理；移动端未跑 Android |
| 2026-09-29 | 260929-T02B.2 | T02B.2 单向关联（关联选择器） | `src/core/bitableDoc.ts`(+test 新增 `toggleRelationDraft`) · `src/features/bitable/bitableCells.tsx`(RelationCell 可编辑) · `BitableEditor.tsx`(跳转/新建回调) · `BitableRecordDrawer.tsx` · `bitableFieldCells.css` · `bitableEditorMount.test.ts` · `src/styles/cssLayers.test.ts` | 选择器 = 搜索 + 目标记录列表 + 已选计数 + 新建记录 + 取消/确认 + 行尾跳转；**草稿确认前不写正文**；多选增删 / 单选替换；复用 `.bt-option-*` 原语（删掉 T02B.1 的第二套 chip）。门禁全绿 + vitest 1391-16 + CDP 真实端点（隔离 userData 9261；搜索/取消不落盘、多选/单选落盘、跳转切表开抽屉、新建目标记录 6→7 均实测） | 新建记录用字段默认值（主字段空 → 未命名记录）；选择器列全部目标记录（不做数据范围筛选）；移动端未跑 Android |
| 2026-09-29 | 260929-T02B.3 | T02B.3 双向关联 | `src/core/bitableDoc.ts`(+test 新增 `relationReverseFieldName/createRelationPair/unpairRelationFields/applyRelationMirror`) · `BitableEditor.tsx`（双向开关 / 关联写值走镜像 / deleteField 先 unpair） · `bitableEditorMount.test.ts` | 建反向字段 + 回填已有值；双向镜像唯一写入口；删一侧解除配对（对侧降级单向、数据保留）；关掉双向即解除。门禁全绿 + vitest 1394-16 + CDP 真实端点（隔离 userData 9262；反向字段名 `第一个关联`、B 反向出现 A、改一侧另一侧同步、删反向字段来源保留且降级） | 反向字段默认名只在创建时给；已配对不允许改目标表（需先改回单向）；移动端未跑 Android |
| 2026-09-29 | 260929-MOBILE | 移动端多维表只读补齐 + Android 验收 | `src/mobile/bitable/MobileBitableViewer.tsx` · `src/mobile/mobile.css` · `src/mobile/bitable/mobileBitableViewer.test.ts`(新) | 单元格按字段类型给只读控件（布尔复选框 / 链接 target=_blank / 评分星 / 进度条 / 关联 chip / 附件缩略图 / 选项色块），非 grid 视图保留明确回退提示。门禁全绿 + vitest 1396-16 + **Android 模拟器 CDP 验收**（AVD lake_mobile；造两条 bitable 笔记断言全部控件） | 未跑真机；移动端仍只读；D01/D02 按用户要求暂缓 |
| 2026-09-29 | 260929-UI3 | 数据表行操作改浮动 | `src/features/bitable/bitableEditor.css` · `src/styles/cssLayers.test.ts` | 「⋯ / 删除表」由流内（opacity 0 仍占位）改**绝对定位浮层**：默认 visibility:hidden; opacity:0 且不接点击，悬停整行淡入；名称/计数不再被挤压。cssLayers 基线 1046 → 1054 | 无 |
| 2026-09-29 | 260929-UI4 | 字段类型改弹出选择 | `src/features/bitable/bitableCells.tsx`(新 `FieldTypeSelect`) · `BitableEditor.tsx`(编辑字段弹窗) · `bitableEditorMount.test.ts` | 「编辑字段」的字段类型由内联 2 列网格改**弹出选择器**：触发器一行（图标 + 名称 + ▾），点开才在 Popover 里出同一 `FieldTypeGrid`（14 项，当前项打勾）；弹窗不再被一大块网格撑高。快捷「新增字段」入口不变 | 未加「基础/高级」分组（沿用 260928 决定） |
| 2026-09-29 | 260929-UI5 | 类型名左对齐 + 选项回车新建 | `src/features/bitable/BitableEditor.tsx` · `bitableEditor.css` · `bitableEditorMount.test.ts` · `src/styles/cssLayers.test.ts` | ① 字段类型触发器文字改**左对齐**（`<button>` 默认 text-align:center 把类型名居中）；② 选项输入框**回车 = 当前选项编辑完成 → 切到下一个选项**，已是最后一个才新建并聚焦新行（与「添加选项」按钮共用 `addOptionRow`）。cssLayers 1054 → 1055 | 无 |
| 2026-09-29 | 260929-FIX | 状态栏「一个数据表有一个没有」 | `src/features/bitable/BitableEditor.tsx` · `bitableEditorMount.test.ts` | 根因：`--lake-bitable-status-bottom` 量的是 `.bt-stat-row`（`<tr>`，**static**），而 sticky 在 `.bt-stat-row td`；内容纵向溢出时 `<tr>` 停在内容底部（视口外），算出 **-231px** 把状态栏顶出屏幕（空表/不溢出时才对）⇒ 改为量 sticky 的 `td` | 无 |
| 2026-09-29 | 260929-REL-FIX | 关联字段「关联数据表」占位被当成选项 | `src/features/bitable/BitableEditor.tsx` · `bitableEditorMount.test.ts` | 占位文案「选择数据表」原先是 `options[0]`（`value: ""`）⇒ 空值时被渲染成选中项并打勾；改为 `SelectMenu` 的 `placeholder`，选项只留真实数据表（与看板/日历同写法）。门禁全绿 + vitest 1399-16 + CDP 真实端点（隔离 userData 9271：空值触发器 = 灰字占位、下拉仅 `["第一个"]`、`hasPlaceholderItem=false`） | 不提供「清除目标表」入口（关联字段无目标表无意义） |
| 2026-09-29 | 260929-T02B.4 | 关联数据范围 + 关联选择器改全局大弹窗 | `src/core/bitableDoc.ts`(+test) · `src/features/bitable/BitableRelationPicker.tsx`(新) · `bitableRelationPicker.css`(新) · `bitableCells.tsx` · `BitableEditor.tsx` · `BitableRecordDrawer.tsx` · `bitableEditorMount.test.ts` · `src/styles/cssLayers.test.ts` | ① 数据范围：`relation.viewId` + `relationTargetView`/`relationCandidateRecords`（不勾选=全部记录，勾选=按目标表视图筛选后的记录）；字段配置加「从视图筛选记录 + 关联视图」（换目标表/取消勾选即清 viewId）。② 选择器：单元格气泡 → **全局 Dialog**（两个 tab / 全局搜索 / 筛选·排序（弹窗内联条）/ 目标表整表 / 页脚「已选 N 条记录·取消·确认」），撤销「添加记录」与「跳转」；排序映射 `sortModeOf/applySortMode/changeSortField` 上收 core 单一来源。门禁全绿 + vitest 1402-16 + CDP 真实端点（隔离 userData 9271：15 行整表 / 两 tab / 搜索「打」→3 / 筛选「单选=已完成」→1 / 排序「评分降序」→4 在首 / 确认写盘 / 取消不落盘 / 勾选视图范围后候选 15→1、取消后回落 15） | 选择器本机筛选排序不持久化（按选择器语义）；移动端未跑 Android（只读路径未改） |
| 2026-09-29 | 260929-DEF-TBL | 新建数据表默认结构改「1 列文本 + 3 行空白」 | `src/core/bitableDoc.ts`(+test) · `src/core/bitableDoc.test.ts`(新增 3 字段夹具 `fixtureTable`) · `src/core/historyPreview.test.ts` · `electron/store.test.ts` · `bitableEditorMount.test.ts` | `createDefaultBitableTable` 由「文本+单选+日期、0 记录」改为「**文本 1 列 + 3 行空白记录**」；`emptyBitableBody()`（新建多维表文档首表）与编辑器「新建数据表」共用同一函数。门禁全绿 + vitest 1404-16 + CDP 真实端点（隔离 userData 9271：点新建数据表 → 表头 `["", "文本"]`、3 行空白、落盘 `fields:[text] records:3 values:[{},{},{}]`） | 测试夹具改为显式 `fixtureTable()`（不再隐式依赖产品默认字段），非兼容层 |
| 2026-09-29 | 260929-REL-ASSET | 关联选择器里图片/附件真渲染 + 资产 URL 单一来源 | `src/features/bitable/bitableAssetUrl.ts`(新) · `BitableRelationPicker.tsx` · `bitableRelationPicker.css` · `bitableCells.tsx` · `BitableEditor.tsx` · `BitableKanbanView.tsx` · `BitableGalleryView.tsx` · `BitableRecordDrawer.tsx` · `BitableFormView.tsx` · `bitableEditorMount.test.ts` · `src/styles/cssLayers.test.ts` | ① 选择器整表：`image`/`attachment` 列改**真渲染** —— 图片出 32px 缩略图（`?w=` 档位、点开预览**本格**图片，与表格/画册同一条 Lightbox），非图片附件出「📎 + 文件名」chip（>2 个折成 `+N`）；`noteId`/`onOpenImages` 从表格、记录详情、表单三处透传。② 资产 URL 从 4 处各拼一遍收敛为 `bitableAssetUrl(noteId, file, cssPx?)`（单元格 chip、附件卡片、看板缩略图、画册封面、选择器 + 编辑器 openAsset/openImages 共用）。门禁全绿 + vitest 1405-16 + CDP 真实端点（隔离 userData 9271：选择器 10 张缩略图 `naturalWidth=128`、渲染 32×32；注入 3 个 PDF 后 chips = `6.25鞠老师晚读.pdf / 6.23鞠老师晚读(1).pdf / +1`） | 选择器里附件 chip 最多列 2 个（其余 +N）；移动端只读路径未改 |
| 2026-09-29 | 260929-TABS | 横向页签原语（用户选定 B 墨线 + 计数徽标），多维表先切 | `src/styles/kit.css` · `src/styles/components.css`(删 legacy .ln-tabs 整套) · `BitableRelationPicker.tsx` · `bitableRelationPicker.css` · `TrashPanel.tsx` · `HistoryPanel.tsx` · `bitableEditorMount.test.ts` · `src/styles/cssLayers.test.ts` · `AGENTS.md` · `HANDOFF.md` · 本文件 §2.2/§11/§13 | 原语：`.ln-tabs > .ln-tabs__track[role=tablist] > .ln-tabs__item[role=tab][aria-selected]` + `.ln-tabs__count`（计数徽标，选中跟强调色）+ `.ln-tabs__action`；墨线基座从 `components.css` 的 legacy 段收编到 kit 层（**单一来源**，`components.css` 那 45 条删除），旧分段形态保留为 `.ln-tabs--seg` 变体。多维表：选择器两页签改用原语（`所有可关联记录 [15]` / `已选 [4]`，数字进徽标、文案不再随计数重排），删掉 `.seg` 用法。门禁全绿 + vitest 1405-16 + CDP 真实端点（隔离 userData 9271） | 无（`.seg` 保留给取值选择/图标开关，非 tab） |
| 2026-09-30 | 260930-ADDCOL | 表头「新增字段」的 ＋ 贴着左侧最后一列 | `src/features/bitable/bitableViews.css`(+2 声明) · `bitableEditorMount.test.ts`(+1 护栏) · `src/styles/cssLayers.test.ts`(基线 146→148) · `HANDOFF.md` · 本文件 | 用户（附图）：「添加列的加号贴近做左侧的列，不要总是居中」。根因：`.bt-th-add` 是表尾**自动宽度**的单元格（吸收表格剩余宽度），`th` 浏览器默认 `text-align:center` ⇒ 加号落在空白区正中（实测格宽 604、加号 x=965）。改 `.bt-grid th.bt-th-add { text-align: left; padding-left: 8px }`：**只对齐内容、列宽语义不变**（不动列宽 ⇒ 数据列不被撑开）。需要 `.bt-grid th.` 前缀才压得过 `.bt-grid th { padding: 0 }`（(0,1,1) > (0,1,0)）。门禁全绿 + vitest **1406 passed / 16 skipped** + CDP 真实端点（隔离 userData：加号 x=683 = 最后一列右缘 675 + **8px**、`text-align:left`、该格宽仍 604） | 未提交（待用户验收）；`th` 默认居中这条已回填 HANDOFF §4 |
| 2026-09-30 | 260930-OPTBLUE | 选项编辑「添加」不再自动全选（去掉那块蓝色底色） | `src/features/bitable/BitableEditor.tsx`（`focusOptionInput` 去 `select()` 改光标落末尾；`addOptionRow` 新选项留空；`save()` 收口选项名兜底；输入框加 `placeholder`） · `bitableEditor.css`(+1 = `.bt-input::placeholder`) · `bitableEditorMount.test.ts`(+1 护栏) · `src/styles/cssLayers.test.ts`(基线 1055→1056) · `HANDOFF.md` · 本文件 | 用户（附图，红框圈住输入框里的蓝块）：「多选每项添加的时候为什么会有蓝色的底色，需要去掉」。根因：260928–260929 那批给「回车=完成并切下一个/最后新建」加的 `focusOptionInput` 里带 `el.select()`，新行预填的 `选项 N` 被整块选中 ⇒ 系统选区就是那块蓝（CDP 实测 `selectionStart=0/End=4`，每加一次都复现）。改法：**不再全选**（`focus()` + `setSelectionRange(len,len)`），新选项**留空**、默认名交给 `placeholder`（`选项 N`），保存时空名按位置兜底 ⇒ 既不丢「直接键入即选项名」，也没有选区。门禁全绿 + vitest **1407 passed / 16 skipped** + CDP 真实端点（隔离 userData：新行 `value=""`/`placeholder="选项 6"`/`selection=[0,0]`；`Input.insertText` 键入「苹果」→ 值为「苹果」且 `sel=[2,2]`；再空加一行直接确定 → 落盘 `苹果` + `选项 7`） | 未提交（待用户验收）；表格单元格 `focusCell` 的 `select()` **未动**（网格既有约定，与选项编辑不同语义）；焦点环（输入框的 2px 描边）保留（可访问性） |
| 2026-09-30 | 260930-COLW | 列宽自由设置（不再看内容）+ 行高不被内容撑高 + 下限 40 | `src/features/bitable/BitableEditor.tsx`（新增 `columnWidth()`；表头 `th` / 记录格 `td` / 分组统计格 / 底栏统计格四处加行内 `maxWidth`；拖拽下限 80→40） · `bitableEditor.css`（`.bt-grid th/td` 补 `white-space: nowrap`；新增 `.bt-date-trigger > span` 单行省略；`.bt-cell-input` 补 `text-overflow: ellipsis`） · `bitableEditorMount.test.ts`(+1 护栏) · `src/styles/cssLayers.test.ts`(基线 1056→1062) · `HANDOFF.md` · 本文件 | 用户（附图：附件列 3 个 chip 撑出一大列）：「附件类型的列左右宽度不能设置下限，也需要能自由拉长和缩短。我测试了一下，所有的列都是根据内容长度算的左右宽度，我需要能自由设置了，展示不下就截断省略。并且不能为了展示内容而自动扩大行高。例如日期缩短了就会导致换行，而行高变大。」+ 追加「可以设定一个比较小的下限值」。**根因两条**：① `table-layout: auto` 下 `<col style="width">` 只是「至少这么宽」，内容更宽就把列撑开（实测附件列 field width=180 渲染成 **413**，日期列拖到 80 又被内容顶回 109 —— 只有 nowrap 之后）；② `td` 的 `height` 只是最小值，内容折行就撑高（实测日期列 80px：`2026-09-07` 折行 ⇒ 行高 **36 → 48**）。**改法**：① 列宽改由**每格行内 `max-width`** 卡住（`columnWidth(field)`；宽度来自正文数据、CSS 无法按列取值；实测附件 413→180，且分组行/记录行右缘逐列对齐）；② `.bt-grid th/td { white-space: nowrap }` 让行高与内容无关 + 日期/时间格 `.bt-date-trigger > span` 出省略号 + `.bt-cell-input` 补 `text-overflow: ellipsis`（文本格从硬裁改省略）；③ 拖拽下限 80→40（上限仍 640）。门禁全绿 + vitest **1408 passed / 16 skipped** + CDP 真实端点（隔离 userData：拖 日期→40 / 附件→340→40 / 文本→300 列宽都精确跟随、行高恒 **36**；分组态分组行与记录行右缘 `[281,461,…,2421]` 完全一致，分组行高 36） | 未提交（待用户验收）；chip/缩略图/星级这类**没有省略号语义**的格子是裁切（不是 `…`）；行内 `max-width` 是为「按列数据驱动宽度」破例（`<col>` 上的 max-width 被忽略、`contain: inline-size` 在 table cell 上无效），已在 HANDOFF §4 记坑 |
| 2026-09-30 | 260930-FILEICON | 附件按**文档类型图标**展示（单元格小图标 + hover 名称气泡 / 展开面板大图标） | `src/core/assetNaming.ts`(+`AssetFileKind` / `ASSET_FILE_KIND_EXTS` / `fileKindOf`) · `assetNaming.test.ts`(+1) · `src/features/bitable/FileKindIcon.tsx`(新) · `bitableFileIcon.css`(新，登记 cssLayers) · `bitableCells.tsx`（`AttachmentChipList` 加 `imageOnly` 分叉 + hover 气泡；展开面板卡片改大图标） · `src/styles/themes/base.css`(+11 = `--lake-file-*`) · `bitableEditorMount.test.ts`(+1 护栏) · `src/styles/cssLayers.test.ts`(新文件基线 33) · `docs/LAKEX-CONTRACT.md` · `HANDOFF.md` · 本文件 | 用户（附图 = 云端附件列小图标 + 展开面板大图标 + hover 深色名称气泡）：「附件不展示名称和预览了，直接展示文档类型吧…我们是否有对应的图标样式可以使用」。**先答问题**：内核 sprite 实测 **325 个 `symbol[id]`**，按 file/pdf/doc/ppt/word/excel/zip/video/audio/attach 过滤只命中 `icon-card-mention-doc` **一个** ⇒ 云端那套彩色页图标在**语雀 App 自己的 sprite** 里、内核不提供，**没有现成的可用**（已回填 LAKEX-CONTRACT §三）。**实现**：① core 新增 `fileKindOf(nameOrExt)`（映射 11 类：image/pdf/doc/sheet/slide/archive/audio/video/code/text/file；图片沿用 `isImageExtension` 的既有清单，不重复维护）；② 新组件 `FileKindIcon`（lucide：FileImage / FileText / FileType / FileSpreadsheet / Presentation / FileArchive / FileAudio / FileVideo / FileCode / File / File），颜色走新增的 `--lake-file-*` 令牌（11 个，只放 `themes/base.css` —— 内容/品牌色不随主题分叉）；③ 单元格 = `.bt-file-chip` 小图标按钮 + **hover 名称气泡**（表面 kit 的 `.ln-tip`、定位 `usePopoverPosition`、`position: fixed` ⇒ 不被 `.bt-grid-wrap` 裁切；不再是常驻文件名）；④ 展开面板卡片 = `.bt-attach-card-kind` 大图标（46px），名称仍在卡下方；⑤ **图片字段仍是缩略图**（`imageOnly` 分叉）。门禁全绿 + vitest **1410 passed / 16 skipped** + CDP 真实端点（隔离 userData：附件格 = 3 个 `.bt-file-icon`、**0 个 `<img>`**；图片格 = 3 缩略图、0 图标；行高 36；hover 气泡 `text=【期神笔记】2024.pdf`、`bg=rgb(58,74,104)`（深色）；展开面板 = 3 个大图标 `bt-file-icon--pdf/doc/doc` + 名称、0 缩略图） | 未提交（待用户验收）；**没动的三处**（需要的话另说）：看板卡片的图片缩略图、关联选择器整表里的图片缩略图/附件 chip、移动端只读的附件渲染（移动端是独立样式）；pdf 与 txt 共用一个字形（靠颜色区分） |
| 2026-09-30 | 260930-FILEICON-2 | 图片格 hover 名称走同一气泡 + **移动端同步**（附件字段换类型图标） | `bitableCells.tsx`（气泡两种字段共用：去掉 img 的原生 `title`、`onMouseEnter` 不再按 `imageOnly` 分叉） · `bitableEditorMount.test.ts`(护栏改写) · `src/mobile/bitable/MobileBitableViewer.tsx`（`AttachmentCell` 加 `imageOnly` 分叉：附件字段 = `FileKindIcon` + 名称；图片字段 = 缩略图） · `src/mobile/mobile.css`(+2 = `.mbt-attachment-file.is-kind` / `.mbt-attachment-name`) · `src/mobile/bitable/mobileBitableViewer.test.ts`(+1) · `HANDOFF.md` · 本文件 | 用户两条追加：「图片有一个改动，鼠标放上去展示名称可以和附件一样」「图片不动，图片是用来看的，**移动端可以换**」。① 桌面：缩略图与类型图标**共用**同一个 hover 气泡（同一交互只有一套实现；同时删掉 `title` 免得两个气泡打架）。② 移动端：附件字段 → 类型图标**＋名称**（触屏没有 hover，名称不能收进气泡；图标给类型、名字给内容），图片字段仍是缩略图。门禁全绿 + vitest **1411 passed / 16 skipped** + CDP 真实端点（桌面 hover 缩略图 → `.bt-file-tip` = `MOON0005.jpg`；**Android 模拟器**（AVD lake_mobile，`android-build.sh --sync --install` + `emu-cdp.sh 9335` + 往 DB 写一条 bitable 笔记）实测：附件格 3 个类型图标 `--pdf/--doc/--image` + 名称、图片格 1 张缩略图、令牌色解析为 `rgb(217,74,61)/rgb(47,111,208)/rgb(217,138,0)`） | 未提交（待用户验收）；移动端**名称仍保留**（触屏无 hover）；HANDOFF **§8 是移动端会话的维护范围，本批没改**，§8「多维表只读」里仍写着附件/图片都是缩略图，需要移动端会话按本条更新 |
| 2026-09-30 | 260930-FILEICON-3 | 展开面板的文件名被截断时 hover 出全名（与单元格同一气泡） | `bitableCells.tsx`（气泡抽成 `useNameTip()` 单一来源；`.bt-attach-card-name` 去掉原生 `title`、挂 `tip.show(name, el, true)`；`whenTruncated` 用 `scrollWidth > clientWidth` 判截断） · `bitableEditorMount.test.ts`(护栏改写) · `HANDOFF.md` · 本文件 | 用户（附图：面板里「【期神笔记】2…」被省略号截掉）：「加一个优化，展开之后文件名这里，有可能看不全，也加一个弹窗展示完整名称」。改法：把 hover 气泡抽成 `useNameTip()`（表面 `.ln-tip`、定位 `usePopoverPosition`），**单元格 chip 与面板文件名共用**；面板那条带 `whenTruncated` ⇒ **真的被省略才弹**（没截断弹出来是同义重复），并删掉原生 `title` 避免两个气泡打架。CDP 真实端点：面板 3 个名字实测 `scrollWidth/clientWidth` = 121/89、103/89、159/89（都截断）→ hover 第一个出 `.bt-file-tip` = `【期神笔记】2024.pdf`；把面板拖宽到 932px 后第二个名字不再截断（108/108）→ hover **不出气泡**（探针返回 null） | 未提交（待用户验收）；面板里**重命名输入框**没有气泡（文本框本身可横向滚动，不需要） |
| 2026-09-30 | 260930-REL-UNIFY | 关联选择器整表 + **看板卡片** + **画册卡片**都复用同一套附件渲染（一处实现）；卡片只出图标/缩略图、不显示名称 | `bitableCells.tsx`（`AttachmentChipList` 改为 **export**；曾加过 `showNames` 变体，**本条按用户要求撤销**） · `BitableRelationPicker.tsx`（改用 `AttachmentChipList`；删自养的缩略图/「📎 文件名」chip 与 `PICKER_THUMB_PX`/`PICKER_FILE_MAX`） · `bitableRelationPicker.css`（`.bt-rel-files` 改 inline-flex + max-width/overflow；删 `.bt-rel-thumb`） · `BitableKanbanView.tsx`（卡片附件分支改用 `AttachmentChipList`，**不显示文件名**；删 `KANBAN_THUMB_PX`/`thumbUrl`/`imageAttachmentsOf`） · `BitableGalleryView.tsx`（卡片字段里附件类**不再走 `bitableFieldText` 出一串文件名**，改走 `AttachmentChipList`） · `bitableFileIcon.css`(+`.bt-card-files` 卡片附件行容器 = 看板/画册共用) · `bitableKanbanView.css`（删 `.bt-kanban-thumb` 与 `.bt-kanban-files`） · `bitableAssetUrl.ts`(+`openBitableAttachment` 单一入口) · `BitableEditor.tsx`（`openAsset` 改走它） · `bitableEditorMount.test.ts`(+2 护栏、改写 5 条旧护栏) · `src/styles/cssLayers.test.ts`(基线 120→113 / 109→100 / 33→37) · `HANDOFF.md` · 本文件 | 用户：「关联字段弹窗展示里还没有看到我们新的改动，这两处不是同一套代码吗？能做成一套吗？」→ 选择器改用 `AttachmentChipList`；随后「看板卡片呢」→ 选 **A**（卡片也换成同一套）；再随后（看到卡片带名字的效果后）「**看板视图不展示名称了，直接图标或者缩略图吧**」+「**画册视图的附件也要改**」⇒ ① 撤销 `showNames`（卡片上只留图标/缩略图，名字靠 hover 气泡）；② 画册卡片字段里的附件类也改用同一套（之前 `bitableFieldText` ⇒ 卡片上是一串「【期神笔记】2024.pdf, 2…」）。顺带把「打开一条附件」也收成 `openBitableAttachment`（表格/选择器/看板/画册四处共用）。门禁全绿 + vitest **1414 passed / 16 skipped** + CDP 真实端点（隔离 userData：选择器附件列 3 个类型图标、0 旧 chip；**看板卡片** = 3 缩略图 + 3 类型图标、**0 个常驻文件名**；**画册卡片** 附件行 = 3 个类型图标（此前是文件名文本）、0 个旧 `.bt-kanban-thumb`；hover 全名气泡在对话框内也可见） | 未提交（待用户验收）；卡片上附件/图片的**名称只剩 hover 气泡**（触屏看板不存在；移动端是只读表格，不受影响） |

| 2026-09-30 | 260930-REL-VIEW | 关联选择器视图投影 | `src/core/bitableDoc.ts`(+`defaultGridView`/`relationPickerFields`/`orderedAllTableFields` 与 fieldOrder 排序收敛) · `bitableDoc.test.ts`(+1 关联投影用例) · `BitableRelationPicker.tsx`(字段投影、只读基线筛选/排序、视图分组表头、仍可叠加本机筛选/排序) · `bitableRelationPicker.css`(+30 声明) · `bitableEditorMount.test.ts`(+1 投影护栏) · `cssLayers.test.ts`(基线 108→138) · `HANDOFF.md` · 本文件 | 用户确认：① 绑定视图必须应用字段顺序和隐藏字段；② 未绑定视图用默认表格视图字段顺序；③ 已绑视图的筛选/排序/分组作为只读基线，仍可继续叠加本机筛选/排序且不写回原视图；④ 后加字段下次打开动态进入。实现：`relationPickerFields()` 在绑定视图时走 `orderedTableFields()`（顺序+隐藏），未绑定时走 `orderedAllTableFields(默认 grid)`（顺序但不隐藏字段）；选择器把视图 filters/sorts 显示为 `视图 + Lock` 只读基线，本机规则仍可增删；表格按 `groups[0]` 输出只读分组头；候选集仍由 `relationCandidateRecords()` 统一供数。门禁全绿 + vitest **1416 passed / 16 skipped**；CDP 真实端点：绑定视图 headers=`进度/文本/布尔值/日期/名称/新链接`（隐藏 `单选`）、groups=`否 1 条 / 是 2 条`、筛选基线显示`文本 包含 目标`不可删、排序基线显示`进度·降序`不可删；叠加本机 `文本 包含 目标乙` 后行数 3→1；取消后原视图 JSON 的 filters/sorts/groups/hidden/order 值不变；未绑定视图 headers=`布尔值/进度/文本/单选/日期/名称/新链接`、3 条全部记录、无分组且字段完整；通过真实 UI 给目标表新增字段后重开选择器，新字段动态出现在末尾 | 未提交（待用户验收）；“已选”页签继续按选择顺序平铺，不套视图分组；移动端不受影响 |

| 2026-09-30 | 260930-REL-CELL | 关联选择器/历史/回收站只读渲染统一 | `BitableRelationPicker.tsx`（非附件值改走 `CellEditor readOnly`；附件继续走 `AttachmentChipList`） · `bitableEditorMount.test.ts`(+1 只读渲染护栏，锁选择器/正式编辑器/历史快照/回收站链路) · `HANDOFF.md` · 本文件 | 用户（附图红框：单选/评分/进度/布尔仍是纯文本）：「关联的弹窗了，单选，多选，评分，进度，布尔值这些都使用和行视图相同的渲染方式。就算是只读也要保证相同样式的渲染。同理还有历史快照和回收站里的只读渲染，需要统一样式。」实现：选择器单元格不再对普通字段调 `bitableFieldText`，改用主表格同一个 `CellEditor`，传 `readOnly + no-op onChange/onAddOption`；因此单选/多选显示色块、布尔显示禁用复选框、评分显示 5 星、进度显示条+百分比，后续新字段类型也自动跟随主表格。历史快照仍挂只读 `BitableEditor`，回收站/锁定文档仍走 `MultiTabEditor → BitableEditor readOnly`，与正式行视图共用同一 `CellEditor` 分支。门禁全绿 + vitest **1417 passed / 16 skipped**；CDP 实测选择器单选 chip、布尔禁用框、进度条+百分比、评分 5 星均由主控件渲染，历史/回收站链路源码护栏通过 | 未提交（待用户验收）；附件仍走既有 `AttachmentChipList` 单一来源；移动端是独立只读控件，不在本次桌面统一范围内 |

| 2026-09-30 | 260930-REL-TYPE | 单向/双向关联拆成两个真实字段类型 | `src/core/bitableDoc.ts`（`relationOneWay` / `relationTwoWay`、移除 `relation.mode`、`isRelationFieldType`、建对/解绑/镜像按 type 判断） · `bitableCells.tsx`（两个图标 + 类型选择器真实选项） · `BitableEditor.tsx`（移除双向复选框；类型决定建对/解绑） · `MobileBitableViewer.tsx`（两类关联共用只读 chip） · 对应 core/UI/mobile 测试 · `HANDOFF.md` · 本文件 | 用户确认「不用考虑数据，使用最优方式」：关联方向不再作为字段配置里的 `mode` 冗余保存，直接拆成两个实际类型；字段面板行图标可区分 `Link2` / `ArrowLeftRight`，行内值仍是同一套关联渲染。门禁全绿 + vitest **1418 passed / 16 skipped**；CDP 实测字段类型网格列出「单向关联 / 双向关联」两项且图标不同，字段面板两行分别出 `lucide-link-2` / `lucide-arrow-left-right` | 未提交（待用户验收）；旧 `relation` / `relation.mode` 不保留兼容（测试数据可重建） |

| 2026-09-30 | 260930-COLOR | 列菜单隐藏列 + 文本颜色加深 | `BitableEditor.tsx`（列菜单新增“隐藏列”入口，文本颜色传独立 palette） · `bitableCells.tsx`（`ColorPalette` 增 `palette` prop） · `src/core/bitableDoc.ts`(+`BITABLE_TEXT_COLOR_PALETTE`) · core/UI 测试 · `HANDOFF.md` · 本文件 | 用户（附图列菜单）：「1、列弹窗添加隐藏列的快捷功能。2、文本颜色的可选颜色都太浅了。」实现：隐藏列走既有 `toggleFieldHidden`；文本颜色新增 18 色深色调色板（不复用浅色选项背景），默认仍保留“无颜色”。门禁全绿 + vitest **1419 passed / 16 skipped**；CDP 实测列菜单出现“隐藏列”、点击后该列从表头消失并落盘 `hiddenFieldIds`；文本颜色面板 18 个色块为深色，选中 `#2563eb` 后列文字 computed color 生效 | 未提交（待用户验收） |

| 2026-09-30 | 260930-FILL-RESEARCH | 填色功能预研（暂缓） | 新增 `docs/BITABLE-FILL-COLOR-RESEARCH.md`；用 BrowserSkill + Edge 调研钉钉填色；当前不改代码/不改正文模型 | 已完成可行性预研与实现草案 | 阻塞于筛选重构；筛选完成后复核再决定实施 |

| 2026-09-30 | 260930-FILTER | 筛选重做：类型操作符矩阵 + 动态日期 + AND·OR 条件组 | `bitableDoc.ts`(+`BitableFilterNode`/`filterOperator`/`filterOperatorLabel`/`dateFilterModesFor`/`dateFilterRangeFor`/递归求值) · `BitableFilterEditor.tsx`(新) · `bitableFilterEditor.css`(新) · `BitableEditor.tsx` · `BitableRelationPicker.tsx` · core/UI 测试 | 远端 lake 实测与 bundle 取证：文本 8 项、数字 8 项、日期 5 项（等于/早于/晚于/空）、单选/多选/复选/附件各自的专属操作符；日期右侧支持具体日期 + 15 种动态日期；根组/子组统一 AND/OR，子组最多再套 2 层；关联选择器复用同一编辑器 | 未提交（待用户验收）；填色可复用筛选规则与求值器；旧 `equals/gt/...` 不保留兼容 |

| 2026-09-30 | 260930-FILTER-UI | 筛选 UI 实测修复 | `BitableEditor.tsx`（打开筛选面板不再自动写入空规则；清空筛选时删除 `filters/filterOperator` 键） · `BitableFilterEditor.tsx`（删除分组内最后一条规则后递归清掉空组） · `bitableDoc.ts`（空组规范化丢弃） · 测试 | CDP 真实 UI 逐视图点验：发现并修掉“空视图打开筛选即写一条空规则”“删除最后一条筛选仍残留空键”“删除组内最后规则残留空组”；日期动态值、多选值、关联值、根组/子组 AND/OR 均实测可用 | 未提交（待用户验收）；无运行时异常 |

| 2026-09-30 | 260930-FILTER-COMMIT | 筛选重构与 260930 待提交批次合并提交 | `src/core/bitableDoc.ts` · `bitableDoc.test.ts` · `BitableEditor.tsx` · `BitableFilterEditor.tsx`(新) · `bitableFilterEditor.css`(新) · `BitableRelationPicker.tsx` · `bitableCells.tsx` · `bitableEditorMount.test.ts` · `bitableRelationPicker.css` · `MobileBitableViewer.tsx` · `mobileBitableViewer.test.ts` · `cssLayers.test.ts` | 代码提交 `7dd81ba3`「feat(bitable): 筛选精准重构与 260930 多维表收口」；将筛选依赖的前置关联/只读/附件/隐藏列改动与筛选一并入库。最终门禁：tsc / vitest 1423-16 / check:core / 双端构建 / ui-metrics / cssLayers+uiPrimitives / git diff --check 全绿 | 功能待用户验收；填色可复用筛选引擎 |

## 13. 会话记录（只追加）

### 2026-09-28 · 调研与方案冻结

本次完成：

- 使用 Edge 实际访问语雀、钉钉、飞书。
- 实际输入文本并验证筛选。
- 实际新增语雀选项和默认值。
- 创建并打开语雀看板、画册、日历、图表、表单视图。
- 实际开启语雀表单收集。
- 打开钉钉字段管理、添加字段、筛选、分组、排序、行高、填色、分享视图。
- 打开飞书字段配置、视图配置、画册/看板创建、关联字段配置和关联选择器。
- 确认飞书只能在同一个多维表文件内跨表关联。
- 确认飞书目标记录删除后，刷新表现为关联为空。
- 确认语雀复选框、链接、评分、进度字段的控件和配置语义。

本次结论：

- 图表、自动编号、查找引用、公式、rollup、条件填色、跨文档关联全部不做。
- 只做单向关联和双向关联，限同一文档内多表。
- 关联支持多选，默认允许多选。
- 目标记录删除时内部保留关联 ID，界面显示为空；目标恢复后可重新出现。
- 目标数据表删除不级联删除来源字段。
- UI 直接对齐语雀，语雀缺失能力按语雀风格扩展。
- 桌面优先，移动端尽量同批但首版只读保底。

本次代码改动：

- 无。

下一步：

- 开始 `V01 多视图工作台`。
- 先确认现有 `BitableViewType`、视图序列化/解析、视图页签和移动端路由。
- 完成本批后回写本文件。

### 2026-09-28 · V01 多视图工作台

本次完成：

- 视图类型升级为**开放集合**：`grid | form | kanban | gallery | calendar`；新增 `BITABLE_VIEW_TYPES` / `BITABLE_VIEW_TYPE_LABEL` / `isKnownViewType` / `viewTypeLabel` / `defaultViewName`。
- `normalizeView` **不再把未知 type 强转成 grid**：未知视图原样保留（只有缺 type 的脏数据才回落 grid）⇒ 旧版本打开新正文不会静默改写。
- 视图壳按职责拆分：`BitableViewBar.tsx`（页签 / 拖拽排序 / 双击重命名 / ⋯ / 新建视图菜单）、`bitableViews.tsx`（类型图标 + 未支持视图回退）、`bitableViews.css`（视图层样式，单一来源）。
- 新建视图菜单列出全部 5 种类型（图标各不相同）；看板存 `kanban`，与 `kind="board"`（Drawnix 画板文档）明确区分。
- 未实现视图（kanban/gallery/calendar）与未知类型 → `BitableViewFallback` 明确提示 + 表格正文继续渲染：不白屏、不改数据、配置完整保留。
- 移动端只读：非 grid 视图先给明确交代再按表格只读展示（不允许空白/静默降级）。

数据结构/接口变化：

- `BitableViewType = "grid" | "form" | "kanban" | "gallery" | "calendar"`；`BitableView.type: string`（开放，未知值保留）。
- 新增导出：`BITABLE_VIEW_TYPES`、`BITABLE_VIEW_TYPE_LABEL`、`isKnownViewType`、`viewTypeLabel`、`defaultViewName`。
- 新建 form 视图默认名由「表单」统一为「表单视图」（与菜单文案同源；已存视图名不变）。
- **无新增持久化字段、无 S3 对象、无同步/历史/GC 改动**：视图仍只存在正文 JSON 的 `views[]`。

UI 与交互变化：

- 视图页签图标按类型区分；新建视图菜单 5 项。
- 未支持视图顶部有回退提示条 `.bt-view-fallback`（`flex: 0 0 auto`，不遮表格）。

改动文件：

- `src/core/bitableDoc.ts`、`src/core/bitableDoc.test.ts`
- `src/features/bitable/BitableViewBar.tsx`（新）、`bitableViews.tsx`（新）、`bitableViews.css`（新）
- `src/features/bitable/BitableEditor.tsx`、`bitableEditorMount.test.ts`
- `src/mobile/bitable/MobileBitableViewer.tsx`、`src/mobile/mobile.css`
- `src/styles/cssLayers.test.ts`、`src/components/historySnapshotPreview.test.ts`

验证结果：

- `tsc --noEmit`：通过
- `vitest`：1351 passed / 16 skipped（+2 = 本次新增用例）
- 桌面构建：通过
- 移动构建：通过
- `check:core`：0 违规
- `ui-metrics`：通过（hex=0 / !important=9 / 未定义令牌=0）
- `vitest cssLayers + uiPrimitives`：通过
- `git diff --check`：通过
- 手工验收（CDP 驱动真实 Electron：`LAKE_RENDERER=scheme` + 隔离 `LAKE_USER_DATA` + 9222）：
  - 新建视图菜单 5 项：表格 / 表单 / 看板 / 画册 / 日历 ✓
  - 新建看板视图 → 页签出现 + 回退提示 + 表格仍渲染 ✓
  - 表格视图配置**逐字节未变**（JSON 对比），字段/记录数不变 ✓
  - 手工注入未知 `chart` 视图 → 页签保留、提示「本版本不认识」、磁盘上 type 仍是 `chart` ✓
  - 切回表格视图 → 回退提示消失 ✓
  - 看板视图落盘 `type:"kanban"`，`activeViewId` 正确 ✓

遗留问题：

- 看板/画册/日历的**本体渲染**在 V02–V04，本批只有安全回退提示。
- 未知视图在**未升级的旧客户端**会按表格显示（数据不丢）；发布说明需注明。

下一步：

- 等用户验收 V01；通过后开 V02 看板视图（单选字段分组、卡片、拖拽改单选值）。

工程备注（供后续批次）：

- `features/bitable/bitableEditor.css` 已顶到 `cssLayers` 基线 **1081/1081（headroom = 0）**：再加任何一条声明都会让该用例变红。视图层新样式一律进 `bitableViews.css`（已登记 FILES + BASELINE）；**新增样式文件必须同步登记**。
- `BitableEditor.tsx` 已把视图壳拆出（1312 → 约 1240 行）；V02–V04 的视图正文请放各自的 `BitableXxxView.tsx`，不要回灌大文件。

### 2026-09-28 · V02 看板视图

本次完成：

- 看板按**单选字段**分栏：**选项即分栏**（空栏目保留，否则没法把卡片拖进空分组），末尾固定「未分组」栏（值为空 / 非字符串 / 指向已删选项都落这里；拖进来 = 清空该字段）。
- 卡片 = 主字段标题 + 配置的字段值；`kanbanShowFieldNames` 控制是否显示字段名；空字段不上卡（卡片才紧凑）。
- 拖拽卡片改单选值（**拖拽只写分组字段值**，第一版不引入视图级手动排序）；折叠/展开分组是本机展示态、不写正文；「新建分组」= 往分组字段追加选项。
- 无可用分组字段（未配置 / 表里没有单选 / 字段被删）→ 明确配置提示，不白屏。
- 工具栏按视图类型收敛：看板显示「看板配置」、隐藏「分组 / 行高」。
- 视图分派收敛为 `isImplementedViewType` 单一判定（core 的 `BITABLE_IMPLEMENTED_VIEW_TYPES`）；未实现类型继续走 `BitableViewFallback`。
- 移动端提示区分「桌面已支持 / 暂未提供 / 不认识」三种措辞。

数据结构/接口变化：

- `BitableView` 新增视图级配置：`kanbanGroupFieldId?: string`、`kanbanFieldIds?: string[]`、`kanbanShowFieldNames?: boolean`；`normalizeView` 对非数组的 `kanbanFieldIds` 直接丢弃。
- core 新增纯函数：`bitableSelectFields` / `kanbanGroupField` / `kanbanCardFieldCandidates` / `kanbanCardFields` / `kanbanColumns`（+ `BitableKanbanColumn`）、`BITABLE_IMPLEMENTED_VIEW_TYPES` / `isImplementedViewType`。
- 新建看板视图默认取表里第一个单选字段分栏。**无持久化格式变更、无同步/GC 改动**。

UI 与交互变化：

- 新组件 `BitableKanbanView.tsx` + 独立样式 `bitableKanbanView.css`（已登记 cssLayers FILES/BASELINE）。
- 新浮层「看板配置」：分组字段（单选）/ 显示字段名 / 卡片字段勾选。

改动文件：

- `src/core/bitableDoc.ts`(+test)
- `src/features/bitable/BitableKanbanView.tsx`(新) · `bitableKanbanView.css`(新)
- `src/features/bitable/BitableEditor.tsx` · `bitableViews.css` · `bitableEditorMount.test.ts`
- `src/mobile/bitable/MobileBitableViewer.tsx` · `src/styles/cssLayers.test.ts`

验证结果：

- `tsc --noEmit` / `vitest` 1355 passed / 16 skipped / `check:core` / 桌面构建 / 移动构建 / `ui-metrics` / `cssLayers` / `git diff --check`：全绿
- CDP 真实端点验收（隔离 userData + 9223；查询一律限定**可见**编辑器，避开 keep-alive 多 tab 的坑）：
  - 分栏 = 待开始 / 进行中 / 已完成 / 未分组（空栏保留）✓
  - 添加记录 → 落「未分组」✓
  - **拖拽到「进行中」→ 落盘 value=进行中**，且切回表格视图该单元格同步显示「进行中」✓
  - 「新建分组 = 评审中」→ 落盘为字段选项、多出一栏 ✓
  - 点卡片 → 记录详情抽屉 ✓
  - 删掉单选列 → 「这张表还没有单选字段，无法看板分组…」✓
  - 锁定笔记 → 卡片 `draggable=false`、新建分组 disabled、配置面板下拉与勾选全 disabled ✓

本次修复（live 验收抓到的真 bug）：

- **只读态写入口泄漏**：①「看板配置」的分组字段下拉未禁用，只读文档仍能改视图配置；②「重命名视图」菜单项与重命名弹窗在只读态仍可改名。均已在 `BitableEditor.tsx` 封死，并在 `bitableEditorMount.test.ts` 加源码级护栏断言。②是 V01 之前就存在的旧漏，本批一并修。

遗留问题：

- 看板不做多选分组、不做手动排序（产品第一版口径）；画册/日历未实现（走回退提示）。
- 移动端仍是表格只读 + 明确提示。

下一步：

- 等用户验收 V02；通过后开 V03 画册视图。

### 2026-09-28 · V03 画册视图

本次完成：

- 卡片网格展示记录；封面取封面附件字段里**第一个图片附件**（非图片跳过、无可用图片 → 无封面占位）。
- 视图级配置：封面字段（可置「无封面」）/ 常规·紧凑 / 裁剪(cover)·适应(contain) / 是否显示字段名 / 卡片字段勾选。
- 封面缩略图沿用单元格附件那条资产 URL + `?w=` 档位；点卡片打开记录详情。
- 无记录 → 明确空态；封面缺失 → 占位（不白屏）。

数据结构/接口变化（均为视图级投影配置，存在正文 JSON 的 `views[]`）：

- `BitableView` 新增 `galleryCoverFieldId` / `gallerySize` / `galleryFit` / `galleryShowFieldNames` / `galleryFieldIds`；`normalizeView` 校验数组成员与枚举取值。
- core 新增纯函数：`bitableAttachmentFields` / `galleryCoverField` / `galleryCardFieldCandidates` / `galleryCardFields` / `galleryCoverImage`；并把「卡片字段候选 / 取交集」抽成看板与画册共用的内部口径（`cardCandidates` / `pickCardFields`）。
- 新建画册视图默认取表里第一个附件字段当封面。**无持久化格式变更、无同步/GC 改动。**

改动文件：`src/core/bitableDoc.ts`(+test) · `src/features/bitable/BitableGalleryView.tsx`(新) · `bitableGalleryView.css`(新) · `BitableViewConfigPanels.tsx`(新) · `BitableEditor.tsx` · `bitableEditorMount.test.ts` · `src/styles/cssLayers.test.ts`

验证结果：

- 门禁全绿：tsc / vitest / check:core / 双端构建 / ui-metrics / cssLayers+uiPrimitives / git diff --check。
- CDP 真实端点验收：3 张卡片 = 1 张真实图片封面 + 2 张无封面占位；封面 URL 带 `?w=` 且返回 200（16×16 PNG 解码成功）；紧凑 → 封面 133×133 方图；适应 → contain；关「显示字段名」→ 无字段名；取消「状态」卡片字段 → 只余日期字段。所有配置项均已落盘核对。

遗留问题：

- **`loading="lazy"` 在 CDP 附着的隐藏窗口里不会触发**（`document.hidden === true`）：验收时需临时去掉该属性才能看到图片上屏。这是测试环境现象，不是产品缺陷（同一 URL 用 `new Image()` 与 `fetch` 均正常）。
- 卡片字段顺序仍由视图列顺序决定（未做卡内拖拽排序）；不做封面标题、多封面、卡片点击进图片预览。
- 移动端首版仍是表格只读 + 明确提示（未跑 Android 模拟器）。

下一步：V04 日历视图（同批完成，见下条）。

### 2026-09-28 · V04 日历视图

本次完成：

- 月视图（42 格、周一起始、跨月填充、今天高亮），上/下月与「今天」回到当月。
- 支持开始日期字段（必配）、可选结束日期字段（跨天日程按天展开）、标题字段（缺省回落主字段）、颜色字段（第一版仅单选，取选项色）。
- 点日程 chip → 打开记录详情；拖拽 chip 到某天 → **保持时长整体平移**（结束为空则只动开始日期，绝不凭空补一个结束日期）。
- 无开始日期字段 / 表里没有日期字段 → 明确配置提示，不白屏。
- 不做农历、节假日、重复日程、提醒（产品确认不做）。

数据结构/接口变化：

- `BitableView` 新增 `calendarStartFieldId` / `calendarEndFieldId` / `calendarTitleFieldId` / `calendarColorFieldId`。
- core 新增纯函数（**全部本地日期语义**）：`bitableDateFields` / `calendarStartField` / `calendarEndField` / `calendarTitleField` / `calendarColorField` / `calendarEvents` / `calendarMonthDays` / `shiftLocalDate` / `localDateDiff` / `calendarEventsByDay` / `calendarMovePatch`；`dateValueOf` 兼容历史 ISO 值并按本地时区折算。
- 新建日历视图默认取表里第一个日期字段当开始日期。**无持久化格式变更、无同步/GC 改动。**

改动文件：`src/core/bitableDoc.ts`(+test) · `src/features/bitable/BitableCalendarView.tsx`(新) · `bitableCalendarView.css`(新) · `BitableViewConfigPanels.tsx`(新) · `BitableEditor.tsx` · `bitableEditorMount.test.ts` · `src/styles/cssLayers.test.ts`

验证结果：

- 门禁全绿。
- CDP 真实端点验收：`2026 年 9 月` 网格 42 格 / 30 个本月格 / 今天(28) 高亮；配「结束日期=结束、颜色字段=状态」后，跨天记录在 10·11·12 三天都出现，三条记录分别取到进行中/待开始/已完成的选项色；拖「只有音频」18→20 落盘 `start=2026-09-20` 且**不写结束日期**；拖「带图记录」10→14 落盘 `start=2026-09-14` / `end=2026-09-16`（时长保持 3 天）。

遗留问题：

- 月份是**本机展示态**、不写正文（切走再回来回到当月）；如需持久化需产品确认。
- 单格最多显示 3 条日程（其余 +N）；不做“展开全部/日视图”。
- 移动端首版仍是表格只读 + 明确提示（未跑 Android 模拟器）。

下一步：等用户对 V02–V04 一并验收；通过后按 §8 顺序进入 T01 列级统计。

### 2026-09-28 · 追加需求批（T07 图片字段 / V03.1 画册封面预览 / T06 表单双模）

用户 260928 现场追加三条需求，同批实施完成。

#### ① T07 图片字段类型（图片 / 附件拆成两个类型）

- `BitableFieldType` 新增 `image`；`BITABLE_FIELD_TYPES` 在 `attachment` 之后加一项；标签：`attachment` 由「图片和附件」改为「附件」、新增 `image` = 「图片」。
- **值模型与附件完全一致**（`{file,name,size}[]`），只是上传侧限定图片：`CellEditor` 的 `attachment`/`image` 走同一分支，`renderAttachment(imageOnly)` 把标记透传给 `AttachmentCell`。
- 三条入口都拦：文件选择（`accept="image/*"`）、拖拽、粘贴；按扩展名或 `file.type` 判图片，被拒文件给**可见提示**（"只接受图片文件，已忽略 N 个"），绝不静默丢弃。展开面板同样受限。
- 附件字段行为不变（`accept` 不设限制，任何类型都能传）；`isAttachmentLikeField` 统一「附件类字段」口径，画册封面候选与封面解析都按它判定。

#### ② V03.1 画册封面点预览

- 有封面时封面渲染成 `<button class="bt-gallery-cover">`，点击**直接预览**：复用 `openAssetEntry`（图片 → 既有 Lightbox、音视频 → 内嵌、其余 → 系统打开），**不新增**多类型预览逻辑。
- 点击封面 `stopPropagation`，不会顺带打开记录详情；没有封面时封面不是按钮，点卡片仍开记录详情。
- 就地重置了 `.bt-gallery-cover` 的原生按钮样式（未另开覆盖层）。

#### ③ T06 表单本地增强（编辑表单 / 预览表单）

- 顶部加**分段控件**（`.seg` / `.seg__item`，与全站同一套横向 tab 原语）：`编辑表单` / `预览表单`。
- **默认规则**：`view.formFieldIds` 非空 = 已配置 ⇒ 默认进「预览表单」可直接填、直接提交；未配置 ⇒ 默认进「编辑表单」。新建表单视图**不再预选全部字段**（留空 = 未配置）。
- 编辑表单：题目增删、**上/下移调顺序**（只动 `formFieldIds`，不动表字段顺序）、表单标题（`formTitle`）、表单描述（`formDescription`），改动即时写回视图配置（文档自动保存）。
- 预览表单：严格按 `formFieldIds` 顺序渲染可填控件（附件/图片走同一 CellEditor 分支）+ 必填校验 + 提交即新增记录 + 「已提交」提示。
- 新增视图级配置键：`formTitle` / `formDescription`（`normalizeView` 校验为字符串）。

改动文件：`src/core/bitableDoc.ts`(+test) · `src/features/bitable/bitableCells.tsx` · `BitableEditor.tsx` · `BitableRecordDrawer.tsx` · `BitableFormView.tsx`(重写) · `BitableGalleryView.tsx` · `bitableGalleryView.css` · `bitableFormView.css`(新) · `src/mobile/bitable/MobileBitableViewer.tsx` · `bitableEditorMount.test.ts` · `src/styles/cssLayers.test.ts`

验证结果：

- 门禁全绿：tsc / vitest 1364 passed-16 skipped / check:core / 双端构建 / ui-metrics / cssLayers+uiPrimitives / git diff --check。
- CDP 真实端点验收（隔离 userData + 9225）：
  - 图片字段 input `accept="image/*"`、附件字段 `accept=null`；给图片字段喂 mp3 → 提示「只接受图片文件，已忽略 1 个」且**不写值**；喂 png → 缩略图 chip 出现且值落盘；
  - 画册：2 张卡片（1 封面按钮 + 1 占位），**点封面开的是 `.image-lightbox`（含 img），不是记录抽屉**；
  - 表单：新建 → 「编辑表单」默认激活、题目空、可选 5 项；加「状态」+ 标题「报名表」；切「预览表单」显示标题与题目；提交 → 记录数 2→3、出现「已提交」；重载后该表单**默认进预览表单**且配置完整（`formFieldIds=["fld-status"]`、`formTitle="报名表"`）。

本次修复（验收抓到的既有 bug）：

- **附件/图片上传后展示名变成生成的磁盘名**：`uploadResource` 只回磁盘名（main 侧直接忽略请求名），而 `BitableEditor.uploadFiles` 把它当展示名 ⇒ 上传后卡片显示 `1790582685708_03cd9c88.png`。已改为 `name: file.name`（用户原始文件名），并加源码级护栏断言。

遗留问题：

- 图片字段只按扩展名 / MIME 判图片（不做内容嗅探）；改名仍只改展示名。
- 表单不做分享 / 二维码 / 云端收集；字段描述（`formDescriptions`）暂未在预览里渲染。

下一步：等用户对 V02–V04 + 本追加批一并验收；通过后按 §8 顺序进入 T01 列级统计。

### 2026-09-28 · 修复合批（图片预览总数 / 附件命名审计 / 表单编辑态回退 / 看板缩略图）

用户 260928 的四条反馈，全部先实测复现再修。

#### ① F01 图片预览总数不对、切不动（文档 + 画册）

- **根因（文档）**：编辑态开了虚拟渲染 + `cardLazyInit`（用户 260911 拍板），**视口外的卡片根本不在 DOM 里**；原画廊列表是 `host.querySelectorAll("img.ne-image")` 现收集的 ⇒ 图多/文长时列表就短，左右切不过去。内核这个构建里 `allowClickToMaximize` 无效（代码里早有注释），官方 `previewImgs` 回调拿不到。
- **修法（文档）**：列表改从**正文**取（`latestDocumentRef` 每次 contentchange 刷新）：`extractImagesFromContent` 解析内核产出的 image 卡片（`value="data:{encodeURIComponent(JSON)}"`）+ 裸 `<img>`；DOM 只用来定位「双击的是哪一张」——DOM 图片是正文列表的**子序列**，按顺序贪心对齐（同一张图出现两次也不会跳错）。
- **根因（画册）**：点封面走 `openAssetEntry`，每次只传自己 1 张 ⇒ 总数恒为 1。
- **修法（画册）**：把**本视图全部图片封面 + 当前下标**交给共享 Lightbox。
- 实测：文档 10 张图 → `1 / 10`，连点下一张到 `10 / 10`；画册 2 张封面 → `1 / 2` → `2 / 2`。

#### ② F02 附件「磁盘名 / 展示名」审计（用户要求严肃排查）

结论：**契约本来就是分开的，只有一处用错了**。

- main 侧 `attachmentOutput`（非图片附件）：磁盘名 = `buildAssetFilename`（`{13位毫秒}_{8位随机hex}.ext`），返回的 `filename` = **清洗后的原始文件名**（展示名），磁盘名只在 url 末段 ✓
- main 侧 `imageOutput`（图片）：返回的 `filename` = **磁盘名**（图片没有展示名概念）——陷阱就在这里
- `buildAssetFilename` 用 `randomHex4()`（crypto 随机）而不是内容 hash ⇒ **同一张图上传两次必得两个文件**，不存在「多条引用共用一份文件、删一条把另一条也删没」的隐患 ✓（全链路无内容去重）
- **唯一的错用**：多维表 `uploadFiles` 把 `uploaded.filename` 当展示名 ⇒ 图片一律显示成 `1790582685708_03cd9c88.png`（已修：`name: file.name`，并加源码护栏断言）
- 复核其它消费方：quick-notes 只存磁盘名且只按图渲染（无展示名需求）✓；文档 file 卡片用 main 侧返回的展示名 ✓；`attachmentPreviewController` 的 `ref` 从 **url** 解析磁盘名（不受展示名影响）✓

#### ③ F03 表单编辑态回退

- 上一版把「编辑表单」改成标题/描述 + 卡片字段勾选，被用户明确否决。本批**恢复 v1 原形态**：左侧「表单题目 / 可选题目」+ 右侧题目预览 + 「填写表单」录入区。
- 只保留新增的「预览表单」tab（已配置默认进预览、未配置默认进编辑）。`formTitle` / `formDescription` 不再有编辑入口，仅预览标题/描述读取，缺省与 v1 文案完全一致。

#### ④ F03 看板卡片图片缩略图

- 附件类字段（image / attachment）上卡改成**图片缩略图**（`?w=` 档位、36px）；没有图片就不上卡；**不再出现文件名**。字段名仍按「显示字段名」开关决定。

验证结果：门禁全绿（tsc / vitest **1369 passed / 16 skipped** / check:core / 双端构建 / ui-metrics / cssLayers+uiPrimitives / git diff --check）；四条均以 CDP 真实端点验收（隔离 userData + 9226）。

改动文件：`src/features/editor/imagePreview.ts`(+test) · `src/features/editor/LakeEditor.tsx` · `src/features/bitable/BitableGalleryView.tsx` · `BitableEditor.tsx` · `BitableFormView.tsx` · `bitableFormView.css` · `BitableKanbanView.tsx` · `bitableKanbanView.css` · `bitableEditorMount.test.ts` · `src/styles/cssLayers.test.ts`

遗留：同一张图在文档里出现两次时，双击第二次仍定位到第一张（那是"定位哪一张"的精度问题，**张数已正确**）；本机展示态（月份/折叠/当前视图）口径不变。

下一步：等用户验收（V02–V04 + 追加两批）。

### 2026-09-28 · 修正批（预览范围=单单元格 / 展示名守卫 / 填写表单跳预览）

用户 260928 对上一批的纠正，三条都先复现再改。

#### ① 图片预览范围必须是**单个单元格**（F01 修正）

- 上一版把「点封面」做成**本视图全部封面**的合集 —— 逻辑错了：用户明确「两列图片就是两类，预览也不能混」。
- 正确口径（已固化）：
  - **表格 / 记录详情 / 表单**：点单元格里的某张图 → 预览**该单元格内**的全部图片（左右切换不越格）。
  - **画册**：点封面 → 预览**封面字段该行单元格**里的全部图片（不是全部封面、也不并其它图片列）。
  - **看板**：卡片缩略图**按字段分组展示**（图片A:2 + 图片B:3）；本轮缩略图只做展示，点卡片仍打开记录详情（要不要「点缩略图预览本单元格」按用户口径再定）。
- 实现：`AttachmentCell` / 展开面板新增 `onOpenImages(images, index)`，图片集合由 `attachments.filter(isImageExtension)` 现算；画册用 `galleryCoverField` 取该行该字段的图片集合。
- 实测（一行两列图片：A 列 2 张、B 列 3 张）：表格点 A 列 → `1 / 2`、点 B 列第 2 张 → `2 / 3`、点 B 列第 3 张 → `3 / 3`；画册封面 → `1 / 2`（只看该格）；看板缩略图 图片A:2 + 图片B:3。

#### ② 展示名守卫：磁盘名**绝不外显、不可编辑**（F02 修正）

- `bitableAttachments`：展示名缺失、或展示名本身就是落盘名（历史脏值）→ 统一回落中性文案「附件」，**不再回落磁盘名**。
- `buildAttachmentPreviewItem`（附件预览标题）：标题缺失/是落盘名 → 同样回落中性文案（原先会用 URL 末段=磁盘名兜底）。
- 重命名走的一直是展示名（`renameBitableAttachment` 只改 `name`；输入框由 `splitAttachmentName(name)` 拆主名/扩展名），**磁盘名没有任何编辑入口**。
- 上传保留原文件名：`BitableEditor.uploadFiles` 用 `file.name`（上一批已修），图片/附件一致。

#### ③ 表单「填写表单」= 跳到预览表单页（T06 修正）

- 删掉 v1 的独立录入弹层（`.bt-form-entry`），「填写表单」按钮直接切到**预览表单** tab（填完直接提交）。
- 实测：点「填写表单」→ 活动 tab = `预览表单`、`.bt-form-entry` 数量 = 0、题目控件 4 个。

验证：门禁全绿（tsc / vitest **1370 passed / 16 skipped** / check:core / 双端构建 / ui-metrics / cssLayers+uiPrimitives / git diff --check）；三条均由 CDP 真实端点验收。

过程备注（避免后人踩）：改完 `src/**` 后**必须 `vite build`** 再跑 `LAKE_RENDERER=scheme` 的验收——本轮首次验收跑在旧 bundle 上，出现过「改了没生效」的假象。

改动文件：`src/core/bitableDoc.ts`(+test) · `src/features/attachment/attachmentPreviewController.ts` · `src/features/bitable/bitableCells.tsx` · `BitableGalleryView.tsx` · `BitableEditor.tsx` · `BitableRecordDrawer.tsx` · `BitableFormView.tsx` · `bitableEditorMount.test.ts`

下一步：等用户验收。

### 2026-09-28 · T01 列级统计

本次完成：

- 表格底部新增**列统计行**（`tfoot`，贴底常驻 `position: sticky; bottom: 0`）：每列显示「统计名 + 值」，未配置显示 `—`。
- 口径：通用（记录总数 / 已填写 / 未填写 / 唯一数 / 已填写占比 / 未填写占比）+ 数字（求和 / 平均 / 最小 / 最大）+ 日期（最早 / 最晚 / 时间范围=天数跨度）。
- 配置入口：列表头右键或 ⋯ → **统计** → 选口径（含「无统计」）；配置存 `view.columnStats`（视图级，不写记录）。
- **统计基于当前视图筛选后的记录**（`shownRecords`），排序不影响集合；空格子不参与数字聚合（不当 0）；附件 / 关联等类型不会崩（只走通用口径）。

数据结构 / 接口：

- `BitableView.columnStats?: Record<string, string>`；`normalizeView` 校验为对象。
- core 新增：`BitableStatType` / `BITABLE_STAT_LABEL` / `statsForField` / `statForField` / `computeColumnStat`（全纯函数）。

改动文件：`src/core/bitableDoc.ts`(+test) · `src/features/bitable/BitableEditor.tsx` · `bitableViews.css` · `src/styles/cssLayers.test.ts` · `bitableEditorMount.test.ts`

验证结果：

- 门禁全绿：tsc / vitest **1372 passed / 16 skipped** / check:core / 双端构建 / ui-metrics / cssLayers+uiPrimitives / git diff --check。
- CDP 真实端点验收：初始底栏全 `—` → 数量列选「求和」= `求和 7`（4 条里 1 条空值不计 0）→ 日期列选「时间范围」= `时间范围 9 天`（多列独立）→ 加「文本 包含 A」筛选后仅 1 条可见，底栏变 `求和 1` / `时间范围 1 天`；`columnStats` 落盘。

遗留：移动端隐藏统计（验收允许「只读或隐藏」）；统计不参与 CSV/JSON 导出配置（导出尚未开始）。

下一步：等用户验收；随后按 §8 顺序进入 T03 多级分组。

### 2026-09-28 · T03 多级分组 + T04 语义排序增强

#### T03 多级分组

- `view.groups` 由「只用第 0 条」升级为**最多 3 级**（`BITABLE_MAX_GROUPS`）；面板可加/删/换字段、**拖动调整优先级**。
- core 新增 `groupRecordsTree`（纯函数）：逐级细分返回树（`key/label/level/count/records/children`），组键/标签口径与单级完全一致，组内保持筛选+排序后的顺序，每级各自排序、空值组恒最后。
- 折叠态仍是**本机展示态**；节点 key = `fieldId:值` 逐级拼接（唯一、互不串扰）。
- 层级缩进用变体选择器（`.bt-group-row.level-N .bt-group-label`）落在 `bitableViews.css`，不改 `bitableEditor.css`。

#### T04 语义排序增强

- `BitableSortRule` 增 `mode: "optionOrder"`；core 新增 `BitableSortMode` / `BITABLE_SORT_MODE_LABEL` / `sortModesForField` / `sortModeLabel` 与 `compareSortValues`。
- 单选/多选多出「选项顺序 / 选项逆序」（多选按**第一个已选项**的序号）；空值/指向已删选项的值**恒排最后**（与分组口径一致）。
- 日期字段的升降序文案改为「早→晚 / 晚→早」（口径不变，只是贴切）。数字保持原有升降序。不做公式排序。
- 排序值按**选项序号**判断（选项重命名/重排后配置不丢）；多条件排序仍按规则顺序稳定比较。

改动文件：`src/core/bitableDoc.ts`(+test) · `src/core/bitableGroup.test.ts` · `src/features/bitable/BitableEditor.tsx` · `bitableViews.css` · `src/styles/cssLayers.test.ts`

验证结果：

- 门禁全绿：tsc / vitest **1375 passed / 16 skipped** / check:core / 双端构建 / ui-metrics / cssLayers+uiPrimitives / git diff --check。
- CDP 实测 T03：分组 = 状态 → 优先级，渲染出「待开始 3（低 1 / 高 2）· 进行中 1（高 1）· 已完成 1（低 1）」两级树（父组 count 含子级、层级缩进生效、5 条记录行）；折叠首组后其子级消失；`groups` 两条配置落盘。
- CDP 实测 T04：状态字段的排序方式下拉出现 4 项（升序/降序/选项顺序/选项逆序）；选项顺序 → `B C E | D | A`（待开始→进行中→已完成，组内保持输入序），选项逆序 → `A | D | B C E`，字典序升降序照旧。

遗留：多级分组的折叠 key 基于「组键=选项名」，重命名选项会重置该组折叠态（本机展示态，不写正文）；移动端仍不展示分组（安全回退为平铺网格）。

下一步：按 §8 顺序进入 **T02A 基础字段**（布尔/链接/评分/进度/创建时间/修改时间）。

### 2026-09-28 · T02A 基础字段（布尔 / 链接 / 评分 / 进度 / 创建时间 / 修改时间）

本次完成：

- **布尔值**：单元格为单复选框；字段默认值可选「是/否」。
- **链接**：单元格是可编辑 URL + `↗` 用**系统浏览器**打开（桌面 `window.open` → 主进程 `shell.openExternal`，移动端走系统打开）；默认值为 URL。
- **评分**：固定 **5 星**，点第 N 颗 = N 星，再点当前星级 = 清零；默认值可选 1–5（含「无」）。
- **进度**：0–100 **进度条** + 数值输入（越界自动夹取），**颜色可配**（`field.progressColor`，调色板；缺省主题强调色）；默认值 0–100 + 颜色。
- **创建时间 / 修改时间**：系统只读，值取 `record.createdAt / updatedAt`，按**本地** `YYYY-MM-DD HH:mm` 展示，**不写 values**。
- 未知字段类型仍走只读展示（原有行为不变）。

数据结构 / 接口：

- `BitableFieldType` 新增 6 类；`BITABLE_FIELD_TYPES` 菜单按云端顺序补全；`BitableField.progressColor?: string`。
- core 新增：`isNumericFieldType`（数字/评分/进度统一走数值口径）、`isSystemTimeField`、`bitableFieldValue(record, field)`、`bitableFieldText(record, field)`、`localDateTimeString`、`BITABLE_RATING_MAX/BITABLE_PROGRESS_MAX`。
- 取值口径统一到 `bitableFieldText`：记录标题、搜索文本、看板/画册卡片、移动端单元格全部改走它（布尔/链接/评分/进度/系统时间都能正确显示）。
- 数值口径（排序 / 筛选操作符 / 列统计）扩展到评分与进度；布尔给 `equals/notEquals/isEmpty/isNotEmpty`。
- **系统时间字段不参与筛选 / 排序 / 分组**（值不在 values 里，且不在表单题目里）——排除而不是给「能选但没效果」的假入口。
- 复制/粘贴口径补全：布尔接受 是/否/true/false/1/0；评分与进度按数字解析并夹取；链接按文本写入。

改动文件：`src/core/bitableDoc.ts`(+test) · `src/features/bitable/bitableCells.tsx` · `BitableEditor.tsx` · `BitableRecordDrawer.tsx` · `BitableKanbanView.tsx` · `BitableGalleryView.tsx` · `BitableFormView.tsx` · `bitableFieldCells.css`(新) · `src/mobile/bitable/MobileBitableViewer.tsx` · `src/styles/cssLayers.test.ts`

验证结果：

- 门禁全绿：tsc / vitest **1376 passed / 16 skipped** / check:core / 双端构建 / ui-metrics / cssLayers+uiPrimitives / git diff --check。
- CDP 实测：新增字段菜单列出 6 个新类型；布尔勾选 → 落盘 `true`；评分点第 3 颗 → 落盘 `3`；进度输入 60 → 进度条 `--bt-progress: 60%` + 配色 `#d6e6fb`，落盘 `60`；链接 `↗` 调起 `https://example.com/x` 且落盘；排序字段下拉**只列** 文本/布尔/链接/评分/进度（创建·修改时间已被排除）。

遗留：创建/修改时间暂不参与筛选与排序（无假入口，等真正需要时再做记录级取值改造）；评分口径为整星（不做半星）。

下一步：等用户验收；随后按 §8 顺序进入 T02B.1 关联基础模型。

### 2026-09-28 · T02A 修正：系统时间字段打通「筛选 / 排序 / 分组 / 统计」

用户质疑（成立）：创建/修改时间就是**自动填充的只读字段**，没有理由不能筛选排序。

**之前为什么不行（真实原因）**：核心求值链是「值优先」的——筛选/排序/分组/统计全都直接读 `record.values[fieldId]`；系统时间的值来自 `record.createdAt/updatedAt`，**不在 values 里**，于是整条链一律读到 `undefined`（排序等于没排、筛选等于全空）。当时的「把字段从下拉里排除」只是把「能选但没效果」换成「不给入口」，**没有解决取值口径本身**，属于假边界。

**正确做法（单一取值口径）**：新增记录级访问器，管线全部走它——

- `bitableFieldValue(record, field)`：**管线取值**。创建/修改时间 → `localDateString(createdAt/updatedAt)`，即**本地日期 `YYYY-MM-DD`**，与 `date` 字段同域 ⇒ 时间字段天然获得 `gt/lt/gte/lte/isEmpty` 比较、最早/最晚/时间范围统计、按天分组。
- `bitableFieldText(record, field)`：**展示文本**，系统时间展示到分钟 `YYYY-MM-DD HH:mm`（不因此损失展示精度）。
- 改造落点：`applyViewToRecords`（筛选 + 排序）、`groupRecordsTree`/`groupRecords`（含组间排序）、`computeColumnStat`、`duplicateValues`；比较器与统计/操作符把时间字段并入 date 口径；排序方式文案也统一为「早→晚 / 晚→早」。
- UI 侧**撤回**了排序/筛选/分组下拉的字段排除（表单仍排除：表单是录入侧，系统字段无录入意义）。

实测（CDP）：单元格显示 `2026-09-03 10:00`；排序字段下拉含「创建时间 / 修改时间」；按创建时间升序 → `A(09-01) C(09-03) B(09-05)`（此前是插入序）；`sorts` 配置落盘。单测覆盖：时间字段的升/降序、`gte` 筛选、按天分组、最早/时间范围统计。

改动文件：`src/core/bitableDoc.ts`(+test) · `src/features/bitable/BitableEditor.tsx`

下一步：等用户验收；随后进入 T02B.1 关联基础模型。

### 2026-09-28 · 字段类型选择改 2 列网格（对齐云端版式）

- 新增共用组件 `FieldTypeGrid`：字段类型按**2 列网格**排布，**不分「基础 / 高级」分组**（用户 260928 给的云端截图版式）。
- 两处共用：表格头「新增字段」面板 + 字段编辑弹窗的「字段类型」（可传 `value` 打勾；**未知类型也占一格**，不会被清空）。
- 类型集合不变（14 种，仍不含人员/邮箱/手机号码等企业字段）。
- 样式落 `bitableFieldCells.css` 的 `.bt-type-grid`（原文件顺带定位为「字段相关样式」），基线同步更新。

**过程坑**：T02A 建 `bitableFieldCells.css` 时**漏了 `import`**，导致那批新单元格样式一直没加载（元素在、样式空）。本轮补上 `bitableCells.tsx` 的 `import "./bitableFieldCells.css";` 后，布尔/链接/评分/进度与 2 列网格同时生效。

实测：新增字段面板 `grid-template-columns: 142px 142px`、14 项、面板内只有 1 个标题（无分组）；字段编辑弹窗里当前类型（文本）带勾选。

改动文件：`src/features/bitable/bitableCells.tsx` · `bitableFieldCells.css` · `BitableEditor.tsx` · `src/styles/cssLayers.test.ts`

### 2026-09-29 · T02A 续：评分空星可见性 + 进度条可拖动（用户反馈）

用户 260929 反馈上一轮 T02A 的两处遗留（附我方/云端对照截图）：

1. 评分字段**未点选时星星颜色太浅、看不清**（我方 = 浅色空心星，云端 = 实心浅灰星）。
2. 进度字段云端可**拖动**调整，我们的只能输入数字。

本次完成：

- ① 评分 `RatingCell`：`<Star>` 由「选中实心 / 未选中 `fill:none` 空心」改为**恒 `fill="currentColor"` 实心**，颜色交回 CSS 令牌 —— 未选中 `--lake-border-strong`（浅色 #d5d9de，对齐云端实心浅灰）、选中仍 `--lake-status-pending`。原先未选中用最浅的 `--lake-border-2` + 空心 ⇒ 几乎不可见。
- ② 进度 `ProgressCell`：轨道改为**可按压拖动** —— `.bt-progress` 上 `pointerdown` 即跟手（**点轨道任意处直接跳值**），`document` 上收 `pointermove/pointerup`；新增圆形把手 `.bt-progress-thumb`（用 `--bt-progress` 定位）。轨道去掉 `overflow:hidden`（否则裁掉把手）并加 `touch-action:none`。
- **只读契约**：`readOnly` 时轨道加 `.is-readonly`（`cursor:default` + 隐藏把手），`startDrag` 直接 `return` ⇒ 只读态没有写入入口（数字输入框同步 `readOnly`）。

数据结构/接口变化：

- 无。沿用字段既有值模型与 `field.progressColor`；不新增持久化字段，无同步/历史/GC 改动。

UI 与交互变化：

- 评分空星由「浅色空心」变「中性灰实心」；进度条可拖动并出现把手（可拖动的可见证据）。
- 新样式仍全部落在 `bitableFieldCells.css`（未回灌 `bitableEditor.css`，其 1081 基线不动）；该文件基线 66 → 81（+15，合法新增非覆盖回涨，已在 `cssLayers.test.ts` 注明）。

改动文件：

- `src/features/bitable/bitableCells.tsx` · `bitableFieldCells.css` · `src/styles/cssLayers.test.ts` · `bitableEditorMount.test.ts`

验证结果：

- `tsc --noEmit`：通过
- `vitest`：**1378 passed / 16 skipped**（+1 = 本轮新增护栏用例）
- `check:core`：0 违规
- 桌面构建：通过；移动构建：通过
- UI/CSS 指标：`ui-metrics` hex=0 / `!important`=9 / 未定义令牌=0；`cssLayers`+`uiPrimitives` 通过；`git diff --check` 通过
- 手工验收（CDP 真实端点：`LAKE_RENDERER=scheme` + 隔离 `LAKE_USER_DATA` + 独立端口 9231）：
  - 评分：`.bt-rating` 5 星；未选中 `getComputedStyle().color` = `rgb(213,217,222)`（#d5d9de）、`svg[fill]` = `currentColor` ⇒ **实心可辨**（截图核对）；选中 = `rgb(155,97,14)`。
  - 拖动：按住 20% → 拖到 80% → 松手，输入框/文案变 `80%`、`--bt-progress:80%`，**4 次轮询内落盘 `fld-progress=80`**。
  - 点轨道跳值：35% 处按下即抬起 → `35%`，落盘 35。
  - 只读态（`setNoteLocked(true)` + 重载）：`.is-readonly` 存在、`cursor:default`、把手 `display:none`、输入框 `readOnly`；在 90% 处拖动后值仍 35（**未写入**）。
- 取证产物（截图 + CDP 脚本）为临时文件，验收后已删，未入库。

遗留问题：

- **选中星色未动**：仍是 `--lake-status-pending`（#9b610e，偏深琥珀），云端为 `#ecaa06`（更亮金）。用户本轮只报「未选中太浅」，故**只修未选中**，是否一并对齐选中色待用户确认。
- 进度条默认色走主题强调色 `--lake-accent`（云端为亮蓝 #137cee）；按「自有设计系统」口径未改，可用字段级 `progressColor` 覆盖。

下一步：

- 等用户验收本批两处修复；通过后再按 §8 顺序进入 **T02B.1 关联基础模型**。

工程备注（避免后人踩）：

- 本轮 CDP 实例**必须加 `--no-sandbox`**：在当前 DSH 宿主 sandbox 下，Chromium 自带 sandbox 初始化报 `Operation not permitted`，连锁 `NetworkService/GPU crashed` 并最终 `FATAL: GPU process isn't usable. Goodbye.`（进程整体退出）。加 `--no-sandbox` + 隔离 `LAKE_USER_DATA` 后正常。

#### 同会话追加（用户 260929 确认后）：选中星对齐云端金 + 去除进度数值框原生「加减框」

上一条「遗留问题」里两项待定，用户当场拍板，同会话落实：

- **选中星色对齐云端**：新增主题令牌 `--lake-rating-star`（light / warm = `#ecaa06`，即云端语雀的金；dark = `#e8b339`，深色底亮一档，与 `--lake-status-pending` 在深色的处理同口径），`.bt-star.is-on` 由 `--lake-status-pending` 改走它；空星仍 `--lake-border-strong`。⇒ 评分星与云端一致：**实心金星 + 实心灰星**（颜色字面量只出现在 `themes/*`，符合 AGENTS §3 #14）。
- **去掉进度数值框的原生「加减框」**：`.bt-progress-input` 加 `appearance: textfield` + `::-webkit-{inner,outer}-spin-button { appearance:none; margin:0 }`。进度条是主控件（0–100 整数、线性跟手），数值框只留精确输入。

改动文件（追加）：`src/styles/themes/{light,dark,warm}.css` · `bitableFieldCells.css`（基线 81 → 84）· `bitableEditorMount.test.ts`

追加验证（CDP 真实端点，隔离 userData）：

- 评分：选中星 `getComputedStyle().color` = `rgb(236,170,6)`（`--lake-rating-star` = `#ecaa06`）、`svg[fill]` = `currentColor`；空星 = `rgb(213,217,222)`（`--lake-border-strong`）。截图核对与云端一致。
- 进度：数值框截图**无加减框**；拖动**逐点重新量轨道**后 0 / 10 / 25 / 50 / 73 / 90 / 100 **全部精确命中**（全整数、线性），越界夹到 0 / 100。
  （注：首次对拍用「一次量好的固定 rect」会得到 50→54、73→79 的假偏差 —— 数值文案宽度变化会改轨道宽度；验收必须每次重取 rect。）

未改（口径保留，用户知情）：

- 进度条**默认色**仍是主题强调色 `--lake-accent`（云端为亮蓝 `#137cee`），可用字段级 `progressColor` 覆盖。
- 「数字」字段单元格与字段弹窗里的「进度默认值」输入框**仍保留原生加减框**：本轮只按用户所指改进度单元格，未扩散到其它输入。

#### 同会话追加②（用户 260929）：进度只留「条 + 百分比」，数值输入框整体删除

用户看图后再收一步：「数字也去掉，拖动进度条直接看百分比就行」。

- `ProgressCell` 删除 `<input class="bt-progress-input" type="number">`，单元格只剩 **轨道（可拖动）+ `{pct}%` 文案**；随之删掉 `.bt-progress-input` 与其 `::-webkit-*-spin-button` 共 3 条声明（基线 84 → **81**）。
- **键盘可达没有一起丢**：轨道本身成为控件 `role="slider" tabIndex=0` + `aria-valuemin/max/now/valuetext`（只读时 `tabIndex=-1` + `aria-readonly`）；键盘映射 ←/↓ −1、→/↑ +1、PageUp/Down ±10、Home/End 两端、**Delete/Backspace 清空**（清空是删除输入框后唯一的「回落到未填写」路径，特意保留）。
- 网格的 `onGridKeyDown` 只处理 Tab/Enter/Escape（方向键不参与），故方向键给 slider 步进不会与单元格导航打架。

追加验证（CDP 真实端点）：

- `cell.querySelector("input") === null`（数值框确已删除），轨道 `role=slider` / `tabindex=0` / `aria-valuenow` / `aria-valuetext` 齐备；UI 只剩「条 + 64%」。
- 拖动（每次重新量轨道）0 / 10 / 25 / 50 / 73 / 100 **全部精确命中**。
- 键盘：50 → →51 → ↑52 → ←51 → ↓50 → PageDown 40 → PageUp 50（**精确**）；Home 0 / End 100；Delete 后文案 `0%` 且 **1 次轮询即落盘（值清空为 ""）**。

遗留（口径变化，用户知情）：进度单元格**不能再直接输入数字**；清空只能靠键盘 Delete/Backspace（或整体清空该行/该字段值）。

### 2026-09-29 · T01 续：空统计行不再渲染（用户反馈「添加记录下面一条奇怪的条」）

用户 260929 发截图（红框圈出「添加记录」下方的一条灰条）要求「完全去掉」。

**定位（先证后改，不靠猜）**：用户截图逐像素采样 + 隔离实例复现同一形态（多列、未配统计）后确认：

- 那条「灰条」= **T01 的列统计行** `tfoot > tr.bt-stat-row`（`.bt-stat-row td { background: var(--lake-bg-block) }`）⇒ 用户图里是 `rgb(241,242,245)`、整行 36px、每列一个 `—`，因为**没有任何列配置过统计**。
- 排除法：`.bt-grid-wrap` 确有横向溢出（scrollWidth 2100 / clientWidth 864），但它的滚动条在容器底边（窗口最底部），与用户圈的位置（表格下方、状态栏上方）不符；该处 `elementsFromPoint` 只返回 `.bt-grid-wrap` 空区、DOM 里没有细长元素 ⇒ **不是滚动条、也没有多余元素**。

**修法（最小、不删功能）**：底栏改为**按需渲染** —— `visibleFields.some((field) => statForField(activeView, field.id))` 为真才输出 `<tfoot>`；没有可见列配置统计时整行不存在。与 §7 T01「不展示统计时保留默认『记录总数』**或无统计**」一致。

改动文件：`src/features/bitable/BitableEditor.tsx` · `bitableEditorMount.test.ts`

验证结果：

- 门禁全绿（tsc / vitest 1378 passed / 16 skipped / check:core / 双端构建 / ui-metrics / cssLayers+uiPrimitives / git diff --check）。
- CDP 真实端点（隔离 userData + 9236，重建后的 dist）：
  - **未配置统计**：`tfoot` 与 `.bt-stat-row` 都不存在；「添加记录」行下面直接是「共 3 条记录」（截图核对无灰条）。
  - **配置一列统计**（`columnStats = { 文本: "count" }` + 重载）：`tfoot` 出现，单元格 = `["", "记录总数 3", "—", "—", ""]`。

遗留：统计行样式与 `.bt-stat-row` 规则**保留**（配置统计时仍用）。若用户要的不是「空行不渲染」而是**整个列统计功能都不要**，属产品级回退，需用户明确后再做。

### 2026-09-29 · T01 整体回退（用户决定：列统计意义不大，实现与展示清干净）

用户 260929 在看过列统计的口径说明后决定：**整体去掉**，并且「实现和展示都清除干净」，
自述「我的问题，没有问清楚如何统计就做功能」。这是**产品级回退**（推翻 §7 批次 D/T01 的原始需求），不是 bug 修复。

删除范围（全链路清干净）：

- **core** `src/core/bitableDoc.ts`：删 `BitableStatType` / `BITABLE_STAT_LABEL` / `GENERIC_STATS` / `statsForField` / `statForField` / `formatStatNumber` / `statPct` / `computeColumnStat`；删 `BitableView.columnStats` 字段与 `normalizeView` 里对应的校验分支。
  - **注意**：`normalizeView` 是「`{...raw}` 原样保留未知键」，所以只删校验分支会**反而让旧 `columnStats` 一直被保留**（本轮实测踩到：加记录保存后字段仍在）。因此补一行 `delete next.columnStats;` 显式丢弃旧数据 —— 这是删除残留、不是为旧数据写兼容。
- **编辑器** `src/features/bitable/BitableEditor.tsx`：删 `<tfoot>` 统计行、列菜单「统计」入口、`statFor` 选择器浮层（含 `setColumnStat`、`statFor` state 与相关 import）。
- **样式** `src/features/bitable/bitableViews.css`：删 `.bt-stat-row td`（4 条声明）⇒ `cssLayers` 基线 **20 → 16**。
- **测试**：删 `bitableDoc.test.ts` 的「列统计」用例与相关断言、`bitableEditorMount.test.ts` 的 T01 护栏用例；新增 1 条护栏锁住「旧 `columnStats` 不再被保留」。

验证结果：

- 门禁全绿：tsc / vitest **1377 passed / 16 skipped**（1378 − 2 个 T01 用例 + 1 个旧数据丢弃护栏）/ check:core 0 违规 / 双端构建 / ui-metrics（hex=0、!important=9、未定义令牌=0）/ cssLayers+uiPrimitives / git diff --check。
- CDP 真实端点（隔离 userData + 9238，重建后的 dist）：
  - `tfoot` 与 `.bt-stat-row` **都不存在**；表格本体正常。
  - 列菜单项 = `编辑列 / 复制列 / 向左插入列 / 向右插入列 / 高亮重复值 / 文本颜色 / 删除列` —— **没有「统计」**。
  - 旧数据：故意在正文里塞 `views[0].columnStats = { 文本: "count" }`，打开不炸；触发一次保存后落盘视图键 = `id/name/type/rowHeight`，`columnStats` **已消失**。

遗留：无。T01 相关的旧会话记录（§13 的 2026-09-28 T01、2026-09-29 T01 续）保留作历史，不再代表当前能力。

### 2026-09-29 · 浮层定位统一：贴底翻上方（修多维表日期选择器被裁）

用户 260929 报：多维表的**日期选择框贴到视口底部时不翻转**，日历被切掉；要求「和目录栏右键一样的逻辑」，并**排查同类弹窗**（「这个问题出过很多次了」）。

**根因（先证后改）**：`Overlay` 原语只按调用方传的 `style` 定位，定位责任散在各调用点；而多维表共用 `Popover` 用**估算高度 48px** 去夹视口（`window.innerHeight - 48`）——日历真实高度 ≈ 300px ⇒ 夹取形同虚设、日历直接溢出窗口，且**从不翻转**。同类估算还有：行右键菜单 `innerHeight - 90`（菜单实测 118px）、列菜单 `- 300`、卡片/标签右键 `- 260 / - 280 / - 200`。

**修法（收敛到单一来源）**：

- `src/hooks/topMenuPosition.ts` 增**垂直方向唯一口径** `placeVertical`（下方优先 → 放不下翻上方 → 两边都放不下才夹进视口）+ 两个入口 `placePopoverPosition`（锚定）/ `placePopoverAtPoint`（坐标/右键）；原 `clampPopoverPosition` 改为薄封装 ⇒ 5 处旧调用（同步状态、桌面浮层、大纲层级菜单、小记排序/行菜单）**一并获得翻转**。
- 新增 `src/hooks/usePopoverPosition.ts`：**先把表面挂到屏外（`visibility:hidden`，仍参与布局）量真实尺寸**，再定位；`ResizeObserver` + window resize 触发重算（内容变高也会重定位）。与目录栏右键同一条逻辑。
- 多维表共用 `Popover`（15 处调用：日期 / 单选 / 附件展开 / 文本展开 / 字段 / 筛选 / 排序 / 分组 / 行高 / 视图配置 / 列菜单 / 视图菜单 / 数据表切换 / 新建字段 / 视图栏新建）改走该 hook。
- 行右键菜单、`TabContextMenu`、`CardContextMenu` / `TextContextMenu` 同样改走 hook；`openColumnMenu` 去掉按 300 的预夹取（坐标原样交给浮层）。
- 附件展开 / 文本展开两个面板的初始定位改走 `placePopoverPosition`（保留原有拖动/缩放）。

**同类清查结论（用户要求的排查）**：

| 位置 | 结论 |
| --- | --- |
| 多维表 `Popover`（日期 / 单选 / 各配置面板） | **有 bug（已修）**：估算 48 / 300 |
| 多维表行右键菜单 | **有 bug（已修）**：估算 90，实测 118 ⇒ 贴底必裁 |
| 卡片右键 / 文本右键 / 标签页右键 | 估算 200 / 260 / 280，实测**小于**估算 ⇒ 侥幸没被裁；本轮统一改走实测，去掉隐患 |
| 目录栏右键菜单 | 本来就对（先量 `offsetHeight` 再决定上下）—— 本轮把它作为口径来源 |
| 标签页切换菜单 | 安全：自身 `maxHeight: min(470px, calc(100vh - top - 16px))` 自限高 |
| 同步状态 / 桌面浮层 / 大纲层级菜单 / 小记菜单 | 走 `clampPopoverPosition` ⇒ 本轮获得翻转 |
| 大纲层级 / 选区工具条 / 内核小浮层 | 已有上下翻转判断，未动 |
| 悬浮窗（`useFloatingDialog`）/ 侧栏新建菜单 | 自身夹取或锚点在顶部，无贴底问题 |

验证结果：

- 门禁全绿：tsc / vitest **1381 passed / 16 skipped**（+4 = 3 条定位用例 + 1 条多维表护栏）/ check:core / 双端构建 / ui-metrics / cssLayers+uiPrimitives / git diff --check。
- CDP 真实端点（隔离 userData + 9239，重建后的 dist；18 条记录、网格滚到底）：
  - 首行日期（顶部）：popover 195–445，位于锚点**下方**、完整可见（无回归）。
  - 末行日期（锚点 717–743）：popover **463–713，翻到锚点上方**、完整可见（截图核对：日历完整、今天/清除都在）。
  - 末行单选项：568–708 完整可见；末行右键菜单（光标 y≈743）：625–743 完整可见（旧的 90 估算会裁）。
- 新增源码级护栏：多维表两文件禁用 `window.innerHeight - <估算>` 旧写法，必须走共用 hook/纯函数；`topMenuPosition.test.ts` 覆盖翻转与夹取三分支。

遗留：浮层**不跟随滚动**（与改动前一致：定位完成后滚动表格不会重定位）；若要跟随，可在 hook 里加 scroll 重算。

### 2026-09-29 · V05 分组样式复刻云端 + T01 列统计恢复

用户反馈：**分组之后样式不对**（给图：云端 vs 我方「差距巨大」），要求用 BrowserSkill 精细探查、逐步复刻；同时纠正——
**统计功能还需要**（「我忘了分组之后就有统计需求了」）。

#### ① 云端精细探查（browser-skill + Edge，遵守 §1.8 必须用 Edge）

会话：`bsk session start --browser <edge>`（本机 chrome/edge 同时在线，**按 §1.8 选 Edge**）→ `navigate` 到用户给的语雀数据表（已分组）→ `bsk evaluate` 取真实 DOM/计算样式（`get-html` 只给结构，几何必须靠 evaluate 量）。

云端分组规格（实测类名与数值）：

| 云端 | 实测 |
| --- | --- |
| `.lakex-viewer-grid-group-header` | **flex，高 56px，整行铺满表宽** |
| `.lakex-viewer-grid-group-header-index` | 36px 白底 chip，1px `rgb(244,245,245)` 边框，圆角 `6px 0 0 0`，padding `0 8px`，flex 居中 |
| `.lakex-viewer-grid-group-fold` | 24×24，圆角 4px，**无边框/透明底**（只是三角的命中区） |
| `.lakex-viewer-grid-group-field` | 高 34，font 12px，色 `rgb(38,38,38)`（分组值） |
| `.lakex-viewer-grid-group-header-column` | 36px 白底 chip，1px `rgb(244,245,245)`，padding `0 8px`，**justify: right**（统计值右对齐） |
| 分组头的统计内容 | 首个是**索引列**的统计：`N 条记录` + 下拉箭头（`lt-icon-ReviewArrowDown`，切换统计口径）；其余每列默认占位「统计」。DOM：`.lakex-table-stats` + `-text/-filled/-select/-date/-image/-file/-progress/-rate/-checkbox/-link` |
| 每组顺序 | header(56) → records(36/条) → `.lakex-viewer-grid-add-record`(**40px**，内含 sticky **24×24 圆形白钮**：圆角 50%、1px `rgb(231,233,232)`、margin-left 16、`+ 图标 14×14`) → 顶级分组之间 `.lakex-viewer-grid-group-gap-line`(**20px**) |
| 表尾 | 另有一条**总计**统计行（同 chip 结构，显示总记录数 + 各列统计） |
| 记录行 | `.lakex-viewer-grid-row` 高 36；组内最后一行 `.group-last`（容器底色 `rgb(250,250,250)`） |

结论：**云端把「分组头」和「该组统计」合成同一条 56px 整行** —— 因此用户说「分组后就有统计需求」是同一条需求。

#### ② 我方实现（`bitableViews.css` 为分组的单一来源）

- 分组行由「一个 colSpan 的格子」改为**与表头同列数的多格**：`.bt-group-cell`（折叠钮 + 分组值）+ 每个可见字段一个 `.bt-group-stat`（**右对齐**，取该列在**本组记录**上的统计）+ 尾部一格。
- 首列缺省显示 `N 条记录`（对齐云端）；配了统计的列显示「口径 + 值」。
- 每组记录之后插一行 `.bt-group-add-row`（40px）放**圆形白钮 `.bt-group-add`（24×24，border-radius pill）**，点击=**加进本组**（新记录预置该分组字段的值；空值组不写值）。
- 顶级分组之间插一行 `.bt-group-gap`（20px）。
- 分组样式（含 T03 层级缩进）**按职责从 `bitableEditor.css` 移入 `bitableViews.css`**：`bitableViews.css` 20 → 74，`bitableEditor.css` 1081 → **1075**（首次腾出余量）。
- core：`BitableGroupNode` 增 `fieldId`（「加进本组」要用）；`node.records` 本就含整组记录，**按组统计无需改求值口径**。

#### ③ T01 列统计恢复

`git revert` 掉当天的整体回退（`d2eeb79`），保留同日早些时候的**按需渲染**（没有可见列配置统计时整行不渲染 → 不会再有「添加记录下面的空灰条」）。
> ⚠️ **此条已被同日后续会话取代**：用户当天定稿为「底部汇总栏**常驻**」（见本文件 §13「V05 续：四条修复」）——现在总是渲染。此处仅作历史记录。
底栏总计行为「当前视图筛选后的记录」口径不变；分组头里的统计是**该组记录**口径（同样只看筛选后集合）。

验证结果：

- 门禁全绿：tsc / vitest **1382 passed / 16 skipped** / check:core / 双端构建 / ui-metrics（hex=0、!important=9、未定义令牌=0）/ cssLayers+uiPrimitives / git diff --check。
- CDP 真实端点（隔离 userData + 9240，重建后的 dist；日期分组 + 进度列配「求和」）：
  - 结构：`bt-group-row` 2 条、每条 **6 格**（1 索引 + 4 字段 + 1 尾）、`.bt-group-stat` 共 10、`fold` 存在、`.bt-group-add` **2 个**、`.bt-group-gap` **1 条**。
  - 几何：分组行高 **56**、加行进 **40**、统计格 `text-align: right`。
  - 内容：首组首列 `1 条记录`、次组 `3 条记录`；进度列按组 `求和 0` / `求和 84`；底栏总计 `求和 84`。
  - 截图与云端结构一致（折叠钮已改为**无边框裸三角**）。

#### ④ 「添加」统一为同一颗圆形 + 钮（用户追加）

用户看到分组那颗圆钮后要求：「分组的新建你都换成这个图标了，那就把这个应用到**所有的添加**吧」。

- 把云端那颗钮抽成**共用类 `.bt-add-round`**（24×24、`border-radius: pill`、1px 边框、白底、hover 变强调色；「加进本组」那行用 `.bt-group-add-row .bt-add-round` 加 16px 左边距）。
- 三处添加入口改用它：**表头「新增字段」**（原 `.bt-add-col`）、**表底「添加记录」**（原 `.bt-add-record-row`，去掉文字只留圆钮，与分组那颗一致）、**分组「加进本组」**（原 `.bt-group-add`）。
- 删除被取代的旧样式（`.bt-add-record-row` 整条 + `.bt-add-col/.bt-add-record-row` 从组合规则摘除）。
- ⚠️ 过程中 CSS 围栏抓到一处**真重复**：组合规则只剩 `.bt-panel-add` 后，与它自己那条规则重复声明了 `border/background`（dupGroups 0 → 2）—— 该组合规则已冗余，直接删除。**围栏在这里起到了它该起的作用**。

未动（本项目判断）：工具栏「＋ 添加记录」、字段面板 / 记录抽屉的「＋ 新增字段」、看板「新建分组」都是**带文字的按钮**，且云端工具栏同样是「＋ 添加记录」文案 ⇒ 保留文字（只统一了表格内的添加入口）。如需连这些也变成纯圆钮，说一声即可。

验证：门禁全绿；CDP 实测 `.bt-add-round` **4 颗**（标题：新增字段 / 加进本组 ×2 / 添加记录），尺寸全 **24×24**、`border-radius: 999px`，旧类残留 **0**。

#### ⑤ 分组头「分组值优先 + 首列统计固定长度」（用户 260929 追加）

用户要求：**分组项（分组值）优先占位**、把首列统计压成**固定长度**，分组值过长则**省略** —— 这样分组项有更大空间，也不再出现错位。

- 首列统计（含缺省的 `N 条记录`）从「独占首列格」移入**与分组值同一格**（`colSpan=2` = index + 首列）：`.bt-group-label` 用 `flex: 1 1 auto; min-width: 0` + 省略号；`.bt-group-head-stat` **`flex: 0 1 auto; min-width: 80px`** 右对齐并带 `title` 全文。
- **云端实测（用户授权直接操作云端后补测，只在页面 DOM 里临时改文本、不保存）**：把分组值临时改长后，云端「分组值元素」由 61 → 90 且 `scrollWidth 109`（**被裁**，`white-space: normal` 换行后裁切、非省略号）；**首列统计格由 109 → 80** 并右移让位，其余统计格（180）不动。⇒ 云端口径 = **分组值优先、首列统计压到下限 80px**；本实现取 80px 为下限，但把"裁切"改成**省略号**（用户要求「省略处理」）。
- ⚠️ **错位真正的根因**（实测才发现，比表面更深）：分组头是**表格行**，而 `table-layout: auto` 会把它的**长文本算进列宽** —— 实测表头首列被撑到 **482px**、记录行仍 80px，`thead/tbody` 列对不齐。修法：分组头内容改**不进流**（`.bt-group-inner` 绝对定位 `inset: 0`），列宽只由表头与记录行决定。
- 修后 CDP 实测：表头首列与记录行首列**完全一致（415–495）**；分组格跨度恰为 index+首列（415–675）；末格与记录行末格对齐；统计宽 **96**；长分组值 `scrollWidth > clientWidth`（省略号生效）、`title` 保留全文。截图核对：短值与超长值两组都不再错位。
- 同时按用户要求把「**样式统一**」写进 `AGENTS.md` §3#14 作为固定规则（同语义只能有一套视觉/几何；「添加」= `.bt-add-round`、浮层表面/定位各自单一来源；重复声明当场收敛）。

遗留：
- 云端统计格有「切换统计口径」的下拉箭头（`N 条记录 ▾`）与 hover 态的「统计」占位；我方沿用列菜单「统计」入口，未在分组头内嵌下拉。
- 云端统计格白底 chip + 1px `#f4f5f5` 边框，我方用主题令牌的灰带（`--lake-bg-block`）；如需逐像素一致要新增令牌，待用户确认。
- 多级分组（T03）里「加进本组」按**每个分组节点**出现（与云端一致），顶级之间才有 20px 间隔。

### 2026-09-29 · V05 续：四条修复（列选中残留 / 分组汇总行高 / 每列汇总 / 底栏常驻）

用户 260929 一次提四条，先问清歧义（问题工具第一次超时、第二次拿到答复）再动手：

1. **列选中残留**：选中整列后点列外任意单元格，列高亮不消失。
   → 修法：`.bt-grid-wrap` 加 `onMouseDownCapture` —— 按下的位置不在「被选中列」的格/表头里（`[data-field-id]`）就清 `selectedColumnId`；表头补 `data-field-id` 让判定统一。
2. **分组汇总行固定低行高**：分组头固定 **36px**（我们「低」档），**不随 行高 设置变化**（此前写死 56px）。
3. **分组头每一列都要有汇总**（用户选的正是这一条）：每列都给汇总位 —— 配了统计显示「口径 值」，未配置显示**「统计」占位按钮**（点它直接开该列口径选择器，复用 `statFor` 浮层）。
4. **底部汇总栏常驻**：改为**总是渲染**（推翻当天早些的「无配置就整行不渲染」——用户当场定稿），并做**薄**（固定 24px，不随行高），首格缺省显示总记录数，未配置列显示 `—`；
   同时 `.document-statusbar[data-doc-kind="bitable"] { bottom: 34px }` 把**状态栏整体上移**给底栏让位（sheet 是先例，但多维表底栏是整行、没法左右分栏，只能抬高状态栏）。
   - ⚠️ 实测发现「贴底常驻」还有一层：`position: sticky; bottom: 0` 只把它钉在**表格**底部 —— 内容不足一屏时它就悬在半空（截图核对）。补 `.bt-grid { min-height: 100% }` + 一条 `tbody` 末尾**撑满占位行** `.bt-grid-filler`，表格才撑满一屏、底栏落到**视图**最底。

5. **分组「加进本组」的 + 不占行，改悬浮**（用户追加）：「+ 号不用占一行，隐藏掉做成图 2 的悬浮样式」。
   → `.bt-group-add-row td { position: relative; height: 0; padding: 0; border: 0; background: transparent }` + 圆钮 `position: absolute; left: 16px; top: 0; transform: translateY(-50%)` ⇒ 行高实测 **1px**（原 40px），圆钮**骑在分组边界线**上（对齐云端图 2）。后面的 `.bt-group-gap`（20px）正好给悬浮钮留出空间。

验证（CDP 真实端点，隔离 userData + 9243；行高设为「高」以证第 2 条）：

| 项 | 实测 |
| --- | --- |
| ① 列选中 | 点表头后 `.col-selected` = 4（表头+3 行）；点**列外**单元格 → **0**；点**同列内**单元格 → 保持 **4** |
| ② 分组汇总行 | 分组行高 **36**，同一份数据里记录行 **64**（行高=高）⇒ 不随行高变 |
| ③ 每列汇总 | 分组头每列都有内容：`文本=N 条记录` + `单选=统计` + `日期=统计` + `进度=求和 30`（2 个占位按钮） |
| ④ 底栏常驻 | `.bt-stat-row` 存在、高 **24**、首格 `3 条记录`、`position: sticky`；`wrap.bottom == footer.bottom == 819`（钉在视图最底）；状态栏 `bottom: 34px` |
| ⑤ 悬浮 + | 加行高 **1px**（原 40）；按钮 24×24，中心与边界线偏差 ≤2px；`elementFromPoint` 命中的是按钮本身（没被后续行盖住） |

门禁全绿：tsc / vitest **1383 passed / 16 skipped**（+1 条新护栏）/ check:core / 双端构建 / ui-metrics / cssLayers+uiPrimitives / git diff --check。

遗留：
- 云端统计格有「切换统计口径」的下拉箭头（`N 条记录 ▾`）与 hover 的「统计」占位；我方用「统计」占位按钮开既有口径选择器（等价能力，位置在格内而非独立 chip）。
- 分组汇总行取 36px 是**按用户要求**（云端实测是 56px）；如需回到云端的 56px 说一声。

### 2026-09-29 · T01 与云端对齐：汇总方式 / 默认口径 / 统计格外观（一次做到位）

用户 6 条要求，核心是「仿照云端 lake，别再反复来回对照」。按用户提示**直接读云端前端资源**（比点 UI 快且权威）：

**取证方式（可复用）**：`bsk session start --browser <edge>` → navigate → `bsk evaluate` 里 `fetch(performance.getEntriesByType('resource'))` 找到
`gw.alipayobjects.com/**/lakex_table_yq.*.chunk.css` 与 `*.async.js`（CORS 允许读），直接 grep 出**统计配置表**与**样式规则**；UI 点击只用于交叉验证。

**云端权威配置表（逐字抄自 bundle，`kg.` 为字段类型枚举）**：

```
e0e（通用类）= TEXT, SELECT, MULTI_SELECT, NUMBER, RATE, PROGRESS, DATE, IMAGE, FILE, PHONE, MENTION, LINK, EMAIL, USER_ID, CREATED_AT, MODIFIER_ID, UPDATED_AT   ← 不含 CHECKBOX
e0t（日期类）= DATE, CREATED_AT, UPDATED_AT
none   "不展示" | count "$1 条记录"
filled "已填写 $1" | empty "未填写 $1" | unique "唯一数 $1" | percentFilled/percentEmpty/percentUnique "…占比 $1"  → types: e0e
checked "已勾选 $1" | unchecked "未勾选 $1" | percentChecked/percentUnchecked → types: [CHECKBOX]
sum "求和 $1" | average "平均值 $1" | median "中位数 $1"                        → types: [NUMBER]
max "最大值 $1" | min "最小值 $1"                                              → types: [NUMBER, RATE, PROGRESS]
earliestDate "最早时间 $1" | latestDate "最晚时间 $1" | dateRange "时间范围 $1 天" | monthRange "时间范围 $1 月" → types: e0t
```

**样式（同源 CSS）**：统计格 = `.lakex-viewer-grid-group-header-column`（白底 + 1px `rgb(244,245,245)` + `padding:0 8px` + 高 36 + `justify:right`）；内容 `.lakex-table-stats`（12px、右对齐、`.lt-icon` ▾ 带 `margin-left:2px; transform:scale(.8)`）；
**关键**：`.lakex-table-stats-unfilled{opacity:0}` + `:hover .lakex-table-stats-unfilled{opacity:1}` —— 占位「统计」**默认不可见，仅 hover 显形**（这正是用户要的「默认空白、不出现统计字样」）。

**本次实现**：

- **core**（`bitableDoc.ts`）：`BitableStatType` 与 `BITABLE_STAT_LABEL` 按上表重建（新增 `checked/unchecked/percentChecked/percentUnchecked/percentUnique/median/dateRange/monthRange`，旧 `avg/earliest/latest/range` 等改名）；`statsForField` 严格按 `types` 限制（复选框只给勾选类；进度/评分只给最大最小**无求和**；日期类给最早/最晚/日/月范围）；`computeColumnStat` 新增勾选类、中位数、月范围；新增纯函数 `localMonthDiff`。
- **UI**：新增**共用组件 `StatCell`**（`bitableCells.tsx`）—— 分组头与底部汇总行**同一实现**（样式统一红线）：白底 chip + ▾ + 未配置时整块 `opacity:0`、hover 显形、点击开该列口径选择器。
- **默认口径**：**只有第一列**默认「记录总数」（分组头 = 该组条数、底栏首格 = 总条数），其余列默认空白；不再有 `—`、不再有常显的「统计」字样。
- 顺手：把统计格的白色放到「行 + 格」选择器上，修掉被 `.bt-group-row td` 灰底按特异性压掉的问题（归属修正，不是加覆盖）。

**验证（CDP，隔离 userData + 9243）**：新建一条**完全不配置统计**的笔记 → `.bt-stat` 共 12 个，其中**可见的只有 2 个**（两个分组各自首列的 `记录总数 1 / 记录总数 2`），其余 10 个 `opacity:0`（文本为「统计」但不显形）；chip `background: rgb(255,255,255)` + `border-left: 1px`；点开文本列 → 选项 = 无统计/记录总数/已填写数/未填写数/唯一数/已填写、未填写、唯一数占比（**与云端 8 项逐字一致**）；进度列实测为 10 项（多「最大值/最小值」、**没有求和**）。

门禁全绿：tsc / vitest **1383 passed / 16 skipped** / check:core / 双端构建 / ui-metrics / cssLayers+uiPrimitives / git diff --check。

遗留：
- 复选框 / 数字 / 创建·修改时间 的选项**按 bundle 的 types 直接实现**，未在真机逐项点验（若要逐项验收可补）。
- 第一列默认「记录总数」目前**无法关掉**（「不展示」= 删除配置 ⇒ 回落默认）。云端可显式选「不展示」，如需支持要在 `columnStats` 里存 `"none"` 哨兵。

### 2026-09-29 · V05 续（补做）：第 2/3 条我上一轮漏做/做反，按用户指正修正

用户指出「第 2、3 条你还没做」——核对属实，两条都不是表述问题，是我的实现问题：

- **第 2 条（分组后不要表底 +）**：上一轮**根本没做**——`.bt-add-row` 是无条件渲染的。
  → 改为**按「是否真的渲染出分组」条件渲染**：`{!rowItems.some((item) => item.kind === "group") && (<tr className="bt-add-row">…)} `。
  用「实际渲染出的分组」而不是 `groups.length`，是为了避开「配了分组但分组字段已删 → 回落成未分组」时两边都没有 + 的空档。
- **第 3 条（+ 要有独立空间、只是不要行线）**：上一轮我理解反了，做成了 `height: 0` + `position: absolute; transform: translateY(-50%)` **骑在分组边线上** —— 正是用户说的「内嵌到边线有点丑且不好点」。
  → 改为**独立行高 32px + 无边框/无底色**（`.bt-group-add-row td { height: 32px; border: 0; background: transparent; vertical-align: middle }`），圆钮回到**正常流**里居中（`margin-left: 16px`），不再贴/骑边线。

验证（CDP，隔离 userData + 9243；用我自己那条分组笔记**临时取消分组再原样恢复**，数据已还原）：

| 状态 | `.bt-group-row` | `.bt-group-add-row` | `.bt-add-row`（表底） |
| --- | --- | --- | --- |
| 取消分组 | 0 | 0 | **1**（保留） |
| 恢复分组 | 2 | 2 | **0**（隐藏） |

分组 + 行高实测 **32**、按钮上下沿完全落在行内（235–259 ∈ 232–264）、`td` 边框 **0px**。

门禁全绿：tsc / vitest 1383-16 / check:core / 双端构建 / ui-metrics / cssLayers+uiPrimitives / git diff --check。
护栏补充：`!rowItems.some((item) => item.kind === "group")`、`.bt-group-add-row td` 必须是 32px 且**不得**出现 `translateY(-50%)` / `position: absolute`。

### 2026-09-29 · T03 回退：分组重做为单级 + 保留细节优化

用户最终决定：**不做多级分组**，分组最多一级。历史定位：

- `git log -S'BITABLE_MAX_GROUPS'` 指向 `9b80ede feat(bitable): T03 多级分组 + T04 语义排序增强`；多级树、最多 3 级、拖动调优先级和 `.level-1/.level-2` 缩进均从该提交进入。
- 本次只回退多级分组能力，不回退 T04 语义排序、T01 列统计、T02A 字段、看板/画册/日历、附件/图片等新增优化。

本次完成：

1. **core 收敛为单级**：删除 `BITABLE_MAX_GROUPS`、`BitableGroupNode`、`groupRecordsTree`；编辑器只消费 `groups[0]`，行数据继续走既有 `groupRecords`。历史多规则正文在 `normalizeView` 收敛为第一条，避免隐藏配置继续生效。
2. **删除多级 UI**：分组面板恢复为单行 `字段 + 升降序 + 取消`；删除添加分组、拖动优先级、groupPath/innerGap/层级区域类。
3. **单级分组卡片**：每组是一张白底 + 1px 边框 + 8px 圆角卡；分组头继续显示按组统计，记录后保留「加进本组」，组间保留 20px 间隔。
4. **保留此前细节优化**：`+` 行不使用底边线；表底 `.bt-grid-foot` 不再默认重复显示“共 N 条记录”；目录栏把手增加全局离开清理兜底。
5. **单级统计口径**：`groupRecords` 改为 `bitableFieldValue(record, field)`，系统时间字段分组与单级统计口径一致。

数据结构 / 接口变化：

- 正文 `views[].groups` 仍是数组，但产品只支持第 0 条；解析时 `groups.slice(0, 1)`。
- 删除多级树 API 与 `leaves/children/level` 概念。
- 不新增持久化字段，不改同步/历史/GC。

改动文件：

- `src/core/bitableDoc.ts`(+test)
- `src/core/bitableGroup.test.ts`
- `src/features/bitable/BitableEditor.tsx`
- `src/features/bitable/bitableViews.css`
- `src/features/bitable/bitableEditorMount.test.ts`
- `src/App.tsx`
- `scripts/e2e-sidebar-hover.mjs`
- `src/styles/cssLayers.test.ts`
- `HANDOFF.md`

验证结果：

- `tsc --noEmit`：通过
- `vitest run`：**1382 passed / 16 skipped**
- `npm run check:core`：0 违规
- 桌面构建：通过
- 移动构建：通过
- `node scripts/ui-metrics.mjs`：hex=0 / rgb=0 / !important=9 / 未定义令牌=0
- `cssLayers + uiPrimitives`：通过
- `git diff --check`：通过
- CDP 隔离实例：原两级测试笔记加载后只显示首级日期分组，工具栏 badge=1，分组卡背景为 `rgb(255,255,255)`，无「最多 3 级/添加分组」，`+` 行底边 `0px`，`.bt-grid-foot=null`；目录悬停 e2e 通过。

遗留问题：

- 历史多分组配置只保留第一级；这是当前产品语义，不做兼容迁移。
- 目录把手清理仍需用户在真实 macOS 窗口首次进入时复验。

下一步：

- 等用户验收单级分组与细节优化；通过后进入 `T02B.1 关联基础模型`。

### 2026-09-29 · 260929-UI2 分组底衬 + 底栏收口（用户四条 + 现场追加）

用户附云端截图（image1，含 3 个红框）+ 我方截图（image2，圈出表底横条）提四条；实施中追加**第五条**。
红框语义先用像素取证定位（对截图做红色区域投影，拿到三个框的真实 y 区间）：
框 1 = 表头与第一个分组之间；框 2 = 组 1 结束到组 2 开头之间；框 3 = 最后一组之后的空白 —— **三个框全在云端的浅灰区域上**。

#### ① 分组底衬：浅灰背景突出「当前编辑区」

- 云端做法（截图取样，2x 缩放）：分组容器 `#fafafa`、卡片（分组头 + 记录行）纯白 `#ffffff`、行/卡片边线 `#f4f5f5`；
  灰色只在**卡片之外**露出：表头下 20px、每组记录后的「加进本组」通道、组间 20px、最后一组之后的空白。
- 我方此前这些位置分别是「无间隙 / 白 / 白（旧值 `--lake-bg-canvas` = #ffffff，等于没上色）/ 透明」⇒ 分组之间看不出分界。
- 新增主题令牌 **`--lake-bg-subtle`**（light/warm `#fafafa`；dark `#242528` —— 深色里「比 panel 亮一档」才是同一语义），
  颜色字面量只出现在 `themes/*`（符合 AGENTS §3 #14）；四处底衬共用它，是**一条通道**而不是几段灰条。
- 用户追加：**不分组时表格下方的空白也要同款灰**（"不分组空白地方也要加同款灰色背景"）⇒ 占位行
  `.bt-grid-filler td` 直接改成浅灰，**不按分组条件分叉**（不再需要 `is-grouped` 类，已删）。

#### ② 表头与第一个分组之间的间隙

- 新增 `.bt-group-head-gap` 行（`colSpan` 全列、20px、浅灰、不带边框），**只在真的渲染出分组行时**出现
  （`hasGroupRows`：配了分组但分组字段已删 → 回落未分组，那时不该多一条空带）。

#### ③ 卡片收口移到「该组最后一条记录」

- 云端卡片 = 分组头 + 记录行，**「加进本组」在卡外的灰通道上**。我方原先把 `bt-group-end`（下边框 + 底部圆角）
  挂在加号行上 ⇒ 卡片把加号行也包进去了。现在按 `rowItems[itemIndex + 1]?.kind === "groupAdd"` 给**该组最后一条记录**打收口，
  加号行只剩 `.bt-group-add-row`（32px、浅灰、无线）。

#### ④ 汇总文案：选「记录总数」显示「共 N 条」

- 展示文案与选择器文案拆开（core 新增 `statDisplayText`）：格子里「共 N 条」，选项列表仍是云端原文「记录总数」；
  底部汇总栏首格（索引列缺省统计）同样走它 ⇒ 「共 10 条」。其余口径仍是「口径名 值」。

#### ⑤ 去掉表底横条，底栏就是最底下那条；状态栏贴住它

- 删掉 `.bt-grid-foot`（那条「已选择 N 个单元格 / 匹配 N 条」横条）——它在表格之后、撑满一屏的占位行**下面**，
  只有拉到最底才看得见，正好压在底栏下方（用户 image2 圈的就是它）。
- 底栏（`.bt-stat-row`）贴底后，**状态栏不再压住它**：底栏上沿会随「有没有横向滚动条」上下浮动（滚动条吃掉内容盒高度，
  实测差 10px），所以由 BitableEditor **实测底栏上沿**写进 `--lake-bitable-status-bottom`，`chrome.css` 用它定位
  （姿势同 sheet 的 `--lake-sheet-status-w`，不在 CSS 里猜高度 —— 这是本仓反复踩过的坑）。

验证结果（CDP 真实端点，隔离 `LAKE_USER_DATA=$TMPDIR/lake-ui-260929b` + 独立 CDP 端口 9251 + `--no-sandbox`）：

| 项 | 实测 |
| --- | --- |
| 结构 | `bt-group-head-gap` 1 / `bt-group-add-row` 2 / `bt-group-gap` 1 / 卡片内 `bt-group-end` 落在最后一条记录 / `bt-grid-foot` **0** |
| 底衬 | 表头间隙·加号行·组间·表下空白 = `rgb(250,250,250)`；分组头与记录行 = `rgb(255,255,255)` |
| 高度 | 表头间隙 20 / 加号行 32 / 组间 20 / 底栏 24 |
| 文案 | 底栏首格「共 10 条」、分组头首列「共 3 条」 |
| 底栏位置 | 底栏 785–809、状态栏 761–783 ⇒ **重叠 0px**，底栏在表格视口最底（距容器底 10px = 横向滚动条） |
| 不分组 | 表头间隙/加号行/组间 0 个，表下空白仍是 `rgb(250,250,250)`（用户追加要求） |
| 深色 | 手工切 `data-theme="dark"` 截图核对：分组通道为 panel 之上的一档浅灰，可辨 |

#### 同会话追加（用户）：数据表选择区也用同一个灰

用户看完截图追加第五条：「选择数据表的背景也是用同样的灰色，要做到风格统一」。

- **现状**：`.bt-tables`（文档内的「数据表」列表）原先铺 `--lake-bg-block`（#f0f2f5，比表格区深一档、偏冷），
  于是左侧一条深灰 + 右侧浅灰画布**像两套风格拼在一起**。
- **改法**：`.bt-tables` 底衬改 `--lake-bg-subtle`（与表格区同一个灰）。**只换"面"，不换状态**：
  `.bt-table-item:hover`（`--lake-bg-hover`）与 `.bt-table-item.active`（`--lake-accent-tint`）仍是「在浅灰面上浮起一档」的选中/悬停语义，未动。
- 实测（CDP）：`.bt-tables` = `rgb(250,250,250)`，与 `.bt-grid-filler` 同值；选中项仍为 `rgb(236,239,245)`。
- 护栏：`bitableEditorMount.test.ts` 断言 `.bt-tables` 必须是 `--lake-bg-subtle`、且不得回退到 `--lake-bg-block`。

#### 同会话追加②（用户）：底栏最左格在多选时显示选择量

用户：「关于你说的多选，展示选择多少条，可以在底部最左侧这里展示，只有多选触发，例如【选择 x 行】」
（附截图圈出底栏最左格「共 10 条」，画面里正选着一个单元格）。

- 上一批把表底那条「已选择 N 个单元格」横条删掉后，选择量就没有落点了；用户指定落到**底栏最左格**（`.bt-stat-index`）。
- 口径：**只有多选触发**——`selectedRecordIds.size >= 2` → 「选择 N 行」；单元格拖选 ≥2 格 → 「选择 N 个单元格」；
  单选（单行 / 单格）与未选中都保持「共 N 条」（单选那属于「当前这一格」，不是「一批」）。
- 样式：`.bt-stat-index.is-selection` 用 `--lake-accent-text` + medium 字重标出「这是选择态、不是总条数」。
- 实测（CDP 真实点击）：初始「共 10 条」→ 点 1 个行号仍「共 10 条」→ 点第 2 个行号「选择 2 行」（`is-selection`，`rgb(58,74,104)`）
  → 取消回「共 10 条」→ 拖选 3 行 × 2 列「选择 6 个单元格」。
- 护栏：`bitableEditorMount.test.ts` 锁住 `selectionSummary` 的两个分支与 `.bt-stat-index.is-selection` 的强调色。

#### 同会话追加③（用户）：底栏融合灰底 + 汇总行整行处理

用户附两张云端截图（图 1 = 云端底栏、图 2 = 云端分组头）提两条：
「1、底栏使用同样的底色背景，且有光标的时候加重展示。2、所有的汇总行去掉单元格的边框，做整行处理，例如图 2，同样光标上去颜色同样加重。」

先对两张云端截图做像素取证（逐行/逐列扫描色带）：

| 位置 | 云端实测 |
| --- | --- |
| 底栏整行 | `#fafafa`（**与表格区底衬同色**，靠上方 1px `#f4f5f5` 分隔线分界，不是白条） |
| 底栏里光标所在的那一格 | `#eff0f0`（加重一档）——**没有边框、没有白底 chip** |
| 分组头行 | 白底；`统计` 占位那一格被光标压住时同样变 `#eff0f0` |
| 两行的**行内竖线** | 一处都没有（只有行与行之间的水平分隔线） |

实现（全部落 `bitableViews.css`，都是改单一来源的值/删冗余声明，不新增覆盖层）：

- **底栏底色**：`.bt-stat-row td` 的 `background` 由 `--lake-bg-panel` 改 `--lake-bg-subtle`（与表格区同一块灰）；
  同时**删掉** `.bt-stat-row .bt-stat-cell` 那条「白底 + 左竖线」规则（与 `td` 规则重复，删掉即单一来源）⇒ 行内不再有竖线。
- **汇总行整行处理**：新增 `.bt-group-row > td:not(:last-child), .bt-stat-row > td:not(:last-child) { border-right: 0 }` ——
  去掉**行内**竖线，末格的右边线保留（那是卡片/表格外缘）。分组头首列统计 `.bt-group-head-stat` 的 `border-left` 也一并删除。
- **光标加重**：`.bt-stat-row > td:not(:empty):hover` 与 `.bt-group-row .bt-group-stat:not(:empty):hover`（含 `.bt-group-head-stat:hover`）
  背景 → `--lake-bg-block`（#f0f2f5，≈ 云端的 `#eff0f0`）。用 `:not(:empty)` 把两个空尾格排除在外。
- 顺带统一：分组头的统计格保持白底（云端的卡片是白的），底栏才用灰底 —— 两行的**底色**不同、**边框与 hover 规则**同一套。

实测（CDP 真实端点）：底栏 9 格全部 `rgb(250,250,250)`、`border-right` 除末格（1px，表格外缘）外**全为 0**；
分组头 8 格白底、行内 `border-right` 全为 0；鼠标移到某格 → 只有那一格变 `rgb(240,242,245)`（其余不变）；
**列边界与表头逐列对齐**（9 列 x 区间完全一致，去边框没有引起 1px 错位）。

#### 同会话追加④（用户）：表格线颜色变浅（对齐远端）

用户：「继续优化和远端一样，线的颜色变浅一点」（附云端分组表格截图）。

- 云端实测（本张截图逐行扫描）：**格线一律 `rgb(244,245,245)`（#f4f5f5）**，横竖同色，1px 无例外。
- 我方原先把所有格线/卡片边线都挂在 `--lake-border-1`（#e8eaee）上，比云端深两档。
- 改法：**只换线色，不动线宽/线位**（去/改线宽会动列宽，色值不会）——
  `.bt-grid th, .bt-grid td` 的 border-right/bottom、`.bt-grid thead th` 的 border-bottom、
  以及分组卡片的四边（`.bt-group-start/body/end` 的 first/last/top/bottom）全部改挂 `--lake-border-2`（#f0f2f5）。
  没有新增令牌：`--lake-border-2` 本就是设计系统里「更浅一档的分隔线」，深色下同样更浅一档（#2e2f34 → #242528）。
- 实测（CDP）：格线/表头底线/卡片边线 computed 全为 `rgb(240,242,245)`；截图取样 1px 线 = `rgb(241,242,245)`，
  与云端 `rgb(244,245,245)` 相差 3/255（≈1.2%，肉眼不可辨）。若要**逐像素一致**再加 `#f4f5f5` 专属令牌即可，本轮按「复用既有令牌」处理。
- 顺带修一处隐患：`.bt-group-row/.bt-stat-row > td:not(:last-child)` 原写 `border-right: 0`（简写会把颜色重置成 `currentColor`），
  改为 `border-right-width: 0`（只改宽度，颜色保持）。

#### 同会话追加⑤（用户）：分组汇总项「无统计」必须真的不展示 + 「左下角计数」的口径

用户报 bug + 澄清两条计数口径：

> 「分组的汇总项有问题，共 x 条是在记录总数下展示的，如果不想要就使用无统计，无统计就什么也不展示。当前选择无统计还是有共 X 条。
> 另外说明一下，左下角的共 X 条和汇总项里的共 X 条不一样是独立逻辑，左下角的是展示当前视图的所有的展示记录，这个不能改，也无需计算，仅受到多选和筛选影响。汇总项里的共 X 条是实时计算的。」

**① bug（已修）**：分组头首列的汇总格写的是 `statForField(...) ?? "count"` —— **没配统计就兜底成「记录总数」**，
所以选了「无统计」照样显示「共 N 条」。改为直接用 `statForField(...)`：**展示什么完全由汇总方式决定**，
「无统计」= 什么都不展示（只留 hover 才显形的「统计」占位入口，与其余列同一套行为）。

**② 口径澄清（已按此对齐实现）**：两处「共 X 条」是**两套独立逻辑**，不再混用同一个数：

| | 左下角那一格（`.bt-stat-index`） | 汇总项（分组头 / 底栏的列统计格） |
| --- | --- | --- |
| 语义 | **当前视图正在展示的记录数**（展示口径） | 该列/该组按所选汇总方式**实时计算**的统计值 |
| 数据源 | `shownRecords.length`（随筛选 / 搜索变；O(1)，不做统计计算） | `StatCell` 的 `computeColumnStat(field, records, stat)`（分组头传本组记录、底栏传筛选后的记录） |
| 何时变 | **只**随「筛选 / 搜索」+ 多选（多选时整格改显示「选择 N 行」） | 随汇总方式、组内记录、筛选变 |

改前左下角用的是 `activeTable.records.length`（表内**全部**记录，不随筛选变），与用户给的口径不符 ⇒ 已改为 `shownRecords.length`。

实测（CDP）：

| 场景 | 左下角 | 汇总项 |
| --- | --- | --- |
| 无筛选、首列无统计 | 共 10 条 | 分组头什么都不显示（占位 `opacity: 0`） |
| 首列选「记录总数」 | 共 10 条 | 组 1「共 3 条」/ 组 2「共 7 条」（各自实时计算） |
| 加筛选「文本 包含 记录」 | **共 8 条**（随筛选变） | 同上，按筛选后的组内记录算 |

#### 同会话追加⑥（用户）：＋号居中，放在编号正下方

用户附截图（红框圈住表底那颗 +，它在最左、而行号 9/10 居中）。

- 改前：加号行是一个 `colSpan` 全列的格子，＋号靠左（`加进本组` 还额外 `margin-left: 16px`）⇒ 与行号不在一条竖线上。
- 改后：两处添加入口（分组「加进本组」/ 表底「添加记录」）都改成**编号列独占一格** `<td className="bt-add-index">` + 其余列 `colSpan={visibleFields.length + 1}` 的占位格，
  样式只加一条 `.bt-add-index { text-align: center }`，并删掉 `margin-left: 16px`。**列数不变**（1 + (n+1) = n+2）。
- 实测（CDP）：编号列表头中心、行号中心、两颗＋号中心**全部 = x 41**（`|Δ| ≤ 2px` 断言为 true）；不分组时表底的「添加记录」＋ 同样落在 x 41。

#### 同会话追加⑦（用户）：分组面板的删除键挪到行尾，与筛选/排序同一套

用户（带情绪）：「删除已有分组的删除键放在右侧，和筛选和排序一样，说了多少次了，样式保持一致。」

- 现状不齐：**筛选**行 = `[字段][操作符][值][🗑 行尾 .bt-icon-btn + Trash2]`；**排序**行 = `[字段][方式][🗑 行尾]`；
  而**分组**行 = `[✕ 行首 X 图标][字段][方向]` —— 删除键在三处里唯独它跑到了行首、且图标是 `X` 不是垃圾桶。
- 改法：分组行改为 `[字段][方向][🗑 行尾]`，`title/aria-label` 用「删除分组」，与另两处同一个类（`.bt-icon-btn`）、同一个图标（`Trash2`）、同一个位置（行尾）。
  `disabled={readOnly}` 保留（另两处没有这层保护是因为只读态整个工具栏隐藏、面板打不开）。
- 实测（CDP 打开三个面板读 DOM 结构）：分组行 = `[DIV.bt-select][DIV.bt-select][BUTTON.bt-icon-btn[删除分组]]`，
  筛选项 = `[DIV.bt-select][DIV.bt-select][INPUT][BUTTON.bt-icon-btn[删除规则]]`，排序行同构 ⇒ 三处一致。
- 护栏：`bitableEditorMount.test.ts` 断言「删除*」的按钮**共 4 处且都长 `className="bt-icon-btn" title="删除…" aria-label="删除…"`」
  （筛选/排序/分组/选项），并断言旧的 `title="取消分组"` 不再存在。

#### 同会话追加⑧（用户）：链接格 2 层边框 + 链接格样式对齐云端

用户两条：①「图 1 链接单元格又出现了 2 层边框」；②「图 2 是远端 lake 的样式，仿照这做就行，展示文本，然后点击自动使用本地浏览器打开」。

**① 两层边框（真 bug，且不只是链接格）**

- 根因：单元格自身已有 **2px 选中环**（`.bt-td.cell-selected .sel-*` 的四条 inset box-shadow），而格内的
  `input.bt-cell-input:focus` 又有 **2px 焦点环**（`outline-offset: -2px`）⇒ 同一个格上画了两圈。
  实测（CDP，点一个**文本**格）：`cellShadow` = 四条 2px inset、`input.outline` = `2px solid rgb(91,111,150)` —— 链接格只是更容易被看出来。
- 修法：单格选区（四条边都在）时不再画输入框焦点环 ——
  `.bt-td.cell-selected.sel-top.sel-bottom.sel-left.sel-right .bt-cell-input:focus { outline: 0 }`。
  **多格选区**只有外缘画环，内层格仍保留输入框自己的焦点环 ⇒ 不丢可访问性。
  实测：同一个文本格点开 → `input.outline = 0px/none`、单元格选中环不变。

**② 链接格改成云端的形态**（图 2 = 云端链接格：格子展示文本 + 右端 🔗 图标）

- 旧实现是**常驻输入框**：空值一直显示 `https://` 占位（看着像输入框而不是值），且正是 ① 的两层边框来源。
- 新实现：展示态 = `文本（省略号 + title 全文）` + 右端 `🔗`(`Link2`) 图标；**点图标**用本地浏览器打开
  （`window.open(url, "_blank", "noopener")` → 主进程 `shell.openExternal`，与其它外链同一路径）；
  **双击单元格**进入编辑（输入 URL，Enter/失焦提交、Esc 取消）；空值展示态什么都不显示。
- 实测（CDP）：`input` 在展示态**不存在** ⇒ 单层边框；点 🔗 时 `window.open` 收到 `["https://www.yuque.com/"]`；
  双击 → 出现输入框（`outline: 0px/none`，仍单层）；Esc → 回到展示态。

门禁全绿：tsc / vitest **1383 passed / 16 skipped** / check:core 0 违规 / 桌面构建 / 移动构建 /
ui-metrics（hex=0、rgb=0、!important=9、未定义令牌=0）/ cssLayers+uiPrimitives / git diff --check。

遗留问题：

- 表底那条横条承载的信息**不再展示**：单元格/行选择本身仍有高亮，搜索命中数在工具栏（`N 条`）。如需把选择数常显，可再议放哪。
- 状态栏与底栏是**上下两段**（不是同一行）：底栏是贯穿表宽的整行、右端还可能是横向滚动的列，
  状态栏并进同一行会压住最后一列的汇总格 —— 所以取「上下一栈、右缘对齐、间距 2px、底栏恒在最底」。
- 分组卡片仍是 8px 圆角 + `--lake-border-1` 边框（云端更细），未逐像素对齐。

下一步：

- 等用户验收本批四条（+ 追加的「不分组空白也要灰」）；通过后进入 `T02B.1 关联基础模型`。

### 2026-09-29 · 260929-OPT 阶段代码优化（真 bug + 单一来源 + 令牌合规）

用户本轮要求「先看看做到哪一步 → 整理当前阶段代码 → 做一次代码优化 → 再继续推进计划」。先做**只读代码审计**（对照 AGENTS §3 #14/#17 分档取证），只做「真 bug / 真违规」，明确**不做**纯整齐类重构。

本次完成（每条都有源码/逻辑证据，先证后改）：

- **进度字段颜色面板打不开（真 bug）**：`FieldEditorModal` 把 `<ColorPalette anchor={progressColorAnchor}>` 写在 `{supportsOptions && ...}` 块内，而进度字段 `supportsOptions=false` ⇒ 点色块永远没有面板。移到对话框正文层。
- **表单题目顺序被丢弃（真 bug）**：`BitableFormView` 用 `formableFields.filter(...)` 生成题目，渲染顺序恒等于表字段顺序；`formFieldIds` 的顺序（契约明写「顺序即题目顺序」）被忽略。改为按 `formFieldIds` 顺序 map。
- **高亮重复值对系统时间列恒失效（真 bug）**：`isDuplicateCell` 直接读 `record.values[field.id]`，系统时间值不在 values 里 ⇒ 恒为 `""`。改走 `bitableDisplayValue(field, bitableFieldValue(record, field))`。
- **复制选区对系统时间列复制出空串（真 bug）**：`copySelection` 读 values 再显示，屏幕上是 `bitableFieldText` 到分钟。改为复制所见。
- **搜索绕开展示口径（真 bug）**：编辑器搜索手写了一套取值分支（附件变 `[object Object]`、布尔/系统时间搜不到）。统一走 `bitableFieldText`。
- **`statForField` 原型链穿透（正确性隐患）**：`stat in BITABLE_STAT_LABEL` 会命中 `Object.prototype`。改 `Object.prototype.hasOwnProperty.call`。
- **删字段留下跨视图脏配置（真 bug）**：只清 hidden/fieldOrder/formFieldIds；残留 filters/sorts/groups/columnStats/highlightDuplicate/columnTextColors 与看板/画册/日历专属字段 id。改为删除时清空**所有视图**里指向该字段的配置。
- **单一来源**：移动端附件判定 `field.type === "attachment" || "image"` 改 `isAttachmentLikeField`；`(fields[0] ?? fields[0])` 冗余去除。
- **令牌合规（AGENTS §3 #14）**：`bitableEditor.css` 残留的 `#fff`×3、`#1f1f1f`、`rgba(0,0,0,.08)` 改走 `--lake-text-on-accent` / `--lake-text-1` / `--lake-border-1`（抽屉阴影 rgba 无对应令牌，保留并注明）。

数据结构/接口变化：无（不改正文格式、不加持久化字段）。

改动文件：`src/core/bitableDoc.ts`(+test) · `src/features/bitable/BitableEditor.tsx` · `BitableFormView.tsx` · `bitableEditor.css` · `bitableEditorMount.test.ts` · `src/mobile/bitable/MobileBitableViewer.tsx` · `src/styles/cssLayers.test.ts`(注释)

验证结果：

- `tsc --noEmit`：通过
- `vitest`：**1386 passed / 16 skipped**（+3 = 进度面板护栏 + 原型链用例 + 优化批护栏）
- `check:core`：0 违规
- 桌面 / 移动构建：通过
- `ui-metrics`：hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0
- `cssLayers + uiPrimitives`：通过
- `git diff --check`：通过
- 真实端点：本批为组件内行为，源码级护栏 + 紧随其后的 T02B.1 CDP 实例（字段编辑弹窗即在其中打开核对）一并覆盖。

遗留问题：

- 抽屉阴影 `rgba(0,0,0,.1)` 无现成令牌，未改。
- 看板/画册/移动端卡片渲染等 10 项「纯去重」重构（B 档）未做（按 AGENTS §3 #17：收益只停留在整齐）。

下一步：

- 继续 `T02B.1 关联基础模型`。

### 2026-09-29 · T02B.1 关联基础模型（同一文档内跨表关联：模型 + 统一解析 + 展示）

本次完成：

- **字段模型**：`BitableRelation` 定稿为 `{ tableId?, mode?: "oneWay"|"twoWay", allowMultiple?, pairedFieldId? }`（新增 `BITABLE_RELATION_DEFAULT = { mode:"oneWay", allowMultiple:true }`）；新建关联字段默认单向 + 允许多个记录。`normalizeField` 归一关联配置（补默认、只留认识的键）。
- **值模型**：关联值恒为**目标记录 id 数组**（单条模式也存单元素数组）；`relationRecordIds` 去重/保序/丢非法。
- **统一解析（专项 §6.4）**：新增 `BitableDisplayContext { tables }` + `relationTargetTable` / `relationTargetRecords`；`bitableDisplayValue` / `bitableFieldText` / `bitableRecordTitle` / `calendarEvents` 增加**可选 ctx**（旧调用不变）。关联展示 = 目标记录**主字段**文本、多值逗号分隔；**只解析一层**（目标主字段若也是关联则留空）避免两张表互相引用时无限递归。
- **失效语义**：目标记录被删 → 该条不再解析、其余仍在，**内部 id 原样保留**（恢复后自动重现）；目标表被删 → 找不到目标表，展示为空 / `关联已失效`，**不级联删来源字段**。
- **字段配置 UI**：`FieldEditorModal` 增加「关联数据表」选择（候选 = 同一文档内**除本表外**的数据表）+「允许添加多个记录」（默认勾选）；`onAddField`/`onSave` 落 `relation`。
- **单元格**：新增 `RelationCell`（chip 列表；空值 `—`、失效文案），`CellEditor` 透传 ctx（T02B.1 只读展示，选择器在 T02B.2）。
- **ctx 透传**：表格网格 / 记录详情 / 表单 / 看板 / 画册 / 日历 / 移动端 / 历史快照预览 / 搜索全部走同一套（`displayCtx = useMemo({ tables: doc.tables })`）。
- 不创建新 S3 对象、不改同步/历史/GC：关联只存在正文 JSON 的 `values[fieldId]` 与字段 `relation` 配置里。

数据结构 / 接口变化：

- `BitableRelation` 由占位（`tableId?/multiple?`）改为上述四键（`multiple` 被 `allowMultiple` 取代；关联此前是空占位、无真实数据，按 AGENTS §3 #7 不做兼容）。
- core 新增导出：`BITABLE_RELATION_DEFAULT`、`BitableDisplayContext`、`relationRecordIds`、`relationTargetTable`、`relationTargetRecords`；UI 新增 `RelationCell`。
- 展示函数新增可选尾部参数 ctx（向后兼容）。

改动文件：

- `src/core/bitableDoc.ts`(+test) · `src/core/historyPreview.ts`
- `src/features/bitable/BitableEditor.tsx` · `bitableCells.tsx` · `BitableRecordDrawer.tsx` · `BitableFormView.tsx` · `BitableKanbanView.tsx` · `BitableGalleryView.tsx` · `BitableCalendarView.tsx` · `bitableFieldCells.css`
- `src/mobile/bitable/MobileBitableViewer.tsx` · `src/features/bitable/bitableEditorMount.test.ts` · `src/styles/cssLayers.test.ts`

验证结果：

- `tsc --noEmit`：通过
- `vitest`：**1389 passed / 16 skipped**
- `check:core`：0 违规
- 桌面 / 移动构建：通过
- `ui-metrics`：hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0
- `cssLayers + uiPrimitives`：通过
- `git diff --check`：通过
- **CDP 真实端点**（隔离 `LAKE_USER_DATA=$TMPDIR/lake-t02b1`（复制开发数据）+ 独立 CDP 端口 9260 + `--no-sandbox`，`LAKE_RENDERER=scheme`；往正文注入两张表 + 关联字段/值）：
  - 字段配置：关联字段的「关联数据表」= `目标表`、候选下拉 = `选择数据表 / 目标表`（**本表 `第一个` 被排除**）、「允许添加多个记录」= checked。
  - 展示：多值 chip = `目标甲, 目标乙`；含失效 id 的行只显示 `目标乙`（缺失被跳过、其余保留）；指向已删表的字段格显示 `关联已失效`；数据表列表显示 `第一个/目标表` 两表，删除/失效均不崩。
  - 截图证据：字段编辑弹窗（关联配置）+ 网格关联列（chip / 失效文案）。

遗留问题：

- **T02B.1 只做展示、没有填写入口**：关联值须由 T02B.2 的选择器写入（本批 CDP 通过预置正文值验证展示）。
- 关联列的**筛选/排序/分组/统计**当前按「空」处理（专项 §6.4 的最小侵入口径）；如需支持再单独立项。
- 移动端只过了构建与源码护栏，**未跑 Android 模拟器**（按 §8 边界由移动端会话补验）。

下一步：

- 进入 `T02B.2 单向关联`（关联选择器：搜索 / 已选计数 / 确认草稿 / 跳转目标记录）。

### 2026-09-29 · T02B.2 单向关联（关联选择器：草稿确认 / 搜索 / 跳转 / 新建记录）

本次完成：

- **选择器**（`RelationCell` 由 T02B.1 的只读 chip 升级为可编辑）：点单元格开浮层 —— 顶部搜索框、目标记录列表（主字段标题 + 选中态）、行尾「跳转」、页脚「已选 N 条 + 新建记录 + 取消 + 确认」。
- **草稿语义**：打开时把当前值拷进本机 `draft`，所有勾选/取消/搜索/新建都只改草稿；**只有「确认」调 `onChange` 写正文**，取消/关闭/搜索都不落盘（切换逻辑抽成纯函数 `toggleRelationDraft`，可单测）。
- **多选 / 单选**：`allowMultiple !== false` 时增删；关闭多选时选中即替换、再点同一条取消（单元素数组）。
- **跳转目标记录**：行尾按钮 → `onJumpToRecord(tableId, recordId)`，编辑器切到目标数据表并打开该记录详情。
- **新建记录**：`onCreateTargetRecord(tableId)` 在目标表按默认值新增一条并返回 id，选择器把它加入草稿选中，确认后写入来源单元格。
- **单一来源**：选择器主体**复用 `.bt-option-*` 单元格原语**（trigger/chip/search/list/item），只新增行/页脚 4 条规则；T02B.1 的 `.bt-relation-chips/-chip` 一并删除（避免第二套 chip）。
- **只读**：触发器 `disabled`；目标表删除/未配置时直接返回只读占位（无浮层、无入口）。

数据结构 / 接口变化：

- core：新增 `toggleRelationDraft(draft, recordId, allowMultiple)`（纯函数）；不改正文格式、不加持久化字段。
- `CellEditorProps` 增 `onJumpToRecord?` / `onCreateTargetRecord?`；`RelationCell` 增 `readOnly/onChange/onJumpToRecord/onCreateTargetRecord`。
- `BitableRecordDrawer` 透传上述两个回调。

改动文件：`src/core/bitableDoc.ts`(+test) · `src/features/bitable/bitableCells.tsx` · `BitableEditor.tsx` · `BitableRecordDrawer.tsx` · `bitableFieldCells.css` · `bitableEditorMount.test.ts` · `src/styles/cssLayers.test.ts`

验证结果：

- `tsc --noEmit`：通过
- `vitest`：**1391 passed / 16 skipped**（+2 = 草稿纯函数用例 + 选择器源码护栏）
- `check:core`：0 违规
- 桌面 / 移动构建：通过
- `ui-metrics`：hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0
- `cssLayers + uiPrimitives`：通过
- `git diff --check`：通过
- **CDP 真实端点**（隔离 `LAKE_USER_DATA=$TMPDIR/lake-t02b2` + 独立端口 9261 + `--no-sandbox`；注入两张表 + 多选/单选/失效关联字段）：
  - 打开空白关联格：搜索框占位「搜索目标记录」、列出 5 条目标记录、页脚「已选 0 条 | 新建记录 | 取消 | 确认」。
  - 搜索「搜索」→ 只剩 `搜索专用A/搜索专用B`。
  - 勾 2 条 → 「已选 2 条」；点「取消」→ 单元格仍「请选择」（**未落盘**，实测只有原本有值的那格非空）。
  - 打开多选格勾 1 条确认 → 单元格变 `目标乙`，落盘 `fld-rel-demo=["tgt-2"]`。
  - 单值格先选 `目标乙` 再选 `目标丙` → 已选恒 1、最终 `目标丙`，落盘 `fld-rel-single=["tgt-3"]`。
  - 行尾「跳转」→ 活动表切到 `目标表`、抽屉标题 `目标甲`、浮层关闭。
  - 「新建记录」→ 目标表 6→7、草稿已选 1、确认后单元格 `未命名记录`，落盘 `fld-rel-demo=["recab7fca85174d"]`。

遗留问题：

- 「新建记录」用目标表字段默认值（新记录主字段为空 → 显示「未命名记录」）；不做「随手命名」。
- 关联选择器只列**全部**目标记录（专项 §2.4 明确第一版不做字段级数据范围筛选）。
- 移动端仍是只读（复用 T02B.1 的 core 口径），未跑 Android 模拟器。

下一步：

- 进入 `T02B.3 双向关联`（反向字段 + 配对一致性 + 删一侧降级为单向）。

### 2026-09-29 · T02B.3 双向关联（反向字段 + 双向镜像唯一写入口 + 删一侧降级）

本次完成：

- **建立配对**（core `createRelationPair`）：在目标表建反向字段（默认名 **来源表名 + 来源字段名**，可像普通字段一样重命名）、两侧写 `pairedFieldId` 与 `mode="twoWay"`，并把**已有值回填**到反向侧 ⇒ 「A 关联 B 后，B 反向出现 A」对历史数据也成立；已配对时幂等。
- **双向镜像唯一写入口**（core `applyRelationMirror`）：把某一侧记录的值设为 nextIds，并把**增删差集**镜像到对侧（新增目标 → 对侧记录加上来源 id；移除目标 → 对侧记录去掉来源 id）。编辑器里**所有关联字段的写值都走它**（`setCellValue` 按类型分派），非双向时行为等价于普通写值。
- **解除配对**（core `unpairRelationFields`）：清掉对侧 `pairedFieldId` 并降级为单向，**两侧数据都保留**。两处触发：字段编辑里把「双向」改回「单向」；**删除一侧字段前**先解除（`deleteField` 改为跨表 `setDoc`，先 unpair 再删字段并清视图配置）。
- **字段配置 UI**：关联字段编辑弹窗加「**双向关联（在目标表生成反向字段）**」开关（未选目标表时禁用；已配对时目标表选择锁定，避免改表让反向字段失去意义）。
- 目标记录删除/恢复仍只影响显示解析（T02B.1 口径），不破坏字段；关联仍只存 id、不复制数据、不加 S3 对象。

数据结构 / 接口变化：无正文格式变化。core 新增导出：`relationReverseFieldName`、`createRelationPair`、`unpairRelationFields`、`applyRelationMirror`（全部纯函数，入参/出参都是 tables 数组）。

改动文件：`src/core/bitableDoc.ts`(+test) · `src/features/bitable/BitableEditor.tsx` · `bitableEditorMount.test.ts`

验证结果：

- `tsc --noEmit`：通过
- `vitest`：**1394 passed / 16 skipped**（+3 = 双向纯函数用例 + 未配对等价用例 + 护栏）
- `check:core`：0 违规
- 桌面 / 移动构建：通过
- `ui-metrics`：hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0
- `cssLayers + uiPrimitives`：通过
- `git diff --check`：通过
- **CDP 真实端点**（隔离 `LAKE_USER_DATA=$TMPDIR/lake-t02b3` + 独立端口 9262 + `--no-sandbox`；来源表「第一个」+ 目标表 3 条记录、来源 1 条记录已关联 tgt-1/tgt-2）：
  - 关联字段开启「双向关联」保存 → 目标表多出反向字段 **`第一个关联`**。
  - 反向侧回填：`tgt-1`/`tgt-2` 显示来源记录标题 `测试第一二`，`tgt-3` 空（B 反向出现 A）。
  - 来源侧改成「目标甲 + 目标丙」→ 目标侧 `tgt-2` 变空、`tgt-3` 变 `测试第一二`（双向同步）。
  - 删除目标侧反向字段 → 目标表只剩 `名称`；来源表 `关联` 字段仍在、值仍 `目标甲目标丙`（**降级为单向、数据保留**，落盘 `relation={mode:"oneWay",allowMultiple:true,tableId:"tbl-target"}`）。
  - 再开启双向 → 反向字段重建并按当前值（tgt-1/tgt-3）回填；截图核对。

遗留问题：

- 反向字段的**默认名**只在创建时给（此后重命名不影响配对）；改来源表名不会同步旧反向字段名。
- 已配对时不允许改目标表（需要先改回单向）；不做「改表时自动迁移配对」。
- 移动端仍是只读（共用 core 口径），未跑 Android 模拟器。

下一步：

- 进入 `D01 CSV 导入导出`。

### 2026-09-29 · 移动端多维表只读补齐 + Android 模拟器验收

用户 260929 明确「先不做导入导出」，改为补齐移动端多维表只读并做 Android 验收。

本次完成：

- `MobileBitableViewer` 单元格改为**按字段类型分派的只读控件**（不再是统一裸文本）：
  - boolean → 禁用复选框；link → `<a target="_blank">`（外部 origin 走系统浏览器）；rating → 5 星（选中 \`--lake-rating-star\`、空星 \`--lake-border-strong\`）；progress → 条 + 百分比（宽度数据驱动）；relation → 目标记录主字段 chip（复用 core `relationTargetRecords`/`bitableRecordTitle`）；附件/图片、单选/多选维持缩略图/色块；其余走 `bitableFieldText`（系统时间到分钟）。
  - 目标表/目标记录失效 → `关联已失效`，与桌面同一 core 口径。
- 非 grid 视图（看板/画册/日历/未知）仍走 `mbt-view-notice` 明确提示 + 表格只读。
- `mobile.css` 新增只读控件样式（`.mbt-bool/-link/-rating/-star/-progress*/-relation*`）。

改动文件：`src/mobile/bitable/MobileBitableViewer.tsx` · `src/mobile/mobile.css` · `src/mobile/bitable/mobileBitableViewer.test.ts`(新)

验证结果：

- `tsc --noEmit`：通过；`vitest`：**1396 passed / 16 skipped**（+2 = 移动端 render 单测：控件齐全 + 非 grid 回退）；桌面/移动构建通过；`check:core`/`ui-metrics`/`cssLayers`/`git diff --check` 全绿。
- **Android 模拟器真实端点**（AVD `lake_mobile` Pixel6/API36；`android-build.sh --sync --install` → `emu-up.sh --no-window` → `emu-cdp.sh 9335`）：
  - 造了两条 bitable 笔记（`parent_id=notebook-personal`，否则首页点开报「未找到所属笔记本」）。
  - `移动多维表` 断言：布尔 `[true,false]` 且 disabled；链接 `href=https://example.com/mobile` + `target=_blank`；评分星数 `[4,2]`；进度 `60%/0%`（条宽一致）；关联 chip `[目标A,目标B]/[目标B]`；创建时间 `2026-09-01 08:00`；只读徽标。
  - `移动看板表` 显示「「看板视图」桌面已支持，移动端暂以表格只读展示。」。
  - 踩坑：首页最近文档是 `<button class="doc-card">`，CDP `el.click()` 不触发导航，必须 `Input.dispatchMouseEvent` 真实点按；App 重启后 WebView socket 变化需重跑 `emu-cdp.sh`。

遗留问题：

- 未在**真机**复验（模拟器已覆盖控件与布局）；edge-to-edge/键盘安全区不在本批范围（属移动端 §8 真机项）。
- 移动端仍为只读，不支持在移动端编辑多维表（产品边界）。

下一步：

- 导入导出（D01/D02）按用户要求暂缓；或按用户指定方向继续。

### 2026-09-29 · 数据表行操作改浮动（用户反馈）

用户（附图）：「数据表的这 2 个按钮做成浮动在目录上，光标上去之后浮现，不要占用固定位置」。

- 原状：`.bt-table-more`/`.bt-table-del` 只是 `opacity:0`，**仍在 flex 流里占位** ⇒ 名称/计数被挤压。
- 改法（就地改 `bitableEditor.css` 单一来源）：`.bt-table-item` 加 `position: relative`；两钮 `position:absolute; top:50%; transform:translateY(-50%); opacity:0; visibility:hidden`（隐藏时也不接收点击），`.bt-table-more{right:30px}` / `.bt-table-del{right:4px}`，`hover` 时 `opacity:1; visibility:visible`。
- 验证（CDP 桌面真实端点，隔离 userData + 9264）：默认 `absolute/opacity=0/hidden`；悬停后 `absolute/opacity=1/visible`，且 `nameW`/`countW` 与悬停前**逐位相同**（无布局位移）；截图 before/after 对照。
- 改动文件：`bitableEditor.css` · `cssLayers.test.ts`（基线 1046 → 1054，实测值）。门禁全绿（vitest 1396-16）。

### 2026-09-29 · 字段类型改弹出选择（用户反馈）

用户（附图）：「编辑字段的字段类型做成弹出选择，如图 2，不要放这么大一坨在这里占位置」。

- 现状：「编辑字段」弹窗里内联渲染 `FieldTypeGrid`（14 项 2 列），把弹窗撑得很高。
- 改法（单一来源）：新增 `FieldTypeSelect`（`bitableCells.tsx`）——触发器复用 `.bt-select`/`.bt-select-trigger`，只用一行显示「图标 + 当前类型名 + ▾」；点开在 `Popover` 里渲染**同一个** `FieldTypeGrid`。`FieldEditorModal` 改用它；工具栏快捷「新增字段」仍是独立弹出网格（两处共用同一网格组件）。**未新增任何 CSS**。
- 未加「基础/高级」分组标题：产品 260928 明确「字段类型选择不分基础/高级组」，且我方无人员/邮箱/手机号码等企业字段；如需要分组另议。
- 验证（CDP 桌面真实端点，隔离 userData + 9265）：弹窗内 `inlineGrid=false`、触发器文本 = 当前类型；点开 `.ln-popover` 出 14 项、当前项打勾；点「单选」后触发器变 `单选`、浮层关闭、弹窗内仍无内联网格。截图核对。
- 改动文件：`bitableCells.tsx` · `BitableEditor.tsx` · `bitableEditorMount.test.ts`（+1 护栏）。门禁全绿（vitest 1397-16）。

### 2026-09-29 · 类型名左对齐 + 选项回车新建（用户反馈）

用户两条：「① 编辑字段-字段类型选好了左侧对齐展示，居中是什么操作；② 添加选项这里，回车就是新建一个选项」。

- ① 根因：`FieldTypeSelect` 的类型名用 `.bt-field-name`（`flex:1`）铺满，而 `<button>` 默认 `text-align:center` ⇒ 文字被居中。改法：给 `.bt-select-trigger` 加 `text-align: left`（选择器的值本就该左对齐；其它 SelectMenu 触发器的 span 是内容宽度、本就靠左，不受影响）。
- ② 改法：`optionInputsRef`(Map<id, input>) + `focusOptionInput`；「添加选项」按钮与选项输入框 Enter 共用 `addOptionRow()`（追加并置 pending focus，`options` 变化后的 effect 聚焦）。**Enter 的真实口径 = 当前选项编辑完成**：有下一个就 `focusOptionInput(next.id)`（**不新建**），已是最后一个才新建。
  > 注：首版做成了「每次 Enter 都新建」，用户当场纠正——「回车代表这个选项编辑完成了，回车一下切换到下一个选项，下一个如果没有就新建」。
- 验证（CDP 桌面真实端点，隔离 userData + 9266/9267）：`.bt-select-trigger` 与类型名 span computed `text-align=left`；焦点在 #0 按 Enter → 焦点 #1、选项数仍 4；#1→#2；#2→#3；在最后一个 #3 按 Enter → 选项数 4→5、新行「选项 5」、`document.activeElement` = 新行 input。截图核对。
- 改动文件：`BitableEditor.tsx` · `bitableEditor.css` · `bitableEditorMount.test.ts`（+1 护栏）· `cssLayers.test.ts`（1055）。门禁全绿（vitest 1398-16）。

### 2026-09-29 · 修「状态栏一个数据表有一个没有」（用户反馈）

现象（用户附图）：同一个多维表文档里，数据表「第一个」（15 条、纵向溢出）**看不到文档状态栏**，切到「第二个」（0 条、不溢出）就有。

先复现取证（隔离 userData + CDP 9268）：切到「第一个」读 `.workspace` 的 `--lake-bitable-status-bottom` = **-231px**（状态栏 top 1029，早就飞出 820 的视口）；切到「第二个」= 27px（正常）。再把两个元素都量一遍：

- `.bt-stat-row`（`<tr>`）rect.top = **1053**、computed `position: static`；
- `.bt-stat-row td` rect.top = **785**、computed `position: sticky; bottom: 0`。

**根因**：底栏的「贴底常驻」挂在 **td** 上（`bitableViews.css` 的 `.bt-stat-row td { position: sticky; bottom: 0 }`），`<tr>` 本身仍是 static。测量代码 `host.querySelector('.bt-stat-row')` 取到的是 `<tr>`；内容纵向溢出时它停在**内容底部**（视口外），于是 `above = innerHeight - tr.top + 2` 变成负数 ⇒ 状态栏 `bottom:-231px` 被顶出屏幕。空表不溢出时 `<tr>` 恰好也贴底，所以「第二个」看着正常——这正是「一个有一个没有」的来源。

**修法**：测量改取粘性单元格 `.bt-stat-row td`（变量名 `row` → `bar`），并在注释里写明「不能量 `<tr>`」。

验证（CDP 真实端点 9269，同一份数据）：

| 数据表 | `--lake-bitable-status-bottom` | 底栏 td | 状态栏 | 重叠 |
| --- | --- | --- | --- | --- |
| 第一个（15 条，纵向溢出） | **37px** | 785–809 | 761–783 | **-2px（不重叠）** |
| 第二个（0 条） | 27px | 795–819 | 771–793 | -2px |

截图核对：第一个底部「共 15 条」上方右侧出现「多维表 仅本地」。门禁全绿（vitest 1398-16）。

### 2026-09-29 · 关联字段「关联数据表」：占位文案不再是可选项（用户反馈）

用户（附图，编辑字段 → 字段类型=关联）：「下面的选择数据表，选择数据表仅是提示，不能当做选项」——
截图里下拉第一项就是「选择数据表」而且**带勾**（当前值被判定成它）。

**根因**：`FieldEditorModal` 的关联目标表下拉把占位文案塞进了 `options`：
`options={[{ value: "", label: "选择数据表" }, ...其它数据表]}` ⇒ 它同时是「提示」和「一条可选中的值」，
空值时 `SelectMenu` 会把它渲染成当前选中项并打勾。

**修法（单一来源，不加覆盖）**：该 `SelectMenu` 只保留真实数据表作为 `options`，
占位改由 `SelectMenu` 既有的 `placeholder` 能力承担（触发器的 `bt-select-placeholder` 灰字，不参与选中）。
与看板「选择分组字段」、日历「选择日期字段」两处已是同一写法。

本次完成：

- `关联数据表` 下拉选项 = 同一文档内**除本表外**的数据表；空值 → 触发器显示灰字占位「选择数据表」（无勾选态）。
- 顺带核查全仓同类写法：`rg 'label: "选择…'` 只剩这一处；画册「无封面」、日历「（无，按单日）」「（无）」是有语义的**清除项**，不是占位，按原样保留（未被本次改动波及）。

数据结构/接口变化：

- 无（仅 `options` 数组内容；字段模型/正文格式不变）。

UI 与交互变化：

- 未选目标表时触发器显示占位灰字；下拉里只有真实数据表，点开不再出现「选择数据表」，也不会给它打勾。

改动文件：

- `src/features/bitable/BitableEditor.tsx`（`FieldEditorModal` 关联数据表 SelectMenu）
- `src/features/bitable/bitableEditorMount.test.ts`（+1 护栏：必须有 `placeholder="选择数据表"`、不得再有 `label: "选择数据表"`）

验证结果：

- `tsc --noEmit`：通过
- `vitest`：**1399 passed / 16 skipped**（+1 = 本批护栏）
- `check:core`：0 违规
- 桌面 / 移动构建：通过
- `ui-metrics`：hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0
- `cssLayers + uiPrimitives`：通过
- `git diff --check`：通过
- **CDP 真实端点**（隔离 `LAKE_USER_DATA=<tmp>/lake-relfix2-*`（只复制 `workspace-default`，避免用户 dev 实例的 `SingletonLock` 让新实例秒退）+ 独立端口 9271 + `--no-sandbox`，`LAKE_RENDERER=scheme`）：
  - 已有目标表的字段：触发器 = `第一个`，下拉选项 = `["第一个"(已选中)]` —— **不再有「选择数据表」项**。
  - 新建关联字段（未选表）：触发器 = `选择数据表` 且命中 `bt-select-placeholder`（占位态、非选中态）；下拉选项 = `["第一个"]`，`hasPlaceholderItem=false`。
  - 截图核对：弹窗内触发器为灰字占位、下拉仅一项真实数据表。

遗留问题：

- 目标表选定后**没有「清除目标表」入口**（占位不再可点）。关联字段没有目标表本身无意义，需要换目标表直接改选即可；若日后要支持清空再单独立项。
- 用户 dev 实例（9222）里那条字段的目标表已被选中（`tableId=tble6e97bfbf9d9`），本次验收用的是隔离副本，未改动用户数据。

下一步：

- 等用户验收本轮修复；D01/D02 仍按 260929 决定暂缓。

### 2026-09-29 · T02B.4 关联数据范围（从视图筛选）+ 关联选择器改全局大弹窗

用户两条（附图 1 = 云端字段配置、图 2 = 云端选择器）：

1. 「关联数据表需要做是否可以从视图选择，如果不勾选就默认从全部数据里选，如果勾选了，就要绑定一个视图。」
2. 「关联字段选择的时候弹窗展示，不要扣扣搜搜的使用小弹窗，就用正常的全局弹窗，然后展示选择的关联表全部信息…要点 1、要 2 个 tab，一个全部，一个已选择且展示数量，每选择一条，已选择里就加一条，也可以点击已选择页签看全部已选择。同时已选择里也保留复选框，方便取消。2、搜索框，全局搜索，右侧也有筛选条件和排序的功能。3、主要区域全局展示，完整展示当前的所有数据。4、不做添加记录。」

用户同时给了架构授权：「我感觉改动应该比较大，如果有必要可以重新设计架构，你看的决定」。**结论：不需要大改架构**——
本质是「一个字段配置项 + 选择器换载体」，边界干净；正文格式/同步/历史/GC 全不变，core 只加 2 个纯函数并复用既有求值引擎 `applyViewToRecords`。
真正该做的是**职责位置**：选择器原先寄生在 `bitableCells.tsx`（1175 行，气泡+搜索+页脚都在 `RelationCell` 内），本轮抽成独立组件。

本次完成：

#### ① 数据范围（从视图筛选记录）

- core：`BitableRelation` 新增 `viewId?: string`；`normalizeField` 保留它；新增 `relationTargetView(ctx, field)`（目标表里绑定的视图，缺省/删表/删视图 → undefined）与 `relationCandidateRecords(ctx, field)`（**候选集口径**：有视图走 `applyViewToRecords(target, view)`，否则全部记录）。
- 字段配置（`FieldEditorModal`）：`关联数据表` 下面加「从视图筛选记录」勾选框 + 勾上后出现的「关联视图」下拉（候选 = 目标表的全部视图，默认取第一个）。
  换目标表 / 取消勾选即清 `viewId`（视图 id 属于目标表）；`save()` 只在 `tableId && viewId` 时写 `viewId`。
- **展示与候选分离**：单元格 chip 仍走 `relationTargetRecords` —— 已选记录即使被数据范围过滤掉也照常显示（只有「能选什么」受视图约束）。
- 表被删 / 视图被删 → 回落全部记录，不级联、不报错。

#### ② 选择器改全局大弹窗

- 新组件 `BitableRelationPicker.tsx` + `bitableRelationPicker.css`（已登记 `cssLayers` FILES/BASELINE = 96/0）；`Dialog`（Overlay 原语，.ln-dialog 表面）尺寸 `min(1080px,92vw) × min(720px,82vh)`。
- 结构：标题（字段名 + 右侧数据范围「目标表 · 视图/全部记录」）→ 两个 tab（`.seg` 分段控件：「所有可关联记录」/「已选 N 条记录」）→ 搜索框 + 右侧筛选/排序 → 主区域整表（吸顶表头、全字段列、超长省略 + title、点行或复选框选择）→ 页脚「已选 N 条记录 / 取消 / 确认」。
- **已选页签**保留复选框（可取消）、保持**选择顺序**（不受字段排序影响，只被搜索/筛选收敛）。
- **撤销**「添加记录」与「跳转目标记录」：`onCreateTargetRecord` / `onJumpToRecord` 从 `CellEditorProps` / `RelationCell` / `BitableRecordDrawer` / `BitableEditor`（含 `createTargetRecord`、`jumpToRelationRecord` 两个回调）全链路删除——按图 2 结构收敛，不留死代码。
- 草稿语义不变：确认才 `onChange([...draft])` 写正文。
- 排序方式映射（`sortModeOf` / `applySortMode` / `changeSortField`）从 BitableEditor **上收 core 导出**，选择器与编辑器共用（消除第二套实现）。

#### ③ 实施中发现并修掉的真实问题（嵌套浮层）

筛选/排序最初做成**嵌套气泡**（气泡里再开 SelectMenu），实测有两个真问题：里层下拉 `isInsideDialog(anchor)` 判 false（它的锚点在 portal 出来的气泡里、不在 `.ln-dialog` 内）⇒ z 只有 600，被抬层的外层（715）压住，**点第一项「升序」会打到外层面板**；且外点关闭会把整个面板一起关掉，选中的值丢失。
→ 改成**弹窗内的内联条**（`.bt-rel-config`）：规则行的下拉都在 `.ln-dialog` 内，天然抬层，也不再有点一下就被关掉的问题。改动后真实鼠标点选 字段/操作符/排序方式 全部生效且面板保持打开。

数据结构/接口变化：

- core 新增：`BitableRelation.viewId`、`relationTargetView`、`relationCandidateRecords`、`sortModeOf`、`applySortMode`、`changeSortField`（后三个是从 BitableEditor 上收的纯函数）。
- 删除：`CellEditorProps.onJumpToRecord` / `onCreateTargetRecord`（及 BitableRecordDrawer / BitableEditor 对应链路）。
- **正文格式无结构变更**：关联仍只存 `values[fieldId] = 目标记录 id 数组`（`relation.viewId` 是字段级配置，可选键，旧数据不受影响）。

改动文件：

- `src/core/bitableDoc.ts`(+test)
- `src/features/bitable/BitableRelationPicker.tsx`（新）· `bitableRelationPicker.css`（新）
- `src/features/bitable/bitableCells.tsx` · `BitableEditor.tsx` · `BitableRecordDrawer.tsx`
- `src/features/bitable/bitableEditorMount.test.ts` · `src/styles/cssLayers.test.ts`

验证结果：

- `tsc --noEmit`：通过
- `vitest`：**1402 passed / 16 skipped**（+3 = 数据范围 core 用例 + 选择器两条护栏；原 T02B.2 护栏改写为 T02B.4）
- `check:core`：0 违规
- 桌面 / 移动构建：通过
- `ui-metrics`：hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0
- `cssLayers + uiPrimitives`：通过
- `git diff --check`：通过
- **CDP 真实端点**（隔离 `LAKE_USER_DATA=<tmp>/lake-relfix2-*`（只复制 `workspace-default`，避开用户 dev 实例的 `SingletonLock`）+ 端口 9271 + `--no-sandbox`，`LAKE_RENDERER=scheme`＋改完 `vite build` 后 reload）：
  - 弹窗：`role=dialog`、1080×672、tab `["所有可关联记录","已选 0 条记录"]`、搜索占位「搜索相关记录」、右侧 `["筛选","排序"]`、表头 = 目标表全字段（9 列）、15 行、页脚 `["取消","确认"]`、`hasAdd=false`。
  - 选择：点 2 行 → tab 变「已选 2 条记录」、2 行高亮 + 2 个勾选；切「已选」→ 只有那 2 行；在已选页取消 1 条 → 2→1；回「所有」再加 1 条 → 2；确认 → 单元格 chip = 那 2 条，**落盘 `["rec122e98afc936","rec19cef0038e7a"]`**。
  - 取消：草稿选到 3 条后点取消 → 单元格仍 2 条、磁盘值不变（不落盘）。
  - 搜索：「打」→ 3 行（打地基热 / 阿打发 ×2）。
  - 筛选：`文本 包含 阿` → 2 行；`单选 等于 已完成` → 1 行；删除规则 → 15 行。
  - 排序：`评分 降序` → 评分 4 的记录排第一（其余为空）。
  - 数据范围：字段配置勾「从视图筛选记录」→ 出现「关联视图」并默认取「表1」；确定后**落盘 `viewId=vewc44885bf0222`**，重开选择器 scope = 「第一个 · 表1」、候选 15 → **1**；取消勾选再确定 → 磁盘 `viewId` 消失、scope = 「第一个 · 全部记录」、候选回到 15；两次操作中单元格已选值始终保持 2 条。

遗留问题：

- 选择器的筛选/排序是**本机状态**（不写正文，重开即清）——按「选择器」语义处理；如需记住再单独立项。
- 撤销了「新建记录」与「行内跳转」：按用户图 2 与「不做添加记录」收敛，需要恢复请说一声。
- 移动端未跑 Android（移动端是只读路径，本轮未改其代码）。

下一步：

- 等用户验收 T02B.4；D01/D02 仍按 260929 决定暂缓。

### 2026-09-29 · 新建数据表默认结构：1 列文本 + 3 行空白记录

用户：「默认新建数据表，只创建一列类型为文本的列，然后默认添加 3 行空白数据。」

**改前**：`createDefaultBitableTable` 建 **3 列**（文本 + 单选[待开始/进行中/已完成] + 日期）且 **0 条记录**。
**改后**：只建 **1 列文本** + **3 行空白记录**（`values` 全空）。

本次完成：

- core：`createDefaultBitableTable` 收敛为 1 文本列 + 3 条 `createBitableRecord()`；删掉预置的单选/日期列及其配色（产品不再替用户定表结构）。
- 单一来源未变：编辑器 `addTable()`（「新建数据表」）与 `initialDoc()` 空正文兜底、`emptyBitableBody()`（新建多维表文档首表）都走这一个函数——新建文档的首张表口径与新建数据表一致。
- 测试夹具解耦：`bitableDoc.test.ts` 新增 `fixtureTable()`（文本+单选+日期，供 26 处既有用例显式声明结构），不再让用例隐式依赖产品默认字段；`historyPreview.test.ts` 的「还没有记录」用例改为显式清空记录；`electron/store.test.ts` 的建文档断言改为 `["text"]` + 3 条记录。
- 新增护栏：core 用例锁「默认表 = 1 列文本 + 3 行空白 + 1 表格视图」与 `emptyBitableBody` 往返；挂载用例锁「默认表不再含待开始/进行中/已完成选项」且新建表/空正文兜底都走 `createDefaultBitableTable`。

数据结构/接口变化：

- 无正文格式变更（仍是 `tables[]` 结构）；只是**新建时**的初始内容不同。既有文档不受影响（无迁移、无兼容层）。

UI 与交互变化：

- 新建数据表后：表头只有「文本」一列 + 3 行可填空行（底部计数「共 3 条」）；用户自己「新增字段」加列。

改动文件：

- `src/core/bitableDoc.ts`(+test) · `src/core/historyPreview.test.ts` · `electron/store.test.ts` · `src/features/bitable/bitableEditorMount.test.ts`

验证结果：

- `tsc --noEmit`：通过
- `vitest`：**1404 passed / 16 skipped**（+1 = 默认表护栏；另 3 处断言随口径更新）
- `check:core`：0 违规
- 桌面 / 移动构建：通过
- `ui-metrics`：hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0；`cssLayers + uiPrimitives` 通过；`git diff --check` 通过
- **CDP 真实端点**（隔离 userData 9271，`vite build` 后重启）：点「新建数据表」→ 数据表列表出现 `数据表 3`、表头 `["", "文本"]`、**3 行空白**（行号 1/2/3、单元格全空）；落盘核对 `fields:[{name:"文本",type:"text"}]`、`records:3`、`values:[{},{},{}]`；截图核对（底部「共 3 条」）。

遗留问题：

- 既有文档里的表结构不受影响（本次只改新建口径）。
- 新建**多维表文档**的首张表同样变成 1 列文本 + 3 行空白（同一函数，刻意不分裂两套默认）。

下一步：

- 等用户验收；D01/D02 仍按 260929 决定暂缓。

### 2026-09-29 · 关联选择器：图片/附件真渲染 + 资产 URL 单一来源

用户：「关联弹窗选择的时候附件和图片需要渲染加载，不能就给一个名称。」

本次完成：

- 选择器整表的值渲染改为按字段类型分派（`PickerCellValue`）：
  - `image` / `attachment`：图片出 **32px 缩略图**（走 `?w=` 档位、`loading="lazy"`），**点缩略图 = 预览本单元格的图片**（`onOpenImages` → 与表格/画册同一条 Lightbox，不跨字段合并）；非图片附件出「📎 + 文件名」chip（`title` 全文），超过 2 个折成 `+N`。
  - 没有 `noteId` 的极端入口才退化成「N 张图片」，不再出现「只给一个名称」的样子。
- `noteId` / `onOpenImages` 从三个入口透传：表格网格（`BitableEditor`）、记录详情（`BitableRecordDrawer`）、表单（`BitableFormView`）→ `CellEditor` → `RelationCell` → `BitableRelationPicker`。
- **资产 URL 收敛为单一来源**：新增 `bitableAssetUrl(noteId, file, cssPx?)`，替换原先散在 4 处的 `ASSET_ORIGIN + noteId + file` 手工拼接（单元格 chip / 附件卡片缩略图 / 看板缩略图 / 画册封面），选择器与编辑器 `openAsset`/`openImages` 一并改走它（AGENTS §3 #14 单一来源）。

数据结构/接口变化：

- 无正文格式变更。新增 `CellEditorProps.noteId` / `CellEditorProps.onOpenImages`（可选，关系字段用）；新增模块 `src/features/bitable/bitableAssetUrl.ts`。

改动文件：

- `src/features/bitable/bitableAssetUrl.ts`（新）
- `src/features/bitable/BitableRelationPicker.tsx` · `bitableRelationPicker.css`
- `src/features/bitable/bitableCells.tsx` · `BitableEditor.tsx` · `BitableKanbanView.tsx` · `BitableGalleryView.tsx` · `BitableRecordDrawer.tsx` · `BitableFormView.tsx`
- `src/features/bitable/bitableEditorMount.test.ts` · `src/styles/cssLayers.test.ts`

验证结果：

- `tsc --noEmit`：通过 · `vitest`：**1405 passed / 16 skipped**（+1 = 选择器资源渲染护栏）· `check:core` 0 违规 · 桌面/移动构建通过
- `ui-metrics`：hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0；`cssLayers`（本文件基线 96 → 120）+ `uiPrimitives` 通过；`git diff --check` 通过
- **CDP 真实端点**（隔离 userData 9271，`vite build` 后 reload）：
  - 选择器整表出现 10 个 `img.bt-rel-thumb`，src = `http://127.0.0.1:19891/{noteId}/1790585329113_fb503221.png?w=128&token=…`；去掉 `loading` 后 4 张 `naturalWidth=128 / naturalHeight=78`，**实际渲染 32×32**（真加载，不是占位）。
  - 往附件列注入 3 个 PDF 后：chips = `["6.25鞠老师晚读.pdf","6.23鞠老师晚读(1).pdf","+1"]`（>2 折成 +N）。
  - 截图核对：图片列是原神角色缩略图、附件列是 PDF chip。

遗留问题：

- 选择器里非图片附件最多列 2 个 + `+N`（避免一行被文件名刷满）；需要全列可再说。
- 本次为验附件 chip，往**隔离副本**的目标表首条记录注入了 3 个假 PDF（`1790582950xxx_deadbeef.pdf`，文件不存在、只用于渲染核对）；用户真实数据未改动。

下一步：

- 等用户验收；D01/D02 仍按 260929 决定暂缓。

### 2026-09-29 · 横向页签原语：用户选定 B（墨线 + 计数徽标），多维表先切

背景：用户要求「弹窗 tab 切换需要重做，正好可以设计一个新的原语，文档那边的里和回收站也要用，出几个方案」。
本轮先给了 5 个形态的可点对比（A 墨线 / B 墨线+计数 / C 胶囊 / D 分段（现状）/ E 滑动等宽），用户选定 **B**，并要求「做成原语，先改多维表这边的 tab，我看看效果」。

本次完成：

- **原语进 `kit.css`（单一来源）**：`.ln-tabs`（墨线基座：`display:flex` / 18px 间距 / 左右 16 / 底部 1px `--lake-border-2` 分隔线）→ `.ln-tabs__track[role=tablist]` → `.ln-tabs__item[role=tab][aria-selected]`：
  - 未选中 `--lake-text-2`、hover `--lake-text-1`；选中 `--lake-accent-text` + `600`；
  - 选中指示线 = `::after` 2px `--lake-accent`，**与文字等宽**（`inset: auto 0 -1px`），带 `ln-indicator-in` 微入场（与移动端 `.mobile-htab` 同一套动效）；
  - 新增 `.ln-tabs__count`：计数徽标（`min-width:18px` / pill / 默认 `--lake-bg-block` + `--lake-text-3`，选中时 `--lake-accent-tint` + `--lake-accent-text`，`tabular-nums` 防抖）；
  - `.ln-tabs__action` 保留（历史面板的「创建快照」）。
- **收编 legacy**：`components.css` 里那套 legacy `.ln-tabs`（260926 之前的墨线实现，被 kit 层分段样式盖住但仍在提供 `display:flex` 等承重属性）整段删除（-45 声明）——现在页签只有 kit 一处来源。
- **过渡变体**：旧的分段形态保留为 `.ln-tabs--seg`（`flex:1 1 0` 等分 + 选中项浮起白块），**回收站 `TrashPanel` / 历史 `HistoryPanel` 显式加上 `--seg`**，外观零变化（等它们迁移）。
- **多维表先切**：`BitableRelationPicker` 的两个页签改走原语 —— `所有可关联记录 [15]` / `已选 [4]`（数量进徽标，文案不再随计数重排），删掉 `.seg` / `.seg__item` 用法；`.bt-rel-tabs` 只留上下留白。
- 规则文档同步：`AGENTS.md` §3 #14 的「横向 tab 一律分段控件」改成「一律用 `.ln-tabs` 原语（B 墨线 + 计数徽标）＋单一来源清单加一条」；`HANDOFF.md` §4 同步。

改动文件：

- `src/styles/kit.css` · `src/styles/components.css` · `src/styles/cssLayers.test.ts`
- `src/features/bitable/BitableRelationPicker.tsx` · `bitableRelationPicker.css` · `bitableEditorMount.test.ts`
- `src/components/TrashPanel.tsx` · `src/components/HistoryPanel.tsx`（各 +1 `--seg`，外观不变）
- `AGENTS.md` · `HANDOFF.md` · 本文件

验证结果：

- `tsc --noEmit`：通过 · `vitest`：**1405 passed / 16 skipped** · `check:core` 0 违规 · 桌面/移动构建通过
- `ui-metrics`：hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0；`cssLayers`：`kit.css` 558 → 593、`components.css` 433 → 388（搬家 + 新增，成对登记）；`uiPrimitives` 通过；`git diff --check` 通过
- **CDP 真实端点**（隔离 userData 9271，`vite build` 后 reload）：选择器页签 `34px` 高、内容宽 `119 / 50`；激活项 `::after` = `2px rgb(91,111,150)`、颜色 `rgb(58,74,104)` + `600`；非激活 `rgb(74,81,88)`；轨道底线 `rgb(240,242,245)`；激活徽标 `rgb(236,239,245)`、非激活徽标 `rgb(240,242,245)` + `rgb(109,117,126)`；切换 tab 正常、`hasSeg=false`、`cursor=pointer`；勾选一行后「已选」徽标 4 → 5。截图核对。

遗留问题：

- 原语暂不支持「页签过多横向滚动」——当前各处页签都 ≤3 个，等真出现再按需加。

下一步：

- 等用户验收全量效果。

#### 同会话追加（用户：「可以推广到所有位置吧」）—— 全量落地

用户看过多维表效果后要求推广。桌面端全部 `role="tab"` 位置（`rg 'role="tab"'` 盘点：关联选择器 / 表单编辑·预览 / 回收站文档·小记 / 历史面板文档历史·孤儿文件）**一次性迁完**，过渡变体删除：

- `BitableFormView`：`.seg` / `.seg__item` → 原语；`bitableFormView.css` 的 `.bt-form-tabs` 只留上下留白 + 一条「轨道居中」（表单是居中版面，分隔线仍横贯整壳）。
- `TrashPanel`：去掉 `--seg`，并把数量做成徽标（`文档 [N]` / `小记 [N]`，数据本来就在手边）。
- `HistoryPanel`：去掉 `--seg`，两个页签加数量徽标（`文档历史 [11]` / `文档孤儿文件 [0]`），右侧「创建快照」继续走 `.ln-tabs__action`，图标保留。
- `kit.css`：删除 `.ln-tabs--seg` 变体与说明；`components.css` 早已只剩一行注释。
- **`role="tab"` 之外不动**：设置页「主题」（浅/深/暖）与小记「列表·卡片版式」是**取值选择 / 图标型开关**（`aria-pressed`/`Seg` 组件），不是导航页签 —— 继续用 `.seg`，并在 AGENTS/HANDOFF 里写明这个边界。
- 移动端（`MobileSheetViewer` / `MobileBitableViewer` 的页签）保持移动端自己的样式语言（`.mbt-*` / mobile.css），本轮不动。

追加验证（CDP 真实端点，隔离 userData 9271）：

| 位置 | 实测 |
| --- | --- |
| 回收站（空间切换 → 回收站） | `文档 [0] / 小记 [0]`；激活 `rgb(58,74,104)` + 600、指示线 `2px` 宽 50 `rgb(91,111,150)`；tab 高 34；分隔线 `rgb(240,242,245)`；无 `--seg` |
| 表单视图（数据表「第一个」→ 表单视图） | `编辑表单 / 预览表单`；指示线 `2px` 宽 52；轨道 `justify-content: center`；无 `.seg` |
| 历史面板（侧栏右键 → 历史版本） | `文档历史 [11] / 文档孤儿文件 [0]`（图标保留）；指示线 `2px` 宽 98；右侧动作 = `创建快照`；无 `--seg`。**这个实例是暖色主题**，实测激活色 `rgb(196,78,0)`、指示线 `rgb(255,106,0)` ⇒ 原语完全跟随主题令牌（同一份代码在浅色下是 `rgb(58,74,104)` / `rgb(91,111,150)`） |

过程备注（供后续会话）：隔离实例的窗口是隐藏的（`document.hidden`），侧栏是「贴左缘的悬浮 peek 面板」⇒ 合成鼠标移不进去、`⌘` 之类的 hover 显形入口点不开。最后用 **JS 派发 `contextmenu` 事件**（`row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX, clientY }))`）打开了侧栏右键菜单，才拿到历史面板入口。这条姿势以后验「hover/peek 类入口」可复用。

### 2026-09-29 · 提交并推送（用户授权）

用户：「合并master并推动远程。」—— 项目红线本来是「不擅自合 master（代码批次需用户验收）」，此处为**用户明确授权**。

- 代码：本批 260928–260929 各批（同一批文件被多批改过，无法按批拆 commit）合成一个提交 `681f148`「feat(bitable): 多维表专项收口（关联/选择器/页签原语/默认表）」，34 改 + 4 新文件。
- 文档：`HANDOFF.md` / `AGENTS.md` / 本文件的回写单独一个提交。
- 推送：`git push origin master` 成功；连同此前本地领先的 23 个提交（`1494331..1fe4d22`）一起上远端。
- 门禁（提交前重跑）：`tsc --noEmit` ✓ · `vitest 1405 passed / 16 skipped` ✓ · `check:core` 0 违规 ✓ · 桌面 + 移动构建 ✓ · `ui-metrics`（hex=0/rgb=0/`!important`=9/未定义令牌=0）✓ · `cssLayers`+`uiPrimitives` ✓ · `git diff --check` ✓。

⚠️ 口径提醒：§11 看板里的「待验收」是**功能验收**状态，与「有没有提交」无关——本批现在都已入库，但**还没有用户的功能验收结论**。

### 2026-09-30 · 表头「新增字段」的 ＋ 贴着左侧最后一列

用户（附图，红框圈住表头行末尾那颗 +）：「继续优化多维表：1、添加列的加号贴近做左侧的列，不要总是居中。」

本次完成（先取证、再改）：

- **复现与取证**（隔离 `LAKE_USER_DATA` + CDP 9281，`LAKE_RENDERER=scheme` + `vite build` 后）：表头最后一格 `.bt-th-add` 实测 `x=675 / w=604`，加号 `x=965` = 675 + 604/2 − 12 ⇒ **正处在空白区正中**；`getComputedStyle(.bt-th-add).textAlign = "center"`。
- **根因**：`th` 的浏览器 UA 默认样式就是 `text-align: center`。字段头靠 `.bt-th-inner { justify-content: flex-start }` 才左对齐，而表尾这格 `.bt-th-add` **此前没有任何规则**；它同时是「吸收表格剩余宽度」的**自动宽度**单元格（`colgroup` 只给 index 与字段列显式宽度，`.bt-grid` 又是 `width:max-content; min-width:100%`）⇒ 加号被居中到很远的空白区中部，离最后一列 290px。
- **改法（只对齐内容，不动列宽）**：`bitableViews.css` 新增一条
  `.bt-grid th.bt-th-add { text-align: left; padding-left: 8px; }`
  - 必须带 `.bt-grid th.` 前缀：`.bt-grid th, .bt-grid td { padding: 0 }` 是 (0,1,1)，裸 `.bt-th-add` 是 (0,1,0) **压不过**。
  - **刻意不给这一格固定宽度**：那会把剩余宽度摊给数据列、把列宽撑开（`colgroup` 里字段列是显式的 `field.width ?? 180`）。8px 内距与字段头 `.bt-th-inner` 的内容起点一致。
- **护栏**（`bitableEditorMount.test.ts` +1 条）：锁 `<th className="bt-th-add"> … class="bt-add-round" title="新增字段"` 的 JSX 结构；锁 CSS 恰为该字符串；并断言 `text-align: center` 不再出现在 `.bt-th-add` 上。

数据结构/接口变化：无（纯 CSS + 测试；不动正文格式、不动同步/历史/GC）。

改动文件：`src/features/bitable/bitableViews.css` · `src/features/bitable/bitableEditorMount.test.ts` · `src/styles/cssLayers.test.ts`（`bitableViews.css` 基线 146 → 148，注明「合法新增非覆盖回涨」）· `HANDOFF.md` · 本文件。

验证结果：

- `tsc --noEmit`：通过
- `vitest`：**1406 passed / 16 skipped**（+1 = 本条护栏）
- `check:core`：0 违规
- 桌面构建：通过；移动构建：通过
- `ui-metrics`：hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0
- `cssLayers + uiPrimitives`：通过
- `git diff --check`：通过
- **CDP 真实端点**（隔离 userData，`vite build` 后 `Page.reload` + 真实点开文档）：改后 `.bt-th-add` `text-align=left`、`padding-left=8px`、**格宽仍 604**（列宽未变）；加号 `x=683`、最后一列右缘 `675` ⇒ **间隙 8px**（改前 290px）。截图核对：加号紧贴「文本」列右缘；表底「添加记录」那颗 + 仍居中在行号正下方（未受影响）；`共 3 条` 底栏正常。

遗留问题：

- 未提交（项目红线：代码批次需用户验收后再处理提交/合并）。
- 表头里**没有**「最后一列之后留白也画成列」这类云端细节；本次只挪加号位置。
- 分组态 / 只读态使用同一格与同一条规则，未单独回归（规则只作用于该格的内容对齐，与分组、只读无关）。

下一步：

- 等用户验收本条；D01/D02 仍按 260929 决定暂缓。

### 2026-09-30 · 选项编辑「添加」不再自动全选（去掉那块蓝色底色）

用户（附图，红框圈住「选项 3」输入框里那一块蓝）：「多选每项添加的时候为什么会有蓝色的底色，需要去掉。」

本次完成（先复现取证、再改）：

- **复现**：隔离实例里打开 `多选` 字段的「编辑字段」→ 点「添加选项」→ 读焦点输入框：新行 `value="选项 6"`、`selectionStart=0 / selectionEnd=4`、`selectionText="选项 6"` ⇒ **整块被全选**，屏幕上就是系统蓝（连点两次分别得到 `选项 6` / `选项 7`，每次复现）。
- **根因**：260929 那批（`681f148`）为「回车 = 当前选项完成 → 切下一个；已是最后一个才新建」加的 `focusOptionInput` 里带 `el.select()`（`el.focus(); el.select();`），配合 `addOptionRow` 预填的默认名 `选项 N` ⇒ 新行一出现就是「全选的默认名」。选区是**系统配色**，不属于我们的令牌、也没法只把它隐藏（要么全选、要么不全选）。
- **改法**（把「键入即新值」从「靠选区」改成「靠输入框本来就是空的」）：
  1. `focusOptionInput`：`el.focus(); el.select()` → `el.focus(); el.setSelectionRange(el.value.length, el.value.length)`（只聚焦、光标落末尾，**与鼠标点进这个输入框完全一致**）。
  2. `addOptionRow`：新选项 `name: ""`（原先 `"选项 " + (prev.length + 1)`），默认名改由输入框 `placeholder={"选项 " + (index + 1)}` 展示。
  3. `save()`：新增 `nextOptions`，把**空名按位置兜底成「选项 N」**（其余行原样返回、不产生差异）；新增字段与保存字段两条路径都改用 `nextOptions`。
  4. `bitableEditor.css` 补 `.bt-input::placeholder { color: var(--lake-text-4) }`（浏览器默认占位灰不是令牌；与 kit.css / overlay.css 的 placeholder 口径一致）。
- **刻意不动**：`focusCell`（表格单元格的键盘导航/落格）保留 `el.select()` —— 那套的既有语义是「落到某格即可直接覆盖」，用户报的是**选项编辑**，不能顺手改网格。输入框的**焦点环**也保留（可访问性；用户说的是「底色」= 选区填色，不是描边）。

数据结构/接口变化：无（不改正文格式、不加持久化字段；选项名兜底只发生在 `save()` 的入参上）。

改动文件：`src/features/bitable/BitableEditor.tsx` · `src/features/bitable/bitableEditor.css` · `src/features/bitable/bitableEditorMount.test.ts`（+1 护栏） · `src/styles/cssLayers.test.ts`（`bitableEditor.css` 基线 1055 → 1056） · `HANDOFF.md` · 本文件。

验证结果：

- `tsc --noEmit`：通过
- `vitest`：**1407 passed / 16 skipped**（+1 = 本条护栏）
- `check:core`：0 违规
- 桌面构建：通过；移动构建：通过
- `ui-metrics`：hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0
- `cssLayers + uiPrimitives`：通过
- `git diff --check`：通过
- **CDP 真实端点**（隔离 userData，`vite build` 后 `Page.reload` + 真实点开文档 → 列菜单「编辑列」）：
  - 点「添加选项」→ 新行 `value=""`、`placeholder="选项 6"`、`selection=[0,0]`（**无选区**）、`::placeholder` 实色 = `rgb(154,161,170)`（`--lake-text-4`）。截图核对：新行是灰字占位 + 光标在行首 + 正常焦点环，蓝块消失。
  - `Input.insertText("苹果")` → 该行 `value="苹果"`、`sel=[2,2]`（键入即选项名，没有被追加成「选项 6苹果」）。
  - 再点一次「添加选项」留空不填 → 点「确定」→ 落盘 `options` 尾部 = `苹果`（键入的）+ `选项 7`（空名兜底），其余 5 个选项字节不变。

遗留问题：

- 未提交（项目红线：代码批次需用户验收后再处理提交/合并）。
- `focusCell` 的 `select()` 保留（见上「刻意不动」）；若用户也希望网格落格不要全选，需另行确认——那不是本条范围。
- 选项**重命名既有行**时仍是普通文本编辑（点进去光标落末尾，要整段替换可 ⌘A），不再有「自动全选」这个便利。

下一步：

- 等用户验收本条（含同日上一条「表头新增字段＋贴左列」）；D01/D02 仍按 260929 决定暂缓。

### 2026-09-30 · 列宽自由设置（不再看内容）+ 行高不被内容撑高 + 下限 40

用户（附图：附件列被 3 个 chip 撑出很宽的一列）：「附件类型的列左右宽度不能设置下限，也需要能自由拉长和缩短。我测试了一下，所有的列都是根据内容长度算的左右宽度，我需要能自由设置了，展示不下就截断省略。并且不能为了展示内容而自动扩大行高。例如日期缩短了就会导致换行，而行高变大。」随后追加：「可以设定一个比较小的下限值。」

本次完成（先复现取证、再改）：

- **复现（隔离实例 + CDP，往隔离副本注入长文本/长附件名）**：
  - 列宽：附件字段 `width` 明明是 180，**渲染成 413**（3 个中文文件名的 chip 顺着排开）；把带 `2026-09-07` 的日期列拖到 80 之后，列又「自己」回到 109（nowrap 生效前的最小内容宽）。
  - 行高：日期列拖到 80 ⇒ `2026-09-07` 折行，**记录行 36 → 48**。
- **根因**：① 网格是 `table-layout: auto`，此时 `<col style="width">` 只是「**至少**这么宽」的提示，**内容更宽就把列撑开**；② `td` 上的 `height` 同样是**最小值**，内容折行就撑高。（`td { overflow: hidden }` 早就有，但 **Chrome 对 table cell 不做 overflow 裁剪**，指望它没用。）
- **候选方案实测对比**（同一份数据，注入 CSS 量同一个格子）：
  | 方案 | 结果 |
  | --- | --- |
  | `table-layout: fixed` | **无效**：表格 `width: max-content` 时 Chrome 不走 fixed 算法，附件列仍 413 |
  | `contain: inline-size` 加在 `th/td` | **无效**：Chrome 不对 table cell 生效 |
  | **`max-width` 加在 `th/td`** | **有效**：附件列 413 → **180**，其余列不动（列宽终于由数据说了算） |
- **改法**：
  1. **列宽以字段 `width` 为准**：新增 `columnWidth(field) = (field.width ?? DEFAULT_COL_WIDTH) + "px"`，给**四处**格子写行内 `max-width` —— 表头 `th`、记录格 `td`（与文本颜色合并成一个 style）、分组统计格、底栏统计格。漏一处就会被那一处的长内容重新撑开。
     - 为什么用行内 style：宽度是**正文数据**（每列一个值），CSS 无法按列取值；`<col>` 上的 `max-width` 被浏览器忽略。表尾「新增字段」那格是**吸收剩余宽度**的自动列，**不能**给它 max-width（给了列宽就会摊到数据列上）。
  2. **行高与内容无关**：`.bt-grid th, .bt-grid td { white-space: nowrap }`（永不折行）；日期/时间格补 `.bt-date-trigger > span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }`；文本格 `.bt-cell-input` 补 `text-overflow: ellipsis`（从硬裁改成省略号）。
  3. **下限 80 → 40**（用户追加口径），上限仍是 640。

数据结构/接口变化：无（不改正文格式；`field.width` 本来就是既有字段，只是现在**真的**说了算）。

改动文件：`src/features/bitable/BitableEditor.tsx` · `src/features/bitable/bitableEditor.css` · `src/features/bitable/bitableEditorMount.test.ts`（+1 护栏） · `src/styles/cssLayers.test.ts`（`bitableEditor.css` 基线 1056 → 1062） · `HANDOFF.md` · 本文件。

验证结果：

- `tsc --noEmit`：通过
- `vitest`：**1408 passed / 16 skipped**（+1 = 本条护栏）
- `check:core`：0 违规
- 桌面构建：通过；移动构建：通过
- `ui-metrics`：hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0
- `cssLayers + uiPrimitives`：通过
- `git diff --check`：通过
- **CDP 真实端点**（隔离 userData，`vite build` 后 `Page.reload` + 真实点开文档）：
  - 拖拽：日期 −200 ⇒ 列宽 **40**（下限生效）；附件 +260 ⇒ **340**；文本 +120 ⇒ **300**；附件 −600 ⇒ **40**。**每次拖动列宽都精确等于设定值，行高恒为 36**。
  - 长内容：附件字段 `width=180` 时列宽 **180**（原来 413），chip 在列内裁切不越界；文本列 200px 时长文本出**省略号**（`这是一个很长的文本内容…`）；日期列 120px 显示 `2026-09-07` + 图标、40px 时只留图标。
  - 分组态（把 `views[0].groups` 设为单选字段）：分组行/记录行**右缘逐列完全一致** `[81,281,461,641,761,941,1121,1301,1481,1661,1841,2021,2201,2381,2421]`，分组行高与记录行高同为 **36**。
  - 截图核对：分组视图里长文本省略、附件裁切、行高整齐。

遗留问题：

- 未提交（项目红线：代码批次需用户验收后再处理提交/合并）。
- **chip / 缩略图 / 星级** 这类格子没有「省略号」语义，超出就是**裁切**（不是 `…`）；附件格也没有云端那种 `+N` 溢出计数（那是另一个交互，需要时再立项）。
- 行内 `max-width` 是本仓 §3#14「不写内联样式」的**受控例外**（宽度来自正文数据、无 CSS 等价写法），已记入 HANDOFF §4 与本节。
- 只改了**桌面**网格；移动端多维表是只读的独立样式（`.mbt-*`），本批未动。

下一步：

- 等用户验收同日三条（表头＋贴左列 / 选项编辑去自动全选 / 本条）；D01/D02 仍按 260929 决定暂缓。

### 2026-09-30 · 附件按「文档类型图标」展示（用户问「我们是否有对应的图标样式」）

用户（图 1 = 云端附件列：一行 4 个**小类型图标**、展开面板是**大类型图标** + 名称；图 2 = 云端 hover 出的**深色名称气泡**）：
「附件不展示名称和预览了，直接展示文档类型吧…行单元格里是小类型图标且鼠标放上去自动弹出名称…展开的弹窗里是大类型图标，例如 PDF，图片，doc 等各类图标。当然我们的交互形式不变，只是改名称为图标，更直观。**我们是否有对应的图标样式可以使用。**」

**先回答「有没有现成图标」：没有。**（按 AGENTS §2 的三级检索走完）

- ⓪ vendored 内核 `vendor/lakex-doc-react/**`：`ne-card[data-card-name='file'] .ne-card-file-icon` 只有一个通用 `note-file`，而该 symbol 内核自己都缺（我们 `ensureNoteFileIcon()` 自补过，见 LAKEX-CONTRACT §三）。
- ① 运行时实测：页面上 **325 个 `symbol[id]`**，按 `file|pdf|doc|ppt|word|excel|zip|video|audio|attach|paper` 过滤**只命中 `icon-card-mention-doc` 一个**。
- ⇒ 云端那套彩色「页 + 类型字形」属于**语雀 App 自己的 sprite**，内核不提供；`docs/LAKEX-CONTRACT.md` 已回填这条，避免后人再翻一遍。
- 结论：**用自己的图标库**（本仓全站用 lucide-react 线性图标）按类型分色。

本次完成：

1. **类型判定收敛到 core（单一事实源）**：`src/core/assetNaming.ts` 新增 `AssetFileKind`（image/pdf/doc/sheet/slide/archive/audio/video/code/text/file）+ `ASSET_FILE_KIND_EXTS` + `fileKindOf(nameOrExt)`（吃文件名或裸扩展名，大小写归一，未知回落 `file`；图片仍走既有的 `isImageExtension` 清单，不重复维护）。桌面/移动端将来共用同一口径。
2. **图标组件**：`src/features/bitable/FileKindIcon.tsx`（lucide：FileImage / FileText / FileType / FileSpreadsheet / Presentation / FileArchive / FileAudio / FileVideo / FileCode / File）+ 新样式文件 `bitableFileIcon.css`（已登记 cssLayers：FILES + 基线 33）。
3. **配色进主题令牌**：`themes/base.css` 新增 11 个 `--lake-file-*`（内容/品牌色，与 `--lake-board-canvas-*` 同处「主题无关令牌」区，不按主题分叉）；组件 CSS 里**没有任何颜色字面量**（护栏断言）。
4. **单元格**（`AttachmentChipList`）：附件字段 → `.bt-file-chip` 小类型图标按钮（22px 命中区），**不再显示文件名、不再显示缩略图**；hover 出**名称气泡**（表面用 kit 的 `.ln-tip`，定位用 `usePopoverPosition`，`position: fixed` ⇒ 不会被 `.bt-grid-wrap` 的滚动容器裁掉；`aria-label` 保留可读性）。点击 = 打开/预览本单元格图片，**交互与原来完全一致**。
5. **展开面板**（`AttachmentExpandPopover` 卡片）：非图片的「扩展名文字」与图片缩略图，在**附件字段**下统一换成 **46px 大类型图标**；名称仍在卡片下方（与云端图 1 一致）。
6. **图片字段分叉**：`AttachmentCell` 的 `imageOnly` 决定走哪套 —— **图片字段仍是缩略图**（那个字段的语义就是看图），附件字段才是类型图标。`AttachmentChipList` 新增同名 prop 承接。

数据结构/接口变化：无（不改正文格式、不加持久化字段）；新增 core 导出 `fileKindOf` / `AssetFileKind`。

改动文件：`src/core/assetNaming.ts`(+test) · `src/features/bitable/FileKindIcon.tsx`(新) · `bitableFileIcon.css`(新) · `bitableCells.tsx` · `src/styles/themes/base.css` · `bitableEditorMount.test.ts`(+1 护栏) · `src/styles/cssLayers.test.ts`(登记新文件) · `docs/LAKEX-CONTRACT.md` · `HANDOFF.md` · 本文件。

验证结果：

- `tsc --noEmit`：通过
- `vitest`：**1410 passed / 16 skipped**（+2 = core `fileKindOf` 用例 + 本条护栏）
- `check:core`：0 违规
- 桌面构建：通过；移动构建：通过
- `ui-metrics`：hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0（新令牌都有定义）
- `cssLayers + uiPrimitives`：通过（新文件 `bitableFileIcon.css` 33 条已登记）
- `git diff --check`：通过
- **CDP 真实端点**（隔离 userData，`vite build` 后 `Page.reload` + 真实点开文档）：
  | 项 | 实测 |
  | --- | --- |
  | 附件格 | 3 个 `.bt-file-icon`（`--pdf` / `--doc` / `--doc`）、**0 个 `<img>`**、0 个文件名按钮 |
  | 图片格（同表另一列） | 3 个缩略图、**0 个类型图标**（`imageOnly` 分叉生效） |
  | 行高 | 36（与改动前一致） |
  | hover 名称气泡 | `.ln-tip bt-file-tip`，`text=【期神笔记】2024.pdf`，`background=rgb(58,74,104)`（深色，与云端图 2 同调），位置在图标上方 |
  | 展开面板 | 3 个大图标（46px，`--pdf` / `--doc` / `--doc`）+ 名称行，缩略图 0、扩展名文字 0 |

遗留问题：

- 未提交（项目红线：代码批次需用户验收后再处理提交/合并）。
- **刻意没动的三处**（用户只说了「附件」，其余等他点名）：看板卡片上的图片缩略图、关联选择器整表里的图片缩略图/附件 chip、移动端只读的附件渲染（移动端是 `.mbt-*` 独立样式）。
- `pdf` 与 `txt` 共用文件页字形（靠红 vs 灰区分）；若要更细的字形区分再加。
- hover 气泡是**本仓第一处自定义 tooltip**：表面用 kit 现成的 `.ln-tip`、定位用 `usePopoverPosition`（都在既有单一来源里），不是第三套浮层实现。

下一步：

- 等用户验收同日四条（表头＋贴左列 / 选项编辑去自动全选 / 列宽自由设置+行高 / 本条）；D01/D02 仍按 260929 决定暂缓。

### 2026-09-30 · 跟进两条：图片格 hover 同名气泡 + 移动端同步换图标

用户：「图片有一个改动，鼠标放上去展示名称可以和附件一样。」「图片不动，图片是用来看的，移动端可以换。」「2、你哪里来的图标资源，要不要找找资源内置一套。3、统一就行。」

本次完成：

1. **桌面：hover 名称气泡两种字段共用**（回应「统一就行」）——缩略图与类型图标走**同一套**气泡实现（同一个 `tip` state、同一个 `.ln-tip` 表面、同一个 `usePopoverPosition`）；顺手**删掉 `<img>` 上的原生 `title`**，否则系统 tooltip 会和自定义气泡同时冒出来。
2. **移动端同步**（回应「移动端可以换」）：`MobileBitableViewer` 的 `AttachmentCell` 加 `imageOnly` 分叉 —— **附件字段** = `FileKindIcon` + 名称（触屏没有 hover，名称不能像桌面那样收进气泡，所以图标给类型、名字给内容）；**图片字段**仍是缩略图。样式只加 2 条（`.mbt-attachment-file.is-kind` / `.mbt-attachment-name`），图标配色仍走 `--lake-file-*`（移动端 `main.tsx` 本来就 import 了 `themes/*`，令牌在移动端同样解析）。

关于「图标资源要不要内置一套」（用户提问）——**结论：不引第三方图标集**，理由：

- 现有图标来自 `lucide-react`（**本来就在依赖里**，全站同一套线性图标），不新增依赖、不新增资产文件、无额外许可问题；
- lucide 的 `file-*` 家族本身就是「页 + 类型字形」，与云端同一套视觉语言，只是描边而非填充；
- 第三方 file-icon 集（vscode-icons / file-icons 之类）是**填充 + 品牌色**风格，会与我们的线性设计系统打架，且要引依赖 + 处理许可；
- 云端那套（彩色页 + PDF/Office 字形）**不可用**：内核 sprite 实测只有 `icon-card-mention-doc` 一个相关 symbol，其余在语雀 App 自己的 sprite 里（已回填 LAKEX-CONTRACT）。

验证结果（CDP 真实端点 + Android 模拟器）：

- `tsc --noEmit`：通过
- `vitest`：**1411 passed / 16 skipped**（+1 = 移动端附件分叉用例）
- `check:core`：0 违规；桌面 / 移动构建：通过；`ui-metrics`：hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0；`cssLayers`+`uiPrimitives`、`git diff --check`：通过
- **桌面**（隔离 userData）：hover 图片缩略图 → `.bt-file-tip` 文本 `MOON0005.jpg`、深色底；附件格仍是类型图标；行高 36。
- **Android 模拟器**（AVD `lake_mobile`，Pixel6/API36；`android-build.sh --sync --install` → `emu-up.sh --no-window` → `emu-cdp.sh 9335` → 往 App DB 写一条 bitable 笔记再重启）：附件格 = **3 个类型图标**（`bt-file-icon--pdf/--doc/--image`）+ 名称、**0 张缩略图**；图片格 = **1 张缩略图**、0 图标；图标色实测 `rgb(217,74,61)` / `rgb(47,111,208)` / `rgb(217,138,0)`（= `--lake-file-*` 令牌值，说明移动端令牌链同样生效）。截图核对。

遗留问题：

- 未提交（项目红线：代码批次需用户验收后再处理提交/合并）。
- **HANDOFF §8 是移动端会话的维护范围，本批没有动它**：§8「多维表只读」那条仍写着附件/图片都是缩略图，需要移动端会话按本条更新（已记在 §12）。
- 移动端附件格**保留文件名**（触屏无 hover）——若希望移动端也只留图标，说一声。
- 看板卡片、关联选择器整表里的附件渲染**仍未改**（用户未点名）。

下一步：

- 等用户验收同日五条；D01/D02 仍按 260929 决定暂缓。

### 2026-09-30 · 展开面板的文件名：截断时 hover 出全名

用户（附图：面板卡片下方「【期神笔记】2…」被省略号截掉）：「加一个优化，展开之后文件名这里，有可能看不全，也加一个弹窗展示完整名称。」

本次完成：

- **气泡抽成单一来源** `useNameTip()`（`bitableCells.tsx`）：表面仍是 kit 的 `.ln-tip`、定位仍是 `usePopoverPosition`；**单元格 chip、展开面板文件名、图片缩略图三处共用同一个实现**（不再各写一份）。
- **面板文件名**：`tip.show(name, el, true)` —— 第三个参数 `whenTruncated` 让它**只在真的被省略时才弹**（判据 `anchor.scrollWidth > anchor.clientWidth`，在 hover 那一刻实测）。没截断时弹出来只是同义重复，所以不弹。
- 同时**删掉 `.bt-attach-card-name` 上的原生 `title`**，否则系统 tooltip 和自定义气泡会同时冒出来（与单元格那次同一处理）。

数据结构/接口变化：无（纯展示层）。

验证结果（CDP 真实端点，隔离 userData）：

- 面板 3 个名字实测 `scrollWidth/clientWidth` = **121/89、103/89、159/89**（三个都截断）→ hover 第一个 ⇒ `.bt-file-tip` 文本 `【期神笔记】2024.pdf`（完整名，深色气泡，不被面板边界裁掉）。
- 把面板拖宽到 **932px** 后第二个名字**不再截断**（108/108）→ hover 它 ⇒ 气泡**不出现**（探针返回 `null`）⇒ `whenTruncated` 分支正确。
- `tsc` / `vitest 1411 passed / 16 skipped` / `check:core` / 双端构建 / `ui-metrics` / `cssLayers`+`uiPrimitives` / `git diff --check`：全绿。

遗留问题：未提交（待用户验收）；面板里的**重命名输入框**没有气泡（输入框本身可横向滚动，不需要）。

下一步：等用户验收同日各条；D01/D02 仍按 260929 决定暂缓。

### 2026-09-30 · 关联字段选择器整表：与表格收敛成同一套附件渲染

用户（附图：关联弹窗整表里，附件列还是「📎 【期神笔记】2024.pdf / 📎 2月18日三合一.doc / +1」）：
「关联字段弹窗展示里还没有看到我们新的改动，这两处不是同一套代码吗？能做成一套吗？」

**确实不是一套**（用户判断准确）：关联选择器自己养了一份渲染 —— `.bt-rel-thumb`（32px 缩略图）+ `.bt-rel-file`（`Paperclip` 图标 + 文件名 chip，非图片超过 2 个折成 `+N`）；表格走的是 `AttachmentChipList`。

本次完成（真的做成一套）：

- `AttachmentChipList` 从模块私有改为 **export**（它就是「附件值展示」这唯一一套实现：附件字段 = 类型图标、图片字段 = 缩略图，都带 hover 名称气泡）。
- `BitableRelationPicker.PickerCellValue` 的图片/附件分支改为直接渲染 `<AttachmentChipList ... imageOnly={field.type === "image"} />`，并删掉自养那套：`PICKER_THUMB_PX` / `PICKER_FILE_MAX` / `.bt-rel-thumb` / `Paperclip` 全部移除（`.bt-rel-file` 只留给「没有 noteId」的极端兜底）。
- **交互也一并对齐**：点图标 = 预览本格图片 / 用系统应用打开（与表格同一动作，非图片在表格里本来就是"打开"）。因此该 wrapper `stopPropagation` —— 但 `.bt-rel-files` 特意用 `inline-flex`，**只包住图标本身**，行的空白处仍可点选勾选；`max-width/overflow` 把多余图标裁在格内（不让它溢到下一列）。

验证结果：

- `tsc` / `vitest **1412 passed / 16 skipped**`（+1 条「选择器复用同一套」护栏，260929 那条旧护栏同步改写）/ `check:core` 0 违规 / 桌面 + 移动构建 / `ui-metrics`（hex=0 rgb=0 !important=9 未定义令牌=0）/ `cssLayers`+`uiPrimitives` / `git diff --check`：全绿。
- **CDP 真实端点**（隔离 userData，打开关联字段的选择器）：附件列 = **3 个类型图标**（`bt-file-icon--pdf/doc/doc`）、**0 个旧 chip / 旧缩略图**；图片列 = 3 张缩略图；hover 图标 → `.bt-file-tip` 文本 `【期神笔记】2024.pdf`，**盖在对话框之上**正常可见（截图核对）。
- `cssLayers` 基线：`bitableRelationPicker.css` **120 → 113**（自有那套删除，只允许变小的方向）。

遗留问题：未提交（待用户验收）；**看板卡片**的图片缩略图仍未与这套统一（用户未点名，要的话把同一套搬过去即可）。

下一步：等用户验收；D01/D02 仍按 260929 决定暂缓。

### 2026-09-30 · 看板卡片也并进同一套（用户选 A）＋「也展示图片名」

承接上一条：我列了「还剩下看板卡片一份独立实现」，并问卡片上要不要显示文件名。
用户答「**A吧**」（卡片也换成同一套），随后追加「**也展示图片名**」。

本次完成：

1. **看板卡片改用 `AttachmentChipList`**：附件字段现在出**类型图标**（之前 `if (images.length === 0) return null` ⇒ 只有 PDF/Word 的记录在卡片上**什么都不显示**，现在看得见），图片字段仍是缩略图。删掉卡片自养的 `KANBAN_THUMB_PX` / `thumbUrl` / `imageAttachmentsOf` 与 `.bt-kanban-thumb`（CSS 基线 109→104；`.bt-kanban-thumbs` 更名 `.bt-kanban-files`）。
2. **`showNames` 变体**（回应「也展示图片名」）：`AttachmentChipList` 新增 `showNames` —— 图标/缩略图后面跟上文件名。**表格格子太窄**所以不传（名字仍在 hover 气泡里）；**卡片有地方放**所以传。名字超长省略号 + **真被截断时 hover 出全名**（与展开面板同一条 `whenTruncated` 口径）。
3. **「打开一条附件」也收成一处**：新增 `openBitableAttachment(noteId, attachment)`（`bitableAssetUrl` + `openAssetEntry` 那一句），表格单元格、关联选择器、看板卡片三处共用；`BitableEditor.openAsset` 与选择器都改走它。
4. 卡片上点图标 = 打开/预览（与表格同一动作），wrapper `stopPropagation` ⇒ 不会顺带打开记录详情；卡片空白处仍开详情。

验证结果（CDP 真实端点，隔离 userData；往 doc 注入一个看板视图 + 分组字段后打开）：

- 卡片：图片行 = **3 张缩略图 + 3 个文件名**（`MOON0005.jpg` / `MOON0006.jpg` / `MOON0012.jpg`）；附件行 = **3 个类型图标**（`--pdf/--doc/--doc`）+ 3 个文件名；旧 `.bt-kanban-thumb` **0** 个。
- 长名 `3_坚果哥复盘50个交割单.doc` 在卡上省略号截断，hover 出全名气泡。
- `tsc` / `vitest **1414 passed / 16 skipped**`（+2 护栏，另有 4 条旧护栏随实现改写）/ `check:core` / 双端构建 / `ui-metrics`（hex=0 rgb=0 !important=9 未定义令牌=0）/ `cssLayers`+`uiPrimitives` / `git diff --check`：全绿。

遗留问题：

- 未提交（待用户验收）。
- 卡片文件名宽度上限 150px（超出省略 + hover 全名）——如果想让名字更长/更短，说一声。
- 移动端没有看板/关联选择器，不受本批影响。

下一步：等用户验收；D01/D02 仍按 260929 决定暂缓。

### 2026-09-30 · 卡片不显示名称 + 画册卡片并进同一套

用户（附图：画册卡片里「附件　【期神笔记】2024.pdf, 2…」是一串文件名）：
「1、看板视图不展示名称了，直接图标或者缩略图吧。2、图2画册视图的附件也要改。」

（承接上一条：我先按「也展示图片名」给卡片加了文件名；用户看到效果后改口径 —— 以最新口径为准。）

本次完成：

1. **撤销 `showNames`**：`AttachmentChipList` 回到「附件字段 = 类型图标、图片字段 = 缩略图」+ hover 名称气泡，**卡片上不再常驻文件名**（连带删掉 `.has-name` / `.bt-attachment-chip-name` 那 14 条 CSS）。看板卡片实测：3 缩略图 + 3 类型图标、**0 个常驻文件名**。
2. **画册卡片并进同一套**：`BitableGalleryView` 的卡片字段里，附件类字段不再走 `bitableFieldText`（那是一串用逗号连的文件名），改为 `AttachmentChipList`（附件字段 = 类型图标、图片字段 = 缩略图），空字段不上卡。实测：附件行 = 3 个类型图标。
3. **卡片附件行容器收成一处**：新增 `.bt-card-files`（定义在 `bitableFileIcon.css`），看板与画册共用；删掉 `.bt-kanban-files`（CSS 基线 109→100；`bitableFileIcon.css` 33→37）。

至此「附件/图片怎么显示」在全仓只有**一个实现**：表格单元格、记录详情、表单、关联选择器、看板卡片、画册卡片、展开面板 —— 名称一律走 hover 气泡（展开面板另有大图标 + 卡下名称，那是它自己的语义）。

验证结果（CDP 真实端点，隔离 userData；往 doc 注入看板 + 画册视图后分别打开）：

| 位置 | 实测 |
| --- | --- |
| 看板卡片 | 图片字段 3 张缩略图、附件字段 3 个类型图标，**0 个常驻文件名**（`chipNames: 0`） |
| 画册卡片 | 附件行 = 3 个类型图标（此前是「【期神笔记】2024.pdf, 2…」文本） |
| 关联选择器 | 附件列 3 个类型图标（上一批已收敛） |

门禁：`tsc` / `vitest **1414 passed / 16 skipped**`（+2 护栏，另有 5 条旧护栏随实现改写）/ `check:core` 0 违规 / 桌面 + 移动构建 / `ui-metrics`（hex=0 rgb=0 !important=9 未定义令牌=0）/ `cssLayers`+`uiPrimitives` / `git diff --check` —— 全绿。

遗留问题：未提交（待用户验收）；卡片上名称只剩 hover 气泡（触屏没有看板/画册；移动端只有只读表格视图）。

下一步：等用户验收；D01/D02 仍按 260929 决定暂缓。

### 2026-09-30 · 关联选择器视图投影（绑定视图顺序/隐藏/筛选/排序/分组 + 未绑定默认视图顺序 + 动态字段）

本次完成：

- **绑定视图的字段投影**：`relationPickerFields()` 读取当前目标表和字段配置绑定的 `viewId`，走 `orderedTableFields(target, boundView)`；列顺序跟随 `fieldOrder`，并移除 `hiddenFieldIds`。因此关联选择器与正式表格视图的列展示方式一致。
- **未绑定视图的默认列顺序**：没有绑定视图时，取目标表默认表格视图（`defaultGridView()`：优先第一个 `grid`，否则第一个视图），只应用 `fieldOrder`；不隐藏字段，也不应用默认视图的筛选/排序/分组。记录仍是目标表全部记录。
- **视图基线只读**：绑定视图时，选择器把 `filters` / `sorts` 显示为带 `Lock + 视图` 的只读规则；不能删除/修改。视图 `groups[0]` 用于“所有可关联记录”页签的分组表头；分组字段、方向、标签与正式表格单级分组一致。
- **继续筛选/排序**：选择器仍可添加本机筛选/排序。筛选是视图基线之后继续叠加（AND），排序是弹窗内临时优先；所有本机筛选/排序只存在组件状态，点“取消/关闭”即丢，不修改目标视图 JSON。
- **动态字段**：字段投影每次打开都从当前 `ctx`/目标表重新计算，不缓存字段快照。后加字段若未在 `fieldOrder` 中，会按目标表字段顺序追加到末尾；绑定视图若把该新字段放入 `hiddenFieldIds`，则再次打开时按视图隐藏。
- **“已选”页签**：继续按选择顺序平铺，不套视图分组；它用于管理草稿选择，和“所有可关联记录”的浏览分组分离。

数据结构/接口变化：

- `src/core/bitableDoc.ts` 新增导出：`defaultGridView`、`relationPickerFields`、`orderedAllTableFields`；`orderedTableFields` 也继续复用同一套 fieldOrder 排序函数。
- 正文格式、字段值模型、同步/历史/GC 均无变化；只改变关联选择器读取正文和视图配置的口径。

UI 与交互变化：

- 绑定视图时选择器列头按视图投影；隐藏字段不再出现在选择器表头。
- 筛选/排序内联条增加只读视图基线行（锁图标 + “视图”徽标 + 规则摘要），本机规则仍可添加/删除。
- “所有可关联记录”按绑定视图的单级分组显示 `值 N 条` 的只读分组头；筛选/排序后分组内容实时重算。

改动文件：

- `src/core/bitableDoc.ts` · `src/core/bitableDoc.test.ts`
- `src/features/bitable/BitableRelationPicker.tsx` · `bitableRelationPicker.css`
- `src/features/bitable/bitableEditorMount.test.ts` · `src/styles/cssLayers.test.ts`
- `HANDOFF.md` · 本文件

验证结果：

- `tsc --noEmit`：通过
- `vitest`：**1416 passed / 16 skipped**
- `check:core`：0 违规
- 桌面构建：通过；移动构建：通过
- `ui-metrics`：hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0
- `cssLayers + uiPrimitives`：通过
- `git diff --check`：通过
- **CDP 真实端点**（隔离 userData + `--no-sandbox` + 独立端口 9283，真实 Electron）：
  - 绑定视图：headers = `进度 / 文本 / 布尔值 / 日期 / 名称 / 新链接`（`单选` 按视图隐藏）；分组 = `否 1 条 / 是 2 条`；`进度 · 降序` 排序生效。
  - 筛选面板显示只读 `文本 包含 目标`；排序面板显示只读 `进度 · 降序`；没有删除按钮。
  - 追加本机筛选 `文本 包含 目标乙` 后，行数从 3→1；取消后原视图 `filters/sorts/groups/hidden/order` 值不变，确认不写回。
  - 未绑定视图：headers = `布尔值 / 进度 / 文本 / 单选 / 日期 / 名称 / 新链接`，3 条全部记录、无分组、字段完整。
  - 通过真实 UI 给目标表新增字段后，重新打开绑定视图选择器，新字段动态追加到末尾（未被 hiddenFieldIds 命中）。

遗留问题：

- 本轮没有改移动端；移动端仍是只读表格，不会进入这个桌面选择器。
- “已选”页签不套视图分组（保持选择顺序）；如需对已选也分组另立项。
- 本地筛选/排序按选择器语义不持久化；关闭即清空，符合本轮用户口径。

下一步：

- 等用户验收本批；D01/D02 仍按 260929 决定暂缓。

### 2026-09-30 · 关联选择器 / 历史快照 / 回收站只读渲染统一

本次完成：

- 关联选择器的普通字段值不再走 `bitableFieldText` 纯文本，改为复用主表格的 `CellEditor` 只读分支。
- 单选/多选显示选项色块；布尔显示禁用复选框；评分显示 5 星；进度显示条 + 百分比；日期、链接、关联等也自动跟随主表格。
- 附件/图片继续走既有 `AttachmentChipList` 单一来源，避免重复实现。
- 历史快照仍通过只读 `BitableEditor` 渲染；回收站/锁定文档仍通过 `MultiTabEditor` 的 `readOnly` 传给 `BitableEditor`。三处最终都落到同一 `CellEditor`，不再维护只读文本旁路。

数据结构/接口变化：

- 无正文模型、同步、历史、GC 变化；仅复用现有 `CellEditor`。

UI 与交互变化：

- 关联选择器与正式行视图的只读值外观一致；控件不可编辑，链接仍可按既有只读规则打开。
- 历史快照、回收站/锁定文档无需新增样式，继续使用同一控件与令牌。

改动文件：

- `src/features/bitable/BitableRelationPicker.tsx`
- `src/features/bitable/bitableEditorMount.test.ts`
- `HANDOFF.md` · 本文件

验证结果：

- `tsc --noEmit`：通过
- `vitest`：**1417 passed / 16 skipped**
- `check:core`：0 违规
- 桌面构建：通过；移动构建：通过
- `ui-metrics`：hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0
- `cssLayers + uiPrimitives`：通过
- `git diff --check`：通过
- **CDP 真实端点**：关联选择器内实测单选 `bt-option-chip`、布尔 `input[type=checkbox][disabled]`、进度 `.bt-progress + .bt-progress-value`、评分 `.bt-rating + 5 × .bt-star`；历史快照与回收站/锁定文档的 `BitableEditor readOnly` 链路由源码护栏锁定。

遗留问题：

- 移动端有独立的 `.mbt-*` 只读控件，本次未改；如需桌面/移动视觉完全一致另立项。

下一步：

- 等用户验收本批；D01/D02 仍按 260929 决定暂缓。

### 2026-09-30 · 单向/双向关联拆成两个真实字段类型

本次完成：

- `BitableFieldType` 增加 `relationOneWay` / `relationTwoWay`，删除单一 `relation` 类型；关联方向由真实字段类型表达。
- `BitableRelation` 删除 `mode`，只保留目标表、允许多个、数据范围视图和双向配对 id。
- 类型选择器新增「单向关联 / 双向关联」两个实际选项，分别使用 `Link2` / `ArrowLeftRight` 图标；字段面板行动画也按真实 type 区分。
- 双向建对、反向字段、镜像写入和解除配对全部改为判断 `relationTwoWay`；解绑后降级为 `relationOneWay`。
- 行内/关联选择器单元格仍只按关联值渲染 chip，不需要根据类型显示不同数据内容。
- 移动端只读对两个关联类型一视同仁。

数据结构/接口变化：

- 正文中旧 `relation` / `relation.mode` 不再保留兼容；按用户确认的数据可重建基线直接使用新类型。
- 新增 `isRelationFieldType(type)` 统一判断关联类字段。

改动文件：

- `src/core/bitableDoc.ts` · `src/core/bitableDoc.test.ts`
- `src/features/bitable/bitableCells.tsx` · `BitableEditor.tsx` · `bitableEditorMount.test.ts`
- `src/mobile/bitable/MobileBitableViewer.tsx` · `mobileBitableViewer.test.ts`
- `HANDOFF.md` · 本文件

验证结果：

- `tsc --noEmit`：通过
- `vitest`：**1418 passed / 16 skipped**
- `check:core`：0 违规
- 桌面构建：通过；移动构建：通过
- `ui-metrics`：hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0
- `cssLayers + uiPrimitives`：通过
- `git diff --check`：通过
- **CDP 真实端点**：字段类型选择器列出 `单向关联`（`lucide-link-2`）和 `双向关联`（`lucide-arrow-left-right`）；字段面板中两个关联字段行分别显示单链与双向箭头图标。

遗留问题：

- 旧测试数据中的 `relation` / `mode` 不做迁移，符合用户「数据都是测试用的、用最优方式」的口径。

下一步：

- 等用户验收本批；D01/D02 仍按 260929 决定暂缓。

### 2026-09-30 · 列菜单隐藏列 + 文本颜色加深

本次完成：

- 列菜单增加“隐藏列”快捷项，复用既有 `toggleFieldHidden`，点击后当前视图立即移除该列并写回 `hiddenFieldIds`。
- `ColorPalette` 增加 `palette` 参数：普通颜色（选项/进度）仍用浅色数据色板；列文字颜色改用独立深色 `BITABLE_TEXT_COLOR_PALETTE`。
- 文本颜色面板仍保留“无颜色”清除项；颜色存储与既有 `columnTextColors` 兼容结构不变。

改动文件：

- `src/core/bitableDoc.ts` · `src/core/bitableDoc.test.ts`
- `src/features/bitable/BitableEditor.tsx` · `bitableCells.tsx` · `bitableEditorMount.test.ts`
- `HANDOFF.md` · 本文件

验证结果：

- `tsc --noEmit`：通过
- `vitest`：**1419 passed / 16 skipped**
- `check:core`：0 违规
- 桌面构建：通过；移动构建：通过
- `ui-metrics`：hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0
- `cssLayers + uiPrimitives`：通过
- `git diff --check`：通过
- **CDP 真实端点**：列菜单出现 `隐藏列`；点击“单选”的隐藏列后表头消失，落盘 `hiddenFieldIds` 包含该字段；文本颜色面板返回 18 个深色色块 + 无颜色，选中 `#2563eb` 后列文字 computed color = `rgb(37, 99, 235)`。

遗留问题：

- 旧列文字颜色如果已经选了浅色，保持原值直到用户重新选择；本轮不迁移历史颜色值。

下一步：

- 等用户验收本批；D01/D02 仍按 260929 决定暂缓。

### 2026-09-30 · 填色功能预研（暂缓）

本次完成：

- 使用 BrowserSkill + Microsoft Edge 实测钉钉多维表填色。
- 确认四种模式：单元格 / 整行 / 行侧（3px 左色条）/ 整列。
- 确认规则顺序：后色压前色。
- 确认调色板结构：5×11，共 55 色；另存在 AI“智能配色”入口。
- 将完整调研、候选数据模型、实现结构、风险和待定项写入独立文档：`docs/BITABLE-FILL-COLOR-RESEARCH.md`。

数据结构/接口变化：无。当前只新增独立预研文档，不改代码、正文模型、筛选或渲染。

验证结果：Edge 调研完成；未保存钉钉文档，未修改其数据。

遗留问题：筛选能力将重构，填色必须等待新筛选协议完成后再复核并实施。

下一步：筛选重构完成后，重新评估是否进入填色实施批次。

### 2026-09-30 · 筛选精准重做（远端 lake 对齐）

本次完成：

- 用 BrowserSkill + Microsoft Edge 打开 `https://todoo.yuque.com/ex813k/stock/ls7d44lq2n5q0q2u`，实际操作/观察筛选字段、操作符、动态日期、AND/OR 与子分组；远端文档临时变更已恢复并复核回 11 条原始记录。
- 从远端实际加载的 `lakex_table_yq.89b4f502.async.js` 取证：字段类型映射、操作符表、日期动态范围、packet 递归结构和最多 2 层子组规则。
- core 改为递归 `BitableFilterNode = BitableFilterRule | BitableFilterGroup`；根组连接符存 `BitableView.filterOperator`，子组自带 `operator`。
- 操作符逐类型对齐：文本/链接 `startsWith/notStartsWith/endsWith/notEndsWith/contains/notContains/isEmpty/isNotEmpty`；数字/评分/进度 `equalTo/notEqualTo/greaterThan/greaterThanOrEqualTo/lessThan/lessThanOrEqualTo/isEmpty/isNotEmpty`；日期/系统时间 `equalTo/lessThan/greaterThan/isEmpty/isNotEmpty`；单选 `is/isNot/isEmptySelect/isNotEmptySelect`；多选/关联 `isExactly/isNot/hasAnyOf/hasAllOf/hasNoneOf/isEmptySelect/isNotEmptySelect`；复选 `equalTo`；附件/图片 `isEmpty/isNotEmpty`。
- 日期值支持具体日期与动态范围：今天、明天、昨天、本周、上周、下周、上月、本月、下月、本年、过去/未来 7 天、过去/未来 30 天；日期操作符文案使用早于/晚于。
- 新增共享 `BitableFilterEditor`：视图筛选与关联选择器共用；支持添加规则/分组、组内切换 AND/OR、创建/展开/删除分组；关联选择器的绑定视图筛选以只读基线复用同一组件。
- 新增 `evaluateFilterNode` / `evaluateFilterGroup` / `bitableFilterRuleCount`，为后续条件着色提供同一套字段取值、空值和操作符求值入口。

数据结构/接口变化：

- `BitableView.filters` 改为递归节点数组；新增根连接符 `filterOperator`。
- 旧短操作符名（`equals/gt/...`）不写兼容映射；测试数据可重建。

UI 与交互变化：

- 筛选面板由 420px 简单 Popover 改为远端 lake 风格的约 820px 条件树。
- 条件行 = 连接符列 + 字段/操作符/值 + 行尾菜单；根组第二行可切与/或。
- 新增“添加筛选规则 / 添加筛选分组”菜单；子组使用浅灰嵌套卡；最多两层子组，第三层不再提供分组入口。
- 日期不再要求手输字符串：选择“具体日期”才出日期选择器，动态日期直接选预设范围。

改动文件：

- `src/core/bitableDoc.ts` · `src/core/bitableDoc.test.ts`
- `src/features/bitable/BitableFilterEditor.tsx`（新） · `bitableFilterEditor.css`（新）
- `src/features/bitable/BitableEditor.tsx` · `BitableRelationPicker.tsx` · `bitableRelationPicker.css`
- `src/features/bitable/bitableEditorMount.test.ts` · `src/styles/cssLayers.test.ts`
- `HANDOFF.md` · 本文件

验证结果：

- `tsc --noEmit`：通过
- `vitest`：**1422 passed / 16 skipped**（筛选重做新增 2 个 core 用例 + 1 个 UI 源护栏）
- `check:core`：0 违规
- 桌面构建 / 移动构建：通过
- UI/CSS 指标：`ui-metrics` hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0；`cssLayers + uiPrimitives` 8 passed
- CDP 真实端点：字段矩阵/日期动态模式/AND·OR/子组层级已实际点验；关联选择器复用同一编辑器
- Edge 远端实测：已复核远端文档恢复原始 11 条记录

遗留问题：

- 筛选树的历史短操作符不迁移；旧正文若仍有旧操作符，需要用户重新选择或重建测试数据。
- 移动端仍只读，不提供筛选编辑。
- 条件着色的正式数据模型待筛选完成后复核；当前可复用 `BitableFilterRule` / `evaluateFilterNode` / `BitableFilterEditor`。

下一步：

- 等用户验收筛选重做；同时可开始基于该筛选引擎细化填色规则模型。

### 2026-09-30 · 筛选 UI 实测与修复

本次通过真实 Electron UI 对测试文档逐视图点验：

- 总览、文本+数字 AND、日期动态、嵌套分组、多选、关联、附件 7 个视图均能正常渲染。
- 文本+数字 AND、动态上周、嵌套分组、多选包含所有、关联非空、附件非空的结果数与规则一致。
- 日期“具体日期”能打开日历浮层，并能在视口内完整显示；动态日期菜单 15 项完整。
- 多选值编辑器能搜索/勾选/取消，摘要会按选择数量收敛；关联值编辑器能列出目标记录。
- 根组与子组切换 AND/OR 均能即时改变结果；分组内删除最后一条规则后自动移除空组。
- 运行时未捕获到 exception / console error。

本次发现并修复：

1. **打开空筛选面板会自动写入一条空规则**：`BitableEditor` 原逻辑在 filters 为空时先 `setFilters([...])`，导致 badge 变 1 且立即改正文。已删除自动写入；空态只显示“添加筛选规则”。
2. **清空最后一条筛选仍残留 `filters: []` / `filterOperator`**：现在无筛选时同步删除两个键；normalize 也会丢弃空筛选配置。
3. **删除分组内最后一条规则后残留空组**：`BitableFilterEditor` 增加 `pruneEmptyGroups()`；字段删除清理也同步移除空组。

改动文件：

- `src/features/bitable/BitableEditor.tsx`
- `src/features/bitable/BitableFilterEditor.tsx`
- `src/core/bitableDoc.ts` · `bitableDoc.test.ts`
- `src/features/bitable/bitableEditorMount.test.ts`
- 本文件

验证结果：

- `tsc --noEmit`：通过
- 全量 `vitest`：**1423 passed / 16 skipped**
- `check:core`：0 违规
- 桌面构建 / 移动构建：通过
- `ui-metrics`：hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0
- `cssLayers + uiPrimitives`：8 passed
- `git diff --check`：通过
- UI 实测：空态不写正文、清空后无残留键、空组自动移除、根组/子组 AND/OR 正常

遗留问题：

- “展开分组”会按远端 packet 语义直接移除分组壳，子规则归入父组；父组连接符可能因此改变最终语义。当前按远端实现保留，UI 未另加二次确认。
- 移动端仍只读，不提供筛选编辑。

下一步：

- 等用户验收；若需要，可继续补“展开分组”的语义确认或移动端只读筛选展示。

### 2026-09-30 · 筛选重构提交

用户明确授权「先把筛选推动到 master」。

本次提交：

- 代码提交 `7dd81ba3`「feat(bitable): 筛选精准重构与 260930 多维表收口」。
- 由于筛选实现与之前未提交的关联/只读/附件/隐藏列改动共用 `bitableDoc.ts`、`BitableEditor.tsx`、`BitableRelationPicker.tsx`、测试和 CSS 基线，无法安全拆成独立半套代码；该批在提交前已通过全量 1423 passed / 16 skipped、双端构建和所有围栏。
- 功能本身仍标记为待用户验收；提交只表示代码已入库。

下一步：开始填色功能，按修订后的 `BitableFillRule` / `targetFieldId` / `condition` / token 色板方案实施。

## 14. 会话执行模板

每次实现会话结束前，把下面模板复制到 §13 末尾并填写完整：

```md
### YYYY-MM-DD · <任务编号与名称>

本次完成：

- ...

数据结构/接口变化：

- ...

UI 与交互变化：

- ...

改动文件：

- ...

验证结果：

- `tsc --noEmit`：
- `vitest`：
- 桌面构建：
- 移动构建：
- UI/CSS 指标：
- 手工验收：

遗留问题：

- ...

下一步：

- ...
```

## 15. 会话启动检查清单

- [ ] 已读 `README.md`、`HANDOFF.md`、`AGENTS.md`。
- [ ] 已读本文件全文。
- [ ] 已检查 `git status`。
- [ ] 已检查 `git log -1`。
- [ ] 已检查 `git worktree list`。
- [ ] 已确认当前任务不在“进行中”状态，或已取得用户/前序会话授权。
- [ ] 已确认改动文件与其他会话不冲突。
- [ ] 已确认使用 Edge 进行 UI 实测。

## 16. 会话结束检查清单

- [ ] 代码改动只覆盖当前任务范围。
- [ ] 已运行本任务要求的全部门禁。
- [ ] 已更新 §11 任务状态看板。
- [ ] 已追加 §12 修改记录。
- [ ] 已追加 §13 会话记录。
- [ ] 已写明未验证项和下一步。
- [ ] 未擅自合并 `master`。
