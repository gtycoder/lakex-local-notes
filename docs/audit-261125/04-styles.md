# 04 · 前端样式审计（第 4 流 · 只读 · 261125）

> 范围：全仓自有样式（`src/styles/**`、`src/mobile/**/*.css`、`src/features/**/*.css`、`src/components/**/*.css`）+ TSX 样式违规点名（内联 style、动态拼接）+ 样式门禁脚本（ui-metrics / cssLayers / mobileLayers / css-audit/*）覆盖缺口。
> **不改任何代码**；每条方案的 file:line 均为本次实际读取核实。vendor 内核 CSS 与第三方（univer/plait/antd/drawnix）只做「压样式」例外核对，不提清理（AGENTS §3#18）。
> 已结案事项未重开：目录树不渐隐、tree-row 常驻 will-change、树展开高度动画、输入卡 0.5px 边+轻阴影、`--lake-text-4` 3:1 档、AI 助手/AI 写作输入卡分化。

## 1. 概览

**范围与方法**：
- 通读 `AGENTS.md` §3#14（桌面 UI 硬约束）、`docs/DESIGN.md`、`docs/MOBILE-DESIGN.md`、`docs/HANDOFF.md` §1–§3；
- 跑只读取证脚本：`node scripts/ui-metrics.mjs`（全指标 0 红）、`css-audit/audit-dead-css.mjs`（桌面 0 / 移动 4 候选）、`audit-lookalike.mjs`（41 基准原语 / 546 命中）、`audit-primitives.mjs`（规则体重复族 119 组）；
- 自写只读脚本复算「同端跨文件 (选择器,属性) 重复」全量清单（ui-metrics 只打 top10），并逐条读源码核实归属层与胜负；
- 对「层层套 CSS」专项：核对 `src/styles/primitives.test.ts`（跨所有权覆盖基线 0）、`cssLayers.test.ts` / `mobileLayers.test.ts`（按文件声明数/重复组棘轮）的实际覆盖面与盲区。

**总体评价**：本仓样式治理处于高水位——颜色/字号字面量 0、桌面 !important 9 条全部逐条有理由、kit 原语跨所有权覆盖 0、双端令牌护栏齐全、`cssLayers/mobileLayers` 棘轮把「层层套」压到 45 组基线。**没有系统性的新增叠层**；剩余问题集中在三类：
1. **legacy 残影**：同名类跨层/跨文件双定义、被高层压死但因 @media 上下文差异躲过 shadowedDecls 的死声明（S-01～S-04、S-07）；
2. **令牌收归缺口**：px 几何字面量（gap 441 处字面 vs 229 处令牌）、移动端动效三族并存且 v2 族零引用、`--shell-*` 别名族、等宽字体双写（T-01～T-05）；
3. **少量观感红线违规**：大纲选中条 3px 单侧色条、两处装饰性过渡、一个 900ms 自造动效、多维表面板件 1px 边框面（R-01～R-04）。
门禁侧最需要补的是「@media 上下文的 shadow 检测」「动效用法护栏」「原语类名宇宙扩面」（M-01～M-03）。无 P0；建议先做 S-05 / M-02 / S-01（低风险、直接降门禁负债）。

## 2. 方案清单

### 覆盖链 / 层层套（S-01 起）

---

**S-01 `.note-row.active` 等 4 组：legacy(@media) 与 shell 层双写、取值语义还不一致**

- **问题与证据**：
  - `src/styles/app/misc.css:73-75`（`@media (min-width:761px)` 内 `.note-row.active { color: var(--shell-text) }`）、`misc.css:122-125`（同名再写 `background: var(--shell-accent-soft); box-shadow: none`）、`misc.css:65`（`.note-list { padding: 0 6px 6px }`）、`misc.css:61-63`（`.tab-item:focus-visible` 的 outline 用 `--lake-accent-tint` + offset 2px）；
  - 对手：`src/styles/chrome.css:668`（`.note-row.active { color: var(--lake-fg-selected); background: var(--lake-bg-selected) }`）、`chrome.css:583`（`.note-list { padding: 0 5px }`）、`chrome.css:539`（focus 环用 `--lake-accent` + offset -2px）。
  - chrome.css 在 shell 层、misc.css 在 legacy 层（`src/styles/index.css` 层序）⇒ chrome 恒胜，misc 四组是**死声明**；但两处取值走不同令牌族（`--shell-*` 别名 vs 选中三件套），改选中态/主题时会出现「改了不生效」与静默漂移。ui-metrics `shadowedDecls=0` 未抓到：其判据要求同 at-rule 上下文（`scripts/ui-metrics.mjs` 的 declsWithContext/declIndex 段），misc 的规则在 @media 内。
- **具体方案**：以 chrome.css 为准收单——删 `misc.css:61-78` 与 `122-125` 的 4 组死规则（含空掉的 @media 壳）；若 761px 以下确需差异，把差异写成 chrome.css（shell 层）内的 @media 变体，不再回 legacy。配套把 M-01 的 shadow 口径补上，防止回流。
- **代价与风险**：纯删死规则，理论观感零变化；用 stylesnap `hover-row` 两态 + 目录选中态复核即可。低。
- **优先级**：P2 ｜ **涉及端**：桌面（app/* 移动端不加载）。

---

**S-02 侧栏卡片几何双写：compat.css（后加载）压过 app/shell.css**

- **问题与证据**：`.sidebar.sidebar-docked` 的 background/border/box-shadow/border-radius 同时写在 `src/styles/compat.css:132-138` 与 `src/styles/app/shell.css:213/253/383` 一带；`.app-shell.quick-notes-active .workspace` 的 border-radius 写在 `compat.css:144-148` 与 `app/shell.css:317/441`。两者同在 legacy 层，但 compat.css 在 `index.css` 中加载更晚 ⇒ 同特异性时 compat 胜，app/shell.css 侧为死/被压（`compat.css:130-131` 注释自己记录过同型踩坑：「再写一份会因 legacy 层内本文件加载更晚而压掉那边的值」）。
- **具体方案**：「侧栏卡片几何」定唯一归属（建议留 compat.css 或整体上移 chrome.css shell 层，二选一），另一侧删除；把 261017 那条 margin 收单注释改成单一来源说明。
- **代价与风险**：低；需 dark 主题（`compat.css:139-143` 有 dark 变体）与「已收起」分区态复核。
- **优先级**：P2 ｜ **涉及端**：桌面。

---

**S-03 `.settings-nav-item.active` 双写且取值冲突：bg-selected vs bg-hover**

- **问题与证据**：`src/styles/app/settings.css:22` = `background: var(--lake-bg-selected)`；`src/styles/components.css:127-131` = `color: var(--lake-text-1); background: var(--lake-bg-hover); font-weight: 600`。components.css 在 legacy 层内更晚加载 ⇒ **bg-hover 胜**，settings.css 那条是死规则；而 DESIGN「Selection & Hover Surfaces」规定 UI 选中 = `--lake-bg-selected` ⇒ 现状既与规格不一致，又两处各留一份。
- **具体方案**：一处定义、一处取值。① 若实机确认选中底应为选中档：把 components.css 该条 background 改 `--lake-bg-selected`（保留 600 字重），删 settings.css 死规则；② 若实机就是想要 hover 档观感：保留现值、删 settings.css 死规则，并在 DESIGN 补一行「设置页导航选中 = bg-hover 档」登记。两条路线都消掉双写。
- **代价与风险**：① 有 1 处视觉变化，需设置页截图确认；② 零视觉变化。低-中。
- **优先级**：P2 ｜ **涉及端**：桌面。

---

**S-04 `.ln-empty` 原语双文件双层定义（kit.css 与 components.css 各持一半）**

- **问题与证据**：`src/styles/components.css:244-250` 持 `display:grid / justify-items / text-align` + `.ln-empty--idle` 变体 + svg 尺寸；`src/styles/kit.css:773-784` 持 gap/padding/color/字号 + strong/small 层级。kit 层胜 legacy ⇒ 归属分裂：改空态间距要去 kit、改对齐要去 components；且 kit.css 头注释自称「刻意避开 legacy 已占用的名字（… ln-empty* …）」与现实矛盾（kit.css 实际定义了 `.ln-empty`）——注释已漂移。
- **具体方案**：`.ln-empty` 家族（含 `--idle`）整体收进 kit.css 单一区块，components.css 删残块；同步更新 kit.css 头注释的「避开名字」清单；合并后跑 `uiPrimitives/primitives` 与空态截图复核。
- **代价与风险**：机械搬移（两半声明不重叠），视觉零变化；cssLayers 棘轮基线按实测同步下调。低。
- **优先级**：P2 ｜ **涉及端**：桌面（components.css 移动端已不加载）。

---

**S-05 `.seg/.seg__item` legacy 分段控件 = 死实现 + 4 条 !important + 文件自认死声明（P1 级清欠）**

- **问题与证据**：
  - 全仓 TSX **零引用** `seg__item` / `.seg`（只有测试断言「不得使用」：`src/features/bitable/bitableEditorMount.test.ts:398/779/1197`）；小记版式切换已迁 `ln-segment`（`src/features/quickNotes/QuickNotesWorkspace.tsx:466`）。
  - `src/styles/components.css:322-350`：`.seg` 基座 + `.seg__item` 4 条 `!important`（桌面 !important 9 条允许清单里的 4 条）+ `.seg__item.is-active` 的 color/background/border 被**自己上方的 !important 压死**——文件内 260923 注释已如实记录「是被压死的死声明……保留仅为记录设计意图，待 W2 修正」。
  - 其存在理由已全部失效：「压 siyuan 的 `.b3-button--outline`」——该选择器全仓 0 定义（只在注释里出现）；「本文件双端共享」——移动端自 261012 起不再 import components.css（`src/mobile/main.tsx:25-47` 进口清单可证）。
- **具体方案**：删 `components.css` 的 `.seg` 整块（322-350 前后）+ `src/styles/a11y.css:42` 与 `src/styles/app/misc.css:112` 的 `.seg__item` reduced-motion 残条 + `feature.css:31` 的过时说明；`scripts/ui-metrics.mjs` IMPORTANT_ALLOWLIST 同步删 4 条（桌面 !important 9→5）；cssLayers 基线按实测下调。删前跑 stylesnap 全量（理论上零变化：本来就没人用）。
- **代价与风险**：极低；唯一风险是「有动态拼接出的 seg 类」——已 grep 模板字符串排除（`OutlineList.tsx` 的 `segs` 是局部变量非类名）。
- **优先级**：**P1** ｜ **涉及端**：桌面（连带门禁预算）。

---

**S-06 `.ln-list-item` 家族被调用点 scoped 覆盖（跨所有权护栏盲区的实锤）**

- **问题与证据**：`src/styles/app/quick-notes.css:120` `.quick-note-index-main .ln-list-item__text { min-width:0; flex:1 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }` —— audit-lookalike 判 1.00（与 `.ln-ellipsis` / `.ln-row__title` / `.ln-menu__label` 逐字同构）；`.ln-list-item*` 的唯一定义在 `src/styles/compat.css:85-103`。而 `primitives.test.ts` 的原语宇宙只有 kit.css / overlay.css / mobile kit / mobile floating 4 个文件 ⇒ compat.css 的 ln-* 家族不在守护范围，这类「外面重写原语内元素排版」不会被拦（对照 `quick-notes.css:420-421` 自己的注释口径「不再出现跨所有权覆盖」）。
- **具体方案**：在 compat.css 的 `.ln-list-item__text` 原语内补省略五件套，删 quick-notes.css:120 的 scoped 规则；真正防回流靠 M-02（原语宇宙扩面）。
- **代价与风险**：低；小记列表行视觉零变化（同构声明）。
- **优先级**：P3（随 M-02 做） ｜ **涉及端**：桌面。

---

**S-07 app-shell 栅格三态分散三文件，同层靠 import 顺序定胜负**

- **问题与证据**：`.app-shell` / `.app-shell.sidebar-collapsed` / `.app-shell.sidebar-floating` 的 `grid-template-columns` 分别出现在 `src/features/outline/outline.css:24` 与 `src/styles/app/misc.css:201`（同 legacy 层，outline.css 后加载 ⇒ 胜）；`.app-shell.quick-notes-active` 的 `grid-template-columns` 在 `src/styles/app/shell.css:278` 与 misc.css（misc 后加载 ⇒ 胜）。ui-metrics 的 crossFileDupGroups 已点名这些组（45 组基线 top 里占 4 组），但同层重复不计 shadowed ⇒ 没有「谁是死的」判据，改外壳几何要猜加载顺序。
- **具体方案**：app-shell 全部栅格变体单源到一个文件（建议 `app/shell.css`「壳层几何」分区或 chrome.css shell 层），misc.css / outline.css 删同名组；顺序敏感性由 M-01 的门禁兜底。
- **代价与风险**：低-中（外壳栅格动错 = 全局布局事故；需 `check:windowsweep` + stylesnap 42 态复核）。
- **优先级**：P2 ｜ **涉及端**：桌面。

---

### 分散实现收归令牌（T-01 起）

---

**T-01 间距/几何 px 字面量压倒令牌（gap 字面 441 vs 令牌 229）**

- **问题与证据**：非主题 CSS 中 `gap: <数字>px` **441 处**，`gap: var(--lake-space-*)` 仅 229 处；`padding` 字面 732 / `margin` 字面 382。audit-primitives 里 `align-items:center; display:flex; gap:8px` 一族重复 6 次跨 6 文件、`display:flex;gap:6px` 等族多组。DESIGN Layout 明文「空间节奏由 `--lake-space-*`（2/4/6/8/12/16/20/24/32/40）承担」。
- **具体方案**：**不做一次性全量替换**（churn 巨大、42 态快照全红、收益主要是整洁）。做两条：① `ui-metrics.mjs` 新增「间距/圆角字面量棘轮」（按文件计数只许降，与字号护栏同型）；② 立规矩「触碰某文件时顺手把该文件的 gap/padding 字面量换最近档」，从 features/bitable 与 mobile 高频文件起。已登记例外不换（如 `chrome.css` `.note-row` 行缝 1px）。
- **代价与风险**：门禁一次成型；换值批次每批需 stylesnap 复核。低风险。
- **优先级**：P2（门禁先行） ｜ **涉及端**：共享。

---

**T-02 移动端动效令牌三族并存，v2 族零引用 + 一处字面量**

- **问题与证据**：`src/mobile/theme/tokens.css:67-81` 同时定义 ① `--lake-motion-*`（与桌面同名同值 250ms）、② `--mobile-duration-panel / --mobile-ease-panel / --mobile-ease-out`（**实际在用**：`mobile.css:690`、`features.css:21/75`、`pad.css:84/252`、`quick-notes.css:74`、`brand-launch.css:16`、`usheet-chrome.css:402/414`）、③ `--mb-dur-fast/mid/page` + `--mb-ease`（v2 三档，**全仓 0 引用**）。tokens.css:67 注释自认「移动端实际入场用的是 --mobile-*……新代码别再二选一」，但 MOBILE-DESIGN v2 节（`docs/MOBILE-DESIGN.md:114-115`）仍把 --mb-dur-* / --mb-ease 写成规格。另 `src/mobile/bitable/mobileBitable.css:892` 硬写 `animation: mbt-drawer-in 250ms ease-out`（时长/曲线双字面量）。
- **具体方案**：① 删 `--mb-dur-fast/mid/page` + `--mb-ease`（或在 MOBILE-DESIGN v2 节标注「261118 动效归一后废弃」，文档与代码必须一致）；② `mobileBitable.css:892` 改 `var(--mobile-duration-panel) var(--mobile-ease-out)`；③ tokens.css 动效区注释点名「新代码只用 --mobile-*」。
- **代价与风险**：删死令牌零视觉变化；mobileBitable 入场观感应不变（同值 250ms/ease-out）。低。
- **优先级**：P3（②可单独先做） ｜ **涉及端**：移动。

---

**T-03 等宽字体族三处双写（font-family 借道）**

- **问题与证据**：`.ne-code/.ne-codeblock/code/kbd/samp/pre` 的 `font-family: var(--lake-font-family-mono)` 在 `src/styles/feature.css:15-22` 与 `src/styles/fonts/font-overrides.css:58-68` 各一份（同 feature 层、font-overrides 先加载 ⇒ feature.css 胜）；`.plait-text-container` 在 `font-overrides.css` 与 `src/vendor/drawnix-react-text.css`（legacy 层）各一份。共 5 组（ui-metrics crossFileDupGroups 点名）。`font-overrides.css` 文件头自述职责 = 「字体接线：body 覆盖 vendor 硬编码栈 + 内核正文/画板/代码字体」——它才是根落点。
- **具体方案**：等宽映射单源收进 `font-overrides.css`（其 selector 集合已超集），删 `feature.css:13-22`；`.plait-text-container` 的 vendor 侧不动（legacy 压制保留，属「压第三方」例外），只在 font-overrides 保留单条并注明「压 drawnix」。
- **代价与风险**：同值搬移，零视觉变化。低。
- **优先级**：P3 ｜ **涉及端**：桌面（移动端另有同名族自 mobile theme，不动）。

---

**T-04 `--shell-*` 别名令牌族残用（ui-metrics 别名护栏盲区）**

- **问题与证据**：`src/styles/app/base.css:56-63` 定义 `--shell-accent / --shell-accent-strong / --shell-accent-soft / --shell-text / -secondary / -tertiary / --shell-ease`，全部是 `--lake-*` 的转发别名；使用点：`outline.css:151/155/156/306/370/375`、`app/tabs.css:182/275`、`app/misc.css:74/123`（后者即 S-01 死声明）。ui-metrics 的「禁别名残用」FORBIDDEN 表只列了 `--lake-shell` 一族，**不含 `--shell-*`** ⇒ 无护栏。
- **具体方案**：使用点直换 `--lake-*`（值恒等），删 base.css 别名定义；FORBIDDEN 表补 `--shell-*` 族防回流。
- **代价与风险**：恒等替换，零视觉变化。低。
- **优先级**：P3 ｜ **涉及端**：桌面。

---

**T-05 圆角字面量 77 处（应走 `--lake-radius-*` 档）**

- **问题与证据**：`border-radius: <数字>px` 77 处（`features/bitable/bitableEditor.css` 14、`mobile/mobile.css` 9、`styles/chrome.css` 6、`mobile/ai/ai.css` 5…），对照 `border-radius: var(--…)` 465 处。字面取值多为 4/6/8/10 = 与 2xs/xs/sm/md 档同值，纯写法漂移；少数离档值已有登记令牌（`--lake-chat-radius-*`）却仍有漏网。
- **具体方案**：并入 T-01 的字面量棘轮一并治理；触碰即换。
- **优先级**：P3 ｜ **涉及端**：共享。

---

**T-06 `mb-btn` / `ln-btn` 同模型核对（审计目标 2 的两端一致性验证）**

- **问题与证据**：逐条对照 `src/styles/kit.css:20-71` 与 `src/mobile/kit.css:36-70`：4 语义（primary/outlined/secondary/ghost）+ `--danger` / `--danger-text` / `--link` + is-selected 三件套 + disabled 0.45 + focus 环，两端一致；几何按端（27/26 vs 44/36）为登记差异，符合「UI 两端独立、同模型」口径。**发现 1 处模型缺口**：移动端有实心危险组合 `.mb-btn--primary.mb-btn--danger`（红底白字 + 按下翻转，`mobile/kit.css:66-67`），桌面 `.ln-btn` 无对应规则——桌面若同时挂 `--primary --danger`，kit.css:45（accent-ink 底）与 kit.css:63（红字/红框）叠加会得到「墨蓝底红字」的非预期态。
- **具体方案**：二选一：① kit.css 补 `.ln-btn--primary.ln-btn--danger`（同移动端语义：红底白字 + danger-soft 按下）；② DESIGN Buttons 节明示「桌面禁止 primary+danger 组合」并在 primitives.test 加一条断言。
- **代价与风险**：① 新增 2-3 条声明（kit.css 基线 +）；② 零代码。低。
- **优先级**：P3 ｜ **涉及端**：桌面。

---

### 门禁覆盖缺口（M-01 起）

---

**M-01 shadowedDecls 盲区：@media/条件上下文差异让死声明隐身**

- **问题与证据**：`scripts/ui-metrics.mjs`（declsWithContext → declIndex 段）判「被上层压掉」要求 `ctx+sel+prop` 全同；S-01 的 misc.css @media 内死声明因此漏检（crossFileDupGroups 能报「重复」但不判死活）。本次自写脚本复算同端跨文件重复 42 组（解析口径与 ui-metrics 的 45 略有出入，以 ui-metrics 为准），其中 S-01/S-02/S-03 的 ~9 组是「低层死声明」而门禁全绿。
- **具体方案**：shadowedDecls 口径放宽一档：「同 sel+prop、高层声明、低层在 @media/同层更早文件里声明」即判被压（先只对「高层在顶层上下文」的形态判死，保守起步）；注意排除 !important 与 a11y 层序反转误判。预期能再清一批 misc.css/app/shell.css 残影并把 45 组基线显著压低。
- **代价与风险**：脚本改动小；需一次实测校准。中低。
- **优先级**：P2 ｜ **涉及端**：门禁（mobileLayers 可同口径）。

---

**M-02 原语门禁的类名宇宙只含 4 个文件，ln-* 家族大半裸奔**

- **问题与证据**：`src/styles/primitives.test.ts:17-22` PRIMITIVE_FILES = kit.css / overlay.css / mobile kit / mobile floating；但 ln-* 家族还住在 `components.css`（`.ln-empty:244`、`.seg`、`.badge`）、`compat.css`（`.ln-list-item/.ln-label:85-103`）、`dialog.css` 等（kit.css 头注释自列「legacy 已占用的 ln-dialog*/ln-tabs*/ln-toolbar*/ln-row2*/ln-empty*」）。实锤漏检 = S-06。EXEMPT_FILES 还按文件豁免了 kernel-theme / compat / pad（各有理由），但 compat 里的 ln-* 不该整体豁免。
- **具体方案**：把 components.css / dialog.css / compat.css 纳入原语类名提取（可只提取 ln-* 家族），EXEMPT 从「按文件豁免」改「按规则豁免」；跨所有权基线维持 0（现值应仍是 0，S-06 是唯一已知超标，修掉即可）。
- **代价与风险**：测试改动小；可能翻出 2-3 处历史 scoped 覆盖需要顺手收（正是想要的）。中低。
- **优先级**：P2 ｜ **涉及端**：门禁。

