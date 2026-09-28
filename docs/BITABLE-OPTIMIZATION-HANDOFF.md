# 多维表优化落地与交接文档（Single Source of Truth）

> 状态：**方案已冻结；V01 已完成，V02–V04 + 260928 三批追加需求 + T01/T03/T04 + T02A 基础字段已实施，一并待验收**（其余 T02B / T06 / D 批次未开始）。
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
- 不做条件填色。
- 不做跨多维表文档关联。
- 不做跨文档数据互通。
- 不做在多维表字段中嵌入文档。
- 关联只发生在**同一个 `kind="bitable"` 文档内的不同 `tables[]`**。
- 文档仍然是数据边界：一个文档可以有多张表并互相关联；不同多维表文档之间完全隔离。

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
- 字段配置提供“允许添加多个记录”，默认开启；关闭后只能选一条。
- 第一版只允许关联目标表的全部记录，不做字段级数据范围筛选。
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

条件填色不做，但以下现有能力保持不动：

- 单选/多选选项 chip 颜色
- 列文字颜色
- 调色板
- 高亮重复值

不要因为“暂不做条件填色”而顺手删除这些能力。

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
  | "relation"
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
- `relation` 继续作为关联字段类型，不拆成两个独立类型。

### 6.2 关联字段配置

建议扩展 `BitableRelation`：

```ts
interface BitableRelation {
  tableId?: string;
  mode?: "oneWay" | "twoWay";
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
6. `T03` 多级分组
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

## 11. 任务状态看板

> 每次会话开始和结束都更新这里。状态值：`未开始` / `进行中` / `阻塞` / `待验收` / `已完成` / `已废弃`。

| 任务 | 状态 | 当前会话 | 说明 |
| --- | --- | --- | --- |
| 方案冻结 | 已完成 | 260928 | 产品边界和顺序已确认 |
| V01 多视图工作台 | 已完成 | 260928-V01 | 用户 260928 验收通过（见 §13） |
| V02 看板视图 | 待验收 | 260928-V02 | 代码 + 全部门禁 + CDP 真实端点验收完成；含只读写入口泄漏修复（见 §13） |
| V03 画册视图 | 待验收 | 260928-V03 | 封面 / 裁剪·适应 / 常规·紧凑 / 卡片字段全部落地（见 §13） |
| V04 日历视图 | 待验收 | 260928-V04 | 月网格 + 跨天 + 颜色 + 拖拽平移，全程本地日期语义（见 §13） |
| T01 列级统计 | 待验收 | 260928-T01 | 视图级列统计（通用/数字/日期），底栏贴底常驻、随筛选现算（见 §13） |
| T03 多级分组 | 待验收 | 260928-T03 | 最多 3 级 + 拖动调优先级 + 层级缩进；折叠按节点 key（见 §13） |
| T04 语义排序增强 | 待验收 | 260928-T04 | 单选/多选「选项顺序·逆序」，日期文案早→晚/晚→早（见 §13） |
| T02A 基础字段 | 待验收 | 260928-T02A | 布尔/链接/评分/进度/创建·修改时间；**系统时间可筛选/排序/分组/统计**（记录级取值口径，见 §13） |
| T02B.1 关联基础模型 | 未开始 | - | 同一文档内多表 |
| T02B.2 单向关联 | 未开始 | - | 多选默认开启 |
| T02B.3 双向关联 | 未开始 | - | 反向字段与配对一致性 |
| T06 表单本地增强 | 待验收 | 260928-T06 | 编辑态恢复 v1 原形态，「填写表单」= 跳到预览 tab（无独立弹层）；已配置默认进预览（见 §13） |
| T07 图片字段类型 | 待验收 | 260928-T07 | image 复用附件值模型，上传/拖拽/粘贴三路只收图片（见 §13） |
| F01 图片预览总数 | 待验收 | 260928-F01 | 文档预览改用**正文**图片表（虚拟渲染下 DOM 不全 ⇒ 切不动）；预览范围**恒为单个单元格**（见 §13） |
| F02 附件命名审计 | 待验收 | 260928-F02 | 磁盘名绝不外显/不可编辑（统一守卫）+ bitable 展示名取用户原始文件名（见 §13） |
| F03 表单编辑态回退 + 看板缩略图 | 待验收 | 260928-F03 | 编辑态恢复 v1；看板图片字段上卡出缩略图（见 §13） |
| V03.1 画册封面点预览 | 待验收 | 260928-V03.1 | 点封面把**本视图全部图片封面**交给 Lightbox（可左右切换，见 §13） |
| D01 CSV 导入导出 | 未开始 | - | 不依赖新重型库优先 |
| D02 JSON 导入导出 | 未开始 | - | 完整结构导出 |
| V05 图表视图 | 已废弃 | - | 产品确认不做 |
| T05 条件填色 | 已废弃 | - | 产品确认不做；现有颜色能力保留 |

## 12. 修改记录

> 追加格式：`日期 / 会话 / 任务 / 改动文件 / 结果 / 遗留`。

| 日期 | 会话 | 任务 | 改动 | 结果 | 遗留 |
| --- | --- | --- | --- | --- | --- |
| 2026-09-28 | 260928 | 调研与方案冻结 | 新增本文档 | Edge 实测、竞品对账、产品决策完成 | 待开始 V01 |
| 2026-09-28 | 260928-V04 | V04 日历视图 | `src/core/bitableDoc.ts`(+test) · `src/features/bitable/BitableCalendarView.tsx`(新) · `bitableCalendarView.css`(新) · `BitableViewConfigPanels.tsx`(新) · `BitableEditor.tsx` · `bitableEditorMount.test.ts` · `src/styles/cssLayers.test.ts` | 门禁全绿 + CDP 真实端点验收通过（拖拽改日期已落盘核对） | 不做农历/节假日/重复日程/提醒；移动端只读回退 |
| 2026-09-28 | 260928-F02 | 附件命名审计 | `src/features/bitable/BitableEditor.tsx` · `bitableEditorMount.test.ts` | 复核 main 侧契约：附件 filename=展示名、url 末段=磁盘名、buildAssetFilename 随机唯一（无去重）；bitable 展示名改取 `file.name` | 无新增改动面 |
| 2026-09-28 | 260928-F01 | 图片预览总数 | `src/features/editor/imagePreview.ts`(+test) · `LakeEditor.tsx` · `BitableGalleryView.tsx` · `BitableEditor.tsx` · `bitableEditorMount.test.ts` | 实测 10 图文档预览 1/10 → 10/10；画册点封面 1/2 → 2/2 | 同一张图重复出现时按首次匹配定位下标 |
| 2026-09-28 | 260928-T04 | T04 语义排序增强 | `src/core/bitableDoc.ts`(+test) · `BitableEditor.tsx` · `bitableEditorMount.test.ts` | 门禁全绿 + 实测选项序 B/C/E→D→A、逆序反转、字典序不受影响 | 不做公式排序 |
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
