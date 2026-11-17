# 移动端顶部 Chrome 架构方案（A/B/C）

> 状态：**B0–B2 已实施（261117）** —— 契约 + 门禁 + 全表面迁移一次落地，实施记录见 §12；B3 剩余项（过冲归一化 / 设备矩阵 / 探针）也在 §12。
> 审计基线：`HEAD 22e432763` + 工作树中的 Android AI 顶部安全区修复。
> 范围：移动端首页、工作区、设置、抽屉、全屏浮层、内嵌页和 Sheet 的顶部几何。
> 不在范围：编辑器正文排版、内核卡片、同步、数据层、桌面端。

## 1. 要解决的问题

移动端顶部元素反复出现问题，表面症状包括：

- 顶栏高度反复调整；
- 顶部安全区有时重复计算，造成大块空白或元素下移；
- 页头、工具栏、抽屉、Sheet 对安全区的处理各自不同；
- 路由转场启用 `transform` 后，`position: fixed` 元素可能按错误容器定位；
- 改一处顶栏高度后，其它页面或浮层出现新的视觉差异。

近期已发生的代表性事件：

- 261027：部分 ROM / edge-to-edge 下 `env(safe-area-inset-top)` 返回 0，引入原生 WindowInsets 注入。
- 261103：补充横屏左右安全区。
- 261110：首页顶栏在同一天内经历 `52 → 44 → 40 → 44` 三次调档。
- 261115：首页顶栏滚动后出现不应有的玻璃灰条。
- 261117：AI 内嵌副工具栏位于首页顶栏之下，却再次消费顶部安全区，历史/新对话被推到页面中部。
- 桌面侧也发生过同类问题：261006 回收站成页把顶栏高度计算两遍。

这些不是同一个视觉 bug，但共同指向同一个结构问题：

> **安全区是全局事实，消费却分散在多个局部组件；顶部类名同时承担屏幕位置、页面角色、安全区、高度和滚动状态。**

## 2. 当前实现模型

### 2.1 全局安全区来源

- 原生 Android 通过 `WindowInsets(systemBars ∪ displayCutout)` 计算 CSS px，并注入：
  - `--mobile-native-top-safe`
  - `--mobile-native-bottom-safe`
  - `--mobile-native-left-safe`
  - `--mobile-native-right-safe`
- CSS 在 `src/mobile/theme/tokens.css` 中取 `max(env(...), native)`：
  - `--mobile-top-safe-area`
  - `--mobile-bottom-safe-area`
  - `--mobile-left-safe-area`
  - `--mobile-right-safe-area`

原生负责“真实值”，CSS 负责“消费方式”。目前原生值本身不是主要问题。

### 2.2 顶部表面的实际分类

| 顶层表面 | 是否位于另一个已处理安全区的顶栏之下 | 当前顶部处理 | 正确契约 |
| --- | --- | --- | --- |
| 首页顶栏 `.mobile-topbar--home` | 否 | 自己加 safe-area | viewport |
| 工作区顶栏 `.mobile-topbar` | 否 | 自己加 safe-area | viewport |
| 设置全屏页头 `.mobile-settings-head` | 否 | 自己加 safe-area | overlay/viewport |
| 左侧抽屉工具栏 | 否 | 自己加 safe-area | overlay/viewport |
| AI 独立页 / 历史页 `.mobile-topbar` | 否 | 自己加 safe-area | overlay/viewport |
| AI 内嵌副工具栏 `.mobile-ai-page__head` | 是，位于首页顶栏下 | 必须清零 safe-area | nested |
| 标签首页头 `.mobile-page-head` | 是，位于首页顶栏下 | 不再加 safe-area | nested |
| 日记首页头 `.mobile-page-head` | 是，位于首页顶栏下 | 不再加 safe-area | nested |
| 表格顶部条 `.mb-usheet-topbar` | 是，位于工作区顶栏下 | 不消费顶部 safe-area | nested |
| 多维表头部 `.mbt-header` | 是，位于工作区顶栏下 | 不消费顶部 safe-area | nested |
| 底部 Sheet `.mb-sheet__head` | 不在屏幕顶部 | 不应消费顶部 safe-area | sheet |

问题不在“有多个视觉形态”，而在“没有明确声明每个形态属于哪一类”。

### 2.3 当前高度来源

当前至少存在以下高度口径：

