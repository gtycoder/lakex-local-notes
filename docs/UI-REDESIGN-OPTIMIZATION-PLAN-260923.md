# UI-REDESIGN-OPTIMIZATION-PLAN-260923.md — 「行为不变」的优化方案 + 与安卓端重做的排期

> **前提（用户 260923 定的边界）**：功能**全部定稿**；目录面板「悬停召唤」与 minimap 是**用户的设计**（A3 定稿、A4 返工也是用户决定）。
> 本计划**只做行为不变的优化**与**过时样式清理**，**不做任何功能/交互/视觉结果改动**。
> **判据**：`没有可观测变化` = **整页计算值 0 差异 + 像素批次 0 差异 + 现有单测/e2e 全绿**，不是"看着没变"。

## 0. 排期决策（先审计桌面，还是先做安卓？）

**结论：先审计桌面端，再做安卓端；但"审计"拆成两半 —— 装置必须先立，清理按"是否与安卓共享文件"切。**

| 依据 | 事实 |
|---|---|
| 共享面是**有界**的 | `src/mobile/main.tsx` 只 import 6 个与桌面共用的样式文件：`styles/tokens.css`、`styles/components.css`、`styles/dialog.css`、`styles/app/quick-notes.css`、`features/editor/image-lightbox.css`、`features/attachment/attachment-preview.css`（另加内核 `@dlient/lakex-doc-react/style.css`） |
| 清理的大头**零耦合** | `kit.css`、`styles/index.css`、`chrome.css`、`overlay.css`、`feature.css`、`themes/*`、`compat.css`、`document-status.css`、`motion.css`、`app/*.css`、`features/outline/outline.css` 均**只被桌面入口加载** |
| 门禁必须先有 | 安卓重做必然要动那 6 个共享文件；没有双端门禁 = 重演 P7-b 漏搬（用户截图才发现同步浮窗/`.tabbar-trailing` 完全没样式） |
| 延后共享清理能省一轮 | 共享文件的清理需**安卓侧同时验**；而安卓 UI 即将更换 ⇒ 现在验会作废，等定型后**一次做完** |
| 先做安卓会把脏底带过去 | 参考/复用同套设计系统时会面对 466 条死 kit、66 条过渡别名、~2500 条 legacy 声明 —— 旧模式正是这样扩散的 |

**执行顺序**：`W0 门禁（含移动端态）→ W1 桌面专属清理（大头）→ 安卓 UI 重做 → W2 共享文件清理 + 删过渡别名（一次做）`；`W3/W4/W5/W6` 与安卓无耦合，可穿插。

### 0.1 前置决定：安卓端是否复用同套设计系统？—— **推荐：复用**（260923 量化后）

**实测的共享面（`src/mobile/**`，2026-09-23 统计）**

| 指标 | 移动端现状 | 对照：桌面重设计前 |
|---|---|---|
| `b3-*` 类名 | **20 个不同类名 / 8 个 TSX 文件 / 107 处** | 桌面 `b3` 类族远大于此 |
| `--b3-*` 变量 | **23 个** | **25 个 / 401 处**（P7-a 清点值） |
| `!important` | `mobile.css` **19 条** | 桌面 9 条（已降） |
| 已共享的桌面资产 | `--lake-*` 令牌（`styles/tokens.css`）+ **7 个 `ln-*` 承重件**（`ln-row/ln-menu/ln-dialog/ln-row2/ln-tabs/ln-toolbar/ln-empty`） | — |
| 移动端自有样式 | `mobile.css` **994 行** + `editor-dock.css` **176 行**（真正的大头） | — |
| `@layer` / 主题 | **无**；沿思源 daylight/midnight 两套 | 8 层 + 三主题 |

