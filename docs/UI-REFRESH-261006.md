# 桌面端 UI/UX 刷新 · 计划与进度

> **唯一进度跟踪文档。** 计划、边界、每一项的状态与验证结果都记在这里；随做随更。
> 分支：`feat/ui-refresh-261006`（从 `master` c076878 切出）。目标：**只做 UI/UX**。

## 0. 红线与边界（用户 261006 定稿）

**红线**

1. **内核 lake（闭源）不动**。仅当确有必要时，才通过重建 vendor 产物（`npm run build:vendor`）处理，绝不手改内核源码。
2. **只做 UI/UX，绝不能影响功能或造成功能缺失**。若某处非改功能不可，**先问用户**。
3. 全程在 `feat/ui-refresh-261006` 分支上做。

**IN（可改）**：颜色 / 材质 / 纵深 / 圆角 / 动效 / 图标 / 组件观感；密度与几何；`--lake-*` 令牌体系内的一切。

**OUT（本轮不碰）**

- 文案、术语、交互、快捷键、内核行为、移动端。
- 状态栏两端重复信息（用户 261006：先不做，后续讨论）。
- 「本地优先 = 永不丢数据」不作为卖点：本地磁盘本就难丢数据，这是**正常**；同步状态维持现在的安静，不加醒目提示。
- 内核绿 `--lake-kernel-brand-green` **只作点缀**（面积极小），**绝不当主色**。

**顶栏 / 多标签条 / 面包屑**：**结构不变**（区域不删、不挪、不合并）；但**元素可以适配变化**（配色、字重、密度、分隔、状态表现都可以改）。

**主题**：浅 / 深 / 暖三套一起统一。⚠️ **暗色格外小心**——内核与外壳在暗色下的适配最脆弱，改动必须逐条实测。

## 1. 计划

### Phase 1 · 系统收敛（route 1）— 把系统修干净，不换观感

| # | 任务 | 主要落点 | 状态 |
|---|------|----------|------|
| 1.1 | 主题漂移归一：三主题统一为**同一色相**（板岩蓝 222°），只按明度/饱和与中性面区分 | `src/styles/themes/{dark,warm}.css` `src/lib/themes.ts` | ✅ 完成（待验收） |
| 1.2 | 去 AI-slop 痕迹：桌面 toast 单侧色条 → 表面+1px 描边+状态色；布局属性动画 → transform | `chrome.css` `kit.css` `dialogs.css` `app/shell.css` | ✅ 完成（待验收） |
| 1.3 | 图标族收敛：清 emoji 字形，统一 lucide 一族 + 单一 stroke + 光学尺寸 | TSX（Sidebar/StatusBar/tab 等） | ✅ 完成（结论修正：家族已统一，只修离群尺寸） |
| 1.4 | 样式来源收敛：内联 `style={{}}` 能收敛的收进令牌/kit；核对 `!important` 口径 | `app/shell.css` `chrome.css` `Sidebar.tsx` | ✅ 完成（结论修正：多为合理动态几何） |
| 1.5 | 删除：legacy 层可证死声明（同选择器 + 被更高层覆盖） | `src/styles/app/*` `components.css` `document-status.css` 等 11 个文件 | 🔄 扫描完成：**137 条**，待执行 |

**Phase 1 验证门禁**：`tsc` · `vitest` · `check:core` · `ui-metrics` · `cssLayers` + `uiPrimitives` · 双端 build · `git diff --check` · 真机三主题截图对比。

### Phase 2 · 替换视觉世界（route 2，comp-first）

1. **2.1 方向派生**：7 个视觉系统 → 掷骰 → 决策页，用户挑 1。
2. **2.2 视觉基准图（comp）**：真实界面、真实内容。
3. **2.3 在既有骨架上重建观感**：表面三阶、纵深、材质、组件外观、统一动效；**P0 视觉层级在此解决**；accent 与新图标语言在此定稿（内核绿仅点缀）。
4. **2.4** 三主题同步；**只做桌面**。