- `--mobile-topbar-height: 52px`；
- 首页顶栏 CSS 硬编码 `44px`；
- AI 内嵌副栏借用 `--mb-tap-min` 的 `44px`；
- Sheet 头使用自己的 `44px`；
- 设置页头由上下 padding 推导；
- 部分浮层写 `min-height: calc(52px + safe-area)`；
- 表格、多维表、日历等另有自己的头部高度。

这说明高度与安全区尚未形成单一语义来源。令牌名称也无法稳定表达“内容高度”还是“含安全区总高度”。

### 2.4 同类问题的正面对照：编辑器高度体系

编辑器高度和键盘适配已经形成了较好的单一 owner，可作为本次方案的参考：

- `src/mobile/hooks/viewportShell.ts`：稳定外壳高度；
- `src/mobile/editor/editSurfaceModel.ts`：纯几何算术；
- `src/mobile/editor/useEditSurface.ts`：键盘、面板、外壳高度的唯一 owner；
- `scripts/mobile-audit/edit-surface-invariants.mjs`：设备级不变量门禁。

顶部 Chrome 目前缺少同类 owner，这是重复修复的根本原因。

## 3. 目标契约

无论采用哪个方案，最终都应满足以下契约：

1. 顶部安全区只由“最外层屏幕表面”消费一次。
2. 位于已处理安全区的顶栏之下时，嵌套头部必须使用 `0px` 顶部 inset。
3. 顶部内容高度和安全区高度分开表达。
4. 业务 feature CSS 不再直接写 `44px`、`52px` 或 `var(--mobile-top-safe-area)`。
5. 不允许新增第二套顶栏视觉体系。
6. 不改变现有信息架构、按钮语义和页面布局。
7. 不触碰已验证稳定的 `useEditSurface` / `viewportShell` 键盘高度体系。

建议用以下语义表达顶部 inset context：

- `viewport`：直接贴近屏幕顶部，消费顶部安全区；
- `overlay`：全屏浮层顶部，消费顶部安全区；
- `nested`：位于已有顶部 Chrome 之下，不消费顶部安全区；
- `sheet`：底部 Sheet 或局部面板，不消费顶部安全区，除非明确扩展到屏幕顶部。

## 4. 方案 A：继续局部修补

### 4.1 做法

维持现有结构。每次发现某个顶部元素错位，就在对应 feature CSS 中增加一条复位规则，例如：

```css
.mobile-ai-page--embedded .mobile-ai-page__head {
  height: var(--mb-tap-min);
  margin-top: 0;
  padding-top: 0;
}
```

必要时增加点对点测试，防止该页面再次回退。

### 4.2 优点

- 当前改动最小；
- 单次修复速度快；
- 对现有视觉和 DOM 几乎无扰动；
- 适合发版前止损或单页面回归。

### 4.3 缺点

- 只解决问题实例，不解决类问题；
- 新页面复用 `.mobile-topbar` 时仍可能重复消费安全区；
- 覆盖规则会继续散落在 feature CSS；
- 高度令牌继续漂移；
- 页面越多，组合矩阵越大；
- 测试只能覆盖已经出过问题的页面。

### 4.4 适用条件

仅在以下情况使用：

- 即将发布，需要最小止损；
- 问题只影响一个页面且不会新增同类顶部结构；
- 没有余量进行跨页面回归。

### 4.5 结论

**不推荐作为长期方案。** 可以作为本次 AI 修复的过渡状态，但不应成为后续默认做法。

## 5. 方案 B：建立 Top Chrome 上下文契约（推荐）

### 5.1 核心思想

不新建第二套顶栏，也不强行把所有头部合并成一个 React 组件。只新增一层明确的“顶部几何契约”：

- 每个顶部表面显式声明自己属于 `viewport / overlay / nested / sheet`；
- 统一由该声明决定是否消费顶部安全区；
- 现有视觉组件继续保留；
- 高度拆成内容高度与 inset 高度两个部分；
- 业务页面不再自行处理顶部安全区。

### 5.2 建议的组件入口

新增一个只负责几何与布局槽位的轻量组件，例如 `src/mobile/ui/MobileTopBar.tsx`，或在现有头部原语上增加统一属性。推荐 API：

```tsx
<MobileTopBar edge="viewport" size="compact" />
<MobileTopBar edge="overlay" size="regular" />
<MobileTopBar edge="nested" size="compact" />
```

如果暂时不抽 React 组件，也可以先使用统一 DOM 契约：

```html
<header data-mb-topbar data-edge="viewport" data-size="compact">
```

约束：