**推荐复用的理由**
1. **迁移面小且已半途**：只需把 **20 个 b3 类**迁到共享原语；移动端**已经在用**桌面令牌与 7 个共享组件类 ⇒ 复用是"把已有共享面补完"，不是引入新体系。
2. **顺带下线 AGPL**：迁完这 20 个类，`src/b3/**`（`siyuan/` **20 个文件** + 两套 b3 主题 + `dark/layout/components/base/animations`）可整体删除 ⇒ 同时消掉 23 个 b3 变量、19 条 `!important`、`mobile-theme.css` 的 `--lake-* → --b3-*` 桥。
3. **移动端可能是主端**（HANDOFF §8.4）：两端观感必须一致，否则每次观感迭代要改两遍。
4. **不复用 = 重演桌面刚逃出的坑**：继续"b3 类名 + 叠加覆盖"，等于在移动端重建层叠债。

**复用边界（写死，否则会复制 kit 的失败）**
- **共享**：三主题 + 令牌 + **承重原语** + `@layer` 编排。
- **不共享**：壳与几何 —— `mobile.css`/`editor-dock.css` 保留，但改为消费同一套令牌 **+ 移动密度档**。
- **密度分开定标**：桌面是指针语义（行高 27px、hover 态）；触屏需 **≥44px 命中、无 hover、底部 sheet、safe-area、键盘/Dock** ⇒ 在 token 层加移动尺度，**组件用同一批类名走移动档**。
- **必须带 TSX 改动才算完成**（桌面 kit 的教训：466 条声明零引用）。

**排期修正（复用）**：`W0 门禁（桌面+warm+移动端）→ W1 桌面专属清理 → W0.5 抽两端共享入口 + 移动端接入 @layer → 安卓 UI 重做（**含那 6 个共享文件清理 + b3 下线**）→ W3/W4/W5/W6`。
即 **共享文件清理并入安卓重做**（安卓本就要改那些文件的消费方），比"单独一轮双端验证"省一次全量比对。
若最终**不复用**：保持 `W0 → W1 → 安卓重做 → W2 共享文件单独清理`。
- 另：HANDOFF §8.9 记着移动端走查 harness **仍在 `/tmp/lkm`（未入库）** ⇒ 安卓重做前入库，正好补齐 W0 的移动端一半。

## 1. W0 把现有审计装置提升为「双端门禁」（**先做，零生产改动**）

现成资产（`scripts/css-audit/README.md`）：`stylesnap`（整页计算值快照）、`ab2`（文本级 A/B，0 容差，自带 `self/plan/control` 三模式）、`shotset`+`pixdiff`（像素批次）、`imp-scan/imp-safe/plan-imp`（`!important` 安全判定）、`plan-dup-decls/apply-dup-decls`、`fingerprint-all`（选择器跨态命中指纹）。

要做（**只补不改**）：
1. **补主题**：`stylesnap.STATES` 现在是"浅/深"，重设计有**三套** ⇒ 加 **warm**，否则 warm 下的回归无人看守。
2. **补界面态**：目录栏三态（docked/floating/collapsed）+ 左缘热区 hover、增强大纲开/关、只读无工具条、表格/多维表/画板容器、多标签（README「状态矩阵」已列出的已知空缺）。
3. **补移动端一半**：把 `/tmp/lkm` 的走查 harness **入库为 `scripts/mobile-audit/`**，产出与 `stylesnap` 同格式的移动端快照（`mobile-preview` 390×844：首页/知识库/文档/小记/设置/编辑器 Dock）。
4. **固定环境**：一律**隔离实例**（`LAKE_USER_DATA=$TMPDIR/lake-*` + `vite preview` 独立端口 + 独立 CDP 端口），**绝不用 9222**；快照前注入 `transition:none/animation:none` + `bringToFront` + focus 模拟。
5. **两条 npm script**：`check:stylesnap`（桌面+移动端，逐元素 0 容差对基线）与 `check:pixel`（`shotset` 同批同序 + 像素比对）。
6. **装置自证**：先跑 `self`（**噪声必须 0**）与 `control`（**必须能抓到真改动**），再当门禁用。

**退出判据**：`self` 0 差异、`control` 有差异、桌面含 warm、移动端态齐备、两条 script 可一键跑。

## 2. W1 桌面专属零耦合清理（**零风险，先清大头**）