---

**M-03 动效用法无门禁（motionContract 只钉令牌值不钉用法）**

- **问题与证据**：`src/styles/motionContract.test.ts` 只断言令牌值；实际用法违规见 R-02/R-03（`outline.css:283/419` 的 120/180ms 与颜色/阴影过渡、`editor.css:239` 的 900ms ease-in-out、`mobileBitable.css:892` 字面量）。DESIGN Motion 六条规则目前全靠 review。
- **具体方案**：新增 grep 型护栏（vitest 或并入 ui-metrics）：① transition/animation 声明里出现 `[0-9]+ms` 字面量 ⇒ 报（白名单：a11y.css 的 1ms、reduced-motion）；② transition 的属性列表含 background/color/border/box-shadow ⇒ 报（白名单为空）；基线只许降，两端同口径。
- **代价与风险**：实现 ~40 行；先清 R-02/R-03 再上闸。低。
- **优先级**：P2 ｜ **涉及端**：门禁。

---

**M-04 TSX 内联 style 无门禁、无登记口径**

- **问题与证据**：全仓 `style={{}}` 81 处。多数合规（DESIGN 允许「动态几何例外：实测坐标、数据驱动颜色」，如 `bitableCells.tsx:585` 定位、`InkToolbarDesktop.tsx:54` 色板取色）；静态视觉残留 2 处：`src/features/editor/MultiTabEditor.tsx:223`（fixed 隐藏占位，该用 `.a11y-visually-hidden`，`src/styles/a11y.css` 已有唯一工具类）、`src/features/editor/EditorTab.tsx:1113`（`width:"100%"` 静态值）。历史先例：260928 曾把 lakeRuntime 内联样式收成 `.ne-card-error-fallback` 类（compat.css 注释在案）。
- **具体方案**：① 两处静态项改类/删；② ui-metrics 加「内联 style 计数棘轮 + 静态视觉属性（color/background/font-size/border/radius）出现在 style={{}} 即报」，动态几何按属性名白名单（left/top/width/height/--* 变量）。
- **代价与风险**：低。
- **优先级**：P3 ｜ **涉及端**：共享。