- `data-edge` 是语义来源；
- `data-size` 只决定内容高度；
- 不允许业务页面通过自己的类再次消费 `--mobile-top-safe-area`。

### 5.3 建议的 CSS 模型

```css
:root {
  --mb-chrome-h-compact: 44px;
  --mb-chrome-h-regular: 52px;
}

[data-mb-topbar] {
  --mb-chrome-inset-top: 0px;
  --mb-chrome-content-h: var(--mb-chrome-h-compact);
  height: calc(var(--mb-chrome-content-h) + var(--mb-chrome-inset-top));
  padding-top: var(--mb-chrome-inset-top);
  margin-top: 0;
  box-sizing: border-box;
}

[data-mb-topbar][data-size="regular"] {
  --mb-chrome-content-h: var(--mb-chrome-h-regular);
}

[data-mb-topbar][data-edge="viewport"],
[data-mb-topbar][data-edge="overlay"] {
  --mb-chrome-inset-top: var(--mobile-top-safe-area);
}
```

关键点：

- `nested` 和 `sheet` 默认 `--mb-chrome-inset-top: 0px`；
- 不再用 `safe-area - 8px` 之类的隐式运算；
- 不再让 `.mobile-topbar` 的默认值默默带安全区；
- 横向安全区仍由页面容器或统一 frame 处理，不和顶部高度混在一起。

### 5.4 对现有组件的迁移映射

| 现有选择器 | 目标 edge | 目标 size | 备注 |
| --- | --- | --- | --- |
| `.mobile-topbar--home` | viewport | compact | 保留首页三列网格 |
| 工作区 `.mobile-topbar` | viewport | regular | 保留手机/平板差异 |
| `.mobile-settings-head` | overlay | regular | 保留设置页的大标题规则 |
| `.mobile-page-head` | nested | regular | 去掉内部 safe-area 覆盖 |
| AI 内嵌 `.mobile-ai-page__head` | nested | compact | 现有修复并入统一契约 |
| AI 独立/历史 `.mobile-topbar` | overlay | regular | 全屏页自行消费安全区 |
| `.mb-usheet-topbar` | nested | regular | 继续只处理工作表工具 |
| `.mbt-header` | nested | 自定义 | 多维表多行头部不回退 |
| `.mb-sheet__head` | sheet | compact | 默认不消费顶部 safe-area |
| `.mobile-model-head` | sheet | regular | 复核是否需要顶部 safe-area；当前属于可疑口径 |

### 5.5 实施步骤

#### 第 1 批：契约与门禁，无视觉变化

- 在 tokens 中新增内容高度令牌；
- 增加 `data-edge` / `data-size` CSS 契约；
- 增加静态扫描测试，限制 `var(--mobile-top-safe-area)` 的允许使用点；
- 保持现有页面外观不变。

可用门禁：

- `src/mobile/mobileLayers.test.ts` 已有 CSS 分层围栏；
- 新增 `mobileTopChromeContract.test.ts` 检查：
  - 所有顶栏声明了 `data-edge`；
  - 只有 `viewport` / `overlay` 可以引用顶部安全区；
  - 业务 feature CSS 不允许新增 `--mobile-top-safe-area`。

#### 第 2 批：迁移 viewport 与 overlay

- 首页顶栏；
- 工作区顶栏；
- AI 独立页 / 历史页；
- 设置页头；
- 左侧抽屉工具栏。

验收重点：

- 现有 44 / 52 视觉高度不变；
- 顶部安全区 0 / 32 / 48px 下均只计算一次；
- 页头内容不因设备 inset 不同而压扁。

#### 第 3 批：迁移 nested 与 sheet

- AI 内嵌头；
- 标签与日记首页头；
- 表格与多维表头部；
- Sheet 头部；
- 复核 `.mobile-model-head`。

重点删除以下类型的局部覆盖：

- 业务页中对 `margin-top: 0` / `padding-top: 0` 的成组复位；
- 直接使用 `--mb-tap-min` 作为顶栏高度的写法；
- 直接使用 `var(--mobile-top-safe-area)` 的业务 CSS。

#### 第 4 批：清理与文档回填

- 删除旧 selector 的安全区补丁；
- 回填 `docs/MOBILE-DESIGN.md` 和 `docs/MOBILE-TECH-STACK.md`；
- 更新 `docs/HANDOFF.md` 的文档地图与待办；
- 如果形成稳定判定，写入 AGENTS 的长期机制，而不是重复写历史故事。

### 5.6 优点