1. **删 `kit.css` 里 36 个零引用 `ln-*` 类的规则（466/550 条声明）**。
   - 方法：逗号选择器**展开后逐选择器判定**，只摘掉"该类名在 TSX 与其它 CSS 中零出现"的选择器；同规则混有在用选择器（如 `.ln-row2, .ln-empty`）时保留规则。
   - 保留：7 个在用的承重类 + 84 条命中 `.b3-*`/`.seg` 的覆盖声明。
   - **这不是"放弃组件库"的产品决策**：功能定稿且这些类**从未被引用** ⇒ 纯清理；将来要做组件库属**新增功能**，另立项。
2. **`reset` 空层**：`index.css` 的 `@layer` 声明里删掉 `reset`（声明了没人 import，比没有更糟）。
3. **文件归并（可选）**：`tokens.css`(6)/`motion.css`(1) 已极小，可并入 `compat.css`/`base.css`，同步围栏 `FILES/BASELINE`（围栏注释允许"按职责归并"）。
4. **legacy 桌面专属域逐片清**（`document-status` → `app/dialogs`/`app/panels` → `app/tabs` → `app/shell` → `compat` → `app/misc` → `app/base` → `editor`）：
   三级口径 —— **L1 严格重复**（用 `plan-dup-decls.mjs` 重生成）· **L2 整条规则被高层完全覆盖**（新脚本，逐条交 `ab2` 判定）· **L3 跨全部状态零命中的选择器**（`fingerprint-all`）。
   ⚠️ **跨层搬家不做整批**（README §七：那是"自愿认输"的规则，只能逐条二分）。
5. **围栏同步**：每片跑完把 `cssLayers.test.ts` 的 `decls/dupGroups` 基线**按实测收紧**（260923 已做过一轮：`tokens.css` 83→6 等）。

**退出判据**：桌面专属旧声明降到"确实承重"下限；`dupGroups` 全部收敛到 0。

## 3. W2 共享文件清理 + 删过渡别名（**等安卓 UI 定型后一次做**）

- 对象：那 6 个共享文件里的过期声明（桌面与移动端**各验一遍**）。
- 若前置决定是"不复用设计系统"：先把迁移过渡件**按端拆开**（桌面进桌面包，移动端留共享），再清。
- **过渡别名（`themes/base.css` 6 条 + 三主题各 20 条 = 66 条）在本步最后删** —— 它们的引用方就是被删的旧规则；在此之前只能确认零引用的单条（260923 已删 `--radius-lg`）。

## 4. W3 护栏可执行化（与安卓无耦合，可穿插）

1. **`src/styles/geometrySources.test.ts`**（源码级，沿用本项目既有风格）：
   - 4 个令牌各只定义一次；全部消费者（peek 顶/浮层顶/面包屑高/工具条高/标签高/`.workspace` 顶距/阅读态大纲 `top`）都引用令牌，**裸 px 仅允许白名单**（4 拼接缝 / 6 缝 / 12 底缝）；
   - `.tab-bar` 垂直内距 === (顶栏 − 标签)/2；红绿灯 y === (TOPBAR_HEIGHT − 12)/2（已有单测合并进来）。
2. **z 序可测**：把散落的 5 个值（手柄 100 / 热区 110 / 目录 250 / 大纲 260 / 顶栏 400）+ 编辑器内 5/4/3 收进 `themes/base.css` 的 `--lake-z-*`（词表里已有未用的 `--lake-z-base/sticky/toast`），并加单测断言 `handle < hotzone < sidebar < outline < topbar`。
3. `PANEL-CONTRACT.md` 标注"z 序与几何口径由 `geometrySources.test.ts` 强制"，把散文变成可执行约束。

## 5. W4 `!important` 继续降（9 → 5，**只动桌面**）

