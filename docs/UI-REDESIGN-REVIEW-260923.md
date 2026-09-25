# UI-REDESIGN-REVIEW-260923.md — UI 重构（P0–P8 → 主题/几何 → 目录面板）全面评价 + 收尾审计

> **评价对象**：260921–260923 桌面 UI 重构全批次 —— §2.22（P0–P8：剥离思源层 + 自有设计系统）、§2.23（14 提交视觉回修）、
> §2.24–§2.27（主题 A/B/C、增强大纲进编辑区、目录触发条/浮层）、260923（面板契约 + `⌘]` + 垂直几何令牌化 + 红绿灯对齐 + 微调）。
> **口径**：结论只引**可复现证据**（门禁输出 / 实测数值 / 文件行号），不写无法验证的"更好看"。复现命令见文末。

## 一、评价

### 1. 视觉设计改进

| 维度 | 改前 | 改后 | 证据 |
|---|---|---|---|
| 样式来源 | 思源 `b3/*` 套壳 + 层层覆盖 | 自有设计系统：单入口 `styles/index.css` + 8 层 `@layer` | `ui-metrics`：入口 b3 import **0**、桌面 `var(--b3-*)` **0** |
| 主题 | 浅/深 + 散落字面值 | 主题即数据：`themes/{base,light,dark,warm}` 只定义变量，注册表驱动 `data-theme` | 三套主题逐屏 `getComputedStyle`（§2.22 P2/P5*） |
| 颜色字面量 | 各文件散落 hex/rgb | 只允许出现在 `themes/` | `ui-metrics`：非主题颜色字面量 **0** |
| 层次 | 字号偏小、深色下 panel 与窗底同色 | 字号阶梯 +1px；panel 实心；阴影四档（card/popover/dialog/drag）；主色提饱和 | §2.23 A/B |
| 可读性 | — | 对比度 **42 项全过 AA**（`text-3` 在卡内块上 4.21 → ≥4.5） | §2.22 P2 |
| 密度 | 顶栏 38 / 面包屑 32 / 工具条 38 | 顶栏 **32** / 面包屑 **30**（内距 16→12）/ 工具条 **34**；标签 28 与顶栏**解耦** | 隔离实例实测 |
| 几何一致性 | peek 顶 80、浮层顶 112、阅读态大纲 74 **写死** | 全部由 4 个令牌**派生** | `chrome.css` / `shell.css` / `editor.css` |
| 原生外壳 | 红绿灯写死 `y=13`（为 38px 顶栏调） | 由 `layoutMetrics.TOPBAR_HEIGHT` 计算 ⇒ 中心恒等于顶栏中心 | native `getWindowButtonPosition()={x:14,y:10}` |

### 2. 用户体验优化
- **键盘可达性**：`⌘]` 固定/收起目录栏（此前**只有鼠标**入口）；📌 补 `aria-keyshortcuts`；设置「快捷键」登记。
- **目录栏三态**（固定/悬浮/收起）：隐形 **10px** 热区 + 跟手把手 + **240ms** 驻留；面板贴左缘、贴底浮卡；顶边随令牌联动。
- **块编辑数据安全**：菜单/拖拽全走内核原生命令（`deleteByRange` 补空行、删节点前选区复位、列表父项 = 整块、多块批量）；块手柄图标贴正文而**命中盒不动**（不抢首字点击）。
- **目录树交互**：刷新按钮、点文档不自动展开子项、自动定位消除 **2 帧**错位、重命名单一焦点环、＋菜单 220×60 → 150×50。
- **深色/暖色体检**：主界面/设置/回收站/搜索/小记**五屏 0 异常**（§2.23 B）。
- **红绿灯与顶栏同轴**（用户 260923 报，已修）。

### 3. 技术实现质量
- **层序即优先级**：新样式写进对应 `@layer` 即压过 legacy，**不靠特异性 / `!important`**；全桌面 `!important` **9 条**（≤10），每条在代码里写明理由。
- **四条自动化围栏**：`cssLayers.test.ts`（逐文件声明数/重复组/空壳）、`scripts/ui-metrics.mjs`（五项硬指标）、`scripts/check-core-boundaries.mjs`、`scripts/check-bundle-budget.mjs`。
- **可复用审计法**：样式层删除后的「(选择器, 属性) 漏搬比对」（§2.23 F，71→15→5）——本次最值钱的方法资产。
- **vendor 治理**：`LOCAL-CHANGES.md` 21 条 + `npm run build:vendor`；内核契约 `docs/LAKEX-CONTRACT.md` §5.1–§5.13。
- **文档分工**：`AGENTS.md`（红线）· `README.md`（概览）· `HANDOFF.md`（唯一交接）· `PANEL-CONTRACT.md`（面板不变量）。