- 保留现有视觉和组件结构；
- 用显式 contract 解决重复 inset；
- 能逐步迁移，不需要一次性改完全部页面；
- 能够用静态测试和设备矩阵同时护栏；
- 与现有 `useEditSurface` 的 owner 模式一致；
- 不引入新依赖，不违背“不建第二套顶栏”原则。

### 5.7 风险与代价

- 需要逐个页面核对 `edge` 语义；
- 首个批次需要同时改 CSS、测试和部分 JSX；
- 有短期双轨期，必须设定清理截止点；
- `mobile-settings-head` 与普通 `mobile-topbar` 的内容布局差异仍然存在，不能强行合并视觉。

### 5.8 结论

**推荐采用。** 这是当前收益、风险和可维护性之间最平衡的方案。

## 6. 方案 C：由原生壳统一处理安全内容区

### 6.1 核心思想

把安全区从 Web CSS 中移除，由 Android 原生在 WebView 外层建立“安全内容矩形”：

- 原生监听 `WindowInsets`；
- 给 WebView 设置安全内边距或调整布局边界；
- Web 页面只看到已经扣除系统栏/刘海后的 viewport；
- CSS 不再需要使用 `--mobile-top-safe-area` 和 `--mobile-bottom-safe-area`。

### 6.2 优点

- 理论上只有原生一层 owner；
- Web 页面不需要理解 `viewport / nested / overlay`；
- 永久消除“重复消费 safe-area”这一类问题；
- 对未来增加 iOS 原生壳更友好。

### 6.3 风险与代价

- 必须重新验证 `position: fixed` 在以 WebView padding 建立的视口下如何定位；
- 全屏绘图、画板、图片 Lightbox、系统栏主题、状态栏背景色都要重验；
- 现有 `viewport-fit=cover`、`env(safe-area-inset-*)` 与原生注入会形成双轨；
- 底部键盘 `adjustResize` / edge-to-edge 的判定可能受影响；
- 与 `useEditSurface` / `viewportShell` 的外壳高度逻辑需要重新建立边界；
- Android WebView 与 iOS WKWebView 的行为不同，不能只凭 Android 结论直接类推；
- 需要真机覆盖多种 ROM、刘海、手势条和分屏/自由窗口。

### 6.4 适用条件

只有满足以下条件才建议采用：

- 准备重做移动壳或新增 iOS；
- 有稳定的真机矩阵和足够回归时间；
- 能接受对 fixed 元素、键盘和系统栏做统一重验；
- 明确放弃当前的 `viewport-fit=cover` + CSS safe-area 双通道模型。

### 6.5 结论

**长期候选，当前不推荐。** 当前项目已有成熟的 CSS safe-area 和编辑面高度逻辑，直接迁到原生安全内容区会引入过大的回归面。

## 7. 三方案对比

| 维度 | A：局部修补 | B：Top Chrome 契约 | C：原生安全内容区 |
| --- | --- | --- | --- |
| 首次成本 | 低 | 中 | 高 |
| 长期维护成本 | 高 | 低到中 | 低 |
| 回归风险 | 低到中，持续累积 | 中，可控 | 高 |
| 消除重复 safe-area | 否 | 是 | 是 |
| 保留现有视觉 | 是 | 是 | 需重验 |
| 影响编辑器高度体系 | 否 | 否 | 是 |
| 适合当前项目 | 只适合止损 | **最适合** | 仅适合重做移动壳 |

## 8. 推荐实施方案

### 8.1 总体决策

1. 保留 AI 顶部安全区修复作为立即止损。
2. 启动方案 B 的“契约阶段”，先无视觉变更地建立令牌和门禁。
3. 分 2 到 3 个提交批次迁移现有顶部表面。
4. 完成设备矩阵后删除临时覆盖。
5. 不在本轮考虑方案 C。

### 8.2 批次建议

| 批次 | 内容 | 交付物 |
| --- | --- | --- |
| B0 | 盘点 + tokens + 静态契约 | `data-edge` 契约、静态测试、文档 |
| B1 | 首页 / 工作区 / 设置 / AI 独立页 | viewport/overlay 迁移 |
| B2 | AI 内嵌 / 标签 / 日记 / 表格 / Sheet | nested/sheet 迁移 |
| B3 | 清理旧覆盖 + 设备矩阵 + 文档收口 | 删除旧补丁、回填 HANDOFF |

### 8.3 验收矩阵

设备/视口：

