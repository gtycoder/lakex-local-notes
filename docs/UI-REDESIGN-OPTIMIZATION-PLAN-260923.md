# UI 优化总方案（桌面 + 安卓一体，260923）

> **前提（用户定稿，不可动）**：功能**全部定稿**；目录面板「悬停召唤」与 minimap 是**用户的设计**（A3 定稿、A4 返工也是用户决定）。
> 本方案**不改功能、不改交互、不改视觉结果**，只做三件事：**行为不变的优化** + **过时样式清理** + **安卓端复用同一套设计系统重做 UI**。
> **判据**：`没有可观测变化` = **整页计算值 0 差异 + 像素批次 0 差异 + 现有单测/e2e 全绿**，不是"看着没变"。

## 0. 一条主线（两端一套底座）

```
W0 双端门禁 → W0.5 抽两端共享入口 → W1 桌面专属零耦合清理
            → W2 安卓 UI 重做（复用同套设计系统 + b3 下线 + 共享文件清理并入）
            → W3 几何/层序护栏 · W4 !important 继续降 · W5 A3 内部优化 · W6 增强大纲零成本   （W3–W6 可穿插）
```

**为什么安卓放 W2、共享文件清理并入它**：安卓重做本就要改那 6 个共享文件的消费方 ⇒ 一次改完、**只用跑一轮双端比对**；反之若先单独清共享文件，要双端各验一遍，而安卓 UI 马上要换 ⇒ 白验。

## 1. 不变量（红线）

- **不动功能/交互/视觉结果**：A3 的 10px 热区、240ms 驻留、贴左缘、底缝 12px、三态语义**原样保留**（W5 只做内部重构，行为逐项同值）。
- **不删内核** `@dlient/lakex-doc-react/style.css`。
- **迁移必须带 TSX 改动才算完成**（桌面 kit 的教训：466/550 条声明零引用）。
- **移动端密度单独定标**：桌面是指针语义（行高 27px、hover）；触屏要 ≥44px 命中、无 hover、底部 sheet、safe-area、键盘/Dock ⇒ **复用 ≠ 照搬**。

## 2. 现状事实（2026-09-23 实测）