### 4. 过程中的问题（诚实记录）
1. **删样式层时漏搬**：P7-b 只搬了部分承重规则 ⇒ 菜单项图标贴字、同步浮窗与 `.tabbar-trailing` **完全没样式**、滚动条回落系统 15px。**教训：删层必须逐属性比对，"页面没坏"不算验证。**
2. **围栏基线没同步就提交**：本批曾两次在围栏红着时提交（事后 `--amend` 修）。
3. **验证借用了用户端口/别人的构建**（1442 实为用户会话的 preview）⇒ 若干"验证通过"验的是旧产物；后段改用独立端口 + `lsof cwd` 核对。
4. **画板打不开是既有 bug**（`TypeError: Wt is not a function`，已在 `origin/master` 未改动基线复现）⇒ 非本批引入，**仍未解决**；画板容器壳因此未做视觉验证。

## 二、关键成果（提炼）
1. **换掉整套 UI 底座**：从"思源层套壳 + 层层覆盖"→ **自有设计系统**（单入口 + 8 层 + 令牌 + 主题即数据 + 14 件 kit），桌面与 b3 **彻底解耦**。
2. **把"改不动"变成"改得准"**：几何/颜色/字号全部令牌化，**同一视觉只有一个来源**；改密度只改 4 个数字。
3. **补齐交互缺口**：目录栏键盘入口、块编辑原生化、目录树一批交互细节、macOS 原生外壳对齐。
4. **立起防回归体系**：4 条自动化围栏 + 漏搬审计法 + 面板契约 + 内核行为契约。
5. **留下可复现的验收材料**：`docs/UI-REDESIGN-260921/`（元素底账 56/56、验收口径、对比页 10 组、主题令牌、字体清单）。

## 三、260923 收尾审计（实跑）

```
tsc --noEmit                 → 0
npm test -- --run            → 1213 passed / 16 skipped (1229)
node scripts/ui-metrics.mjs  → b3 引用 0 · 颜色字面量 0 · !important 9 · 入口 b3 import 0 · 同名文件对 0
npm run check:core           → 65 文件 / 违规 0
npm run check:bundle         → app-js gzip 1.79MB/2.9MB · app-css 184KB/2MB · drawnix 408KB/1.4MB
git diff --check             → 干净
```

**本轮修掉（查漏补缺）**
- **围栏基线 10 个文件偏松 ⇒ 按实测收紧**。最严重：`styles/tokens.css` **83 → 6**、`styles/motion.css` **10 → 1**；
  其余 `b3/base.css` 16→13 · `b3/layout.css` 187→184 · `features/outline/outline.css` 290→277 · `styles/app/base.css` 39→33 ·
  `dialogs.css` 152→146 · `misc.css` 293→288 · `shell.css` 512→503 · `tabs.css` 204→202。**此前这些文件的围栏等于虚设。**
- **删掉全仓零引用的死令牌 8 类**：`--ease-in-out`、`--dur-press`、`--shell-toolbar`、`--shell-radius`、
  `--shell-card-shadow`、`--shell-micro-card`（连同空掉的 `:root` 块一起删，避免留空壳规则）、
  `--radius-lg`（过渡别名里唯一没人读的）、`--lake-pinned-border` / `--lake-pinned-tint-hover`（三套主题各 2 条）。
  > 审计脚本一度把 `.ln-tag--hoverable` 报成令牌 `--hoverable` ⇒ **误报**，已识别并保留（BEM 修饰符）。
- **修过期回退值**：`outline.css` 4 处 `var(--lake-editor-top, 112px)` → 由令牌派生（实际 64px）。
- **修过期注释/数字**：热区 8→10px、工具条 36→34px、`editor.css` 的"12px 热区"、HANDOFF「在途」→「已提交」。