- 顶部安全区：`0 / 24 / 32 / 48px`
- 宽度：`360 / 412 / 768 / 1280px`
- 横竖屏：至少各一轮

页面：

- 首页知识库；
- 首页小记；
- 首页标签；
- 首页日记；
- 首页 AI；
- AI 历史页；
- 文档工作区；
- 表格工作区；
- 多维表工作区；
- 设置抽屉根页；
- 设置全屏子页；
- 左侧/右侧抽屉；
- 底部 Sheet；
- 全屏图片/附件预览。

判据：

1. `viewport` / `overlay` 顶部元素内容起点 = 安全区顶部；总高度 = 内容高度 + inset。
2. `nested` 顶部元素顶部 = 父级内容区域顶部；不得额外出现 inset 空白。
3. `sheet` 顶部不因设备顶部 inset 变高。
4. 键盘开合与编辑面板切换时，顶部几何保持不变。
5. 路由转场结束后，没有 fixed 元素按错误的包含块定位。
6. 不出现横向溢出、裁字、按钮命中区缩小或底部 composer/dock 重叠。

### 8.4 建议的自动化探针

新增一个移动端 Chrome 几何探针，例如：

```text
node scripts/css-audit/drive.mjs 9335 scripts/mobile-audit/top-chrome-geometry.mjs
```

探针输出每个页面的：

- `safeTop`
- `chrome.top`
- `chrome.height`
- `content.top`
- `bottomChrome.top`
- `viewport.height`

对不同 `--mobile-top-safe-area` 值执行同一组断言，避免只靠截图判断。

## 9. 不做什么

- 不重写移动端路由、数据层或编辑器体系；
- 不为顶部元素引入新的 layout 库；
- 不新增第二套顶栏视觉原语；
- 不把所有页头强行合并成同一个视觉组件；
- 不通过在业务页面继续增加 safe-area 覆盖来长期解决；
- 不为已经稳定的编辑器高度逻辑建立平行 owner。

## 10. 停止条件

方案 B 执行过程中出现以下情况时暂停并重新评审：

- 某个顶部表面无法判定为 `viewport / overlay / nested / sheet`；
- 迁移必须改变页面信息架构或按钮语义；
- `position: fixed` 的既有浮层在统一契约下无法保持原位置；
- 同一个页面需要两套顶部安全区逻辑；
- 设备矩阵出现无法用 contract 解释的 ROM 差异；
- 旧覆盖无法在计划批次内删除，开始形成长期双轨。

## 11. 最终结论

- 当前移动端不需要整体重构；
- 顶部 Chrome 需要一次限定的架构收敛；
- 方案 B 是推荐路径；
- 方案 A 只适用于短期止损；
- 方案 C 应作为未来移动壳重做或新增 iOS 时的候选，不应在现有架构上直接实施。

## 12. 实施记录（261117 · B0–B2 一次落地）

**落地物**

- **契约层 `src/mobile/topChrome.css`（新文件）**：`data-edge` 派生 `--mb-chrome-inset-top`（viewport/overlay ⇒ `--mobile-top-safe-area`；nested/sheet ⇒ 0）、`data-size` 派生 `--mb-chrome-content-h`（compact 44 / regular 52）、`--mb-chrome-air-top`（顶栏顶部空气 8px，nested/sheet 清零）。**iOS 口子**：契约不感知平台，inset 数值只来自 `theme/tokens.css` 的喂值通道（Android 原生注入 / iOS env() 自然正确，必要时注入同名 `--mobile-native-*-safe`）——换喂值后端不改任何消费方；edge 语义平台无关可整套复用。
- **采用 DOM 契约，未抽 React 组件**：`MobileTopBar` 组件暂缓（§5.2 入口保留为选项）——先让迁移与门禁稳定，抽组件等有第二个调用形态再议。
- **全表面标注**（`data-mb-topbar` + `data-edge`，消费内容高的再加 `data-size`）：`.mobile-topbar` 家族（首页 viewport/compact · 工作区 viewport/regular · 启动失败/坏库/首页骨架 · AI 内嵌 nested/compact · AI 独立/历史 overlay/regular · 回收站预览 overlay/regular）、`.mobile-settings-head`（设置/PanelLoading overlay · 标签/日记页头 nested）、抽屉工具栏（overlay）、`.mb-sel-topbar`（新增 `edge` prop：首页 viewport · 抽屉 overlay · Sheet/平板栏 sheet·nested）、`.mb-usheet-topbar`/`.mbt-header`（nested）、`.mb-sheet__head`（sheet：MobileSheet/PickerSheet/AI 三 Sheet）、`.mobile-model-head`（sheet）、`.attachment-preview__toolbar`（overlay）。
- **几何迁移（数值等价重写）**：`.mobile-topbar` padding/height/margin 全部改走契约变量；首页顶栏 height/margin 覆盖删除（data-size + air 变量派生）；`.mobile-page-head` 的 padding-top 覆盖删除（nested ⇒ calc(12px+0)）；**死规则 `.side-panel .mobile-page-head` 删除**（261107 v2 起多选顶栏不再复用该类）；`.mobile-settings-head` / `.side-panel > .toolbar` / `.attachment-preview__toolbar` / `--pad-float-top` 改走 `--mb-chrome-inset-top` / `--mb-chrome-inset-overhang`。
- **门禁**：`src/mobile/topChromeContract.test.ts`（① 全部顶部表面声明 data-mb-topbar/data-edge/data-size；② `var(--mobile-top-safe-area)` 直接引用允许清单棘轮：topChrome 映射 / pad 悬浮锚点 / .mobile-qn-screen / .mb-toast-host，共 4 处，只许减；③ 契约映射钉死）；`aiLayout.test.ts` 升级为契约口径（261117 内嵌副栏现场回归钉子保留）；`mobileLayers.test.ts` 登记新文件，mobile.css 1491→1486、ai.css 383→380 收紧。