| 维度 | 桌面 | 移动端 |
|---|---|---|
| 样式来源 | 自有设计系统：`styles/index.css` 单入口 + 8 层 `@layer` | **无 `@layer`**；思源 `b3/siyuan.scss` + `mobile.css`(994 行) + `editor-dock.css`(176 行) |
| 对思源层的依赖 | 入口 b3 import **0**、`var(--b3-*)` **0** | **20 个 `b3-*` 类名 / 8 个 TSX 文件 / 107 处**、**23 个 `--b3-*` 变量** |
| `!important` | **9**（tokens 3 + compat 1 + components 5，其中 4 条 `.seg__item`） | `mobile.css` **19** |
| 主题 | 三套（light/dark/**warm**） | 两套（b3 daylight/midnight） |
| 已共享 | — | **`--lake-*` 令牌**（`styles/tokens.css`）+ **7 个 `ln-*` 承重件** |
| 共享文件（6 个） | `styles/tokens.css` · `styles/components.css` · `styles/dialog.css` · `styles/app/quick-notes.css` · `features/editor/image-lightbox.css` · `features/attachment/attachment-preview.css` | 同左（`src/mobile/main.tsx` 逐条 import） |
| 死重量 | `kit.css` **466/550 条声明零引用**；`reset` 空层；**66 条过渡别名**；legacy 仍全量发布（app-css raw 1.46MB） | `src/b3/**`（含 AGPL `siyuan/` **20 文件**）+ `mobile-theme.css` 的 `--lake-*→--b3-*` 桥 |

**推荐：安卓端复用同套设计系统**（理由：迁移面只有 20 个类名、共享面已存在一半；顺带下线 AGPL；两端观感一致，移动端可能是主端）。

## 3. W0 双端门禁（**先做，零生产改动**）

现成资产：`scripts/css-audit/` —— `stylesnap`(整页计算值) · `ab2`(文本级 A/B，0 容差，自带 self/plan/control) · `shotset`+`pixdiff`(像素批次) · `imp-scan/imp-safe/plan-imp`(`!important` 安全性) · `plan-dup-decls` · `fingerprint-all`。

1. **补 warm 主题**到 `stylesnap.STATES`（现在只有浅/深，重设计有三套 ⇒ warm 无人看守）。
2. **补新界面态**：目录栏三态 + 左缘热区 hover、增强大纲开/关、只读无工具条、表格/多维表/画板容器、多标签（README 已列空缺）。
3. **补移动端一半**：`/tmp/lkm` 的走查 harness **已不存在**（260923 核查）⇒ 需**重建**为 `scripts/mobile-audit/`，产出与 `stylesnap` 同格式的移动端快照（`mobile-preview` 390×844：首页/知识库/文档/小记/设置/编辑器 Dock）。
4. **修或退役三条已失效的自带冒烟**（否则"门禁"是假的）——260923 实测三条**全因脚本与现行 UI 脱节而必失败，与任何批次无关**：
   - `test:sidebar-interaction`：找 `.sidebar-docked .search-box input`，而**全局搜索早已移入顶栏**（`85a4ed5`；`src` 已无 `search-box`）。
   - `test:ui`(`e2e-electron-smoke`)：断言活动栏 rail 宽 = 38，而**活动栏不再渲染**（`App.tsx:424`，shell 恒带 `activity-rail-hidden`）。
   - `test:tab-switch`：断言样式表含 `55ms ease-in`/`85ms ease-out`，而这两个字符串**只存在于脚本自身**，CSS 里已随重设计消失（我的批次也未动 `tabs.css`）。
5. **固定环境**：一律隔离实例（`LAKE_USER_DATA=$TMPDIR/lake-*` + `vite preview` 独立端口 + 独立 CDP 端口），**绝不用 9222**；快照前注入 `transition:none/animation:none` + `bringToFront` + focus 模拟。
6. **门禁脚本（260923 落地）**：
   - **`check:stylesnap`（已落地）**：`scripts/css-audit/check-stylesnap.mjs` —— 先做 **CDP 存活检查**（不健康 exit 2，避免把死实例误读成脚本失败）→ 生成 **42 态**整页计算值快照 → 与**已入库的紧凑基线** `scripts/css-audit/baseline/stylesnap.json`（**2.8KB**：每态元素数 + 全态合并哈希）比对 → **有差异 exit 1**。`--from <snap.json>` 可不重跑直接比对；`--write-baseline` 写基线。npm script：`npm run check:stylesnap`。
   - **`check:pixel`（后备，未落地）**：`shotset`+`pixdiff` 的像素批次；基线 PNG 数百 KB ⇒ **不入库**、按需本地生成，仅在需要像素级证据时用。注意 `pixdiff` 只打印差异、**不返回非零** ⇒ 要当门禁需再包一层。
7. **装置可信配方（260923 实测验证，两条缺一不可）**：
   - **快照 key 必须排除内核随机 id**：内核给正文文本节点发的 id 形如 `ne-text$u<hex>`，**跨 reload 不稳定** ⇒ 不排除时同一份代码连拍会得到"**每态恒定 2 条差异 + 2 个新增**"（`stylesnap.mjs` 已按 `/^u[0-9a-f]{6,}$/` 排除）。
   - **每次跑快照必须用全新同构实例**（独立 `LAKE_USER_DATA`）：否则**首个状态会继承上一轮的标签集**（实测首态差 **386 条**、元素数 2310 vs 2135）；`pin()` 只重置主题/侧栏/大纲，管不到主进程里的标签集。
   - 两条都满足后：**两个独立实例的 warm 8 态实测 `0 个状态有差异 / 0 条指纹差异`**；**全量 42 态**实测 41/42 一致。
   - **已知装置限制（260923 回滚实验定性）**：**窄窗（560/760）态跨"实例世代"漂移** —— 内核**原生大纲**的展开/收起是 hover/resize 时序态（不在 localStorage、`pin()` 管不到）。实测：**把 `reset` 层名加回去（= 与基线同一份代码）+ 重建 + 全新实例，窄窗态仍与基线不同（22/25 条）** ⇒ 与"删 reset 层"无关，是装置问题；1315 宽的态则全部稳定。处理：`check-stylesnap.mjs` 用 `UNSTABLE = /:(?:560|760):/` **只跳过窄窗 8 态并点名**，严格比对覆盖 **34 态**；首次比对有差异会自动**重跑一次去抖**（只有两轮都差异才判失败）。**TODO**：在 `pin()` 里钉死内核原生 TOC 态后恢复全量严格比对。

**DoD**：`self` 0 差异、`control` 有差异、桌面含 warm、移动端态齐备、三条失效脚本已修或已退役、两条 script 一键可跑。

## 4. W0.5 抽两端共享入口（复用的地基）

- 让移动端与桌面**消费同一份编排**：`styles/tokens.css` + `themes/*`（三主题）抽成共享入口；移动端接入 `@layer`（现在完全没有 ⇒ 补上后移动端也能"靠层序取胜"而不是 `!important`）。
- 加**移动密度档令牌**（触屏命中 ≥44px、无 hover 的替代态、safe-area）。
- `mobile-theme.css` 的 `--lake-* → --b3-*` 桥**随 b3 下线一起退役**（本步先不动，避免双改）。

## 5. W1 桌面专属零耦合清理（**零风险，先清大头**）

> 已核实：`src/mobile/**` 对以下文件**零引用** ⇒ 本步对安卓完全无影响。

1. **~~删 `kit.css` 的 466 条 app 内零引用声明~~ —— ⚠️ **260923 撤销（重要更正）**：`docs/UI-REDESIGN-260921/kit-demo.html` 有 **59 处** `ln-*` 引用（≥20 个类）、`03-ACCEPTANCE.md`/`04-LAYOUT-SPACE-SPEC.md` 也引用 ⇒ kit 是**本设计系统的组件词汇表 + living demo**，且已定「安卓复用同套设计系统」⇒ **保留 kit**；W2 安卓端**采纳它**（或明确降级为 demo-only 并在文档标注）。真正要清的是下面第 4 条的 **legacy 桌面专属声明**。
   - （260923 撤销原「纯清理」判断：kit 保留，见上。）
2. **✅ `reset` 空层（260923 已做）**：`index.css` 的 `@layer` 声明里已删掉 `reset`（声明了没人 import 比没有更糟）。
3. **文件归并（可选）**：`tokens.css`(6 声明)/`motion.css`(1 声明) 并入相邻文件，同步围栏 `FILES/BASELINE`。
4. **legacy 桌面专属逐域清**：`document-status` → `app/dialogs`/`app/panels` → `app/tabs` → `app/shell` → `compat` → `app/misc` → `app/base` → `editor`。三级口径：**L1 严格重复**（`plan-dup-decls`）· **L2 整条规则被高层完全覆盖**（新脚本 + `ab2` 逐条判定）· **L3 跨全部状态零命中**（`fingerprint-all`）。
   ⚠️ **跨层搬家不做整批**（README §七：那是"自愿认输"的规则，只能逐条二分）。
5. 每片跑完**把围栏基线按实测收紧**（`cssLayers.test.ts`）。

**DoD**：桌面专属旧声明降到"确实承重"下限；`dupGroups` 收敛到 0；`ab2/pixel` 0 差异。

## 6. W2 安卓 UI 重做（复用同套设计系统）

1. **迁 20 个 `b3-*` 类**（8 个 TSX 文件）到共享原语 —— **必须改 TSX**。
2. **`mobile.css`(994 行)/`editor-dock.css`(176 行) 按同套令牌 + 移动密度档重写**（观感你来迭代验收）。
3. **`src/b3/**` 整体下线**：`siyuan/` 20 文件 + 两套 b3 主题 + `dark/layout/components/base/animations` ⇒ 同时消掉 23 个 b3 变量、19 条 mobile `!important`、`mobile-theme.css` 的桥。
4. **6 个共享文件的过期声明在本阶段清理**（桌面与移动端各验一遍，只此一轮）。

**DoD**：移动端 `var(--b3-*)`=0、`!important` 19→0、`@layer` 接入、双端 `check:stylesnap`/`check:pixel` 0 差异、你在真机/模拟器验收观感。

## 7. W3–W6（与安卓无耦合，可穿插）

- **W3 几何/层序护栏**：`src/styles/geometrySources.test.ts` —— 4 个令牌各只定义一次、全部消费者引用令牌（裸 px 仅白名单 4/6/12）、`.tab-bar` 内距 === (顶栏−标签)/2、红绿灯 y === (TOPBAR_HEIGHT−12)/2；并把散落的 z 序（手柄 100 / 热区 110 / 目录 250 / 大纲 260 / 顶栏 400 + 编辑器内 5/4/3）收进 `--lake-z-*` 并加**顺序断言**（`handle < hotzone < sidebar < outline < topbar`）。`PANEL-CONTRACT.md` 标注"由该测试强制"。
- **W4 `!important` 9→5**（只动桌面）：把**桌面端** `.seg__item` 规则搬进桌面专属 `kit.css`（layer kit > legacy ⇒ 无需 `!important`），`components.css` 的**移动端那份一字不动**（`src/mobile/main.tsx:17` 有明确注释）。tokens 那 3 条压内核运行时注入的毛玻璃 ⇒ **保留并写明理由**。
- **W5 A3 内部优化（行为逐项不变）**：抽纯状态机 `sidebarHoverMachine.ts`（enter/move/leave/dwell/click/dock-change × idle/handle-shown/preview-armed/preview-shown → 输出），把 §2.28 的 7 条坑写成**转移表 + 单测**；统一走廊并集谓词到 `sidebarInteraction.ts`；新增 `scripts/e2e-sidebar-hover.mjs`（真实指针，断言"进场→把手、≥240ms→面板、移开→收、点把手→固定、`⌘]`→翻转"，且**与改动前逐项同值**）。
- **W6 增强大纲关闭时零成本**：核验 `editor-outline-enhance=false`（默认）时不挂载、样式不生效、无额外计算；有副作用按等价重构修掉。

## 8. 风险与「不做」

- **不做**：删内核 `style.css`；跨层整批搬家；改移动端行为；任何交互语义改动；A3/A4 的功能改动。
- **风险与对策**：矩阵覆盖不足 ⇒ 先补 warm/三态/移动端并以 `self`=0 + `control`≠0 准入；状态漂移 ⇒ 快照前钉死主题/模式/文档/尺寸且同批同序；`@import` 内联注入陷阱 ⇒ 按 manifest 拼接整份内联文本注入，**不按文件名**；单屏像素不能当基线 ⇒ 必须整批。

## 9. 每步 DoD

`tsc` 0 · `vitest` 全绿 · `ui-metrics` 全绿 · **`check:stylesnap` 0 差异（桌面+移动端）** · **`check:pixel` 0 差异** · `git diff --check` 干净；W5 额外要求 e2e 行为前后同值；W2 额外要求你的真机观感验收。

## 10. 立即开始的前三步

1. **W0-a — ✅ 已完成（260923）**：`stylesnap.STATES` 补 **warm 8 态**（实测可 pin：`data-theme=warm`）；三条失效冒烟按"**修**"处理并**全部实跑通过**：`test:sidebar-interaction`（改用面板头 📌 + 按现行 10px 热区/240ms 驻留悬停 + 断言贴左缘 `left:0`，并加自愈/收尾恢复「固定」避免状态泄漏）、`test:tab-switch`（去掉已消失的 55ms/85ms 契约，保留耗时契约）、`test:ui`（活动栏断言换成"不再渲染 `.activity-rail`"+"顶栏高 == `--topbar-height` 令牌"，并修工作空间触发器选择器）。
2. **W0-b（半天~1 天）**：**重建**移动端走查 harness（`/tmp/lkm` 已丢失）到 `scripts/mobile-audit/`，跑通移动端快照。
3. **W1（0.5~1 天）**：桌面专属零风险清理（kit 466 条死声明 + `reset` 空层），用 W0 的门禁证明 0 差异。
