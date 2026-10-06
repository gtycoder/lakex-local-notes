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
| 1.1 | 主题漂移归一：三主题只换值、accent 角色一致（浅蓝 / 深紫 / 暖橙 → 统一策略） | `src/styles/themes/{light,dark,warm}.css` | 待做 |
| 1.2 | 去 AI-slop 痕迹：桌面 toast 单侧色条 → 表面+1px 描边+状态色；布局属性动画 → transform | `chrome.css` `kit.css` `dialogs.css` `app/shell.css` | ✅ 完成（待验收） |
| 1.3 | 图标族收敛：清 emoji 字形，统一 lucide 一族 + 单一 stroke + 2–3 个光学尺寸 | TSX（Sidebar/StatusBar/tab 等）+ `app/base.css` | 待做 |
| 1.4 | 样式来源收敛：内联 `style={{}}`（32 处）能收敛的收进令牌/kit；核对 `!important` 口径 | 各 TSX + `styles/*` | 待做 |
| 1.5 | 删除：legacy 层死声明（计算值对拍后删）、`misc.css` 拆分归并、（可选）`tokens.css` 移动端并入 themes | `src/styles/app/*` `styles/tokens.css` | 待做 |

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