---

**M-05 重复组报告面不足：45 组只打 top10、无分类**

- **问题与证据**：`ui-metrics.mjs` 输出 `crossFileDupTop.slice(0,10)`；45 组全清单只能靠 `--json` 自取。且 45 组里混着两类：真欠账（S-01/02/03/07 + T-03 共 ~19 组）与**契约形态**（a11y reduced-motion 的同名覆盖 12 组：`.app-shell/.sidebar/.tab-item/.tree-row/.dock-filter-row/.floating-dialog` 的 transition/animation/transform 对；tokens.css 的 prefers-reduced-transparency 3 组）——后者是「层序即优先级」契约的必然形态，不该进棘轮，否则数字永远压不动、真欠账被淹。
- **具体方案**：报告模式打全清单；把「a11y 契约对」「reduced-transparency 契约对」加标注豁免，其余按「同层/跨层」分组显示。
- **代价与风险**：纯报告改动。低。
- **优先级**：P3 ｜ **涉及端**：门禁。

---

### 死 CSS / 重复组（D-01 起）

---

**D-01 audit-dead-css 移动端 4 候选核定 + 工具盲区 1 处**

- **问题与证据**：工具报 4 条：`.lv1/.lv2/.lv3`（`src/mobile/editor/editor-dock.css`）是**动态拼接类名**（`src/mobile/editor/OutlineSheet.tsx:95` `"med-outline-item lv" + depth`）⇒ AGENTS 三排除②，**假阳性不删**（AGENTS §2 已有同名踩坑记载）；`.mbt-option-add`（`src/mobile/bitable/mobileBitable.css:256`）全仓零引用、无拼接迹象 ⇒ **候选删**。工具盲区：设计词表文件（kit.css / themes / fonts / kernel-theme / compat）整体不报死类 ⇒ kit.css 里的死原语不可见，例如 `.ln-form__desc`（`kit.css:683/685`）全仓 TSX **0 引用**（`.ln-form__row/__label` 是活的，见 `PublishDocDialog.tsx:94-101`）。
- **具体方案**：① `.mbt-option-add` 删（同步 mobileLayers 基线 + mobile-snap 复核）；② `.ln-form__desc` 按「删前再 grep 一次 + 快照复核」流程删或留；③ audit-dead-css 对词表文件增加「未引用原语」提示模式（只提示不判死）。
- **优先级**：P3 ｜ **涉及端**：移动 / 桌面。