### Phase 3 · 固化为规则（route 3）

`$impeccable document` → `DESIGN.md` + `.impeccable/design.json`，作为后续工作的规则来源。

## 2. 待用户拍板

- （B 表第 6 项）状态栏两端重复信息是否合并 —— 用户：先不做，后续讨论。

## 3. 进度日志

| 时间 | 事项 | 结果 |
|------|------|------|
| 261006 | 建分支 `feat/ui-refresh-261006`；建立本文档 | ✅ |
| 261006 | Phase 1.2 去 slop 痕迹（toast / 布局动画） | ✅ 完成（待验收） |
| 261006 | Phase 1.1 主题漂移归一（三主题统一色相） | ✅ 完成（待验收） |
| 261006 | Phase 1.3 图标族盘点 + 离群尺寸收敛 | ✅ 完成 |
| 261006 | Phase 1.4 内联样式盘点 + 净收益为正的收敛 | ✅ 完成 |
| 261006 | Phase 1.5 死声明静态扫描（137 条） | 🔄 待执行删除 |

## 4c. 变更明细 · Phase 1.3（图标族）

**结论修正（重要）**：评审里「图标语言混用（lucide + emoji 字形 + 内核雪碧图）」是**旧截图带来的误判**。真实运行实例实测：

| 指标 | 实测 |
|------|------|
| 外壳内 emoji 当图标 | **0**（唯一命中 `⌘` 是快捷键提示文字，属正常排版） |
| 外壳内 lucide 图标 | **43 个** |
| 内核雪碧图 `<use href="#…">` | **22 个，全部在 `.lake-editor-mount` 内**——外壳里一个都没有 |
| 当图标用的 `<img>` | **0** |
| lucide 描边宽度 | `svg.lucide { stroke-width: 1.75 }`，实测计算值 `1.75px`（单一来源） |

锁 `🔒` / 更多 `⋮` 也已是 lucide 的 `<Lock>` / `<MoreVertical>`（`Sidebar.tsx:2`）。

**真问题只剩"光学尺寸无体系"**（9/11/12/13/14/15/16/17/18/19/20/21/22/25/26 全在用）。本轮只收敛**离群尺寸**与**同语义不一致**：

| 位置 | 改动 |
|------|------|
| `QuickNotesWorkspace.tsx` 空态「还没有小记」 | 两处 22 / 25（**同一语义两个尺寸**）→ 统一 24 |
| `MultiTabEditor.tsx` 空态 / 标签钉 | `File` 26 → 24；`Pin` 11 → 12 |
| `DesktopStatusBar.tsx` 锁定标识 | `Lock` 11 → 12 |
| `ImageLightbox` / `HistoryPanel` / `TrashPanel` / `SyncToast` | 17 → 16 |

**刻意不动**：13 / 15（共 143 处）等**近重复尺寸**是密集定高行里的取值，1px 变更会挪布局；且最终尺寸体系属 Phase 2 的世界规格，届时统一重定 —— 记入 Phase 2。

## 4d. 变更明细 · Phase 1.4（内联样式）

**结论修正**：32 处内联样式中 **27 处是合理的动态几何**（多维表列宽/`<col>` 宽、浮层实测坐标、数据驱动的 `backgroundColor`、进度条百分比、拖拽定位），属**应有的例外**，改成 CSS 反而增加声明数（项目指标正是"声明数只许降"）。

本轮只做**净收益为正**的两处（并顺手修掉一个真实不对称）：

| 位置 | 改动 |
|------|------|
| `Sidebar.tsx` 树行 `paddingLeft: 8` | 删除行内值；真值收到 **shell 层** `chrome.css` 的 `.note-row`，并由 `2px 7px` 改为**对称 `2px 8px`** |
| `Sidebar.tsx` 新建行 `marginLeft: 8` | 删除行内值，并入 `app/shell.css` 的 `.inline-create`（`margin: 2px 7px 3px 8px`） |