**有意保留（有理由，非遗漏）**
- `--lake-shadow-drag`：在 `05-THEME-TOKENS-ABC.md:34` 的**阴影词表**里，属设计系统词表。
- `--lake-space-* / --lake-motion-* / --lake-ease-* / --lake-z-* / --lake-line-height-* / --lake-font-size-h1 / --lake-font-weight-bold`
  等约 20 项**全仓零引用但属尺度词表**（完整 ramp 是设计系统常态）⇒ 保留；要裁剪需先定"词表保留 vs 按需存在"的设计口径。

## 四、对重构本身的复盘：哪些不该做 / 哪些能做得更好

> 只谈**这次重构自身**的判断（后续项目待办另见 §五）。判断尽量给可验证证据。

### 4.1 判定「不该这样做 / 做过量」

1. **`ln-*` 组件库 14 件（P4）—— 本批最大的一处过度设计。**
   证据：`kit.css` 共 **43 个 `ln-*` 类名，只有 7 个被 TSX 使用**（`ln-row`/`ln-menu`/`ln-dialog`/`ln-row2`/`ln-tabs`/`ln-toolbar`/`ln-empty`，**全是旧的承重类**）；
   **466 / 550 条声明（85%）服务的是全仓零引用的类**（`ln-btn`/`ln-iconbtn`/`ln-input`/`ln-select`/`ln-switch`/`ln-tag`/`ln-card`/`ln-toast`/`ln-drawer`/`ln-segment`/`ln-form` …）。
   P5 十屏迁移**没有一屏改用 kit 类名**，而是把规则改写到 legacy 类名上（`.b3-button`/`.b3-select`/`.b3-switch`/`.floating-dialog` …）。
   根因就写在 §2.22 自己那句「现有 TSX 未把任何 kit 类名当作完整 token 使用 ⇒ **加入当天零视觉回归**」——**"当天零影响"本身就是过度设计的自白**：它把验证无限期推后，后面的进度压力自然选了更短的路。
   **更好的做法**：不做 14 件，只做「令牌 + 层 + 承重类覆盖」；真要组件化，选 **2 个屏把 TSX 真改过去**做通、算清切换成本，再决定铺不铺开。**「必须带 TSX 改动才算完成」应写进组件化的验收口径。**
   > ⚠️ **260923 更正（重要）**：**不要因此删除 kit** —— `docs/UI-REDESIGN-260921/kit-demo.html` 有 **59 处** `ln-*` 引用（≥20 个类），`03-ACCEPTANCE.md`/`04-LAYOUT-SPACE-SPEC.md` 亦引用它 ⇒ 它是**本设计系统的组件词汇表 + living demo**；且已定「安卓复用同套设计系统」⇒ 正解是**安卓端采纳它**（或明确降级为 demo-only 并标注），而不是删。本条批评的是「做完没被 P5 采纳」，不是「不该存在」。

2. **`@layer` 声明了 `reset` 层，却从没有任何文件 import 进去**（`index.css` 只有 legacy/tokens/kit/shell/feature/overlay/a11y）。
   声明了不用的层比没有更糟——后来者会以为那里有东西。要么删层名，要么把基础复位搬进去。

3. **目录面板的「悬停召唤」交互：全批 bug 密度最高、投入产出最低的一块。**
   隐形热区 + 跟手把手 + 240ms 驻留 + 走廊并集 + 贴边守卫 + 层序抢位 —— §2.28 列的 **11 条坑有 7 条**出在这里，还逼出一条"冻结项"、并在次日被用户改口径；它吃掉了 §2.26 + §2.27 两个会话。
   而"常驻把手 / 一个显式按钮"能拿到约 90% 的收益、且零守卫。**不是说它错**（交互是用户点名要的），但**性价比全批最低**，下次应先谈交互再谈实现。

4. **minimap（左缘缩略图）：加了又被删，纯返工。**
   它当初是为"半幅浮层露出的横条"引入的 ⇒ 属于**用新机制掩盖几何 bug**，而不是修几何。

### 4.2 判定「还能做得更好」

5. **"彻底剥离思源样式层"名不副实：实际是"整层降级 + 叠加覆盖"。**
   证据：桌面仍全量加载 legacy（`index.css` 十余条 `layer(legacy)`，含内核 style.css ≈130 万字符）；我们自己的旧 CSS ≈**2500 条声明**原样在产物里（app-css raw **1.46MB** / gzip 184KB）；
   围栏仍在统计**重复 (选择器,属性) 组**：`app/shell.css` **10**、`dialog.css` **8**、`quick-notes.css` **8**、`app/dialogs.css` **7**。
   分层迁移本身是低风险的正确路径，但**措辞过度承诺**。更好的做法：把"删 legacy 声明"立成**有护栏的持续过程**（漏搬比对 + 32 状态矩阵当回归网），而不是停在"降级"。