---

**D-02 crossFileDupGroups 45 组的处置口径**

- **问题与证据**：见 M-05 分类。值得收归的 = S-01（4 组）/ S-02（5 组）/ S-03（1 组）/ S-07（4 组）/ T-03（5 组）≈ 19 组；不值得收 = a11y 契约 12 组 + reduced-transparency 3 组 + 同值双写散组。
- **具体方案**：按上两节方案落地后 45 → 预期 ~20（全为契约形态），基线同步下调，剩余组在 M-05 报告里标「契约」。
- **优先级**：P3（随 S/T 批次顺带） ｜ **涉及端**：门禁。

---

**D-03 audit-lookalike 1.00 命中 68 条的处置口径**

- **问题与证据**：546 命中中 68 条 1.00（与原语逐字同构），主体是 `.ln-ellipsis` 五件套（overflow/text-overflow/nowrap/min-width，~40 处：bt-th-name、mbt-*、med-*、attachment-preview__title 等）与 `.ln-row__title / .ln-menu__label` 排版三件套。**判定**：工具类逐字复写不构成「同一交互语义多套实现」（各自是本域布局的一部分），但**挂在原语内元素上的复写**（S-06）与「整块状态族复制」（如 `editor-dock.css` `med-btn.med-active` / `med-f-btn.med-f-on` 与 `usheet-chrome.css` 两条同构「开态三件套」，audit-primitives 4 重复族）值得按语义收。
- **具体方案**：只收两处：① S-06 的原语内复写；② 移动端「dock/工具钮开态三件套」收进 mobile kit 一个开态原语（4 个调用点）。其余不收（见「明确不建议」2/10）。
- **优先级**：P3 ｜ **涉及端**：移动 / 桌面。