**踩坑（有价值）**：第一版把 `.note-row` 的 padding 改在 `app/shell.css`（legacy 层），实测**计算值没变**——真正生效的是 `chrome.css`（shell 层）的同名规则，legacy 那条**是死声明**。改对后再实测：`padding-left/right` 均 8px。这条正是 1.5 的第一条样本。

## 4b. 变更明细 · Phase 1.1（主题漂移归一）

**问题**：三套主题其实是**三个互不相干的色相**——亮色板岩蓝 222°（S 25%）、暗色紫 245°（S 100%）、暖色橙 25°（S 100%）。这就是「同一产品的世界在主题间漂移」。

**做法**：以**默认主题（亮）的板岩蓝为锚**，三套主题统一到**同一色相 222°**；暗色只按暗底抬高/降低明度，暖色改用与亮色同一组值、仅保留暖中性面。

| 主题 | 旧 accent | 新 accent | 说明 |
|------|-----------|-----------|------|
| light | `#5b6f96` | `#5b6f96` | **不动**（锚，对齐设计规格 Q10） |
| dark | `#9b94ff`（紫） | `#a6b4d3` | 同色相抬亮；`ink #5970a6` / `hover #5d73a7` / `press #4f6392` / `text #bcc9e8` / `tint rgba(166,180,211,.14)` / 选区 `rgba(166,180,211,.22)` |
| warm | `#ff6a00`（橙） | `#5b6f96` | 取亮色同一组值；warm 只靠暖中性面与亮色区分 |

**对比度实测（WCAG）**

| 指标 | 旧 | 新 | 要求 |
|------|----|----|------|
| 暗色 accent vs panel | 6.34:1 | **7.92:1** | ≥3（UI）/ ≥4.5（文字） |
| 暗色 ink 上的白字 | 3.54:1 ❌ | **4.89:1** ✅ | ≥4.5 |
| 暗色 ink-hover / press 上的白字 | — | 4.69 / 5.95 ✅ | ≥4.5 |
| 暗色 accent-text vs panel | — | 9.93:1 ✅ | ≥4.5 |
| 亮色 accent vs #fff | 5.05:1 | 5.05:1 | ≥4.5 |

**连带改动（必须，否则界面与事实不符）**：`src/lib/themes.ts` 的主题标签从颜色名改为中性面性格——`亮 · 蓝 → 亮 · 中性`、`暗 · 紫 → 暗 · 深`、`亮 · 橙 → 亮 · 暖`；色卡预览里的 accent 同步为新值。**这是唯一一处用户可见文案变动**，如不同意可单独回退。

**内核联动（未动内核）**：`kernel-theme.css` 的变量桥本来就指向 `var(--lake-accent)`，暗色的编辑器主色/链接/选区/表格高亮自动跟随；内核品牌绿仍按主题保持 `#00b96b` / `#2ed790`（`kernelBrandGreen.test.ts` 通过）。

**观察项（本轮不改，非本次引入）**：暗色下窗口**顶部有一条浅色带**——实测 `.tab-bar` 背景是 `transparent`、`.app-shell` 已是 `rgb(26,27,30)`，那条浅色来自 **macOS 标题栏透出**（系统为浅色外观），改动前后完全一致，属窗口外观而非渲染层问题。

**验证结果**

| 门禁 | 结果 |
|------|------|
| 三主题真实取色 | light `#5b6f96` · dark `#a6b4d3` · warm `#5b6f96`；内核绿 light/warm `#00b96b`、dark `#2ed790` ✅ |
| `tsc --noEmit` | ✅ |
| `vitest run`（全量） | **1679 passed / 16 skipped** ✅ |
| 主题/内核相关测试 | 8 文件 30 用例 ✅ |
| `ui-metrics` | hex=0 · rgb=0 · `!important` 9/≤10 · 未定义令牌=0 ✅ |
| `impeccable detect` | 10（与 1.2 后持平，余下全为误报/移动端）✅ |
| `vite build` + `git diff --check` | ✅ |
| 真机截图 | `theme-before-{light,dark,warm}.png` → `theme-after-*.png`（暗色大纲高亮由紫转板岩蓝、其余不变） |