6. **过渡脚手架没清（P7 的收尾漏了）**：`themes/base.css` 6 条 + 三套主题各 20 条 = **66 条纯过渡别名**，注释还写着"P7 删 legacy 后可移除"——P7 早已做完。
   教训：**"XX 之后可移除"这类注释必须配一个待办/触发条件，否则等于永不执行**。（本次收尾只删掉其中唯一零引用的 `--radius-lg`；其余 66 条仍被 legacy 引用，只能随第 5 条一起做。）

7. **"几何单一来源"是事后才补的 ⇒ 说明原则缺可执行护栏。**
   `--lake-dir-peek-top` 写死 80、`--lake-floating-panel-top` 写死 112、阅读态大纲 `top:74px` 从 P5 一直活到 260923；红绿灯 `y=13` 同理 —— 一个写死值撑了整批，改一次顶栏立刻暴露 3px 错位。
   更好的做法：`ui-metrics.mjs` 已经证明"硬指标"有效（颜色字面量=0、b3 引用=0），**给几何加一条同类的**（禁止 chrome 栈相关裸 px 加法，或把这些值列入白名单审计）。

8. **`PANEL-CONTRACT.md` 只是散文，没有可执行性。** 面板几何是本批最大坑源，但 z 序（110/100/250/260/400）散在 4 个文件、顶边两套机制。
   **能被测试的约束才是约束** ⇒ z 序与顶边口径应落成常量/单测（现在只有 `--topbar-height` ↔ `layoutMetrics.TOPBAR_HEIGHT` 这一条一致性单测）。
   **260923 部分落实**：外壳 z 序已令牌化（`themes/base.css` 的 9 个 `--lake-z-*`）+ `src/styles/zOrder.test.ts` 强制顺序与"无字面量"；顶边口径仍以散文（`PANEL-CONTRACT.md`）+ `geometrySources.test.ts` 部分断言为准。

9. **`!important` 只降到 9、没降到底：其中 4 条是 `.seg__item`**（另 1 条是面板宽度压 JS inline style，属合理）。
   原因是规则所在的 `components.css` **双端共享**，移动端靠它压 `.b3-button--outline`。桌面已经有 `@layer` 了，正解是**把分段控件按端拆文件**，而不是两端共用 + `!important`。
   **260923 复评（W4 结案）**：原 W4 方案"桌面版搬 `kit.css`、移动端那份一字不动"**不可行**——`@layer` 的 `!important` **反转层序**，legacy `!important` 必压 kit 普通声明，两者不能共存；已决定不做、并入 W2。实测还发现一个**注释与实现不符**：`.is-active` 的 `color/background-color/border-color` 被同一条 `!important` 压成**死声明**，段控件的选中态实际**只靠一条 `box-shadow` 区分**（与注释宣称的"抬起表面 + 中性墨色"不符），已在三处 CSS 注释里更正、并留待 W2 一并修正。

10. **增强大纲"进编辑区"投在了非默认路径上**：只在 `editor-outline-enhance=true`（默认 **false**）时生效，默认走内核原生 TOC（第三方外观，不在重做范围）。
    不是错，但**优先级判断可以更早**：先确认用户到底用不用它，再决定投入。
   **260923 W6 已核验关闭态零成本**：不挂载 / 原生大纲不受影响 / 不让位，并补了单测护栏；唯一发现是 `outline.css` 无条件承载两条基础布局规则（值有意，仅标注归属，未搬）。

11. **整个重构没有视觉回归门禁** —— 最直接的证据是 P0–P8 收尾后用户的「**这个版UI太丑了啊**」＋随后 14 个提交回修；P7-b 删层漏搬（同步浮窗 / `.tabbar-trailing` 完全没样式、滚动条回落系统 15px）也是**用户截图**发现的。当时 32 状态矩阵"只用于抓未预期差异、不作通过标准"。
    更好的做法：迁移期把矩阵跑成**必须过**的门禁；对 2–3 个试点屏做计算样式/像素快照；把 §2.23 F 的"漏搬比对"从**事后总结**提到**删层前置**。