---

### 观感红线核对（R-01 起）

---

**R-01 单侧 3px 色条（DESIGN Shapes 明令禁止的形态）**

- **问题与证据**：`src/features/outline/outline.css:413` `.outline-item--selected { box-shadow: inset 3px 0 var(--lake-accent) }` —— 大纲列表项选中 = 左侧 3px 主色条，恰是被禁形态（「卡片、列表项、提示条上的左侧粗色条是 AI 生成界面的典型痕迹」）。全仓其余单侧色条核过：`tabs.css:51`（1px 底线，deleted 态提示）合规；`bitableEditor.css:406-407`（±2px 拖放前后指示）属拖放瞬时反馈（建议登记例外）。
- **具体方案**：大纲选中改 DESIGN「UI 选中」三件套（`--lake-bg-selected` + `--lake-fg-selected`，与目录行/页签同语义）；若用户坚持「色条指位」，则降到 1px inset 线并在 DESIGN 登记。拖放指示 ±2px 在 DESIGN Shapes 补一行登记（「拖放落点指示条 ≤2px 属瞬时反馈例外」）。
- **代价与风险**：① 有视觉变化（大纲选中态），需截图对比；② 零变化。中低。
- **优先级**：P2 ｜ **涉及端**：桌面。

---

**R-02 装饰性过渡 ×2 + 离档时长（DESIGN Motion 规则 6）**