- 现状 9 = `tokens.css` 3（压内核运行时毛玻璃，**保留并写明理由**）+ `compat.css` 1（`.fn__none`）+ `components.css` 5（1 条压 JS inline 宽度，**合理**；**4 条 `.seg__item`**）。
- 原因已核实：`components.css` **双端共享**（`src/mobile/main.tsx:17`，移动端 `SettingsDrawer` 也用 `seg__item`，注释明确"须晚于 siyuan.scss，否则 seg 选中态被压掉"）。
- **方案**：把**桌面端**的 `.seg__item` 规则搬进桌面专属的 `kit.css`（layer kit > legacy ⇒ 无需 `!important` 即赢过 `.b3-button--outline`）；`components.css` 里**移动端那份一个字不动**。
- 证明：桌面 `ab2/stylesnap` 0 差异（重点设置面板分段控件）+ 移动端快照与本批前一致 + 对桌面专属文件复跑现成 `imp-safe.mjs`。

## 6. W5 A3「悬停召唤」的**内部**优化（用户可观测行为逐项不变）

现状坑密度最高：逻辑分散在 `App.tsx`（热区 enter/move/leave、`--edge-handle-y`、dwell 计时、`relatedTarget` 守卫）+ `useDesktopShell.ts`（preview 显隐、`SIDEBAR_HOVER_HIDE_DELAY_MS`）+ `OutlineSidebar.tsx`（自己一套走廊并集）+ `sidebarInteraction.ts`（纯谓词）。

三步（各自可独立回滚）：
1. **抽纯状态机** `src/components/sidebarHoverMachine.ts`：输入（enter/move/leave/dwell-elapsed/click/dock-change）× 状态（idle/handle-shown/preview-armed/preview-shown）→ 输出（handleY、把手可见、preview 显隐、timer 增删）。把 §2.28 的 7 条坑写成**转移表 + 单测**（"计时只在该轮没在跑时武装"、"leave 先收把手再判守卫"、"面板出即压把手"）。
2. **统一走廊并集判定**：`App.tsx` 的 `isInside(...)` 选择器列表与 `OutlineSidebar` 的并集收进 `sidebarInteraction.ts` 一个谓词，两侧共用。
3. **e2e 固化**：新增 `scripts/e2e-sidebar-hover.mjs`（隔离实例 + 真实指针）：进热区→把手出现；停 ≥240ms→面板出现；移开→收起；点把手→固定；`⌘]`→翻转；**与改动前逐项同值**（把手 Y / 面板几何 / class 序列）。

**明确不动**：热区宽度 10px、驻留 240ms、贴左缘、底缝 12px、三态语义、"面板一出即压把手"。

## 7. W6 增强大纲「关闭时零成本」核验（不改功能）

默认 `editor-outline-enhance=false`（走内核原生 TOC）。核验并保证**关闭时**：不挂载增强大纲组件、其样式不产生作用、无额外计算；把结论写进文档。若发现关闭时仍有空挂载/无效 DOM，按"等价重构"修掉。

## 8. 风险与「不做」

- **不做**：删内核 `style.css`；跨层整批搬家；改移动端行为；任何交互语义改动；A3/A4 的功能改动。
- **风险与对策**：
  - 矩阵覆盖不足 ⇒ 删了没人发现：W0 先补齐 warm/三态/移动端；以 `self` 噪声 0 + `control` 能抓真改动为准入。
  - 状态漂移（README §八）⇒ 快照/截图前钉死主题·模式·文档·尺寸，且**同批同序**。
  - `@import` 内联注入陷阱（README §七）⇒ 按 manifest 拼接整份内联文本注入，**不按文件名**。
  - 单屏像素不能当基线（README 坑 6）⇒ 必须整批。

## 9. 每步完成定义（DoD）与顺序

顺序：`W0 → W1 →（安卓 UI 重做）→ W2`；`W3/W4/W5/W6` 与安卓无耦合，可任意穿插（建议 W3/W4 紧接 W1）。
每步 DoD：`tsc` 0 · `vitest` 全绿 · `ui-metrics` 全绿 · **`check:stylesnap` 0 差异（桌面+移动端）** · **`check:pixel` 0 差异** · `git diff --check` 干净；W5 额外要求 e2e 行为前后同值。