12. **设置面板打开后不移入焦点**：`SettingsPanel.tsx` 的 `navSearchRef` 只声明、**全文件无任何 `.focus()` 调用**（CDP 焦点模拟实测 `document.hasFocus()=true` 但 `activeElement` 仍不是它）⇒ 对话框初始焦点缺失，是**真实的无障碍缺口**；因属功能改动，本批只把它从失效冒烟里摘出并留注，未修。

### 4.3 判定「做得对、不要动」
- `@layer` 层序取代特异性 / `!important` 的方向；单入口 `index.css`。
- 主题即数据 + `ui-metrics` 硬指标（颜色字面量 0、b3 引用 0 —— 真达成且**每天在防回归**）。
- vendor / 内核边界治理（`LOCAL-CHANGES.md` 21 条 + `LAKEX-CONTRACT.md`）：黑盒项目里最值钱的投资。
- 把"找根位置、别套覆盖"写进 `AGENTS.md §3 #14`。
- 迁移全程隔离实例 + 独立端口（后段纠正之后）。

### 4.4 如果重来一次，只改 3 件事
1. **kit 先做减法**：不建 14 件；要组件化就必须带 TSX 改动，并选 2 屏试点。
2. **几何第一屏就令牌化**，并把"chrome 栈裸 px"加进 `ui-metrics` —— 这一条护栏能同时防住红绿灯错位、peek 漂移、面板顶边三处 bug。
3. **删层/迁移配门禁**：漏搬比对 + 32 状态矩阵从"事后工具"变"提交前必过"；`reset` 层当场删掉。

> **本次收尾为什么没动 kit？** 删掉它 = 放弃"自有组件库"路线，**补落地** = 挑 2 屏真改 TSX —— 两条都是产品路线决定，需要你拍板；我只做了无争议的部分（围栏收紧 / 死令牌 / 过期回退）。

## 五、附：项目后续待办（**不属本次重构评价**，原 §四）

**P0 安全（建议优先）** —— ✅ **260926 已结案**
1. **W-8**：`webApiServer` 的 `/api/*` 现已做 Host + Origin 完整白名单 + `Sec-Fetch-Site` 拦截（`webApiServer.test.ts` 覆盖跨站 / DNS-rebinding / 空端口）。
   **W-10 dompurify**：**判定不需要** —— 残留 `dangerouslySetInnerHTML` 仅搜索摘要，由 `buildSnippet` 全量转义、只输出 `<mark>`（`snippet.test.ts` 覆盖 script/&/引号/img-onerror）；全仓无 eval / 其它未转义注入面。加依赖属过度设计（AGENTS #17）。

**P1 机制 / 体验**
2. `library-changed` 广播（外部改动 / AI 写入自动刷新目录）。**触发条件**：AI 写入路径或浏览器端写功能落地；届时与 §3.10 的 SSE 一起做。
3. 目录树窗口化 / 按笔记本懒加载。**触发条件**：先造 5k/10k 合成数据量渲染耗时，量到卡再立项（现库 549 节点、`content-visibility` 已上）。
4. 分段控件段态 + 设置项说明字号被**双端共享层 `!important`** 阻挡 ⇒ 并入移动端批次。
5. **面板契约可执行化**：`PANEL-CONTRACT.md` 目前只是文档；建议把 **z 序**与**顶边口径**做成常量或单测
   （现在只有 `--topbar-height` ↔ `layoutMetrics.TOPBAR_HEIGHT` 有一致性单测）。

**P2 可维护性**
6. 设计词表裁剪（见 §三「有意保留」）。
7. **历史文档标注**：`docs/UI-REDESIGN-260921/03-ACCEPTANCE.md` / `04-LAYOUT-SPACE-SPEC.md` 里仍有旧几何（38px 顶栏、8px 热区），
   建议文首标注「**历史快照，现状见 `PANEL-CONTRACT.md` 与 HANDOFF §0**」。
8. **画板 bug**（`Wt is not a function`）单独立项 —— 它会挡住画板的任何视觉验证。

**P3 产品（长期，§3 已记）**
9. 画板 AI 助手接入；离线残余 3 处（外观级）；移动端表格只读渲染 + 缩略图真机验收；回收站首拉成本；导出（Word/PDF/分片）。

## 六、复现命令
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npx tsc --noEmit
npm test -- --run
node scripts/ui-metrics.mjs
npm run check:core && npm run check:bundle
git diff --check
```