- **问题与证据**：`src/features/outline/outline.css:283` `transition: background-color 120ms ease-out, color 120ms ease-out, border-color 120ms ease-out`（hover/选中色过渡，且 120ms 不在任何令牌档 80/90/250）；`outline.css:419` 过渡列表含 `box-shadow 180ms`（180ms 亦离档）。全量 grep 比对：全仓 transition/animation 里动颜色/阴影的仅此两处，其余为令牌化的位移/入场。
- **具体方案**：283 整条删（状态切换瞬时）；419 保留 opacity/transform/visibility、去掉 box-shadow 项、时长换 `--lake-motion-fast`。
- **代价与风险**：hover 从「渐变」变「瞬时」正是红线要求；reduced-motion 由 a11y 层兜底不受影响。低。
- **优先级**：P2 ｜ **涉及端**：桌面。

---

**R-03 自造动效：搜索命中脉冲 900ms ease-in-out ×2**

- **问题与证据**：`src/styles/app/editor.css:235-239`（`.lake-search-hit-target` + `@keyframes lake-search-hit-pulse`）：`animation: lake-search-hit-pulse 900ms ease-in-out 2`，keyframes 动 `background`（DESIGN：动效只动 opacity/transform）、曲线 ease-in-out（DESIGN：只 ease-out、「不要再自造曲线」）、时长 900ms 离档。
- **具体方案**：二选一——① 保留静态命中环（outline 2px 已在），脉冲只动 `opacity` 且时长走令牌档（或直接删脉冲）；② 若用户点名要醒目脉冲，在 DESIGN Motion 登记「搜索命中提示」例外并把值收进令牌。
- **代价与风险**：低；搜索命中态截图复核。
- **优先级**：P3 ｜ **涉及端**：桌面。

---

**R-04 0.5px 边框红线核对结果（含多维表 57 处 1px 面）**