## 4. 变更明细 · Phase 1.2（去 AI-slop 痕迹）

检测口径：`impeccable detect --json src` 由 **16 → 10** 处命中；剩余 10 处全部为**误报或移动端**（见下）。

**A. 去掉「单侧 >1px 色条」（craft floor 明令禁止的图案）**

| 文件 | 改动 |
|------|------|
| `src/styles/kit.css`（`.ln-toast` 及变体） | 去掉 `border-left: 3px`；状态改由 `.ln-toast__icon` 颜色表达（accent / ok / warn / error）。另：该原语当前**全仓无调用**，属预防性修正 |
| `src/styles/chrome.css`（`.sync-toast` + `.sync-toast-icon`） | 去掉 `border-left: 3px`（原来恒为 accent，非状态信号）；新增 `--ok/--error/--unavailable` 图标色 |
| `src/styles/app/dialogs.css`（`.quick-notes-toast`） | 去掉 `border-left: 3px`；保留 1px 主色描边，动作按钮本就主色 |

**B. 布局属性动画 → 合成属性**

| 文件 | 改动 |
|------|------|
| `src/styles/kit.css`（`.ln-switch__knob`） | `width` 动画 → `transform: scale()`（按压反馈保留） |
| `src/styles/chrome.css`（`.edge-hotzone-handle`） | 过渡里去掉 `top`/`width`，只留 transform/opacity/颜色 |
| `src/styles/app/shell.css`（`.dock-filter-row`） | `height` 动画 → `grid-template-rows: minmax(0,0fr) → minmax(0,1fr)` |

**C. 护栏基线**

- `src/styles/cssLayers.test.ts`：`chrome.css` 470→473、`app/shell.css` 424→427，已在文件顶部注释说明来源（合法新增，非覆盖回涨）。

**踩坑记录（重要）**：`grid-template-rows: 0fr` **不会塌陷**——裸 `0fr` 的轨道最小尺寸是 `auto`，会被 29px 子项撑住；必须写 `minmax(0, 0fr)`。已在真实运行实例上实测修正（关闭 0 → 展开 29 → 收起 0）。

**本轮不做（超出「只做桌面」范围）**：`src/styles/compat.css` 的 `.b3-snackbar--error` 单侧色条——该样式当前**只有移动端**（`src/mobile/ui/Toasts.tsx`）在用，留待移动端批次。

**验证结果**

| 门禁 | 结果 |
|------|------|
| `impeccable detect` | 16 → **10**（余下：3 broken-image 全误报 / 2 引用块竖线 / 2 移动端 / 1 多维表行侧色条（刻意）/ 1 进度条宽度动画（刻意）） |
| `ui-metrics` | hex=0 · rgb=0 · `!important` **9/≤10** · 未定义令牌=0 · b3 引用=0 ✅ |
| `cssLayers` + `uiPrimitives` + `zOrder` + `geometrySources` | 14/14 ✅ |
| `tsc --noEmit` | ✅ |
| `vitest run`（全量） | **1679 passed / 16 skipped**（204 文件通过 / 5 跳过）✅ |
| `check:core` | 75 文件 0 违规 ✅ |
| `vite build` | ✅（`dist/` + `dist-electron/main.js`） |
| `git diff --check` | ✅ |
| 真实实例实测 | 筛选行 0 → 29 → 0 ✅；点击目录栏「筛选」按钮真实展开 ✅ |

## 5. 下一步

- Phase 1.1 主题漂移归一（⚠️ 暗色最危险：先摸清内核 `kernel-theme.css` 与外壳在暗色下的耦合，再动）。
- Phase 1.3 图标族收敛 / 1.4 内联样式收敛 / 1.5 删除收敛。