**本批两处行为修复（仅 inset>0 设备可见，safe=0 几何不变）**

1. **`.mobile-model-head`**（标签页列表底部 Sheet 头）：此前 min-height/padding 各吃一份顶部安全区 ⇒ 刘海屏上 Sheet 头异常变高。按契约 `sheet ⇒ inset=0` 修复（§8.3 判据 3 的「可疑口径」定案：不该消费）。
2. **`.mb-sel-topbar`**（多选顶栏）：261107 v2 重做时丢了 261106 task-8 补的顶部安全区，抽屉/首页多选态在刘海屏上顶进状态栏。按契约 `viewport/overlay ⇒ 消费一次` 修复，与抽屉工具栏同高不跳变。

**验证**：`tsc` 0；`src/mobile` vitest 343 文件 / 1750 例全绿；`check:mobileui` / `check:bundle`（mobile CSS 140,039/141,312、首屏 345.2KB/350KB、entry 50.4KB/51.2KB）/ `check:arch` 0 违规 / `git diff --check` 全过；设备侧（构建安装 + 快照）见 HANDOFF 本批记录。

**B3 剩余（下一批候选）**

- `--mb-chrome-inset-overhang: 8px`（旧口径：内容向上伸进 inset 带 8px）归一化为 0 ⇒ 必须先跑 §8.3 矩阵（安全区 0/24/32/48 × 宽 360/412/768/1280 × 横竖屏）复验；届时 `.mobile-topbar` 与 `--pad-float-top` 同步改。
- `--mb-chrome-air-top` 的 8px 顶部空气与首页清零差异是历史口径（261110 减重），保持现状。
- ~~§8.4 几何探针~~ **已完成（261117）**：`scripts/mobile-audit/top-chrome-geometry.mjs` —— 四档注入顶部安全区（0/24/32/48，直接写 `--mobile-top-safe-area` 喂值通道，与换喂值后端同链路）走 8 个页面，测量全部 `[data-mb-topbar]` 表面并断言三条不变量（A nested/sheet 零响应：inset 变量恒 0 + 高度/上内距不变；B1 viewport/overlay 内容盒顶部 ≥ inset−过冲；B2 契约 inset 恰等于注入值 + footprint 增量 ∈ [ΔS−过冲, ΔS]）。**实测 8/8 页、20+ 表面、0 违规**；关键数字：首页头 h=44+过冲（44/60/68/84）、工作区头 52/68/76/92、抽屉工具条 48+S（48/72/80/96）、设置页头 66.5+S、**AI 内嵌头恒 44**（261117 回归的动态钉子）。用法：`node scripts/css-audit/drive.mjs 9336 scripts/mobile-audit/top-chrome-geometry.mjs`。覆盖盲点（留给矩阵批）：多选顶栏 / 标签页列表 Sheet 头 / usheet·mbt 头部 / 附件预览 / 带标题 Sheet（新建面板经设备核实**无头部元素**，不是漏标注）。
- §8.3 全量设备矩阵未跑（本批两处行为修复需在 inset 模拟 32/48 下人工复核）。