- **问题与证据**：桌面自有样式（styles/**）>0.5px 边框仅 6 处，逐条核过均在例外面（spinner 2px 进度环、对话框 resize 把手 2px 图形、透明占位边、小记预览引用竖线 3px = 内容语义）；移动端 6 处同理。**多维表桌面 CSS 57 处 1px 边框**（`bitableEditor.css` 30+、bitableViews / KanbanView / GalleryView / CalendarView / FilterEditor / FormView / RelationPicker）：其中 `.bt-grid th/td`、`.bt-group-*` 表格线属「文档正文与编辑器内部等内容区」豁免（~15 处），其余 ~40 处是**面板件**（`.bt-filter-*`、`.bt-drawer`、`.bt-form-*`、`.bt-option-*`、`.bt-rule-*`、`.bt-rel-*`）——按字面属红线违规面。
- **具体方案（裁决点）**：A = 面板件边框统一 0.5px（需重烤 bitable-snap 3 态 + 实机确认密集数据面可读性）；B = 在 DESIGN Shapes 登记「多维表密集数据面面板件 1px 边框」例外并写明理由（这些面经 261120 字号批等多轮用户验收）。**倾向 B**（收益 < 快照重烤 + 密集面可读性风险，§3#17）；A 作为用户点单时的执行案。
- **优先级**：P3（裁决点） ｜ **涉及端**：桌面（多维表 CSS 两端共用，移动同面同步）。

---

**R-05 中点「·」分隔符红线**：样式侧无违规形态（分隔符属文案域）；CSS 中无用中点拼接的实现。抽样未见新增违规。

---

## 3. 明确不建议做清单

1. **一次性全量把 gap/padding/圆角字面量换令牌**——churn 数千行、42 态快照全红，收益主要是「代码更整洁」（§3#17 降级）；只做棘轮 + 触碰即换。
2. **合并 audit-lookalike 0.6x 的「面板头/行头」相似族**（`.ln-calendar__head` 族 ~60 条）——不同语义的行头，强行抽原语 = 为统一而统一。
3. **多维表 `.bt-primary/.bt-secondary/.bt-input` 族并入 ln-btn/ln-input**——密集数据面自有形态、多轮用户验收，迁移量大且压内核作用域敏感；如需一致只做「登记差异」。
4. **把 a11y reduced-motion 的同名覆盖收成单条规则**——同名覆盖是层序契约的必然形态，不是叠层债（M-05 只做豁免标注）。
5. **移动端 `.qn-tag-*` 空态并入 `.mb-empty`**——lookalike 仅 0.61，且带输入/添加交互，形态不同。
6. **两端 CSS/组件合并共享**——AGENTS 明令 UI 两端独立（ln-*/mb-* 各一套），不重提。
7. **给 themes/** 加声明数棘轮**——「主题即数据」，计数无意义；只保留现有未定义令牌护栏。
8. **清理 `.lv1-3` 死类**——动态拼接假阳性（OutlineSheet.tsx:95），AGENTS §2 在案。
9. **样式换框架/引 Tailwind/CSS-in-JS**——§3#22 明令禁止，不重提。
10. **把 ellipsis 五件套 40 处全部改挂 `.ln-ellipsis` 类**——牵 TSX 类名、收益=整洁（D-03 只收原语内复写）。

## 4. 历史兼容代码清单

> 判据按 AGENTS §3#7「这些数据能否删了重建？」样式域的「兼容」主要是 legacy 层残留与压内核契约；无用户数据依赖的可安全删（删 = 删规则，观感以快照复核兜底）。

| # | 位置 | 类别 | 现状语义 | 能否按 §3#7 删 | 删的代价 |
|---|------|------|----------|----------------|----------|
| 1 | `src/styles/components.css:322-350` `.seg/.seg__item`（含 4 条 !important） | ① | 死实现：全仓 TSX 零引用（已迁 ln-segment）；压的 `.b3-button--outline` 已不存在；is-active 部分是自认死声明 | **能**（S-05） | 极低；stylesnap 全量复核 + ui-metrics 清单删 4 条 |
| 2 | `src/styles/a11y.css:42` / `app/misc.css:112` `.seg__item` reduced-motion 残条 | ① | 随 #1 存在 | **能**（随 S-05） | 零 |
| 3 | `src/styles/components.css:244-250` `.ln-empty` 半定义 | ① | 与 kit.css 各持一半的原语 | **能**（合并进 kit 后删，S-04） | 低；机械搬移 |
| 4 | `src/styles/app/misc.css:61-78 / 122-125`（@media 内 4 组） | ① | 被 shell 层 chrome.css 压死的死声明（取值还与现役语义不一致） | **能**（S-01） | 低；hover-row 快照复核 |
| 5 | `src/styles/compat.css:132-148` ↔ `app/shell.css` 侧栏几何双写（删一侧） | ① | 同层后加载者胜，前者是死/被压副本 | **能**（S-02 合并） | 低；dark/收起态复核 |
| 6 | `src/styles/app/base.css:56-63` `--shell-*` 别名族 | ① | `--lake-*` 恒等转发别名（10 个使用点） | **能**（T-04，替换后删） | 低；恒等替换 |
| 7 | `src/mobile/theme/tokens.css:78-81` `--mb-dur-fast/mid/page` + `--mb-ease` | ① | v2 动效三档，全仓 0 引用（261118 已归一到 --mobile-*） | **能**（T-02；同步改 MOBILE-DESIGN v2 节表述） | 零 |
| 8 | `src/mobile/bitable/mobileBitable.css:256` `.mbt-option-add` | ① | 零引用死类（工具已报） | **能**（删前最后确认，D-01） | 零 |
| 9 | `src/styles/kit.css:683/685` `.ln-form__desc` | ① | TSX 0 引用疑似死规则（`.ln-form__row/__label` 是活的） | **待确认后能**（D-01） | 零 |
| 10 | `src/styles/kernel-theme.css`（整文件未分层） | ② | 压内核注入的未分层 schema（AGENTS §3#14 明确保留） | **不许删** | — |
| 11 | `src/mobile/editor/edit-surface-kernel.css` 19 条 !important 主体 | ② | 压内核未分层/inline 几何（文件头逐条有理由） | **不许删** | — |
| 12 | `src/styles/tokens.css` prefers-reduced-transparency 3 条 !important | ② | 无障碍契约：压所有浮层毛玻璃（含第三方） | **不许删** | — |
| 13 | `app/quick-notes.css` 内核 fullscreen fixed / `usheetEditor.css` slide-tab height 2 条 !important | ② | 压内核 legacy !important 与 inline style | **不许删** | — |
| 14 | `themes/base.css` `--lake-ease-overshoot` 名字 | ② | DESIGN 明文「名字保留只是历史兼容」（已裁决） | **不许删** | — |
| 15 | `compat.css` `.config-*` 设置骨架 + `.ln-list-item/.ln-label` | ② | AGENTS 指定归属（设置页骨架单一来源），是活契约非遗留 | **不许删**（内部可整并，见 S-06） | — |
| 16 | a11y 层 reduced-motion 同名覆盖 ~12 组 | ② | 「层序即优先级」契约的必然形态 | **不许删** | — |
| 17 | 文档正文/编辑器内部的 1px 表格线、引用竖线等 | ② | DESIGN「内容区不参与 0.5px 统一」 | **不许删** | — |
| 18 | `css-audit/baseline/` + stylesnap/mobile-snap 基线 | ③ | 视觉/工具基线（重烤机制，非兼容代码） | 不适用（按 §3#21 重烤） | — |
| 19 | audit-dead-css 三排除词表、ui-metrics IMPORTANT_ALLOWLIST | ③ | 工具资产/门禁口径 | 不适用（S-05 时同步清单） | — |
| 20 | `bitableEditorMount.test.ts:398/779/1197` 的 not.toMatch(/seg__item/) 断言 | ③ | 迁移期防回退旧夹具 | S-05 后保留（仍防回流） | — |

**结论：可删 9 项（其中 2 项删前需最后确认）/ 不许删 8 项 / 工具与夹具 3 项不适用。**

## 5. 大文件与注释现状小结

**头注释/分区注释良好（无需动作）**：`kit.css`（931 行；分区清楚，但头注释「避开 ln-empty*」已与现实矛盾，见 S-04）、`chrome.css`（889 行）、`app/shell.css` · `app/quick-notes.css` · `app/misc.css` · `app/tabs.css`（S3 拆分头注释统一）、`feature.css`、`overlay.css`、`mobile/mobile.css`（1498 行，注释配平纪律在案）、`mobile/bitable/mobileBitable.css`、`mobile/kit.css`、`mobile/editor/editor-dock.css`、`vendor-focus.css`、`dialog.css`、`tokens.css`、`a11y.css`。

**缺头注释/契约注释漂移（补注释方案）**：

| 文件 | 现状 | 补注释方案 |
|------|------|------------|
| `src/styles/components.css`（399 行） | **无文件头**，直接以 `.sync-status-control` 规则开头；职责（legacy 油漆层小件：sync-status/badge/seg/ln-empty 半/设置导航）全靠读规则猜 —— 本次审计的 S-04/S-05 漂移正出自此文件 | 补头注释：职责清单 + 「本文件是 legacy 层，同名原语以 kit 为准；新原语一律进 kit.css」+ .seg 块删除后的现状说明 |
| `src/styles/document-status.css`（102 行） | 无头注释，首行直接是 `.workspace` 规则 | 补 3 行头：状态栏按 doc-kind 落位契约（与正文侧让位成对，已有 uiPrimitives 测试钉）一句话写进文件头 |
| `src/styles/kit.css` 头注释 | 「刻意避开 legacy 已占用的名字（… ln-empty* …）」与 kit.css 实际定义 `.ln-empty` 矛盾 | 随 S-04 更新清单，写明 ln-* 家族实际归属文件表 |
| `components.css:322-350` `.seg` 注释 | 「保留仅为记录设计意图，待 W2 修正」——W2 已在 TSX 侧完成（ln-segment），注释成为误导 | 随 S-05 删除整块，勿留悬空注释 |
| `src/features/outline/outline.css`、`src/styles/app/editor.css` | 违规点（R-01/R-02/R-03）无「为何偏离」注释 | 落地修正时各留一行「按 DESIGN Motion/Shapes 改，261125 审计 R-0x」 |
| `src/styles/app/base.css` `--shell-*` 块 | 无「这是过渡别名、待清」标注 | 随 T-04 删除；若分批做，先补一行「别名残用，勿新增引用」 |

**大文件拆分建议**：`mobile.css`（1498 行）与 `mobileBitable.css`（1109 声明）虽有分区注释但已超舒适阅读尺寸；建议**只在下次大改该域时**顺手按分区拆（如 mobile.css 的「首页 Dock / 工作区 / 设置 / 抽屉」四段，mobileLayers FILES 同步登记），不为拆而拆（§3#17）。桌面 `kit.css` / `chrome.css` 保持现状（分区清晰、职责单一）。

---
*报告生成：261125 · 第 4 流（前端样式）· 只读审计，未改任何产品代码。*
