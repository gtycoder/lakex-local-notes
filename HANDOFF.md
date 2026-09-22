# HANDOFF.md — Lake Notes 项目交接（唯一权威交接文档）

> 写给**完全没有上下文的新会话**。开工先读三份：本文件 → `AGENTS.md`（长期红线/机制/坑，每次自动加载）→ 相关 `docs/`。
> 历史所有 dated handoff 已合并进本文件（内容在 git 历史可查）。本文件只保留**当前状态 + 真正的待办 + 有价值的坑**。
> **§8 是移动端（安卓）专职交接**，由移动端会话维护；桌面会话不要改 §8，移动端会话不要改 §0-§7 之外的桌面文件。

## 0. 当前基线（新会话开工前）
- **分支**：`master` = `origin/master`，**已包含本轮全部工作**；所有功能/检查点分支**已合并并删除**，只留一个纯备份分支 `backup/ui-theme-abc-handoff-260922`（= 260922 接手前的状态 `604913a`）。
- **master 提交链（本轮）**：`d3bfc56`（UI 重设计末批 + 文档）→ `604913a`（§2.24 主题 A/B/C + 三空间 + minimap）→ `106d2c2`（浮层铺满 + 编辑区右移）→ `12e60eb`（增强大纲进编辑区 + 目录去缩略图/壳层满宽）→ `443b367`「左缘跟手把手 + 贴底浮卡 + 宽度 bug 修复」→ **`8e31fce`（260923：面板契约 + `⌘]` + 垂直几何令牌化收窄 + macOS 红绿灯对齐）**→ **`681997a`（260923 收尾审计：围栏基线收紧 / 死令牌清理 + 热区 10px + 块手柄贴正文 + 复盘文档）**（`git log --oneline -6` 看全）。
- **👉 最新会话完整交接 = §2.28（新会话先读它）**。分项细节：§2.22（UI 重设计 P0–P8）· §2.23（视觉回修 14 提交）· §2.24（主题 A/B/C + 空间 + minimap）· §2.25（增强大纲进编辑区）· §2.26（目录去缩略图 + 壳层满宽 + 手柄边界）· §2.27（跟手把手 + 贴底浮卡 + 宽度 bug）。
- **⚠️ 用户定稿（冻结项，别再改/别再提）**：见 **§2.27 六** —— ① 悬浮/触发条逻辑冻结（隐形 10px 热区 + 跟手把手 + 驻留 240ms + 贴左缘 + 底缝 12px、顶贴面包屑下缘）；② **固定目录栏自成一个区域**（继续用栅格列，**不搬进编辑区**）；③ **SidePanel 组件原语决定不做**（两侧几何/推挤策略刻意不同；理由在该节）。
- **260923 本会话（已提交并推送：`8e31fce`）**：桌面面板/目录收口 —— ① 新增 `docs/PANEL-CONTRACT.md`（跨侧不变量单一来源）；② **`⌘]` 固定/收起目录栏**（面板可见性此前只有鼠标入口；对齐 Feishu）；③ **垂直几何令牌化 + 收窄**：顶栏 **38→32**、面包屑 **32→30**（内距 16→12）、内核工具条 **38→34**；标签高度**与顶栏解耦**（`--tab-item-height: 28px`，顶栏垂直内距 =(顶栏−标签)/2 自动居中，用户 260923 口径"顶栏收窄但标签不变"）。新令牌 `--breadcrumb-height` / `--editor-toolbar-height` / `--tab-item-height`；目录 peek 顶 / 浮层顶 / 阅读态大纲顶全部改由令牌派生，不再写死 80/112/74。④ **macOS 红绿灯对齐**：原先 `trafficLightPosition: {x:14,y:13}` 是**为 38px 顶栏写死**的，缩顶栏后中心错位 3px（用户 260923 报）；改为主进程按共享常量 `layoutMetrics.TOPBAR_HEIGHT` 计算（`y=(顶栏−红绿灯12)/2`），单测卡住 CSS 令牌 ↔ 常量一致。native 实测 `getWindowButtonPosition()={x:14,y:10}` ⇒ 红绿灯中心 16 = 顶栏中心 16。⑤ **左缘热区 8→10px**（用户 260923 反馈偏窄：先试 12px、随后定为 10px）；⑥ **块手柄图标在命中盒内右移 3px 贴正文**（命中盒不动）。⑤⑥ 为 `8e31fce` 之后的微调；⑦ **收尾审计（全面评价 + 查漏补缺）见 `docs/UI-REDESIGN-REVIEW-260923.md`**：收紧 10 个偏松的样式围栏基线（`tokens.css` 83→6、`motion.css` 10→1）、删 8 类零引用死令牌、修 4 处过期回退值、修正过期注释。**同文档 §四 = 对重构本身的复盘（哪些不该做/能更好）**：`ln-*` kit **466/550 声明全仓零引用**（43 类名仅 7 个被 TSX 用）、`reset` 是空层、66 条过渡别名未清、"彻底剥离思源层"实为整层降级（app-css raw 1.46MB）、几何单一来源是事后补的、全程无视觉回归门禁 ⇒ **kit 是留是删需产品拍板**。⑤⑥⑦ 已提交并推送（`681997a`）。**⑧ W0-a（260923）**：`stylesnap` 补 **warm 8 态**（实测可 pin `data-theme=warm`）；三条失效冒烟按"修"处理并**全部实跑通过**（`test:sidebar-interaction` 改用面板头 📌 + 按 10px 热区/240ms 驻留悬停 + 断言贴左缘 `left:0`；`test:tab-switch` 去掉已消失的 55ms/85ms 契约；`test:ui` 把活动栏断言换成"不再渲染 `.activity-rail`"+"顶栏高 == `--topbar-height` 令牌"，并修工作空间触发器选择器）。**两个新发现**：① **设置面板打开不移入焦点**（`SettingsPanel.tsx` 的 `navSearchRef` 只声明、**全文件无 `.focus()`**；CDP 焦点模拟实测 `document.hasFocus()=true` 但 `activeElement` 仍不是它）⇒ 真实 a11y 缺口，**属功能改动未修**，已从失效断言摘出并留注；② **门禁运行纪律**：跑前必须做 `/json/list` **存活检查**——隔离实例被反复 reload 跑死后 `ECONNREFUSED`，极易误读成脚本失败。门禁：`tsc` 0 · `vitest` 1213/16（新增 ⌘] 护栏 1 条 + 红绿灯对齐护栏 2 条）· `ui-metrics` 全绿；隔离实例实测详见 §3 第 0 条。
- **门禁（提交前实测，全绿）**：`tsc` 0 · `vitest` **1229 passed / 16 skipped (1245)** · `ui-metrics` 五项全绿（桌面 `var(--b3-*)`=0、非主题颜色字面量=0、`!important`=9、入口 b3 import=0、同名文件对=0）· 桌面 `check:stylesnap` **34 态 0 差异** · 移动 `check:mobilesnap` **6 态 0 差异** · `git diff --check` 干净。
- **260923 UI 优化与收尾批次（本会话，已推送；最新 `a0d8d6d`）**：W1-L1/L2（删 57 规则/113 声明，新工具 `scripts/css-audit/plan-l2-shadowed.mjs`，桌面 stylesnap 0 差异）· W1-L3（结案：叠加"代码生产者"过滤后无**可证**死代码，新工具 `l3-plan.mjs`）· W3（`--lake-z-*` 层序令牌 + `src/styles/zOrder.test.ts`）· W4（结案**并入 W2**：段控件 4 条 `!important` 为"双端共享 + 层叠反转"必需）· W5（`src/components/sidebarHoverMachine.ts` + 8 条转移表单测 + `scripts/e2e-sidebar-hover.mjs` 真实指针 8/8，重构前后同值）· W6（增强大纲关闭零成本核验 + 护栏单测）· **W2 安卓 UI 全量重做**：移动端接入 `themes/*`（`--lake-*`）+ `kit.css` + 新 `src/mobile/mobile-kit.css` 密度层；移动 TSX `b3-*` 类**清零**、自有样式表 `--b3-*` **0**、**`src/b3/**`（含 AGPL `siyuan/**`，27 文件）整体删除**、自写深色桥移至 `src/mobile/editor-dark.css`、`compat.css` 复用；`ui-metrics` 移动端 `!important` **32→0（思源层）**、b3 文件 **7→0**。**移动端 `!important` 按规则收敛为 14 条，且全部为压 lakex 内核**（`.ne-*` 12 + `--lakex-editor-*` 2）；"接入 @layer"**决定不做**（移动端无未分层/分层优先级冲突，引入会打乱 kit/compat 现有优先级，风险高收益低）。**W2 待用户验收安卓观感**。
- **manifest = v7**（`MANIFEST_VERSION=7`，`READABLE_MANIFEST_VERSIONS={4,5,6,7}`）：`kind` 含 `sheet`/`bitable`/`board`；旧端读到 v7 **整轮拒绝同步** ⇒ **所有端必须一起升级**（刻意安全闸，防旧端把非 doc 正文当 Lake 文档打开写坏）。
- **dev 数据现状（重要，别擅自删）**：桌面 `到啦领导`(ee860a19) 仍在回收站；安卓回收站旧测试数据 + 笔记本「20-UI编辑测试」「测试本1」（含用户笔记）保留。本会话的隔离验证实例全部建在 `$TMPDIR/lake-*` 并在跑完即删，**未碰 `lake-notes-dev` 与正式数据**。
- 历史批次交接：§2.8 表格 · §2.9 FortuneSheet 换代 · §2.10/§2.11 小记内核化 · §2.12 多维表 · §2.13 画板 · §2.14 移动端对账 · §2.15 移动端小记 · §2.16–§2.21 表格图片 · §2.22–§2.27 桌面 UI 重设计 / 主题 / 大纲 / 目录。
- **移动端**：§8 仍是长期基线（最近一批 = §2.15）。
## 1. 项目一句话 + 铁律（详见 AGENTS.md）
本地优先笔记应用（Electron 43 + React 18.3 + better-sqlite3 + 语雀 Lake 内核），S3（七牛 Kodo 兼容）同步。
**红线**：① 本地是真相、S3 只是镜像（云端备份绝不反噬本地）；② 目录/删除强一致（删除传播、墓碑权威）；
③ `src/core/` 禁 `node:` 导入（平台差异走端口注入）；④ 开发数据只用 `lake-notes-dev`，绝不碰正式数据；
⑤ 不为旧数据写兼容/迁移（能删重建就删重建）；⑥ 杀 Electron 只 kill 具体 PID，禁 `pkill -f Electron`；
⑦ 不擅自合 master（代码批次需用户验收；文档类清理可直接提交）。移动端另有铁律见 **§8.0**。

## 2. 更早的会话（2026-09-17 早段）：任务目标 + 已完成（三批；背景，非本批）

**任务目标**：① 修「文档页最底部一条很窄的灰条」，遵守"UI 改动找根位置、别一层层套 CSS"；② 推进"层级冗余清理"的 **档0**（修围栏虚高基线）与 **档1**（只清可证死的重复声明）；③ 评估"浏览器端"现状，并按用户要求加一个**是否开启浏览器端**的开关（**不做伺服**、仅本机浏览器使用；**不落盘、即时生效**，具体功能待用户想清楚）。

**已完成（全部在 `master`）**：

1. **底部灰缝根修**（`src/styles/app/shell.css`）：根因 = `.workspace` 的 `margin: calc(var(--topbar-height) + 4px) 0 4px 0` 底部的 `4px`（shell 852、工作区被收到 848、最底 4px 露 `.app-shell` 灰底）。**小记视图早已单独去掉这 4px、基础层漏改**。只把底部改 `0`（顶部 4px 是固定 `.tab-bar` 的拼接缝，保留）+ 收掉小记里逐字等价的 margin 覆盖。实测底部命中从灰底 `.app-shell` 变为白色 `.ne-editor`（bottom=852），文档/小记两视图都齐底。
2. **档0 围栏纠偏**（`src/styles/cssLayers.test.ts`）：基线按实测收紧，`styles.css` **1778→0**（S3 拆分后入口只剩 `@import`），另 11 文件同步；围栏从"允许 1819 条增长"回到真实值。这是后续任何 CSS 清理的安全网前置。
3. **档1 层级冗余收口**：新增 `scripts/css-audit/plan-dup-decls.mjs` / `build-spec-dup.mjs` / `apply-dup-decls.mjs`；按"同 at-rule 上下文 + 同单选择器 + 同属性 ⇒ 后者恒胜"生成候选，删 **55 条**（12 文件），并用 `ab2` SPEC 整份注入跑**全矩阵 34 状态**证明**噪声 0 / 差异 0**（先跑"无删除重建"证明口径可信，再跑删除计划）。含 A 层菜单盒视觉族死代码、`b3/layout.css` 里 `.sidebar-floating` 旧几何。
4. **装置漂移修复**（`scripts/css-audit/css-audit.mjs`）：`nav.search` 跟上"搜索入口已搬到文档页右上角"，否则 `search-empty` 状态在准备阶段崩。
5. **本会话结论（已回填 §3.9）**：按严格口径，**全库只有这 55 条可安全删**；估算里的 184/147/92 大多把**不同 `@media` 条件**（宽/窄两套）算成"争用"，那些**不能删**。⇒ 不再推进 8–12 人日的整批清理。

**第二批 · 浏览器端（本机附属窗口）：**

6. **定位梳理**：浏览器端 **≠** 移动预览（`mobile.html`/`preview.html`），而是桌面主进程的**本机附属窗口**（`electron/webApiServer.ts`，初版 260916 提交 `a481d08`）：`POST /api/<channel>` 复用同一批 IPC handler + 静态服务 `dist/` + `/__native.js` 注入 `window.lakeNative` 的 HTTP shim，**只绑 `127.0.0.1`**。**用户决定：不做伺服、只做本机浏览器使用。**
7. **新增「设置 → 浏览器端」开关（本批主要交付）**：`electron/ipc/registerWeb.ts` + `createWebServerController`（`electron/webApiServer.ts`）。**不落盘**（内存态，每次启动默认关闭）；**打开/关闭即时起停服务、无需重启**。设置页为独立分类「浏览器端」，含明确说明（"不是伺服：不对外开放、不监听局域网"）与当前地址。
8. **「打开浏览器」按钮**：新 IPC `open_web_client` → 主进程 `shell.openExternal(url)`；**URL 由主进程按固定端口构造、不接受渲染层传 URL**（防开放重定向）。桥接三处齐（`preload.cjs` / `WEB_METHODS` / `src/lib/native.ts`，方法面 `getWebStatus` / `setWebEnabled` / `openWebClient`）。
9. **浏览器端实测**：启动后 `getWebStatus()={enabled:false}` 且 19880 无监听；开 → 19880 起、`GET /` 200、UI 出现「打开浏览器」行；点按钮 `openWebClient()={ok:true}`（真实拉起系统默认浏览器）；关 → 19880 立即消失。`settings` 表**不写任何 `web_settings` 行**。
10. **浏览器端后续（用户明确"先不做功能、待想清楚"）**：见 §3.10。

**第三批 · 块级编辑（悬浮手柄 + 块操作菜单）——⚠️ 未提交，待用户验收（工作区改动即本批）**：

11. **调研结论**：云端语雀的块锚点/块菜单**不在内核**，在 vendor 包装层 `BlockHoverHandle` + `BlockContextMenu`；唯一挂载点是 vendor 的 `LakexEditor`，而我们直连 `Doc.createOpenEditor` ⇒ 手柄一直没挂上（不是开关、不是版本问题）。
12. **安全红线（实测证据）**：菜单原实现里「转化 / 剪切 / 在下方添加 / 复制块 / 拖拽」走 `utils/blockDoc` 的**整篇 JSON 读改写**（`getDocument('json')`→改树→`setDocument('json')`）。副本实测一次「剪切」：正文 6032B→**12288B**、思维导图卡载荷 634B→**8859B**、**未注册卡 `board-card` 整张消失**；对照实验（纯原生 `indent`）只 +26B 且卡片 hash 全同 ⇒ 破坏来自 JSON 路径。内核另**无移动块原生命令**，故拖拽停用。
13. **本批交付（对齐用户给的云端菜单截图，只用内核原生命令）**：
    - vendor：`BlockHoverHandle` 动作全改原生（`deleteByRange` / `runNativeConvert` / `breakLine` 组合 + 拖拽停用）；`BlockContextMenu` 新增并导出 `SAFE_BLOCK_ACTIONS` 白名单、去掉「复制链接 / 插卡」入口 → 菜单 = 转化为（H1–H6/正文/有序/无序/任务/**代码**/高亮块/引用/分栏/折叠块）+ 删除 + 复制 + 剪切 + 缩进 + 在下方添加。登记 `vendor/lakex-doc-react/LOCAL-CHANGES.md` #9/#10，并已 `npm run build:vendor` 重建 `dist/**`。
    - 应用：`src/features/editor/blockHandleMount.ts`（新）+ `lakeRuntime.ts` 加 `prefs.blockHandle` 并在 `__disposeExtras` 链上挂载/清理 + `desktopDerivedState.ts` 传 `blockHandle: true`（移动端不传 → 不挂）。
    - 护栏/验证：`src/features/editor/blockMenuNative.test.ts`（源码级断言禁 JSON 路径 + 白名单）+ `scripts/e2e-block-menu-smoke.mjs`（副本逐项点菜单，**每次比对卡片片段 hash**，原件不打开）——实测 **PASS**（21 个动作全部生效、已有卡片逐字节未变、拖拽不动数据、原件 6032B/hash 未变）。
    - 门禁：`tsc` 0 · `vitest` **996 passed / 16 skipped** · 桌面 + 移动 build 全绿。（`git diff --check` 只报 vendor 生成产物里**原本就有**的 2 处行尾空格。）
14. **代码块已按用户指示加回（260917 二次确认）**：菜单与云端一致（15 项，排版天然 6/5/2/2，**未改任何 CSS**）。「转化为 → 代码」走 `editor.execCommand('insertCard','codeblock')` 落卡；「在下方添加 → 代码块」同理。拖拽移动块仍停用（内核无原生命令）。
16. **文本丢失已定位并修掉数据丢失部分（260917）**：根因 = 容器类命令是**替换/插入**语义，我们原先**全选块内容**再执行 ⇒ 原文本被空容器替换（实测高亮块/分栏的 DOM、模型、落盘三处全无）。**修法**：非 `style` 目标改用**折叠光标**（vendor `blockMenuHelpers.collapseCaretAtBlockEnd`）⇒ e2e 硬断言（新增「原文本仍在正文里」）全部通过：高亮块/引用/分栏/折叠块/代码 + 缩进/在下方添加/剪切/删除。**残留（未解决）**：折叠光标下 `alert`/`columns`/`collapse`/`insertCard('codeblock')` 变成「在原文旁插入**空**容器/空卡，原段落不动」（落盘实测 `<p id="ucfd561e7">…</p><blockquote class="lake-alert …">`）—— 不丢数据，但**转换语义没达成**；`quote` 是例外（真包住内容）。**建议修法**：命令后「搬家」（记录原文 → 执行命令 → `insertText` 写入容器/卡片 → `deleteBlockByRange` 删原段落），仍全程原生命令；代价是行内标记会退化为纯文本。详见 `docs/LAKEX-CONTRACT.md` §5.8。 **✅ 260917 已解决（不再需要"搬家"）**：外部复核确认内核有正规通道 —— 官方 `getNodeContent` + 一次 `insertAtSelection`（内核自动补 hole 并包裹内容）即可把原块替换成「含原文的容器/卡片」；vendor 新增 `convertBlockPreservingContent`（代码块走 markdown 围栏）。e2e 硬断言「原文在容器内部」全部通过。见 §5.8.1 与 `docs/BLOCK-CONVERT-ANSWER-260917.md`。 **260917 二次修正**：① 代码块改为按「卡片 value」生成（不带 hideToolbar ⇒ 工具栏/代码名称完整展示）；② 代码块是块卡，整张塞进 alert 会丢 ⇒ 卡片源转容器/正文/引用/列表一律先「抽取文本」；③ 图片/文件是内联卡，嵌容器不丢、保持原样。e2e 新增「卡片源」用例（含卡计数 1→0 断言）全绿。
17. **✅ 已复核并落地（260917）**：外部复核结论 = 内核**命令级没有**「转换并保留内容」，但有官方正规通道 `insertAtSelection`（插入带内容容器时自动补 `alertHole`/`containerHole`；配 `getNodeContent` 可一次把段落替换成含原文容器）。**已按此实现**（vendor `convertBlockPreservingContent`，四个目标：高亮块/分栏/折叠块/代码块），**未采用**用户此前不接受的"自组装多步搬家"。完整结论/§3/§7 复核表见 `docs/BLOCK-CONVERT-ANSWER-260917.md`，问题清单留档 `docs/BLOCK-CONVERT-QUESTION-260917.md`。
18. **260917 三次修正（用户实测）**：① 「转化为」菜单归属确认 = 我们的 wrapper 层（**非内核**）；新增**按块类型/卡片名**配置菜单（`getBlockMenuKey`），`default` 不再给「转化为」——图表类不硬转。② 容器源（高亮块/引用/折叠块）转容器/正文/引用/列表改为**抽取文本** + 选中「容器节点本身」，修掉「分栏套高亮块」。③ **cmd+X 剪切失效根因 = 应用层**：`EditorTab.cutHandler` 用 `document.execCommand("delete")` 只删 DOM（内核 `_handleCut` 被 capture 阶段 `stopImmediatePropagation` 抢掉）⇒ 文字消失、点块恢复；改走内核 `delete`，副本实测内存模型 + 落盘都删。护栏 `src/features/editor/editorCut.test.ts`。 ④ **块卡菜单按内部 `ne-card` 的 `data-card-name` 区分**（此前所有块卡都解析成 `ne-hole`，导致图表类也出现「转化为」）；⑤ **拖拽调研结论**：毁数据的是 `blockDoc` 的 JSON 路径、不是拖拽；内核有原生 `moveCard`（实测逐字节保真）与各 `move*`，文字块可"读-插-删" ⇒ 拖拽**能做**，详见 `docs/BLOCK-DRAG-RESEARCH-260917.md`。 **已在分支 `feat/block-drag-native` 实现原生拖拽**：卡片 `moveCard`（逐字节保真）/ 其它块「读-插-删」；e2e 新增拖拽用例（文档变化+卡片不丢+文本保留）。 **（260917 修正）**：列表子项/段落拖拽曾被「融合」（第 4 项并进第 1 项、段落丢换行）——根因是 `insertAtSelection` 折叠光标把内容吸附进相邻块；改用 `insertAtPosition`，列表项抽裸 `<li>` 且先删后插、其它块先插后删。实测列表 [1,4,2,3] 格式完整、段落不再融合。 **（二次修正）**：列表项保留 `data-lake-indent` 包装以保层级（抽裸 `<li>` 会把二级拖成一级）；源块删除 range 优先 `selectNodeContents`（列表项 `selectNode` 是折叠的，会触发 deleteByRange 断言）。实测二级项拖拽仍为二级。
15. **顺带挖到的独立数据问题（与块操作无关，建议单列待办）**：内核**未注册的遗留卡**（如换源前自研画板的 `board-card`）在**任何一次编辑保存后都会丢** —— 纯原生 `style h1` 也让文件 6032B→4166B 且该卡消失（已注册卡 hash 全不变）。原因是保存走 `getDocument('text/lake')`（序列化自内核模型），而未注册卡不在模型里。详见 `docs/LAKEX-CONTRACT.md` §5.8 末段。

## 2.5 本会话（260917 续 · 编辑器块级编辑二批）：原生拖拽修复 + 列表整块（Issue 3）+ 多块选区（Issue 4）

> 会话结尾交接，写给**完全没有上下文**的新会话。本批全部在 **分支 `feat/block-drag-native`**（**未合 master**，等用户验收）；commit 链：`f38ceb7`（块菜单/转化/原生拖拽收口）→ `eacece9`/`f0a463b`/`fb0b753`（拖拽三次修正）→ `e3ec693`（§5.9 命令表）→ `73ce4e5`（Issue 3）→ `1b2afde`（Issue 4）→ `ff9b840`（拖拽待办文档）。
> 承接上一批（§2 第 11–18 条：块菜单/「转化为」已全部改原生）：本批修**拖拽的三个实测 bug**，并补齐「父项 + 子项是一个整块」「多块选区批量操作」。

### 任务目标
- 修用户实测的拖拽问题：① 列表二级项拖动丢层级；② 手柄不跟随列表缩进；③ 列表**父项拖动/删除/转化时子项被落下**；④ 跨多块选区希望有**聚合手柄 + 批量删除/复制/剪切/转化**。
- 用户反思「是不是一开始跑偏了、很多操作该用内核 API 却自己实现」⇒ 要求做一次**内核命令全量盘点**。

### 已完成内容（全部已提交、门禁绿）
1. **拖拽三个修正**（`f0a463b` / `fb0b753` / `eacece9`）：
   - 列表项移动保留 `getNodeContent` 返回的**整段 `<ul data-lake-indent=N>` 包装**（抽裸 `<li>` 会丢层级，二级拖完变一级）；
   - 源块删除 range 优先 `selectNodeContents`（列表项 `selectNode` 变换后是**折叠**的，`deleteByRange` 要求非折叠，否则触发内核断言）；
   - 非卡片移动改用 `insertAtPosition(position, 'text/lake', frag)`（`insertAtSelection` 折叠光标会把内容吸附进相邻块：段落融合、列表项文本并进目标项）；
   - 手柄定位对列表项锚到**内容元素左缘**（`ne-uli-c`/`ne-oli-c`/`ne-tli-c`）—— 外层 `ne-tli` 的 left 不含缩进，三级项手柄会落到最左；实测长大纲三级项手柄 353 → 449。
2. **§5.9 内核命令注册表**（`e3ec693`，写入 `docs/LAKEX-CONTRACT.md`）：balanced-brace 解析 bundle，落地 **43 插件 / 147 条 kO 命令 + 4 条命令式（alert 族）= 151**；给出「块编辑命令 → 我们现状（已用 / 未用 / 内核无对应）」对照；澄清 `ISelectionHelperService` 是**工具栏注册服务、不是块选择 API**。这是对「内核优先」反思的正式回应。
3. **Issue 3：列表父项 = 一个整块**（`73ce4e5`）：
   - 关键事实：内核把列表项都渲染成 `.ne-engine` 的**平级**子节点，嵌套只体现在项自身 `ne-level`；`getNodeContent(父项id)` **只返回父项那一行、不含任何子项**；
   - 新增 `blockSpanElements`（父项 + 紧随其后、`ne-level` 更深的同族项）/ `spanDomRange`（跨元素 outer range，恒非折叠）/ `selectBlockSpanInEditor` / `selectWholeBlockForEdit`；整段读取用 `getSelectionContent`；`delete`/`copy`/`move`/`convert` 的选中口径全部按整段；手柄高亮与拖拽 ghost 覆盖整段。
4. **Issue 4：多块选区聚合手柄 + 批量操作**（`1b2afde`）：
   - 关键认识：**内核不需要「批量命令」** —— 跨块选区在内核里就是块选区，`selection` 命令设好后 `getSelectionContent` / `deleteByRange` / `insertAtSelection` 以及所有作用于选区的命令都按**整个选区**工作；
   - 新增 `selectedTopBlocks` / `hasMultiBlockSelection`（≥2 顶层块且非同一列表父项整段）/ `selectBlocksInEditor`（还原选区）/ `runMultiBlockConvert`；
   - 交互坑：点击手柄会让编辑区失焦、浏览器清掉选区 ⇒ `onMouseDownCapture` + `handleMenuAction` 两次还原选区。
5. **验证与护栏**：新增 2 个 e2e（`scripts/e2e-block-list-span.mjs`、`scripts/e2e-block-multi-select.mjs`，均在副本上、真实鼠标事件、原件 hash 不变）+ `src/features/editor/blockMenuNative.test.ts` 新增 7 条源码断言。
6. **门禁**：`tsc` 0 · `vitest` **1008 passed / 16 skipped (1024)** · 桌面 + 移动 `vite build` 全绿；`git diff --check` 只有 vendor 生成产物里原本就有的行尾空格。

### 当前问题 / 已知坑（不阻塞）
- ~~分支 `feat/block-drag-native` 未合 master~~ **（已过时：260918 已合入 master 并删除本地分支）**；本 §2.5 记录的是该分支**当时**的状态，当前基线以 **§0** 为准、本批交接看 **§2.7**。
- **多块选区拖拽未做**（云端 Lake 也未实现）：见 §3 第 11 条（含难度评估与三个风险）。
- §5.9 登记的 3 处「未原生化」仍存在：`selectBlockInEditor` 手工 range（可直接 `execCommand('selectAll')`）、容器重排可优先用 `moveCollapse`/`moveColumns`/…（现在统一「读-插-删」）、`getSelectionContent`/`wordCountSelection` 未用。
- Issue 4 的 e2e 需要源文档有**足够多的纯文本段落**（脚本只取视口内完全可见的段落定位拖选）；本次用 `详细测试1`（`4a606dfa-…`）跑通。

### 下一步计划（按优先级）
1. **用户验收这批块编辑改动**；验收后把 `feat/block-drag-native` 合回 master（红线：**不擅自合**，等用户接受）。
2. 若验收有问题 → 按现象回到本 §2.5 对应条目 + `docs/LAKEX-CONTRACT.md` §5.8.3/§5.8.4 定位。
3. 可选：把 §5.9 的 3 处候选原生化改造做掉。
4. 多块选区拖拽：仅当用户确实需要批量拖动整段时再做（§3 第 11 条）。
5. 其余长期待办见 §3（画板 AI、离线残余、移动端、产品/技术债、小记底座等）。
6. **【内存回收专项 · 下一个会话做（260919 用户指名）】编辑器开关后的「该回收没回收」复核** —— 依据 `docs/QUICK-NOTE-LAKE-MEMORY-SPIKE-260919.md`（分支 `spike/quick-note-lake-memory`，实测：关 20 个标签只回收 ≈18MB；0 标签稳态 ≈113MB vs fresh ≈84MB ⇒ 残留 ≈+30MB）。
7. **【小记编辑器接入 · ⚠️ 已落地但未通过验收（260919，commit `5a774c3` / `0d442a8`）】小记写作区挂 1 个 Lake 实例** —— **完整交接见 §2.10（新会话先读它）**；用户点了几下反馈「问题很多」但未逐条给，默认不通过。已知必修项：①「添加图片」文件选择按钮被删没了；② 真实键盘输入/贴图链路/编辑已有小记未验证；③ `draftEditorRef` 共用竞态、面板常驻实例、删图留孤儿。**本项优先级最高。**
   - **① churn soak（预留 30 分钟）**：反复开关同一批标签 N 轮（建议 ≥10 轮 × ≥20 个标签），每轮记录「连跑两次 `HeapProfiler.collectGarbage` 后」的 JS 堆 / DOM 节点数 / 事件监听数，看是否**随轮次线性上升**（线性 = 泄漏；有上限后收敛 = 正常缓存）。
   - **② 三条触发面都要覆盖**：普通文档开关 · **小记编辑态挂/卸 Lake 实例**（本批新增）· 小记→文档转换。
   - **③ 出现线性增长再用 heap snapshot 找 retained path**，判定是内核侧保留（回填 `docs/LAKEX-CONTRACT.md`）还是我们的引用残留（直接修）。
   - 与 §3.6「小记是否挂 Lake 底座」是同一批：本批已按「编辑态单实例」实现，回收行为需要这轮专项确认。

### 踩过的坑（本批新增，务必记住）
- **内核列表 DOM 是「平」的**：所有列表项都是 `.ne-engine` 直接子级，没有列表容器元素、没有 `data-lake-indent`；层级在项自身 `ne-level`（一级缺省 = 0）。`getNodeContent(父项id)` 只返回父项那一行 ⇒ 任何「按 id 读写单个列表项」都会丢子项。
- **列表项的 `selectNode` 变换后是折叠的**：`deleteByRange` 要求非折叠 range，否则触发 `lakex_editor_assert_error plugins/delete/src/kernel/commands/delete-by-range-command.ts`（删不掉、留副本）。要用 `setStartBefore`/`setEndAfter` 或 `selectNodeContents`。
- **`insertAtSelection` 折叠光标 ≠ 块级插入**：会把内容吸附进相邻块（段落融合丢换行、列表项文本并进目标项）；块移动必须用 `insertAtPosition`。
- **点击块手柄会清掉 DOM 选区**（编辑区失焦）：多块选区做批量动作前必须 `selectBlocksInEditor` 还原；且**不能**写「选区一收缩就清多选状态」（会误伤点击手柄），要改成「编辑区内按下鼠标（非手柄）才清」。
- **元素「有正确 inline style」≠「getBoundingClientRect 非 0」**：若祖先 `display:none`，rect 全是 0。CDP 诊断手柄位置时要过滤 `rect.width > 0`。
- **CDP 拖选文字要带 `button:'left'` 的 mouseMoved**（只给 `buttons:1` 可能选不中）；拖选端点若落到视口外会触发浏览器自动滚动 → 选中远超预期、手柄跑到屏外；e2e 里只取「视口内完全可见」的段落。
- **alert 落盘属性顺序**：`<blockquote data-lake-id=… id=… class="lake-alert …">`，`class` **不在**第一个属性 ⇒ 断言正则要写 `<blockquote[^>]*class="lake-alert`。
- **e2e 断言文案要去掉列表项目符号**：`textContent` 带 `●/○/■`，序列化 HTML 里符号在独立 marker 上 ⇒ 比对前剥前导符号。

## 2.6 本会话（260918 · 块级编辑三批）：用户实测三问 —— 手柄压符号 / 删除拖拽留空行 / 层级拖拽

> 承接 §2.5（**同一分支** `feat/block-drag-native`，仍未合 master）。用户给三张图报：① 手柄盖住无序/有序/待办列表的项目符号；② **每次拖拽都多一个回车**（被拖项原位没清干净）；③ 想要云端那种「拖拽改层级 + 蓝色导引线随层级变长变短」。①② 已修并复验，③ 已评估（结论见下）。

### 已完成（① ②，均在本分支、门禁绿）
1. **①「手柄压住列表符号」= 锚点选错元素**（`BlockHoverHandle.updateHandlePosition`）。列表项外层 `ne-tli` 的 left 不含缩进（缩进在内容元素上），§2.5 为此把手柄锚到**内容元素（`ne-uli-c`）左缘**；但**项目符号 `ne-uli-i`（宽 32px）占的就是内容左侧那一段** ⇒ 手柄 icon 中心落在符号**内部** 16px（压住 ●/○/■/ⅰ，正是截图现象）。改为锚 **marker 左缘**后 icon 中心 = `marker.left − 16`，与段落口径一致。实测三级 marker.left 387/419/451 → iconCenter 371/403/435；截图核对与云端一致（手柄在符号左侧 gutter）。
2. **②「拖拽多一个回车」= `deleteByRange` 的语义是「删内容」而不是「删节点」**：范围覆盖**根级整块**时，内核会在原位**补插一个默认段落**（`delete-content-by-range.ts` 尾部 `insertNodeByPosition(u, e.createElement(e.defaultElementName))`）⇒ 菜单删除 / 剪切 / 拖拽**每次都在原位留一条空行**（实测：删一个段落 顶层块 63→63、空段落 +1；拖拽 63→64）。改为内核**模型事务的节点级删除**：新增 `removeBlockNodesNative`（`kernel._model.editing` → `newJob` → `getNodeById` → `removeChild` → **选区复位 `setSelection`** → `commitJob`），`deleteBlockByRange` 优先用它、`deleteByRange` 仅兜底；拖拽 `moveBlockNative` 改为「**先摘掉源节点 → 再按删除后的目标位置 `insertAtPosition`**」（落点是 `(父节点,子索引)`，先插后删会让索引位移）。修复后：删除 63→62、拖拽 63→63、空段落两者都不变、原位不再留行。
2b. **⚠️ 同一处的第二个坑（更隐蔽，务必记住）**：删节点前**必须把内核算子挪出被删节点**，否则 `commitJob` 在 `framework/engine/src/view/selection/index.ts` 断言失败并**整个事务回滚** —— 症状是「点了删除没反应」，且**此后所有块操作继续报错**（连拖拽一起挂），渲染层异常还会让页面重载（CDP 脚本里表现为 `window.__xxx is not a function`）。实测「复制 → 剪切 → 删除」序列 100% 复现；这正是本轮最初看到的「e2e 后半程全挂」假象的真因。内核自己的 `deleteAlert`/`alert-delete-command`/`deleteCard` 同样是「**先安置选区，再 removeChild**」。完整代码级结论见 `docs/LAKEX-CONTRACT.md` §5.8.5。
3. **验证与护栏**：三个 e2e 套件全绿——`scripts/e2e-block-list-span.mjs`、`e2e-block-menu-smoke.mjs`、`e2e-block-multi-select.mjs`（都在**副本**上跑、原件 hash 不变）。门禁：`tsc` 0 · `vitest` **1011 passed / 16 skipped (1027)** · 桌面 + 移动 `vite build` 全绿。
   - `src/features/editor/blockMenuNative.test.ts` 新增 3 组源码级断言（禁回退到「先插后删 + deleteByRange」、必须有 `removeChild`/`commitJob`/选区复位、手柄必须锚 marker）。
   - `scripts/e2e-block-menu-smoke.mjs` 的拖拽断言从 `pCountAfter >= pCountBefore` **收紧为守恒式**「顶层块数不变 + 空段落不增」，并给「剪切/删除」加了同样的两条断言 —— **旧断言正是这个 bug 溜过去的原因**（`>=` 放过了「原位留一条空段落」）。
   - **归因方法（值得复用）**：`git checkout HEAD -- vendor/lakex-doc-react/dist` 只回滚**产物**（源码不动）再跑同一套 e2e，即可判定失败是「本批引入」还是「既有」：本轮据此确认 8 条「转化为 → 代码/容器」失败在 HEAD 上**一模一样**（既有 flaky），而删除/拖拽 4 条只在 HEAD 失败（本批修掉）。
   - 厂商改动登记见 `vendor/lakex-doc-react/LOCAL-CHANGES.md` **#17**。

### ③ 拖拽改层级（云端那种蓝色导引线）—— **能做，本轮未做**
- **能力齐备**：纵向移动已可用；层级 = 列表项 `ne-level`（模型里是 `attrs.level`/`parentIndex`）；内核有 `indent`/`outdent`/`canIndent`/`firstIndent`（§5.9 注册表；**`editor.execCommand` 上有效、移动端 `renderer.execCommand` 上无效**），菜单「缩进」已在用。
- **要补的是交互与落点语义**：① 拖拽时按光标**水平偏移**算目标层级（候选 `0..(上方块层级+1)`，按列表缩进宽度 32px 量化）；② 导引线按层级改 `left/width`（现有 `positionIndicator` 已画 2px 横线，扩展很小）；③ 落点 = 垂直照旧 + 层级差用 `indent`/`outdent` 补齐（或在同一模型事务里改 `level`）；④ 顺序要实测：先移动后改层级 vs 先改层级后移动（插入同列表会重建列表节点、range/选区失效——§2.5 的坑）。
- **代价/风险**：约 **0.5–1 天**（含新 e2e：拖后断言 `ne-level` 与顺序）。风险集中在「跨列表拖拽 + 同级/子级边界」与「层级变更后子项是否跟着走」（云端按「父项 = 整段」，我们已有 `blockSpanElements` 可复用）。
- **用户决策（260918）：先不做**（「我感觉现在就挺好的，云端的跨层级有点乱，并不是很好用」），已与「多块选区批量拖拽」**合并记入 §3 第 11 条（优化项）**；本轮**未写任何 ③ 的代码**。
- **若日后要做**：不要把云端那套交互照搬 —— 用户明确觉得它乱，先定交互再动手。

### 本轮新增的坑（务必记住）
- **`deleteByRange` 在根级整块上 = 「删内容 + 原位补一个空段落」**；要真删节点只能走模型事务（§5.8.5）。
- **内核模型事务的入口 = `kernel._model.editing`**（命令的 `e` 参数就是它）：`startTransaction/newJob/getNodeById/removeChild/setSelection/commitJob`。**`kernel.newJob` 不存在**。
- **删/改节点后内核算子会失效**：不先 `setSelection` 挪走 → 断言 + 回滚 + **连累后续所有块操作**（见 2b）。
- **多 tab 同开时禁用 `document.getElementById`**：复制的文档**块 id 与原件相同**，隐藏 tab 里有同 id 元素 ⇒ 会取到错的那个（本轮诊断脚本因此假报过 `isConnected`/`isCardNode` 错）。要按「当前可见 engine 根」内取。
- **`deleteEmptyParagraphs` 是全篇删除所有空段落**（`job.getNodesByName('p')`），会把有权保留的空行一起删——**不能当兜底**。
- **写 e2e 断言要问「它抓得住我今天修的这个 bug 吗」**：方向性断言（`>=`）会放过「原位留空段落」；块级动作要用**守恒式**（`===`）。

### 追加（260918）：目录栏「刷新」按钮（用户要求）
- **动机/现象**：用命令（IPC 直调 `deleteTreeNode` / `createNote`）改动库时，UI 目录**不会**跟着变 —— 用户看到「已经删掉的测试副本还挂在目录里」，要求目录栏右上角加一个刷新。
- **根因**：前端树状态只在「走应用自己的动作 / 同步事件」时更新（`setTreeNodes(await native.listTreeNodes())` 只出现在那些路径）；**外部改动没有任何广播**（与 §3.10 提到的 `library-changed` 缺口同源）。
- **实现（三层，均未新增 CSS）**：`src/hooks/useTreeActions.ts` 新增 `refreshTree`（重读 `listTreeNodes`，失败走 `setError`）→ `src/App.tsx` 传 `onRefreshTree` → `src/components/Sidebar.tsx` 头部 `.list-heading` 里在「筛选」右侧加按钮（`RefreshCw`，复用既有 `.dock-icon-btn` 与 `.spin`），进行中 `disabled` + 图标旋转，避免连点。
- **实测（CDP 真实鼠标点按钮）**：① 外部新建 → 库内有 / DOM 无（滞后）→ 点刷新 → **DOM 出现**；② 外部删除 → 库内无 / DOM 仍在（**正是用户看到的现象**）→ 点刷新 → **DOM 消失**。结论：**刷新后 DOM 与库内真值对齐**。
- **有意未做**：不给「外部改动」加自动广播刷新（那是 `library-changed` 事件的设计，见 §3.10，属更大改动）；移动端目录栏没有这条工具条（交互另套），本轮未改。
- 顺手清掉本轮遗留的 4 个**活跃**测试副本（`安卓上行-1 副本` ×3、`详细测试1 副本`；此前回收站里的 58 份测试副本属 e2e 正常产物，未动）。

- **追加（260918，用户点名 4 项 UI）**：
  1. **「刷新」移到图标组最左**（现在顺序：刷新 | 筛选 | 全部收起 | 定位 | ＋）。
  2. **「＋」菜单只保留「新建笔记本」**，并去掉条目说明文案；文档/分组的创建仍走节点右键「新建文档 / 新建分组」（那条路径的 `create`/`pendingCreate` 逻辑未动）。
  3. **点文档不再自动展开子项**：根因是跟随当前文档的 effect 调 `revealNode(activeId)`，而它用的 `expandAncestors` **把目标节点自身也加进了 expanded**，同时 `autoExpanded` 也默认展开「有子项的文档」。改法：新增 `expandAncestorChain`（**只展开祖先、不含自身**）供跟随定位用；跟随定位改调 `revealNode(id, { expandSelf: false })`；`autoExpanded` 只展开笔记本/分组。于是「展开文档子项」只剩两条路：**点下拉箭头**、**「定位到当前文档」按钮**（后者仍会展开自身，符合用户口径）。
  4. **自动定位的跳动**：旧实现是「先 `setExpanded` 渲染 → `setTimeout(60)` 再滚」，展开插行与滚动分属两帧 ⇒ 用户先看到错位再被拽回（实测**旧代码有 2 帧绘制在错误位置**：`rowTop=-15225`，随后 snap 到 92）。改为**在 `useLayoutEffect` 里滚动**（提交 DOM 后、绘制前，由 `revealNonce` 驱动，`expanded` 无变化也会跑），并保留「行还没进 DOM 就下一帧补一次」的兜底。**A/B 实测**：旧 `offFrames=2` → 新 `offFrames=0`（首个 rAF 采样时已滚到位 `scroll=419/581, rowTop=92`）。
  - 验证：4 项均在真实 Electron 上按「断言真实状态」跑过（工具条顺序 / 菜单项与 `small` 计数 / 点文档 `open=false,kidRows=0` → 点下拉 `open=true,kidRows=1` → 再点收起 / 定位 `offBefore=true` 且 `offFrames=0`）。
- **追加（260918，再两项 UI 收口）**：
  5. **「＋」菜单收小**：`createMenuPosition` 的 `preferredWidth` 220 → **150**、`.create-menu` 宽度同步、菜单项 `min-height` 42 → **32**（与全局菜单项一致）。实测 220×60（行高 42）→ **150×50（行高 32）**。
  6. **重命名只有一个焦点环**：之前是 **3~4 层同心蓝框**叠加 —— ① b3 的 `input:focus-visible` 描边（`outline: … 2px` + offset 2）、② 本文件 `.tree-rename-input:focus` 的 `box-shadow`、③ 输入框自身 `border`、④ 所在行 `.tree-row.context` 的 inset 环。改法：输入框只留 `border` 主色（`:focus/:focus-visible` 里 `outline: 0`、去掉 box-shadow），并让**重命名中的行不再挂 `context` 类**（纯 JS 条件，不动 b3 层 CSS、不碰 CSS 围栏基线）。实测改后可见环 = `[{input.border: 1px rgb(59,91,219)}]` 唯一一条，截图核对无误。

## 2.7 本会话总交接（260918 · 块级编辑三批 + 目录栏收口）—— 新会话从这里读

> **写给完全没有上下文的新会话。** 本批已**合入 master**（原在途分支 `feat/block-drag-native` 已并、已删本地分支）。
> 深度细节按需跳转：内核行为 → `docs/LAKEX-CONTRACT.md` **§5.8.5**；厂商改动清单 → `vendor/lakex-doc-react/LOCAL-CHANGES.md` **#17**；本批逐条过程 → 上面 **§2.6**；待办全表 → **§3**（本批相关的是第 11 条「优化项」）。

### 一、任务目标（用户本次要求，按顺序）
1. **块手柄位置错**：手柄盖住了无序/有序/待办列表的**项目符号**，云端是落在符号**左侧**的 gutter。
2. **块拖拽每次都多一个回车**：被拖项**原位置**没清干净（下→上拖，空行在原位下方；上→下拖，空行在原位上方）。
3. 问「**能否做云端那种拖拽改层级 + 蓝色导引线**（线长表示父级/同级/子级）」。
4. 目录栏右上角**加「刷新」**（此前用命令直删的测试副本仍挂在目录里）。
5. 目录栏四项交互：**刷新放最左**；**「＋」弹窗只留「新建笔记本」并去掉说明**；**点文档不自动展开子项**（只有分组/笔记本才展开，文档只在点下拉或自动定位时展开）；**自动定位展开目录有跳动，要优化**。
6. 两项视觉：**「新建笔记本」弹窗偏大**；**重命名出现多层蓝色边框嵌套**。

### 二、已完成内容（全部已提交并合入 master）
**A. 块编辑两个 bug（②③ 之外的两个真 bug，已修）**
- **① 列表手柄锚点**：由「内容元素（`ne-uli-c`）左缘」改为「**项目符号 marker（`ne-uli-i/ne-oli-i/ne-tli-i`）左缘**」。原因：符号本身占的就是内容左侧那 32px，锚内容 ⇒ icon 中心落在符号**内部** 16px。改后 icon 中心 = `marker.left − 16`，三级实测 marker 387/419/451 → iconCenter **371/403/435**，与段落口径一致，截图与云端一致。入口：`vendor/.../BlockHoverHandle.tsx` 的 `updateHandlePosition`。
- **② 删除/剪切/拖拽留空行**：根因 = `kernel.execCommand('deleteByRange')` 的语义是**删内容**，范围覆盖**根级整块**时内核会在原位**补插一个默认段落**（`delete-content-by-range.ts` 尾部 `insertNodeByPosition(u, createElement(defaultElementName))`）⇒ 实测删除 `顶层块 63→63、空段落+1`、拖拽 `63→64`。
  改法：新增 `removeBlockNodesNative`，走内核**模型事务**节点级删除（`kernel._model.editing` → `newJob` → `getNodeById` → `removeChild` → **选区复位 `setSelection`** → `commitJob`），`deleteBlockByRange` 优先用它、`deleteByRange` 仅兜底；`moveBlockNative` 改为「**先摘源节点 → 再按删除后的目标位置 `insertAtPosition`**」（落点是 `(父节点,子索引)`，先插后删会位移）。
  修复后实测：删除 `63→62`、拖拽 `63→63`、空段落**两处都不变**。
- **③ 拖拽改层级 + 蓝色导引线：未做（用户决定）**。已评估为**可做（约 0.5–1 天）**：纵向移动已可用、层级在 `ne-level`（模型 `attrs.level`）、内核有 `indent/outdent/canIndent/firstIndent`；缺的是「按光标水平偏移算层级 + 导引线按层级改 left/width + 落点补层级差」。用户原话「现在就挺好的，云端的跨层级有点乱，并不是很好用」⇒ **已与「多块选区批量拖拽」合并记为 §3 第 11 条的优化项**，本轮**未写任何 ③ 的代码**。⚠️ 若日后要做：**不要照搬云端交互**。

**B. 目录栏（用户第 4/5/6 项）**
- **刷新按钮**：`useTreeActions.refreshTree`（重读 `listTreeNodes`）→ `App.tsx` 传 `onRefreshTree` → `Sidebar` 头部按钮（`RefreshCw`，复用既有 `.dock-icon-btn`/`.spin`，**未新增 CSS**）。**位置在最左**（现在顺序：刷新 | 筛选 | 全部收起 | 定位 | ＋）。实测不变式：API 新建/删除后 DOM 与库内真值**对齐**（外部新建 → DOM 无 → 点刷新 → 出现；外部删除 → DOM 仍在 → 点刷新 → 消失）。
- **「＋」弹窗**：只保留「新建笔记本」、去掉说明文案；尺寸 220×60（行高 42）→ **150×50（行高 32）**。改动：`createMenuPosition.ts` 的 `preferredWidth` 220→150（`minWidth=150` 不动，围栏测试仍绿）、`.create-menu` 宽度与菜单项 `min-height`。**文档/分组的创建仍在节点右键「新建文档/新建分组」**（那条路径未动）。
- **点文档不再自动展开子项**：根因 = 跟随当前文档的 effect 调 `revealNode(activeId)`，而它用的 `expandAncestors` **把目标自身也加进 expanded**；且 `autoExpanded` 也默认展开「有子项的文档」。改法：新增 `expandAncestorChain`（**只展开祖先、不含自身**）+ 跟随定位改调 `revealNode(id, { expandSelf: false })` + `autoExpanded` 只展开笔记本/分组。**展开文档子项只剩两条路：点下拉箭头、按「定位到当前文档」**（后者仍展开自身，符合用户口径）。
- **自动定位跳动**：旧实现「先 setExpanded 渲染 → `setTimeout(60)` 再滚」= 两帧中间态。改为**在 `useLayoutEffect` 里滚动**（提交后、绘制前；`revealNonce` 驱动，`expanded` 无变化也会跑），保留「行还没进 DOM 就下一帧补一次」兜底。**A/B 逐帧实测**：旧 `offFrames=2`（`rowTop=-15225` 画了两帧再 snap）→ 新 `offFrames=0`（首个 rAF 采样已 `scroll=419/581, rowTop=92`）。
- **重命名多层蓝框**：实测是 **3~4 层同心环** —— b3 `input:focus-visible` 描边（2px+offset2）、本文件 `:focus` 的 `box-shadow`、输入框自身 `border`、所在行 `.tree-row.context` 的 inset 环。改法：输入框只留 `border` 主色（`:focus,:focus-visible` 里 `outline:0`、去 box-shadow）+ **重命名中的行不挂 `context` 类**（纯 JS 条件，**不动 b3 层 CSS、不碰 CSS 围栏基线**）。实测可见环只剩 `input.border: 1px rgb(59,91,219)` 一条。

**C. 护栏与文档**
- `src/features/editor/blockMenuNative.test.ts`：新增 3 组源码级断言（禁回退「先插后删 + deleteByRange」、必须 `removeChild`/`commitJob`/选区复位、手柄必须锚 marker）。
- `scripts/e2e-block-menu-smoke.mjs`：拖拽断言由 `pCountAfter >= pCountBefore` **收紧为守恒式**（顶层块数不变 + 空段落不增），并给「剪切/删除」加同样两条 —— **旧断言正是这个 bug 溜过去的原因**。
- `docs/LAKEX-CONTRACT.md` 新增 **§5.8.5**（根因 + 模型事务写法 + 选区复位 + 手柄锚点修正）；`vendor/lakex-doc-react/LOCAL-CHANGES.md` **#17**；本文件 §0/§2.6/§2.7。
- 门禁（合入前实测）：`tsc` 0 · `vitest` **1011 passed / 16 skipped (1027)** · 桌面 + 移动 `vite build` 全绿 · 三个块编辑 e2e（list-span / menu-smoke / multi-select）**全绿** · `git diff --check` 只报 vendor 生成产物里**原本就有**的行尾空格（HEAD 上同样 2 处，已核对）。

### 三、当前问题（均不阻塞）
- **没有已知回归**。唯一"看起来像回归"的是 `e2e-block-menu-smoke` 里 8 条「转化为 → 代码/容器」断言会**偶发失败**：已用「回滚 vendor 产物到 HEAD 再跑同一套」证明**在 HEAD 上一模一样**（既有 flaky，与本批无关）。
- **移动端未做任何改动**（本轮全部是桌面目录栏 + 桌面块编辑）。移动端目录栏没有这条工具条（交互另套）。
- **外部改动不会自动刷新目录**（本批只加了手动刷新按钮）：根因是前端树状态只在「应用自己的动作 / 同步事件」时更新，没有 `library-changed` 广播 —— 与 §3.10 的浏览器端推送缺口同源，属更大改动。
- 回收站里累积了本会话 e2e/诊断产生的一次性副本（正常产物，未清；要清需用户决定）。

### 四、下一步计划
1. **等用户验收本批**（已合 master，若验收有问题按现象回到 §2.6 / §5.8.5 定位）。
2. 其余待办见 **§3**：其中与本批直接相关的是**第 11 条优化项**（多块选区批量拖拽 + 拖拽改层级，均「先不做」）。
3. 若要继续块编辑方向：把 §5.9 里"容器重排可优先用 `moveCollapse/moveColumns/moveTable/moveImage`"这条候选原生化做掉（现统一「摘节点 → 落点插入」）。
4. 与目录栏相关的可选优化：给外部改动加 `library-changed` 事件自动刷新（见上面"当前问题"）。

### 五、踩过的坑（本批新增，务必记住）
- **`deleteByRange` 在根级整块上 = 「删内容 + 原位补一个空段落」**；想真删节点只能走模型事务 `job.removeChild`。完整代码级结论见 §5.8.5。
- **删节点前必须把内核算子挪出被删节点**（`job.setSelection(...)`）：否则 `commitJob` 在 `framework/engine/src/view/selection/index.ts` 断言失败、**整个事务回滚** —— 症状是「点了删除没反应」，且**此后所有块操作继续报错**（连拖拽一起挂），渲染层异常还会**让页面重载**（CDP 脚本里表现为 `window.__xxx is not a function`）。实测「复制 → 剪切 → 删除」序列 100% 复现 —— 这正是本批最初误判「e2e 后半程全挂是既有问题」的真因。
- **内核模型事务入口 = `kernel._model.editing`**（命令的 `e` 参数就是它）：`startTransaction/newJob/getNodeById/removeChild/setSelection/commitJob`。**`kernel.newJob` 不存在**。
- **多 tab 同开时禁用 `document.getElementById`**：复制出来的文档**块 id 与原件相同**，隐藏 tab 里有同 id 元素 ⇒ 会取到错的那个（本批诊断脚本因此假报过 `isConnected`/`isCardNode` 错）。要按「当前可见 engine 根」内取。
- **`deleteEmptyParagraphs` 是全篇删除所有空段落**（`job.getNodesByName('p')`），会把有意保留的空行一起删 —— **不能当兜底**。
- **写 e2e 断言要问「它抓得住我今天修的这个 bug 吗」**：方向性断言（`>=`）会放过「原位留空段落」；块级动作要用**守恒式**（`===`）。
- **归因方法（值得复用）**：只回滚**产物** `git checkout HEAD -- vendor/lakex-doc-react/dist`（源码不动）再跑同一套 e2e，即可判定失败是「本批引入」还是「既有」。
- **量"视觉跳动/逐帧"必须先解除后台节流**：窗口不可见时 rAF 一帧不跑（本次第一版测量 `frames:0` 白跑）。要 `Page.bringToFront` + `Emulation.setFocusEmulationEnabled{enabled:true}` + `Page.setWebLifecycleState{state:'active'}`（**`/tmp` 里的 `lk-cdp.mjs` 已内置这三条**）。
- **CDP `Page.captureScreenshot` 的 `clip` 会截到空白**：本次给"重命名框"截图连续两次全白 —— 真因是**侧栏当时被合成点击折叠了**（`sidebar-collapsed`：行仍有布局矩形、但不绘制）。截图前先确认目标容器可见（`.sidebar` 不是 `sidebar-collapsed`），比反复调 clip 有效。
- **合成点击会误折叠侧栏**：诊断脚本点活动栏附近的坐标有可能切到 `collapsed`；跑完要检查并恢复（点 `title="资料库"` 的 `.activity-button`）。**别把用户的应用留在非预期 UI 状态**。

## 2.8 本会话总交接（260918 · 表格文档接入 SheetDocument 一批）—— 新会话从这里读

> **写给完全没有上下文的新会话。** 本批在分支 `feat/sheet-document` 上，**全部改动未提交**（AGENTS 铁律⑦：代码批次等用户验收）。
> 三份必读：本文件 → `AGENTS.md`（长期红线）→ **`docs/SHEET-BITABLE-DESIGN-260918.md`**（本批全部选型论证 + 实测数据：CE vs Univer vs FortuneSheet vs 自研、CSP 论证、开源多维表逐项核实、体积/内存实测、CSP「独立沙箱」代价量化）。

### 一、任务目标（用户本次要求，按顺序）
1. 给 Lake Notes 增加**表格（电子表格）**能力，作为**新的文档类型**与 Lake 文档/小记共存于同一目录树，**复用既有 S3 同步管线**。
2. 用户对功能范围的定稿（原话）：「一般这种笔记大部分都是只要结构化存储和简单的公式，真正用 excel，可以在文档里挂附件，所以我认为不需要实现完全的 excel 功能」。
3. 选型过程（用户全程参与，结论已定）：评估过 **Univer / FortuneSheet / jspreadsheet CE / 自研**；用户最后定：**表格用 CE，Univer 整个不用**（原话：「我还是倾向于用 ce 来做表格，Univer 太重了就不用了，用 Univer 主要是看上了多维表」）。
4. **多维表（bitable）本批不做**，只做表格。后续自研方向（已论证）：`@tanstack/react-table`（网格）+ **`@teable/core`（MIT，含 models/field、formula/evaluate、convert）** + 我们已有的存储/同步/UI，v1 估 1,500–2,500 行 / 3–5 天（对比参考实现 `local-lake-notes-tauir` 自研多维表 ≈5,360 行）。
5. 收尾时用户明确：「这些剩下的先不做，我验收一下，先列入待办」→ 所以**本批的收口项全部在下文「当前问题」里，不要以为是遗漏**。

### 二、已完成内容（❌ 全部未提交，分支 `feat/sheet-document`；tsc 0 + 1014 测试全绿）
**A. 存储层（本批地基）**
- 新增 `src/core/noteKind.ts`：`NoteKind = "doc" | "sheet" | "bitable"` + `normalizeNoteKind()`（非法/缺失一律回退 `doc`）——两端共享的单一事实源。
- 新增 `src/core/sheetDoc.ts`：表格正文格式与序列化。`SheetDoc = { kind:"sheet", version:1, worksheets:[{name,data,columns?}], activeWorksheet? }`；`emptySheetBody()`（8 列 × 30 行空网格）、`parseSheetBody()`（非法/版本不符返回 null，不抛）、`sheetToSearchText()`（单元格文本 → 全文搜索用）。
- `electron/schemaInit.ts`：`notes` 表加 `kind TEXT NOT NULL DEFAULT 'doc'`（CREATE + 旧库 `ALTER` 迁移）。**未动 `tree_nodes.node_type`**（那套约束被回收站/两端映射依赖，新增取值回归面最大）。
- `electron/store.ts`：
  - 新增 `noteKindCache` / `kindOf(id)` / `bodyPathFor(id, kind)` / `candidateBodyPaths(id)` / `searchTextFor(id, content)`；
  - **`notePath(id)` 改为 kind 感知的单一出口**（`notes/{id}.lake` / `sheets/{id}.sheet.json` / `bitables/{id}.bitable.json`；行已删/未登记时回退 doc 路径 = 与旧行为一致）——全仓 37 处 `notePathFor` 调用点自动受益；
  - 构造函数新增 `sheets/` 目录；
  - 新增 `createSheetIn(parentId, title)`；`createNoteInWithContent(..., kind)` 写入 DB 并缓存 kind；`duplicateNote` 带类型复制；
  - **`searchTextFor` 按类型分派**，替换 4 处「把正文喂给 Lake HTML 解析器」的调用点（`duplicateNote` 索引 / `derivePlainText` / `ensureNoteCaches` / `getNoteInfo`）——**表格 JSON 绝不再进 `lakeHtmlToMarkdown/Plain`**；
  - `saveNote`：非 doc 类型且渲染层没给缓存时，由主进程用 `searchTextFor` 派生（**doc 行为逐字节不变**，仍用内核缓存）；
  - `removeUntrackedNoteArtifacts` 逐个候选路径清理（doc/sheet/bitable 都可能残留）。
**B. 协议层（manifest v6 + kind 贯通两端）**
- `src/core/manifestTypes.ts`：`ManifestNote.kind?: NoteKind`。
- `src/core/syncUtils.ts`：`MANIFEST_VERSION = 6`；`READABLE_MANIFEST_VERSIONS = {4,5,6}`；`validateManifest` **未知 kind 显式抛错**。
- `src/core/syncDecisions.ts`：`LocalNoteState.kind` / `SyncNoteRowShape.kind` / `rowToLocalState` 映射 / `buildUploadEntry` **只写非 doc**（`...(note.kind !== "doc" ? { kind } : {})` ⇒ 纯文档库的清单条目保持逐字节不变）。
- `electron/noteQueries.ts`：`SyncNote.kind` + `SyncNoteRow.kind` + `SYNC_NOTE_COLUMNS` 增 `n.kind`；**`NoteSummary.kind` + `mapSummary` 映射**；`listNoteSummaries` SELECT 增 `kind`。
- `src/core/syncEngineTypes.ts`：`LocalNoteRow.kind`；`electron/syncAdapters.ts`：`rowFromSync` 透传 `kind`。
- `electron/remoteImportRepository.ts`：**新增 `bodyPathFor(noteId, kind)` 依赖**，导入按 manifest 的 kind 解析路径（此刻 DB 还没行，用 `notePathFor` 会回退 doc 把表格写到错位置），并在 INSERT/UPDATE 里持久化 `kind`。
- 测试 fixture 同步更新（版本 5→6、`rowToLocalState` 多 `kind`、测试替身补 `bodyPathFor`）；**v4/v5 旧清单读取兼容用例保持不动、仍全绿**。
**C. 移动端（kind 贯通 + 防腐坏）**
- `src/mobile/schema.ts`：`doc_kind TEXT NOT NULL DEFAULT 'doc'`（CREATE + `addNoteColumn` 迁移）。
- `src/mobile/noteRepository.ts`：`POCNote.kind` + `rowToNote` 映射 + `readNote` SELECT 增 `doc_kind`。
- `src/mobile/syncDbPort.ts`：`rowToLocal` 映射 kind（注意 TS 字面量放宽坑，见下文踩坑 3）；`getNote`/`getAllNotes` SELECT 增 `doc_kind`；`applyRemoteNote` INSERT/UPDATE 增 `doc_kind`。
- `src/mobile/notebook/NotebookWorkspace.tsx`：`TabState.kind` + openTab 带 kind + **非 doc 类型渲染只读占位（"请在桌面端打开"），绝不挂 Lake 编辑器**（AGENTS §3 #16 防腐坏）。
**D. 桌面端链路（新建 → tab → 编辑器）**
- **三处桥 + IPC**：`electron/ipc/registerNotes.ts` 新增 `create_sheet_in`；`electron/preload.cjs` `createSheetIn`；`electron/webApiServer.ts` 频道映射；`src/lib/native.ts` 类型 + 封装。
- **新建入口**：`src/hooks/useNoteLifecycle.ts` 新增 `createSheetIn`（与 `createNoteIn` 同流程：进树 → 开 tab → 待重命名）；`src/hooks/useTreeActions.ts` 的 `createTreeItem`/`sidebarCreate` 支持 `"sheet"`；`src/App.tsx` 装配；`src/components/Sidebar.tsx` **目录树右键新增「新建表格」**（`lucide` `Table` 图标；注意：左上「＋」仍只有「新建笔记本」——那是用户先前定的口径，未改）。
- **tab 路由**：`src/desktop/desktopTypes.ts` `OpenTab.kind`；`src/hooks/useTabLifecycle.ts` 打开时写入 `note.kind ?? "doc"`；`src/features/editor/MultiTabEditor.tsx` 定义 `TabInfo.kind` 并按 `tab.kind === "sheet"` 路由到 `SheetEditor`（其余仍 `EditorTab`）。
- **编辑器**：新增 `src/features/sheet/SheetEditor.tsx`（jspreadsheet CE 接入）：
  - `parseFormulas: false`（**唯一会触发 eval 的路径**，严格 CSP 下必须关，见踩坑 6）；
  - 自动保存：CE `onchange` → **800ms 防抖** → 序列化 `SheetDoc` → `onChange(json)`（走既有 `handleContentChange` → dirty → 保存/草稿/同步管线）；
  - **正文体积护栏 32MiB**（`MAX_SHEET_BODY_BYTES`，超限停存 + `badge badge--error` 提示；同步侧硬上限是 64MiB）；
  - 列配置（类型/宽度/换行）沿用解析结果原样回写（v1 不提供列配置编辑 ⇒ 往返无损）；
  - 只读：`readOnly` 时屏蔽指针事件且不挂自动保存（回收站/锁定/被他端删除）；
  - keep-alive：宿主用 `fn__none` 隐藏而非卸载；卸载/切走前补一次未落盘改动；
  - **懒加载**：`MultiTabEditor` 用 `React.lazy` + `Suspense` 引入 ⇒ 生产分包 `SheetEditor-*.js`（468KB raw / 124KB gzip），**首屏 index chunk 不含 CE**（已实测）。

### 三、当前问题（均不阻塞；用户已同意「先列入待办」）
1. **⚠️ 运行时链路未验收（最该先做）**：`tsc`/`vitest`/`vite build` 全绿，但**没有在真实应用里跑过**完整链路：右键「新建表格」→ 落盘 `sheets/{id}.sheet.json` → 打开 tab → CE 渲染 → 编辑 → 自动保存 → 同步上传 → 另一端拉取仍是表格 → 移动端显示只读占位。
2. **✅ 已解决（260919）**：原 2 处内联样式（容器 `height/width/overflow`、CE host `pointerEvents`）随 FortuneSheet 重写消失——容器尺寸走 `.sheet-editor` CSS（`src/features/sheet/sheetEditor.css`），CE host 的 `pointerEvents` 随 CE 删除；`grep -rn "style=" src/features/sheet/` = 0。（`cssLayers.test.ts` fence 已同步。）
3. **✅ 已解决（260919）**：非 doc 的文档型入口已收口（`noteExport.assertDocKind` 守卫 + 目录树/⋯ 菜单隐藏导出 + 大纲隐藏 + 状态栏改「表格/多维表」）；桌面 `TreeNode` 已带 `kind`。见 §3 第 13 条。
4. **✅ 已走查（260919）**：`EditorTab` 不渲染 ✅、导出隐藏 ✅、大纲隐藏 ✅、字数/图片对表格不计算 ✅。
5. **✅ 已清理（260919）**：spike 产物已删（`spike.html`、`src/spike/`、`scripts/spike-sheet-ce.mjs`、`vite.spike.config.ts`、`vite.spike.build.config.ts`）；设计文档保留。
6. **文档回填未做**：`docs/SYNC-PROTOCOL.md`（升 v6 + `kind` 语义 + 端版本门槛）、`docs/STORAGE-LAYERS.md`（`notes.kind` / 按 kind 分目录 / `searchTextFor` 分派）。
7. 未提交（**等用户验收**；AGENTS 铁律⑦：代码批次不擅自合 master）。

### 四、下一步计划（按优先级）
1. **真机验收**（用户先点一遍，或新会话用 CDP 驱真实 Electron）：重点看 ① 右键新建表格是否出现在树里、② CE 是否渲染且可编辑、③ 编辑后 `sheets/{id}.sheet.json` 是否落盘且 `sync_state='local'`、④ 同步后云端 `objects/{id}-{hash}.lake` 与 `manifest.notes[].kind="sheet"`、⑤ 另一端/移动端表现（移动端应显示只读占位）。
2. 收口 §三.2（内联样式）与 §三.3（导出/复制 MD 守卫）。
3. 回填 §三.6 的两份文档。
4. 清理 §三.5 的 spike 产物 → 请用户验收 → 提交。
5. 之后才考虑**多维表（bitable）**（本批不做；方向见 §一.4 与设计文档 §6.2/§13）。

### 五、踩过的坑（本批新增，务必记住）
1. **`NoteSummary` 有两份**：渲染层 `src/lib/types.ts` 与主进程 `electron/noteQueries.ts` 各定义一份 —— 加字段必须**两处都加**（本批先只加了渲染层 ⇒ tsc 报 `kind does not exist in type NoteSummary`）。
2. **`mapSummary` 有三处 SELECT**：`noteQueries.listNoteSummaries` + `store.ts` 回收站列表 + `store.ts` `saveNote` 回读 —— 漏任何一处就会出现「保存后类型丢成 doc」，症状极具迷惑性。
3. **TS 会在"推断的返回类型"里放宽字面量**：`{ kind: cond ? "sheet" : "doc" }` 被推断为 `string` ⇒ 外层 `SyncDbPort` 不兼容。修法：嵌套三元 / `as "doc"|"sheet"|"bitable"` / 显式标注返回类型。
4. **远端导入必须按 manifest 的 `kind` 解析路径**：`remoteImportRepository.importNote` 在新导入时 DB 还没这行，`notePathFor` 会回退 doc 路径 ⇒ 表格被写到 `notes/{id}.lake`（错位置且难发现）。已改为注入 `bodyPathFor(noteId, kind)`。
5. **多维表选型的事实（供后续自研）**：`@teable/core` 是 **MIT**，含 `models/field`、`formula/evaluate`、`convert`（可当自研底座）；`@teable/sdk` 同为 MIT 但**强绑 Teable 服务端**（解包后 119 文件引用 `@teable/openapi`、19 用 `axios`、带 websocket）；NocoDB 是 **Sustainable Use License**（非 OSI 开源、限商用）；APITable/Undb 是 AGPL；Grist 是 Apache-2.0 但客户端用 GrainJS（非 React）；成熟开源多维表**全是服务端应用**，没有「可嵌 + 自带数据层 + 本地优先」的现成件。
6. **CE 的公式引擎走 `eval`**：`parseFormulas: true` 在严格 CSP 下会让**整张表崩**（只渲染出表头，第二张表都建不出来）；`parseFormulas: false` ⇒ 完整渲染（2 sheet / 17 行 / 115 单元格）+ **0 条 CSP 违规**。`=` 开头当文本存。
7. **CE 的 image 列只认 `data:image`**（源码 `if (s && "data:image" == s.substr(0,10))`）⇒ 图片只能**内联 base64**；好消息：base64 不匹配 `ASSET_NAME_RE`，因此**不会污染 `manifest.assets`**，只让正文对象变大（故有 32MiB 护栏）。
8. **Univer 的实测代价（若日后重新评估多维表/表格）**：生产产物 **9.77MiB raw / 2.48MiB gzip**（含 **55 个 locale chunk ≈4.3MiB**，只留 zh/en 可裁）；依赖 **20 个 `@univerjs` 包 = 118MB** + **`rxjs` 11MB（本项目原本没有）** + `opentype.js` 3.7MB；JS 堆 **23.76MiB**（CE 只有 4.38MiB，增量 20.5 vs 1.3 MiB）；**≈20MB/实例 ⇒ 与本项目 keep-alive 多 tab 现状冲突（10 个表格标签 ≈200MB+）**。且 Univer 的「多维表」本体在 **Pro/商业版**（开源侧只有可扩展架构），照 Sheets 反推 unit/command 体系属无文档逆向。
9. **CSP「独立沙箱」方案的代价量级（本轮实测）**：postMessage 语义 = `structuredClone`，**1MiB 0.135ms / 5MiB 0.698ms**（Node 24 实测，Electron 同 V8）；跨源**没有网络成本**（loopback），固定成本 = 一次页面加载 + 一个独立 JS realm（CE 实测 ≈1.3MiB 堆增量）；开发态 `127.0.0.1:1421` 与 `:19876` 是**同 site**（site 不看端口）⇒ 通常同 renderer 进程、无 IPC；生产 `file://` 父页 ⇒ 很可能 OOPIF 独立进程（**本轮探针超时，未实测**）。**结论：该方案性能代价可忽略，代价在工程复杂度**；且**当前 CE 路线不需要它**（CE 关了公式即可）。
10. **`npx vite dev` 会自己拉起第二个 Electron** 抢 CDP 9222 ⇒ 探针看到 `chrome-error://` 页面。调研期用**独立 spike config（不挂 electron 插件）+ 1422 端口**规避（本批无 spike 文件时可忽略此坑）。
11. **本机 Electron 数量不是固定的**：用户会关掉 dev 实例；任何依赖 CDP 9222 的脚本**先探测**再跑（本会话就遇到「主进程 0 / 9222 拒连」，一次长探针因此挂到 600s 上限才被回收）。
12. **改 `schemaInit.ts` 的建表 SQL 后，旧库靠 `PRAGMA table_info` + `ALTER` 补列**（本批照抄既有 `is_locked`/`md_cache` 的写法）；移动端同理走 `addNoteColumn`。

### 补充（260918 首轮运行时验收：3 个修复，均未提交）
用户点开表格后报 3 个问题，均已定位并修复（CDP 驱真实 Electron 复验）：
1. **右键新建表格打开的是 Lake 文档**：不是存储问题（`notes.kind='sheet'`、正文在 `sheets/{id}.sheet.json` 都正确），而是 `src/hooks/desktopDerivedState.ts` 把 `openTabs` 投影成 `TabInfo` 时**漏传 `kind`** ⇒ `MultiTabEditor` 收不到 `kind=sheet`，走 `EditorTab`。修：`kind: tab.kind ?? "doc"` + 护栏 `src/hooks/desktopDerivedState.test.ts`。
2. **同一页出现 2 张表 / 点单元格不能编辑 / 「Sheet1」栏巨大**（开工具栏后又变成 **2 条工具栏**）：React.StrictMode（dev）双跑 effect；`jspreadsheet` 会把 worksheet / toolbar / contextmenu 追加到「传入的元素」上，且追加**不保证在 `jspreadsheet()` 返回前完成** —— 只在 host 上 `destroy` + `host.replaceChildren()` 会漏掉迟到的追加 ⇒ 叠加成孤儿（可见的那张表点它不进编辑态；worksheet 反而只有 1 张，因为被第二次 init 重建）。修：`SheetEditor.tsx` **每轮 effect 用独立 `mount` 子节点承载 CE**，`teardown()` = `jspreadsheet.destroy(mount)` + `mount.remove()`，进入 effect 先调一次（重入保护）、卸载再调一次；护栏 `src/features/sheet/sheetEditorMount.test.ts`。
3. **没有工具栏**：CE 默认无工具栏；且 npm 包内无 Material Icons 字体文件（`jsuites.css` 只声明字体族、不给 `font-family`），直接 `toolbar: true` 会退化成裸文字。已按用户选定的 **A 方案**本地化 `src/features/sheet/MaterialIcons-Regular.woff2`（Apache-2.0）+ `sheetEditor.css` 的 `@font-face`/`.material-icons` 规则并开 `toolbar: true`；CSP `font-src 'self'` 已放行、离线可用。设计文档 §7 已回填。
4. **单元格内不能换行**（用户报"是不是不支持"）：CE 默认用单行 `<input>` 编辑器，Alt+Enter 无反应。CE 源码里只有**列级** `wordWrap:true` 才走多行 `<textarea>` 编辑器（顶层 `wordWrap` 到不了 worksheet 编辑路径，实测无效）。修：`SheetEditor.tsx` 逐列补 `wordWrap:true`（`withWordWrap`/`sheetColumnWidth`，保留正文已有列配置）⇒ Alt+Enter 插换行、Enter/失焦提交、长文本自动折行。
5. **换行后编辑中看不到第二行**：CE 只在**提交后**才按内容自动调行高，编辑中的 textarea 固定 22px。修：mount 上代理 `input`/`keyup`（Alt+Enter 靠 keyup），用 `height:0` 量 `scrollHeight` 后撑高 textarea + `setHeight(row,h+4)`。实测单行行高不变(26)、两行 39。
6. **工具栏自定义 / 冻结**（用户问可行性，**未落地，待确认**）：CE `toolbar` 的数组形式**有效**（实测可把 30 项覆盖成任意项），但 CE 5.0.4 **不暴露默认项的 onclick**，自建工具栏=要自己重写各动作；`freezeColumns`（仅列、无行冻结）在 init / 选格 / `tableOverflow` 下均**未生效**（`jss_freezed` 始终 0）。若要冻结，倾向自研 sticky CSS（首行/首列）另立项。
- 门禁：`tsc` 0 · `vitest` **1019 passed / 16 skipped (1035)** · 桌面 + 移动 `vite build` 全绿 · `check:bundle` app-js gzip 1.82MB/2.90MB · `check:core` 0 违规 · `git diff --check` 干净。

### 补充（260919：表格内核 jspreadsheet CE → FortuneSheet，未提交）
用户点名换 FortuneSheet（「CE 太简陋」）。选型/实测/落地见 `docs/FORTUNESHEET-FEASIBILITY-260919.md`。
- **CSP 补丁**：`patches/@fortune-sheet+core+1.0.4.patch` 把 `insertRowOrColumn` 的 3 处 `new Function` 换成 `apply`（真 CSP 下实测插行列 0 violation）；`postinstall` 追加 `&& patch-package --patch-dir patches`。
- **正文 v2**：`src/core/sheetDoc.ts` = `{kind:"sheet",version:2,sheets:Sheet[]}`；`sheetsToBody()` 保存时规范化（剔 `luckysheet_select_save` 等运行时字段、dense `data`→sparse `celldata`）并跳过无变化保存。
- **编辑器**：`src/features/sheet/SheetEditor.tsx` 重写为 `<Workbook>`；keep-alive 用 `everVisible` 保证**首次可见才挂载**（canvas 隐藏态初始化会 0 尺寸）；只读 `allowEdit=false`；`sheetEditor.css` 改为容器尺寸（CE 的 Material Icons 字体已删）。
- **清理**：删 `jspreadsheet-ce`/`jsuites` 依赖、CE spike 文件与字体资源；`MultiTabEditor` 注释同步。
- 门禁：`tsc` 0 · `vitest` **1024 passed / 16 skipped (1040)** · 桌面+移动 build 全绿 · 懒加载 `SheetEditor-*.js` **580 KB gzip** · `check:bundle` app-js 1.82MB/2.90MB · `check:core` 0 · `git diff --check` 干净。
- **待办**：真机验收；`SYNC-PROTOCOL`/`STORAGE-LAYERS` 的表格正文 v2 回填；给懒加载 chunk 加 `check:bundle` 预算。

### 补充（260919 首轮 UI 优化，用户实测 5 点后）
- **列数（关键）**：`emptySheetBody` 原写死 `column:8,row:30` → canvas 只按 8 列算宽（976px < 容器 1202）⇒ 右侧留白、横向滚动条不在最右、只显示到 H 列。已改为**不写 row/column**，用 FortuneSheet 默认（60×84）。**旧测试表需重建**（历史 body 保留 8 列，遵红线 #7 不写迁移）。
- **「添加 N 行」输入框**：FortuneSheet 自带 `<input>` 无 class、无样式 → 浏览器默认 `2px inset` 粗边框；已在 `sheetEditor.css` 补 `.luckysheet-bottom-controll-row input` 弱边框。
- **自动换行**：实测**可用**（工具栏「文本换行 → 自动换行」会单元格内换行且行高自适应）；默认是「溢出」。若要求「默认就换行」，FortuneSheet 没有全局默认 wrap 选项，需另做。
- 门禁：`tsc` 0 · `vitest` **1024 passed / 16 skipped (1040)** · 桌面 build 全绿 · `check:bundle` app-js 1.82MB/2.90MB · `check:core` 0 · `git diff --check` 干净。

### 补充（260919 第二轮 UI 优化）
- **右键菜单输入框**（插入行/行高）与「添加 N 行」同源：FortuneSheet 无边框样式 → 补 `.fortune-context-menu input, .luckysheet-cols-menu input` 弱边框。
- **工具栏精简**：`<Workbook toolbarItems={TOOLBAR_ITEMS}>`，只留 18 项高频（见 `SheetEditor.tsx` 的 `TOOLBAR_ITEMS` 注释）。实测可见 18。
- **默认 110% 缩放**：`initialSheets` 给缺省 `zoomRatio` 补 1.1（已有值不覆盖）。实测状态栏 110%。
- 门禁：`tsc` 0 · `vitest` 1024/16 skipped · 桌面 build 全绿 · `SheetEditor-*.js` 580KB gzip · `check:core` 0。

### 补充（260919 第三轮：用户定稿）
- **默认自动换行**：`initialSheets` 给已有单元格补 `tb:"2"`（wrap），`hooks.afterUpdateCell` 给新编辑单元格补（只补缺省）。实测 A1 打 30 W → 折 2 行。
- **默认 20 列**：`emptySheetBody` 加 `column: 20`。
- **工具栏**：+格式刷/清除格式/条件格式/筛选/图片/定位；**−字体**（默认全局字体，不可改）。
- **默认字体**：`ff` 缺省时补 app 的 `--b3-font-family` 栈。
- 门禁：`tsc` 0 · `vitest` 1024/16 skipped · 桌面 build 全绿 · `check:bundle` 1.82MB/2.90MB · `check:core` 0 · `git diff --check` 干净。

### 补充（260919 第四轮：换行后行高自适应）
- **根因**：FortuneSheet 的行高自适应只在 `updateCell` 且 **旧单元格已有 `tb==="2"` 且有值**、并且带 `canvas` 时才跑；首次录入空单元格不调，公开 API 也不带 canvas。
- **修法**：`SheetEditor` 的 `hooks.afterUpdateCell` 补默认 `tb:"2"`/`ff` 后，用离屏 canvas 按列宽估算行数（`estimateWrappedRowHeight`），超过当前行高就 `setRowHeight({[row]: h})`。**实测** A3 打 44 字符 → `config.rowlen` 写高、换行完整可见。
- 门禁同上全绿。

### 补充（260919 第五轮：工具栏/公式栏/图片）
- **工具栏**：去掉 `conditionFormat`/`locationCondition`；CSS 收紧凑（高度 41→33）。
- **公式栏**：`<Workbook showFormulaBar={false}>`（原生支持），已去掉。
- **图片**：本地插入**可用**（隐藏 file input → `insertImage` → `sheet.images` + DOM `<img>` 覆盖层，实测通过）；**粘贴图片不生效**——FortuneSheet 的 `onPaste` 只读文本，要支持得自研 paste 拦截。
- 门禁：`tsc` 0 · `vitest` 1024/16 skipped · build 全绿 · `check:core` 0 · `git diff --check` 干净。

### 补充（260919 第六轮：跨表图片 bug + 默认尺寸 + 标签样式）
- **图片串表（严重）**：FortuneSheet 用固定 id `fortune-img-upload` + 全局 `document.getElementById` 选文件，keep-alive 多实例会命中第一个别的表格。修：`SheetEditor` 只让可见实例保留该 id（隐藏实例摘掉）。实测两表同挂时图片进正确的表。
- **默认网格**：`emptySheetBody` → `column:15, row:50`。
- **工作表标签**：曾改为透明底 + accent 线，用户要求回滚 → 保持 FortuneSheet 默认。
- **图片**：仅浮动图；无单元格图；粘贴图片需自研；全选角边框是 canvas 画的、CSS 改不了。
- 门禁同上全绿。

### 补充（260919 第七轮：patch react 图片 input + 图片管理立项）
- **图片串表修法升级**：patch `@fortune-sheet/react@1.0.4`（`patches/@fortune-sheet+react+1.0.4.patch`），图片按钮点击**自己的子 input**（`e.currentTarget.querySelector('input[type=file]')`），不再依赖全局 `getElementById`。实测 3 实例同挂仍插当前可见表；原 visibility id 补丁已删。
- **图片独立管理已立项**：规范 `docs/SHEET-IMAGE-MANAGEMENT-260919.md`（正文改存 filename、复用 note-assets/manifest/GC；P1 浮动图 ~1–1.5 天，P2 单元格图 ~3–5 天）。**其他会话按该文件实施**。
- 门禁：`tsc` 0 · `vitest` 1024/16 skipped · build 全绿 · `check:core` 0 · `git diff --check` 干净。

### 补充（260919 第八轮：修窗口崩溃）
- **现象**：编辑单元格时窗口整崩；非 OOM（Electron rss≈190MB）；日志 `setCellFormat` 抛 `reading '2'`。
- **根因**：内核 `setCellFormat` 不判空 `sheet.data[row]`（`setCellValue` 有 fallback），空表/切表瞬间未定义；且抛在 `setContext` updater 里，绕过了 hook 的 try/catch → React 未捕获 → 卸载整树。
- **修**：① patch core 补 `if (targetSheetData == null || targetSheetData[row] == null) return;`（core patch 现 4 hunk）；② `MultiTabEditor` 加 `SheetEditorErrorBoundary`（按 tab 隔离，单表崩只显占位）。实测连打多行无异常、默认换行/行高仍生效。
- 门禁同上全绿。

### 补充（260919 第十轮：非 doc 的 UI 收口）
- **导出 kind 守卫**：`electron/noteExport.ts` 加 `assertDocKind(id)`，`exportHtmlNote`/`exportPdfHtml`/`exportNotePackage` 入口拦截非 doc（抛 `InvalidInput`，兜底防 IPC 直调）。测试：`store.test.ts`「非 doc（表格）导出被 kind 守卫拦截」。
- **桌面 `TreeNode.kind`**：`src/lib/types.ts` + `electron/noteQueries.ts` 的 `TreeNode` 加 `kind`；`listTreeNodes` LEFT JOIN `notes` 取 `kind`，`mapTreeNode` 透传。
- **UI**：目录树右键「导出」子菜单 + 文档右上角 ⋯ 菜单对非 doc **隐藏**（`activeKind` 经 `deriveDesktopView` 下发）；**大纲侧栏**对非 doc 隐藏（`outlineVisible` 加 `activeKind==="doc"`）；**状态栏**非 doc 把「字数/图片」替换为「表格/多维表」。
- **实测**：WRAPCHK（表格）状态栏显示「表格」、无大纲；探针笔记（文档）显示「字数/图片」。
- 门禁：`tsc` 0 · `vitest` **1025 passed / 16 skipped (1041)** · build 全绿 · `check:core` 0 · `git diff --check` 干净。

### 补充（260919 第九轮：编辑态限宽）
- **语义**：`tb==="1"`（溢出）编辑态也溢出；`"0"`截断 / `"2"`换行 / 未设（默认换行）→ 编辑框限宽在单元格内。
- **修法**：patch `@fortune-sheet/react` 的 InputBox inner style，按 `cell.tb` 追加 `width/maxWidth=firstSelection.width` + `whiteSpace`（react patch 现 4 hunk）。core `getStyleByCell` 那条试过不生效，已留在 patch 里但非关键。
- **实测**：编辑 `tb:"2"` 单元格 → 编辑框 `max-width:80px`、`pre-wrap`，格内折行不再覆盖邻格。
- 门禁同上全绿；两个 patch 均 `patch-package` 可重放。

## 2.9 本会话总交接（260919 · 表格内核换代 FortuneSheet + UI/文档收口 + 崩溃修复）—— 新会话从这里读

> 前置：**§2.8 是 260918「表格文档接入」一批的总交接**（kind=sheet 的由来、manifest v6、设计文档）；本 §2.9 是**同一批的 260919 续做**，两者合起来才是完整表格文档。
> 状态：**已全部提交并推 origin**（`master` 基线见 §0）；**唯一没做的是真机验收**。

### 一、任务目标（用户本次要求，按顺序）
1. **调研并替换表格内核**：CE（jspreadsheet-ce）太简陋 → 调研 FortuneSheet 可行性 → 用户拍板「开始做」。
2. **用户实测报 5 点 UI 问题**（工具栏没占满 / 滚动条不在最右 / 左上角与【50】行重边框 / sheet1 只到 H 列 / 自动换行不能用）→ 逐项修。
3. 多轮细化：默认 **15 列 × 50 行**；默认**自动换行 + 行高自适应**；工具栏按清单增删；去掉函数栏；默认 110% 缩放；工具栏紧凑。
4. **编辑态宽度语义**（用户定，与云端一致）：换行=**溢出** → 编辑框也溢出；**截断/自动换行** → 编辑框限宽在单元格内。
5. **修窗口崩溃**（编辑时整窗挂）。
6. **非 doc 的 UI 收口**：导出/大纲/字数/复制 Markdown 对 kind≠doc 隐藏或替换；`noteExport` 加 kind 守卫。
7. **文档回填** `SYNC-PROTOCOL` / `STORAGE-LAYERS`。
8. **图片独立管理立项**（只出规范，未实施）。
9. 提交、合入 `master`、推 origin。

### 二、已完成内容（全部已提交并推 origin）
**A. 内核换代（CE → FortuneSheet 1.0.4）**
- 正文仍 `sheets/{id}.sheet.json`，结构换成 FortuneSheet workbook（`{kind:"sheet",version:2,sheets:Sheet[]}`）；`src/core/sheetDoc.ts` 重写（`emptySheetBody`/`parseSheetBody`/`sheetsToBody`/`sheetToSearchText`/`sanitizeSheetWorksheet`：剔 `luckysheet_select_save` 等运行时字段 + dense `data`→sparse `celldata`）。
- `src/features/sheet/SheetEditor.tsx` 重写：`<Workbook>`、everVisible 延迟挂载（隐藏态 canvas 量成 0）、非受控 data、防抖 flush + `lastSerializedRef` 去重。
- **patch-package 两个补丁**（`patches/`，`postinstall` 自动重放）：
  - `@fortune-sheet/core`：① `insertRowOrCol` 的 `new Function` → `apply`（严格 CSP 无 unsafe-eval）；② `setCellFormat` 判空 `sheet.data[row]`（防崩）。
  - `@fortune-sheet/react`：① 图片按钮改为点**自己**的子 input（脱离全局 `getElementById`）；② `InputBox` 按 `tb` 限宽（编辑态语义）。

**B. 表格 UI/交互（用户逐条验收过）**
- 默认网格 **15×50**；默认 **110% 缩放**（`initialSheets` 补 `zoomRatio`，不覆盖已有）。
- **默认自动换行 + 行高自适应**：`tb:"2"` 补缺省单元格（已有内容 `withSheetDefaults` + 新编辑 `hooks.afterUpdateCell`）；行高由 `estimateWrappedRowHeight`（离屏 canvas 按列宽估行数）后 `setRowHeight`。
- **默认全局字体**（`ff` 缺省补 app `--b3-font-family`），**去掉字体选择**。
- **工具栏白名单** `TOOLBAR_ITEMS`（撤销/重做 · 格式刷/清除格式 · 字号 · 粗斜删下 · 字色/背景 · 对齐/换行 · 边框/合并 · 筛选/图片 · 冻结/求和/查找）；CSS 紧凑（高 41→33）。
- **去掉函数栏**（`showFormulaBar={false}`）。
- 工作表标签样式改过又**按用户要求回滚**（保持 FortuneSheet 默认）。
- 输入框（底部「添加 N 行」、右键「插入行/行高」）补弱边框。
- 图片**本地插入可用**；**粘贴图片不支持**（FortuneSheet `onPaste` 只读文本）。
- **编辑态按换行语义限宽**（溢出=不限宽；截断=限宽不折；换行/未设=限宽折行）。

**C. 崩溃修复（严重）**
- 现象：编辑时整窗崩；栈 `setCellFormat` 读 `undefined[row]`。根因：内核 `setCellFormat` **不判空** `sheet.data[row]`（`setCellValue` 有 fallback，它没有），空表/切表瞬间即抛；且抛在 `setContext` 的 updater 里，**绕过 hook 的 try/catch** → React 卸载整树。
- 修：① patch core 补判空；② `MultiTabEditor.tsx` 加 `SheetEditorErrorBoundary`（按 tab 隔离，单表崩只显占位）。

**D. 非 doc 的 UI/文档收口**
- `electron/noteExport.ts` 三导出加 `assertDocKind`（非 doc 抛 `InvalidInput`）；测试 `electron/store.test.ts`。
- 桌面 `TreeNode` 加 `kind`（`src/lib/types.ts` + `electron/noteQueries.ts`：`listTreeNodes` LEFT JOIN `notes` + `mapTreeNode`）。
- 目录树右键「导出」子菜单、文档 ⋯ 菜单对非 doc **隐藏**；**大纲**对非 doc 隐藏；**状态栏**非 doc 把「字数/图片」替换为「表格/多维表」。

**E. 文档**
- 新增 `docs/FORTUNESHEET-FEASIBILITY-260919.md`（选型 + 各轮落地）、`docs/SHEET-IMAGE-MANAGEMENT-260919.md`（图片独立管理 P1/P2/P3 规范）、`docs/BITABLE-PRODUCT-SPEC-260919.md`、`docs/FLOATING-TOOLBAR-DESIGN-260919.md`。
- 回填 `docs/SYNC-PROTOCOL.md`（manifest v6 + kind）、`docs/STORAGE-LAYERS.md`（`sheets/` + kind 路径 + `sheetToSearchText`）。

**门禁（最终）**：`tsc` 0 · `vitest` **1025 passed / 16 skipped (1041)** · 桌面 + 移动 build 全绿 · `check:bundle` app-js 1.82MB/2.90MB · `check:core` 0 · `git diff --check` 干净；两个 patch-package 补丁可重放。

### 三、当前问题（均不阻塞）
1. **真机验收未做**（最该先做）：完整链路没在真实应用跑过（观察点见 §2.8 四.1）。
2. **图片是 base64 内联进正文**（`sheets[].images[].src`）→ 正文膨胀、随同步/历史走、无 GC 关联；**规范已出但未实施**（见 §2.9 四.2 与 `docs/SHEET-IMAGE-MANAGEMENT-260919.md`）。
3. **粘贴图片不支持**；**单元格图片不支持**（FortuneSheet 无 in-cell 图片字段）。
4. **全选角（左上角）边框**由内核 canvas 画，CSS 改不了（用户已同意不改）。
5. **旧表格不会自动迁移**：旧 CE v1 正文 `parseSheetBody` 返回 null → 打开按空表；按红线 #7 **直接重建**（开发版数据可删可重建，不写迁移）。

### 四、下一步计划（按优先级）
1. **真机验收**：新建/编辑/插行列/冻结/多 tab 切换/保存/同步/移动端只读占位。
2. **图片独立管理 P1**（浮动图落资产管线：正文存 filename、复用 `note-assets`/`manifest.assets`/GC）→ P2 单元格图 → P3 移动端/浏览器；规范 `docs/SHEET-IMAGE-MANAGEMENT-260919.md`。
3. 可选：粘贴图片拦截器；给懒加载 `SheetEditor-*.js` 加 `check:bundle` 预算。
4. 更老的待办见 §3。

### 五、踩过的坑（本批新增，务必记住）
1. **FortuneSheet 图片按钮用固定 `id="fortune-img-upload"` + 全局 `document.getElementById`** ⇒ keep-alive 多实例永远命中第一个 → **图片插到别的表格**。修：patch react 让它点**自己**的子 input。
2. **`setCellFormat` 不判空 `sheet.data[row]`** ⇒ 空表/切表时抛错，且抛在 `setContext` updater 里 **try/catch 抓不到** → 整窗崩。修：patch core 判空 + 错误边界。
3. **行高自适应只在「旧值已存在 + 带 canvas」的编辑路径跑**、公开 API 触发不到 ⇒ 首次录入不调行高。修：自己按列宽估算后 `setRowHeight`。
4. **编辑框没有 max-width**（CSS 给到 9900px）⇒ 编辑态文字横向盖住邻格。修：react patch 按 `tb` 限宽；**注入点别选 core `getStyleByCell`**（编辑态那个 memo 常返回 `{}`，改了不生效），要注入到 react `InputBox`。
5. **改了 node_modules 依赖后必须 `rm -rf node_modules/.vite` 再重启**：否则 Vite 用旧依赖缓存（表现为 `jspreadsheet-ce ENOENT` 之类）甚至 HMR 崩渲染树。
6. **patch-package 流程**：改两个 dist（`index.js` + `index.esm.js`）→ `npx patch-package <pkg> --patch-dir patches`；`postinstall` 会重放；用 `npx patch-package --patch-dir patches` 验证。
7. **后台 `npm run dev` 会被会话回收**；Electron 只能按**具体 PID** kill（别 `pkill -f Electron`）。
8. **HMR 瞬态**：改 `toolbarItems` 等在 HMR 中途会出现「useMemo deps 长度变化」告警甚至 update-depth；**干净重启即消失，不是真 bug**。
9. **写补丁脚本别用 TS 模板拼接**（`` ` ` 与 `${` 会被抢先解释）；且**变量名会被压缩器重命名**，grep 变量名验证补丁是否进 bundle **不可靠**（改查字符串字面量 / 直接看 on-disk `.vite/deps` bundle）。

### 六、关键文件定位
- 正文模型 `src/core/sheetDoc.ts`；编辑器 `src/features/sheet/SheetEditor.tsx` + `sheetEditor.css`；类型 `src/core/noteKind.ts`。
- 补丁 `patches/@fortune-sheet+core+1.0.4.patch`、`patches/@fortune-sheet+react+1.0.4.patch`。
- 收口 `electron/noteExport.ts`、`electron/noteQueries.ts`、`src/components/Sidebar.tsx`、`src/desktop/DesktopOverlays.tsx`、`src/components/DesktopStatusBar.tsx`、`src/hooks/desktopDerivedState.ts`。
- 规范 `docs/FORTUNESHEET-FEASIBILITY-260919.md`、`docs/SHEET-IMAGE-MANAGEMENT-260919.md`。

## 2.10 本会话总交接（260919 晚 · 小记挂 Lake 内核编辑器）—— 新会话从这里读

> 写给**完全没有上下文的新会话**。本批**已提交并推送**（`master` @ `0d442a8`），工作区干净、无在途分支/worktree。
> **⚠️ 验收状态：用户简单点了几下，反馈「问题很多」，但**没有逐条给出**——本批**默认不通过**。新会话第一件事是拿现象清单（或按 §三/§四 自查清单逐条走查）。
> 关联：`docs/QUICK-NOTE-LAKE-BODY-260919.md`（数据格式与改动清单）· `docs/QUICK-NOTE-LAKE-MEMORY-SPIKE-260919.md`（实例内存/延迟量化）· `docs/QUICK-NOTES-SPEC.md`（小记产品规格，注意其「不复用 Lake 编辑器」的结论**已被本批推翻**，需要它跟着改）。

### 一、任务目标（用户本次要求）

1. **给小记支持更多格式**：用户定稿要的是「（有序/无序）列表 / 待办 / 引用 / 加粗 / 代码 / 图片 / 附件」——都是内核原生能力。
2. **方案定稿**：小记写作区挂**一个** Lake 内核实例（**编辑时挂、其余不挂**），**不要**每条小记常驻实例。
   - 量化依据（本会话实测）：单实例 ≈ **+1.3~5MB JS 堆 / ≈+5MB RSS**、冷开 ≈ **150ms**；24 tab 场景下 24 个实例共 +58.9MB 堆、RSS 725→925MB。⇒「相当于多开一个 tab」成立。
3. **格式升级的顺带收益**：小记正文变成**内核形态**后，「小记 → 正式文档」从「手拼序列化」退化成「**搬运**（只改写资源作用域）」，消掉旧的「内核容忍形态」隐患。
4. 交付要求：三条链路可用 —— ① 新建（打字/贴图 → 记下）② 编辑已有小记 → 保存 ③ 转为正式笔记（含图片）。

### 二、已完成内容（全部已提交并推送）

**A. 数据层：`.qnote` v2 = 内核形态正文（commit `c08f711`）**

- `QuickNoteContent` 新增 **`body`**（内核形态 Lake 正文，唯一真相）；`text` 退化为**纯文本镜像**（预览/搜索/无富文本端降级）。
- `QUICK_NOTE_VERSION = 2`；`src/core/quickNoteModel.ts` 新增 `quickNoteBodyFromTextAndImages(text, images, imageUrl, makeId)`（**没有内核编辑能力的一端**——移动端/只给 text 的调用——按此合成正文：每行一个 `ne-p` 段落 + 每图一张 inline image 卡片）与 `rewriteQuickNoteAssetScope(body, from, to)`（资源作用域改写，**同时处理卡片 value 里 URL-encoded 的形态**）。
- **转换退化为搬运**：`electron/quickNoteConversion.ts` 现在只做 `body` 的 `/quick-notes/<小记id>/` → `/<目标文档id>/` 改写（图片文件仍由既有 journal 复制），删掉了原来手拼段落/手拼图片卡片的实现。
- **保存时作用域改写**：桌面编辑态图片先落 staging（卡片 src 指向 `/quick-notes/staging/<draftId>/`），`electron/quickNotes.ts` 保存时改写成 `/quick-notes/<小记id>/`。
- 移动端保存时同样合成 body（`src/mobile/quickNotesRepository.ts`）⇒ **移动端建的小记转换后不丢图**。
- **数据兼容按红线不做**（AGENTS §3 #7）：v1 `.qnote` 直接不可读；dev 库里原有 7 条 v1 测试小记**已清理**（含墓碑）。

**B. 量化报告 + 可复现脚本（commit `dd7e62d` / `a4e25f9`）**

- `docs/QUICK-NOTE-LAKE-MEMORY-SPIKE-260919.md`：1→24 实例的堆/DOM/监听/RSS 全表、冷开延迟、以及「关标签内存不完全归还」的观测；`scripts/spike-lake-memory/{cdp,measure,cycle}.mjs` + `results-1to24.json`。
- 关键结论：成本**线性**（第 14→24 个每个 +1.2~1.4MB 堆），内容相关（44k 字大文档 +10.3MB）；`maxOpenTabs` 档位 `0/4/6/8/12/16/24`（**0 = 不限**，默认 8）。

**C. 编辑器接线（commit `5a774c3`）**

| 文件 | 改动 |
|---|---|
| `src/features/quickNotes/QuickNoteEditor.tsx` | **新增**：挂 1 个 Lake 实例（`createLakeDocument(host,"editor",…)`），交出 `getText()/getBody()` 句柄；含 DOM `input` 兜底 + DOM `innerText` 回退（见 §五坑 1/2） |
| `src/components/QuickNotesWorkspace.tsx` | `DraftState` 加 `body`；`<textarea>` → `QuickNoteEditor`；新增 `quickNoteUploader(draftId)`（图片 → `stageQuickNoteImage` → 追加到 `draft.images`）；保存时正文取编辑器句柄（空则回落镜像）；`startEditing` 带上 `body` |
| `src/features/editor/resourceUpload.ts` | `uploadLakeResource(request, noteId, options)` 新增 `saveResource`（覆盖落盘）/`allowRemoteDownload`（小记 v1 关闭网络图片直插） |
| `src/features/editor/lakeRuntime.ts` | `createLakeDocument(..., uploadResource?)` 第 8 参数：覆盖 4 处 `createUploadPromise`（image/file/video/audio） |
| `src/styles/app/quick-notes.css` | `.quick-note-editor` / `> .lake-editor-mount` 替换原 textarea 规则 |

**D. 文档（commit `0d442a8`）**：本文件 §2.10 + §3 第 6/7 条 + `docs/QUICK-NOTE-LAKE-BODY-260919.md`。

**门禁（本批实测）**：`tsc` 0 · `vitest` **1025 passed / 16 skipped (1041)** · 桌面 + 移动 `vite build` 全绿 · `check:bundle` app-js gzip **1.82MB / 2.90MB** · `check:core` 0 违规 · `git diff --check` 干净。

### 三、当前问题（⚠️ 用户报「问题很多」，未逐条给）

> **（260919 晚 · 本会话续做，未提交、待验收）**：用户本轮把方向定为「小记底层换用 Lake 内核 +
> 对齐语雀云端小记（红框：小记卡工具条「图片/待办」+ 展开」）」，已按此落地并实测通过：
> ① 小记写作卡改成**内核 note 版式**（工具条只剩「图片」「待办」，右上角是「展开」）；
> ② 点展开 = 内核 fullscreen，**同一实例**切成完整工具栏的整窗编辑器，右上角可收起；
> ③ **修掉下面第 1 条**（图片按钮回来了：文件选择 → staging → 卡片 → 记下，实测图片落盘 + 正文含 image 卡）；
> ④ **修掉第 2 条的根因**（空小记不 `setDocument` ⇒ 内核 `document.ready` 不触发 ⇒ note 版式/工具条/
> 展开按钮/键入回传整块失效 —— 见 `docs/LAKEX-CONTRACT.md` **§5.11**）。
> 详细交接见本文件 §2.10 末尾「本会话续做」段；门禁：tsc 0 · vitest 1025+4 passed/16 skipped ·
> 桌面+移动 build 全绿 · check:bundle 1.82MB/2.90MB · check:core 0 · git diff --check 干净。

**已确认的回归（我自己发现的，必修）**

1. **✅ 已修（260919 晚）**「添加图片」文件选择按钮没了：原来 textarea 上方工具条里的文件选择入口随 textarea 一起删掉，现在只能**粘贴/拖入**图片。用户若习惯点按钮加图，就是「加不了图」。
   → 现由内核 note 工具条的 `image` 项提供（自带 file input，走 `image.createUploadPromise` → 小记 staging），实测可用。

**未验证（我没能验完，极可能就藏在这里）**

2. **真实键盘输入**：CDP 的 `Input.dispatchKeyEvent/insertText` 打不进 contenteditable（见 §五坑 3），我只用 `document.execCommand('insertText')` 验证了**保存链路**。人用键盘打字是否正常**未经真机确认**。
   → **（260919 晚）根因已定位并修掉一半**：空小记不 `setDocument` ⇒ 内核 `document.ready` 不触发 ⇒ `contentchange` 不来（这才是 §五坑 1「输入了字却不回传」的真因）；现已无条件装载空正文。**真实键盘仍待用户点一下确认。**
3. **粘贴/拖入图片的完整链路**（staging → 保存时作用域改写 → 转换后图片可达）从未验过。
4. **编辑已有小记 → 保存**（只验过「新建 → 记下」）。
5. **取消/放弃草稿**时的 staging 清理（`discardQuickNoteDraft`）与「有内容才确认」的弹窗路径未验。
6. **⌘Enter 发布**（挂在 `onKeyDownCapture`，内核可能吞键）未验。

**潜在缺陷（自查发现，需评估）**

7. **`draftEditorRef` 是 pane 与 inline 两个 composer 共用的单个 ref**：切换/卸载顺序可能互相覆盖（建议按草稿 id 存 Map，或把句柄收进 composer）。
8. **小记面板一打开就常驻 1 个内核实例**（pane 里的新建写作区始终渲染）——与「编辑时挂」的预期不完全一致，内存/首开延迟要复核（并可纳入 §3 第 6 条的回收专项）。
9. **编辑器里删掉图片卡片后 `retainedImageIds` 仍保留该图**（文件不随之回收，可能留孤儿）。
10. **`getBody()` 取不到时静默返回空串**：主进程会按 text 合成正文 —— 这会让「有格式但取不到 body」的情况下**静默丢格式**（不报错）。属于取舍，但要意识到。
11. **inline 变体（卡片内编辑）的样式/高度**没量过（只在 pane 变体看过）。
12. **`docs/QUICK-NOTES-SPEC.md` 已与实现冲突**（该文档写着「小记不复用 Lake 编辑器」），需要同步更新，否则后续会话会按旧规格判断。

### 四、下一步计划（按优先级）

1. **先拿现象清单**：请用户把「点出来的问题」逐条列出（或截图）。若拿不到，就按 §三 的 2~12 条**逐条真机走查**并记录现象，别猜。
   → **（260919 晚）用户已给方向**（小记对齐云端 + 红框项），本会话据此落地了 note 版式与展开流程；
   下一轮请用户**点一遍**，重点是键盘打字、贴图、编辑已有小记、⌘Enter 发布这几条真机项。
2. **真机走通三条链路**（用真实键鼠 + 真实粘贴）：
   - ① 小记面板新建：键盘打字（含换行、列表、加粗、行内代码）→ 记下 → 重开看格式是否保留；
   - ② 编辑已有小记 → 保存（看格式与图片是否都在）；
   - ③ 贴图 → 记下 → 「转为正式笔记」→ 图片在文档里能显示（`note-assets/<新文档id>/` 里应有同名文件）。
3. **~~修掉 §三 第 1 条~~（260919 晚已修）**：图片按钮 = 内核 note 工具条的 `image` 项（无需自研按钮/命令名）。
4. 修 §三 7~9 三个潜在缺陷（ref 竞态 / 常驻实例 / 图片孤儿）。
5. 更新 `docs/QUICK-NOTES-SPEC.md`（v2 格式 + 「写作区挂单个内核实例」的新结论）。
6. 把「小记编辑器挂/卸」纳入 §3 第 6 条的**内存回收专项**（churn soak 三条触发面之一）。

### 五、踩过的坑（本批新增，务必记住）

1. **内核 `contentchange` 在小记上下文不保证回传文本**，`editor.getDocument("text/plain")` 也可能取不到 ⇒ **必须再加 DOM `input` 监听 + DOM `innerText` 回退**。否则症状是「明明输入了字，但发布按钮不点亮、点了提示『请至少记录文字或一张图片』」。
2. **`getBody()` 取不到时不要抛错**：抛错会直接打断保存（症状：点发布无反应/报「保存小记失败」）。返回空串即可 —— 主进程本来就会按 `text` 合成正文。
3. **CDP 的 `Input` 键鼠事件在窗口非激活时不可靠**：鼠标有时能行（点侧栏开标签可以），**键盘基本打不进 contenteditable**（`Input.insertText` 与逐字符 `dispatchKeyEvent` 都试过，DOM 仍是空）。⇒ 验证「打字」只能用真实键盘；验证「保存链路」可以用内核接受的 `document.execCommand('insertText', false, …)` 注入内容。
4. **内核聚焦要走它自己的入口**：官方文档（`08 - 命令列表`）有 `editor.execCommand("focus", "end")`、事件 `focusstatuschange`。DOM `focus()` 让 `.ne-engine` 变成 `document.activeElement` 也**不足以**让合成按键生效。
5. **`.qnote` v1 不再可读**（校验只认 v2）——若 dev 库又出现 v1 小记，小记面板会**整列表报错**（`listQuickNotes` 逐条校验）。清理办法：走应用 IPC `deleteQuickNote`；已被 v2 校验挡住时，按同样语义用 sqlite3 处理（`quick_note_deleted` 墓碑 + 删 `quick_notes` 行，文件按约定保留待 GC）。
6. **量化/隔离环境**（复用这套姿势）：独立 worktree + 独立 `LAKE_USER_DATA`（APFS `cp -Rc` 克隆 + `sqlite3 .backup` 快照）+ 独立端口（vite 1431 / CDP 9232 / asset 19877）+ `LAKE_DEV_SERVER_URL` 指 1431 + 把克隆数据里的资源端口从 19876 改写成 19877（**含 `%3A19876%2F` 编码形态**）。详细命令见 spike 报告 §6。

### 2.10 续做（260919 晚 · 小记对齐云端：note 版式 + 展开成完整编辑器）—— ⚠️ 未提交，待用户点验

> 本段是 §2.10 的**后续一轮**。用户本轮定的方向：「小记底层换用 Lake 内核 → 功能仿照语雀云端小记实现」
> （明确允许用 browser-skill 驱动本地 Edge 观察云端小记；截图标了红框 = **小记卡工具条「图片/待办」+ 展开**，
> 并强调「默认一小块、能展开成完整 Lake 编辑器」的流程；**标签类不做、不额外增加功能**）。

**一、做了什么（代码在 `master` 工作区，未提交）**

1. **小记写作卡改用内核 note 版式**：`src/features/editor/lakeRuntime.ts` 新增 `LakeEditorPrefs.noteUi`；
   `QuickNoteEditor.tsx` 传 `noteUi: true`。内核侧 = `uiSwitch.default='note'` + `fullscreen.enable` +
   `toolbar.agentConfig.note = ['image','taskList']`（并显式给出 `default` 项），mount 类名换成
   `lake-editor-mount ne-doc-note-editor lakex-note-editor`。
   ⇒ 卡片工具条 = **图片 + 待办**，右上角 = 内核**展开**按钮（与云端小记一致）。
2. **展开 = 内核 fullscreen，同一实例切 UI**：点开后 mount 加 `.ne-ui-fullscreen`（`position:fixed;inset:0`），
   note 版式类被摘掉 ⇒ 工具条自动切回**完整默认工具栏**（27 项）、正文回文档版式；右上角
   `.ne-ui-exit-fullscreen` 可收起。**不能用 `uiType:'toolbar'`**（那样展开后没有退出入口）。
3. **修掉 §三 第 1 条**（图片入口）+ **第 2 条的根因**：空小记不 `setDocument` ⇒ 内核 `document.ready`
   不触发 ⇒ note 版式/工具条/展开按钮/`contentchange` 整块失效。`QuickNoteEditor` 现在**无条件**
   `setDocument`（空正文用 `emptyLakeBody(ownerId)`）。
4. **护栏**：`src/features/quickNotes/quickNoteNoteUi.test.ts`（源码级 4 条）。
5. **文档**：内核结论回填 `docs/LAKEX-CONTRACT.md` **§5.11**（三件套 + 两个坑 + 图标结论）。

**二、实测（CDP 驱真实 Electron，dev 数据）**

- 卡片结构：`mount.ne-doc-note-editor.lakex-note-editor` > `.ne-editor.ne-note-ui`；note 工具条
  `data-toolbar-name="note"`（2 钮；symbol 命中 `#icon-image` / `#icon-editor-taskList`）；default 工具条隐藏。
- 展开/收起：展开后 `.ne-editor` 摘掉 `ne-note-ui`、工具栏切默认（27 钮）、`.ne-ui-exit-fullscreen`
  42×42 出现在窗口右上；收起后回到 note 版式。
- **功能链路**：`execCommand('focus','end')` + `insertText` 打字 → 点「待办」→ 发布 ⇒ 落盘正文
  `<ul class="lake-list"><li class="lake-list-task"><card name="checkbox" …>`（内核形态 ✓）；
  合成 `File` 触发工具条 file input ⇒ 图片进 staging → 发布 ⇒ `images[]` 有记录 + 正文含 image 卡 +
  `quick-notes/staging/` 清空（promote 成功）。
- 门禁：`tsc` 0 · `vitest` **1029 passed / 16 skipped** · 桌面 + 移动 `vite build` 全绿 ·
  `check:bundle` app-js 1.82MB/2.90MB · `check:core` 0 · `git diff --check` 干净。

**三、第二轮（用户 260919 确认「两个都要做」后补做：版式切换 + 附件）**

1. **「列表 / 小记」版式切换**（云端 `#switch-listType-wrapper`）——标题右侧分段控件，复用既有 `.seg`/`.seg__item`
   思源件（未新造视觉）：
   - `小记`（note）＝写作卡（图片/待办/附件 + 展开）+ 卡片流（原有版式）；
   - `列表`（list）＝**索引列表（`.quick-notes-index`，复用 `b3-list b3-list--background`，宽 200–260px）
     + 右侧全尺寸编辑器**（`editorMode="document"` ⇒ 完整工具栏），点行切换、当前行高亮，行内时间口径
     对齐云端（今天 = 「今天 HH:MM」，其余 = 「MM-DD」），顶部一行「新建小记」。
   - **纯展示偏好**：存本机 `localStorage: lake-notes-v3.quick-notes-view`，不进 S3（与排序同口径）。
2. **附件（挂纸夹）**：内核 file 插件的工具项 `note-file` 直接可用（自带 file input + `file.createUploadPromise`），
   **但它画的 `note-file` symbol 是语雀 App 私有的**（kernel sprite 无 `note-*`）⇒ 我们自补一枚同 id 的
   symbol（lucide 纸夹路径，`ensureNoteFileIcon()`，幂等）。落盘链路：
   渲染层 `uploadAttachmentFile` 现在也走 `options.saveResource`（**否则附件会落进文档资源空间**）→
   主进程新增 `stage_quick_note_file` / `stageFile()`（与图片共用 staging + promote，宽高 null，走附件硬上限）→
   发布时随图片一起 promote、转换时随图片一起搬运（`content.images` 就是资源清单，MIME 放宽为「合法 MIME +
   非图片必须宽高为 null」；`isQuickNoteImageMime` 仍用于"当图片渲染"的过滤）。
   - 实测：贴一个 .txt → 发布 ⇒ 资源记录 `{mime:text/plain,w:null,h:null}` + 正文含 `<card name="file">`；
     「转为正式文档」⇒ 文件出现在 `note-assets/<新文档id>/`、正文引用改写正确。
3. 云端卡片里还有个「书签」按钮（未在红框内）：仍未加（会插入 bookmark 卡）。
4. §三 7~9（`draftEditorRef` 共用竞态 / pane 常驻实例 / 删图留孤儿）与第 12 条（`QUICK-NOTES-SPEC.md` 过期）：
   第 12 条已更新（QUICK-NOTES-SPEC 顶部加"结论已推翻"说明）；7~9 仍未动。
5. **第三轮（用户 260919 反馈两条后的补做）**：
   - **① 附件按类型成卡**：附件按钮选中的文件按类型落到对应卡片 —— 图片→图片卡、视频→视频卡（带播放器）、
     音频→音频卡、其它→附件卡。内核侧机制与两个坑（泛化 `insertCardByUI` 必须带 `name`；`category` 决定卡片类型）
     见 `docs/LAKEX-CONTRACT.md` **§5.11 五**；实现 = `installAttachmentTypeRouting()`（`lakeRuntime.ts`，拦截
     `.ne-ui-toolbar-file` 的 change 后按 category 重发）。实测：paperclip 选 png/mp3/mp4 → 图片/音频/视频卡 ✓、
     pdf → 附件卡 ✓。顺带把暂存附件的**展示名=原始文件名**（磁盘名仍是时间戳名，与文档附件卡同口径）。
   - **② 已保存小记的卡片展示**：此前把所有资源都当 `<img>` 渲染 ⇒ 视频/附件显示成"小记图片"碎图（用户截图）。
     现在按类型渲染：图片网格（可点开大图）、`<video>`/`<audio>` 可播放、其它给附件条（`.quick-note-file-chip`）。
     用户那条测试小记复验：图片正常 + 视频出播放器、无碎图 ✓。
   - ⚠️ 已知边界（有意不做）：卡片只渲染 `text` 镜像 + 资源清单，**不渲染 `body` 富格式**；要看列表/待办/引用等
     真实样式请进编辑态（内核渲染）。卡片内挂 viewer 的内存代价见 `docs/QUICK-NOTE-LAKE-MEMORY-SPIKE-260919.md`。
6. **第四轮（用户 260919「可以正常展示了，但是一编辑视频或者说附件还是消失」）**：
   - **真因**：内核**媒体卡是两阶段的** —— 插入时先落一张 `status:"pending"`、`url:null` 的卡，
     上传 promise 完成后才回填 url。此时（或更早）保存 ⇒ 正文里是一张**永久 pending 的坏卡**：
     卡片流按资源清单渲染所以"看着正常"，一进编辑就没有可渲染的卡 ⇒ 用户看到的"消失"。
     叠加两个既有缺陷：`draftEditorRef` 单 ref 被两个 composer 共用（HANDOFF §2.10 三.7）、
     资源清单只信渲染层传来的 ids。
   - **修复（三层）**：① `QuickNotesWorkspace.saveDraft` 保存前**等正文里没有 pending/uploading 的媒体卡**
     （≤15s，超时提示"有媒体还没上传完"，绝不写坏卡）+ 等进行中的上传任务归零 + 资源按草稿 id 汇总；
     ② 编辑器句柄改**按草稿 id 存**（`draftEditorsRef`），且**保存的是点击那个 composer 的草稿**
     （从前写作面板的「小记一下」在内联编辑打开时会去存被编辑的那条小记）；
     ③ `electron/quickNotes.ts` 的**资源清单改以正文引用为准**（staging sidecar ∪ 渲染层 ids →
     按 `body.includes(filename)` 过滤），并顺手清掉"编辑器里删了卡但清单还在"的幽灵资源（含文件）。
   - **实测**：贴视频→**立刻**保存 ⇒ 正文是真卡（非 pending）+ 清单有该资源 ✓；打开编辑 → 视频在 ✓；
     改字再存 ⇒ 视频与资源都还在 ✓。
   - **遗留**：用户那条旧小记（`a38c7397`）的正文里本来就是坏卡（视频丢在清单外），按红线 #7 不写修复代码，
     重新拖一次即可。
7. **第五轮（用户 260919 定稿：内核当"写入器"，我们自己当"读取器"）**：
   - **决策**：小记**编辑态继续挂内核**（所以产出永远是标准 lake 标记，手拼格式被内核改写的风险不存在）；
     **卡片预览不挂内核**（性能：每卡一实例 ≈ +5MB RSS，等于开一堆 tab）——改成**自研只读渲染器**；
     两边对齐的办法是**把可插入格式收成封闭白名单**（"预览显示不了的就不给插"）。
   - **白名单**（= `QUICK_NOTE_TOOLBAR_ITEMS`，也用于展开态，避免展开后又漏出白名单外的格式）：
     `style`(正文/标题) · `bold` · `italic` · `unorderedList` · `orderedList` · `taskList` · `quote` · `hr` ·
     `image` · `note-file`。白名单外不给入口；**已有小记里的超范围内容**（表格/代码块/自定义卡）在卡片里降级成
     占位条、保存时**原文原样保留**（不改写、不丢）。
   - **新增**：`src/features/quickNotes/quickNotePreviewParser.ts`（把内核产出的正文解析成块/行内节点，
     零内核实例、纯字符串解析）+ `src/features/quickNotes/QuickNotePreview.tsx`（渲染，媒体按 MIME 就地渲染）
     + 卡片接上（`QuickNotesWorkspace` 的 `QuickNoteCard`）。解析器的 fixture **全部取自真实内核输出**。
   - **实测**：用户那条 7 项待办的小记，卡片里现在显示**真复选框**（以前只能看到纯文本）+ 图片 ✓；
     段落/标题/有序无序/引用/分割线/行内格式同理。
   - **数据格式未变**：`body` 仍是内核产出的 lake 标记 ⇒ 不需要迁移，「小记 → 正式文档」仍是搬运 + 作用域改写。
   - 门禁：`tsc` 0 · `vitest` **1048 passed / 16 skipped** · 桌面 + 移动 build 全绿 ·
     `check:bundle` app-js 1.82MB/2.90MB · `check:core` 0 · `git diff --check` 干净。
8. **第六轮（用户 260919 定稿：小记编辑态直接复用文档页外观，只收入口）**：
   - **决策**：既然编辑态本来就挂内核 ⇒ 外观/手感**与文档页完全一致**（挂载点仍是 `ne-doc-major-editor`，
     不再有 note 版式 / 展开按钮 / note 专用图标那一套）；只把「预览显示不了的」从**两个入口**收掉。
   - **两处裁剪（仅小记，`restrictedFormats: true`）**：
     ① 工具栏 `toolbar.agentConfig.default.items` = 白名单
        `cardSelect · undo · redo · style · bold · italic · underline · unorderedList · orderedList · taskList · quote · hr · link`；
     ② 「+」面板用内核官方钩子 `slash.filterOption` → `filterQuickNoteInsert`（新模块
        `src/features/quickNotes/quickNoteInsertFilter.ts`，按 `mainSearch` 前缀 + 中文 label 兜底，
        隐藏表格/代码块/公式/画板/思维导图/日历/折叠块/第三方服务等）。
     ⚠️ **卡片注册照旧全量**（`customCard` 不动）：否则已有小记里的表格/自定义卡一进编辑就会被内核丢弃（§5.8 的坑）。
   - **不影响文档**（用户明确要求）：`restrictedFormats` 只由 `QuickNoteEditor` 传；文档编辑器不加任何 option。
     实测：小记编辑器工具条 **14** 个按钮，文档编辑器仍是内核默认 **27** 个 ✓。
   - 删掉的东西（本轮简化）：`uiSwitch`/`fullscreen` note 版式、`ensureNoteFileIcon`（附件按钮不再单独放）、
     `installAttachmentTypeRouting`（附件/视频/音频改由「+」面板各条目走内核原生路径）、`editorMode` 双版式。
   - 数据零影响：`.qnote` 仍是 `quick-notes/` 独立空间里的 lake 形态正文，与文档存储/同步完全分离。
   - 门禁：`tsc` 0 · `vitest` **1053 passed / 16 skipped** · 桌面 + 移动 build 全绿 ·
     `check:bundle` app-js 1.83MB/2.90MB · `check:core` 0 · `git diff --check` 干净。
9. **第七轮（用户 260919 再定稿：小卡片最小工具条 + 展开用完整工具栏）**：
   - **小卡片（未展开）**工具条 = `QUICK_NOTE_TOOLBAR_ITEMS` = **图片 · 待办 · 有序列表 · 无序列表 · 分割线**
     （实测 6 个按钮，含有序列表的下拉箭头）。
   - **展开（fullscreen，同一实例切 UI）** = **完整工具栏**（`DEFAULT_TOOLBAR_ITEMS` 逐字等于内核默认 `xP`，
     实测 27 个按钮，与文档页一致）；收起回到最小工具条。
   - **「+」插入面板**：两种状态都由 `filterQuickNoteInsert` 收成白名单（唯一受"预览不支持"约束的入口）。
   - ⚠️ **已知取舍（要跟用户对齐）**：展开态完整工具栏里的 **字号 / 颜色 / 背景 / 对齐 / 行高 / 删除线 /
     缩进 / 素材库 / 大纲** 这些，卡片预览还原不了（内容不丢，只是卡片里看不到这些样式）——用户口径是
     「除了 + 号里的内容都可以实现预览」，实际这几项不在预览覆盖内；要收掉随时说。
   - 另：图片/待办用标准项 `image` / `taskList`（note 专用图标是语雀私有 symbol，本地会空白）。
   - 门禁：`tsc` 0 · `vitest` **1053 passed / 16 skipped** · 桌面 + 移动 build 全绿 ·
     `check:bundle` app-js 1.83MB/2.90MB · `check:core` 0 · `git diff --check` 干净。
10. **第八轮（用户 260919 四条反馈）**：
   - **#4 全屏错乱（真 bug，已修）**：内核 `.ne-ui-fullscreen` 是 `position:fixed;inset:0;z-index:1000`
     （"无外壳编辑器"口径）⇒ 在小记里展开会盖住红绿灯/顶栏/侧栏，且退出按钮落在窗口右上角、难以收起。
     修法（`src/styles/app/quick-notes.css`）：`.quick-notes-pane` 加 `position: relative`，
     把 `.lake-editor-mount.ne-ui-fullscreen` 限定为**面板内绝对定位**（`inset:0; z-index:30`），
     `.ne-ui-exit-fullscreen` 随之改为面板内右上角（`absolute; top/right:6px`）。实测：展开后顶栏/红绿灯可见、
     退出按钮可点、收起回到小卡片 ✓（与文档侧 `.ne-ui-max-view` 的适配同款）。
   - **#2 展开态每一项都要能预览（已做）**：新增这些格式的解析与渲染（fixture 全部取自真实内核输出）：
     删除线 `<del>`、字号 `class="lake-fontsize-N"`、颜色/背景 `style="color|background-color: …"`（可嵌套）、
     对齐 `style="text-align: …"`、行高 `class="lake-lineheight-N"`、缩进 `<ul data-lake-indent="N">`（列表左缩进）。
     ⚠️ 仍**不覆盖**：`materialLibrary`（素材库）、`toc`（大纲）→ 在卡片里显示占位条（用户口径：大纲可做可不做）。
   - **#1「不全量注册会不会更省内存」——结论：省不了什么，不建议为省内存摘注册**：
     重模块（mermaid/flowchart/@viz-js/Drawnix）本来就是懒加载或文档侧已加载（进程内共享），
     注册本身只是 class/registry 引用（几十 KB 级/实例），而小记同时只挂 1 个实例。
     **唯一的取舍**是：摘掉注册后，粘贴进来的表格/卡片会在保存时被**静默丢弃**（§5.8 的坑）。
     ⇒ 保持现状（注册全量、"不给插"只做在「+」面板与工具条上）。
   - **#3 移动端复用这套能力**：已记入待办（§3 第 15 条），后期按移动端工具条形态调整。
   - 门禁：`tsc` 0 · `vitest` **1054 passed / 16 skipped** · 桌面 + 移动 build 全绿 ·
     `check:bundle` app-js 1.83MB/2.90MB · `check:core` 0 · `git diff --check` 干净。
11. **第九轮（用户 260919 五条反馈）**：
   - **#1 输入一个字就整片空白 + #2 编辑态顶部大空白 —— 同一根因：小记编辑器没关虚拟渲染。**
     虚拟渲染靠 `scrollNode` 量视口，小记没有 Lake 内部滚动容器（fallback 到 `.document-pane` 会量错）
     ⇒ 正文被换成 `.ne-virtual-render-placeholder`（实测顶部被顶下 190px；一输入触发重渲染就整片变占位）。
     修法：`QuickNoteEditor` 传 `disableVirtualRendering: true`（与移动端当年的同款处置，§8.8）。
     实测：占位节点归零、内容从顶部开始、输入正常落字 ✓。
   - **#4 切换小记总弹「是否放弃编辑」+ 无改动也触发同步 —— 脏判定错了。** 从前 `dirty = hasDraftContent()`
     ⇒ 编辑一条**本来就有内容**的小记 → 永远"脏" ⇒ 切来切去都弹窗、还每次重写正文（`sync_state` 被打回
     `local` → 平白触发 S3）。修法：`DraftState.baseline`（载入时的 text/body/资源数）做**基线比较**；
     切换小记/新建/离开小记页一律**默认保存**（不再弹窗）；保存前若**正文与基线一致**则**直接退出编辑态、
     不发任何 IPC**。实测：编辑→切另一条 → 无弹窗、三条小记的 `updatedAt` 全部未变（未写库、未触发同步）✓。
   - **#3 卡片预览里的待办可点**：解析器给每个待办项带 `checkboxIndex`（正文里第 N 个 checkbox 卡），
     新增纯函数 `toggleTaskInBody(body, index, checked)` 精确翻转那一个卡片值；卡片里点复选框 → 走既有
     `updateQuickNote`（正文/资源/同步链路一致）→ 就地刷新该卡片。实测：点第一项 → 变勾选、正文出现
     `data:true` ✓。用户口径：预览只做这一个交互。
   - **#5 卡片「收起/展开」**：预览超过 220px 自动收起（底部渐变遮罩）+「展开/收起」按钮（复用 `.quick-note-link`
     风格的 `.quick-note-preview-toggle`），ResizeObserver 自动判断是否需要收起。实测：收起 220px / 展开 857px /
     可反复切换 ✓。
   - 门禁：`tsc` 0 · `vitest` **1055 passed / 16 skipped** · 桌面 + 移动 build 全绿 ·
     `check:bundle` app-js 1.83MB/2.90MB · `check:core` 0 · `git diff --check` 干净。
12. **第十轮（用户 260919：列表页对齐云端小记）**：用 browser-skill 观察了 `https://www.yuque.com/dashboard/notes`
    的列表视图后按同款结构补齐 UI（功能全部复用分块视图已有动作，未新增能力）：
    - **标题行**：右侧「**新建小记**」按钮（绿色羽毛 + 号，对齐云端图3）→ 切到右侧编辑器的新建草稿。
    - **筛选行**（对齐云端）：左侧「**标签 ▾ = 全部**」（点击提示"分组功能后期做"）+ 右侧条数/排序；
      按用户口径**标签暂固定「全部」**。
    - **行**：复选框（hover / 选中态 / 批量模式显形，对齐云端）+ 标题 + 时间；hover 出现「⋯」，
      菜单 = **编辑 · 复制文本 · 转为正式笔记 · 删除**（云端那套里我们没有的：置顶/分享/添加标签/归档/
      查看历史/复制链接——「复制链接」按本地语义换成了**复制文本**；**置顶是新增能力，需 pin 标记 + 同步协议，
      本轮未做，等用户决定**）。
    - **批量条**（对齐云端图1）：复选框(全选) + 「N 篇」+ 取消 + 右侧图标动作「转为正式文档 / 批量删除」。
      列表视图不再复用卡片视图顶部那条多选工具（避免两处重复）。
    - 门禁：`tsc` 0 · `vitest` **1055 passed / 16 skipped** · 桌面 + 移动 build 全绿 ·
      `check:bundle` app-js 1.83MB/2.90MB · `check:core` 0 · `git diff --check` 干净。
13. **第十一轮（用户 260919 三条补充）**：
   - **#1 置顶改成纯本地（已实现）+ 代码核查结论**：小记的同步清单只带
     `{id, createdAt, updatedAt, contentHash, isConflict, images}`，**没有任何顺序/置顶字段**；
     排序是各端本机偏好（桌面存 localStorage、移动端按 `updated_at`）⇒ **顺序本来就不跨端**，
     所以置顶**不写 manifest、不进 S3**：存在 `localStorage: lake-notes-v3.quick-notes-pinned`，
     排序时置顶组优先、组内再按所选顺序。行内 ⋯ 菜单加「置顶 / 取消置顶」。实测：置顶某条后它跳到置顶组内 ✓。
   - **#2 列表页右侧直接用文档式完整编辑器**：新增 prefs `quickNoteUi: "card" | "full"`
     （取代原 `restrictedFormats: boolean`）——`card`＝分块视图的小卡片（最小工具条 + 展开）；
     `full`＝列表视图右侧**直接完整工具栏、无展开按钮、文档样式**（实测 27 个按钮，非 note 版式）。
     两者都只收「+」面板白名单、都不挂第二个内核实例（同一时刻只有一个）。
   - **#3 列表行不再横向滚动**：行标题改用主进程已算好的 `previewText` **只取前 10 个字**（+ 省略号，
     并剥掉内核 text/plain 的待办前缀 `[ ]`），不再整段渲染再靠 CSS 省略；索引列加宽到 220–300px，
     `.quick-notes-index` 加 `overflow-x: hidden`。
   - 门禁：`tsc` 0 · `vitest` **1055 passed / 16 skipped** · 桌面 + 移动 build 全绿 ·
     `check:bundle` app-js 1.83MB/2.90MB · `check:core` 0 · `git diff --check` 干净。
14. **第十二轮（用户 260919：列表页点条目打不开 + 弹「请至少记录文字或一张图片」）—— 已修**：
   根因是**空草稿的文本镜像噪声**：内核空文档的 `text/plain` 是 `"\uFEFF\n"`（零宽 BOM + 换行），
    脏判定用字符串全等比较 ⇒ 没动过的新草稿被判成"脏" ⇒ 点列表里某条时先走"切换前保存"
      ⇒ `saveDraft` 又按 `hasDraftContent()`（trim 后为空）判空并**报错 + 中止切换** ⇒ 条目打不开。
    修法两处：① `isDraftDirty` 前先做**去噪归一**（剥 `\uFEFF`/`\u200B` 再 trim）；
    ② 新增 `saveBeforeSwitch()`：**空白草稿直接放行**（不写库、不报错），只有真有内容才走 `saveDraft`；
    三处切换入口（点条目 / 新建小记 / 离开小记页）统一走它。实测：连点三条都正常打开、无报错；
    「打字后切走」仍会正确保存那一篇（`updatedAt` 变化，只动被编辑的那条）✓。
15. **第十三轮（用户 260919 两条微调）**：
   - **列表页进来默认选中第一条**：进列表视图 / 首次加载时若没有正在编辑的小记，自动打开第一条
     （没有小记则保持空态）——这样进来就是「左列表 + 右内容」，不再是一张空白编辑器。
     ⚠️ 副作用：在列表页点「取消」会立刻重新打开同一条（= 放弃改动后回到已保存状态），符合"默认选中"的口径。
   - **去掉列表页右侧编辑器的卡片边框/圆角**（`.quick-notes-detail .quick-note-composer { border:0; border-radius:0; padding:0 }`），
     编辑器直接铺开、更贴近文档页观感（用户要求先看效果，不满意可以一行回退）。
   - 门禁：`tsc` 0 · `vitest` **1055 passed / 16 skipped** · 桌面 + 移动 build 全绿 ·
     `check:bundle` app-js 1.83MB/2.90MB · `check:core` 0 · `git diff --check` 干净。
16. **待用户点验**（真机/真实键鼠）：列表页（新建小记按钮 / 标签行 / 行内复选框与 ⋯ 菜单（含置顶）/ 批量条）、
    列表页点击条目打开与切换、
    列表页右侧的文档式编辑器、
    编辑小记（打字/换行/列表/待办）、切换小记不再弹窗且未改动不写库、卡片预览勾选待办、卡片收起/展开、
    小卡片工具条与展开后的完整工具栏（含收起）、「+」面板、两端版式切换、贴完立刻保存、⌘Enter 发布；
    **顺带确认文档页一切照旧**。
17. **第十四轮（用户 260920：「编辑小记的保存/取消都在角落里太偏僻，优化位置」）—— 已改**：
    截图是**块状视图（小记视图）左侧写作卡展开后**：保存被 `flex:1` 的空白占位顶到卡片最左、取消甩到最右。
    - **动作行按版式分组**（`QuickNoteComposer` + `.quick-note-composer-actions--{pane,inline}`）：
      写作卡（pane）= `[小记一下] [取消] 按 ⌘ Enter 发布｜可拖入或粘贴图片` 靠左成组（取消紧跟主按钮）；
      编辑既有小记（inline）= `[取消] [保存]` 整组靠右下（对话框底栏惯例）。**删掉 `.quick-note-action-spacer`**。
    - **「取消」升为次级描边按钮**（`.quick-note-composer-actions .quick-note-discard`，选择器带父级压过 b3 的
      `.b3-button` 边框）；卡片内编辑补页脚内边距 `.quick-note-entry.editing .quick-note-composer-actions`。
    - **修掉一个连带 bug：展开态点不到保存/取消**。`.ne-ui-fullscreen` 的定位基准（`.quick-notes-pane` /
      卡片 `.quick-note-entry`）**正好就是动作行所在的盒子**，`z-index:30` 把动作行整个盖住 ⇒
      展开后「保存/取消」既看不见也点不到（`elementsFromPoint` 实测命中的是编辑器内部节点）。
      修：`.quick-notes-compose|.quick-notes-detail|.quick-note-entry.editing:has(.ne-ui-fullscreen)`
      下把动作行改成 `position:absolute; right:16px; bottom:14px; z-index:31` 的浮层页脚（展开态提示文案隐去）。
      ⇒ 展开后按钮浮在编辑器右下角，实测可点。`cdp` 实测四种状态：写作卡（常态/展开）、卡片内编辑（常态/展开）、
      列表页右侧编辑器，按钮均可见且可点。
    - 门禁：`tsc` 0 · `vitest` **1055 passed / 16 skipped** · 桌面 + 移动 build 全绿 ·
      `check:bundle` app-js 1.83MB/2.90MB · `check:core` 0 · `git diff --check` 干净；
      CSS 围栏基线 `styles/app/quick-notes.css` 532 → **547**（动作行 +4、展开态浮层 +11）。
18. **第十五轮（用户 260920：先报「列表页第一次打开小记、右侧编辑器左右宽度不适配，换一条就正常」+ 要求本批代码自审）**：
    自审发现并修掉 **4 个真 bug**（都有实测证据），另做了一批整洁化。
    - **① 首次打开宽度错乱（用户报的现象，根因已定位）**：内核的「工具条塞不下就折叠进 ⋯」**只在实例创建时算一次**，
      之后不随容器宽度重算（实测容器 1015px 时 `.ne-ui-toolbar` 内容 1064px、`.ne-editor` 横向溢出 76px；
      容器 0→1015 后不重算，派发 `window resize` 也不重算，只有换条目=重建实例才正常）。
      而小记工作区是 App 的 keep-alive 视图（`display:none` ⇒ **0 宽**），启动时就把列表页的编辑器建出来了 ⇒
      实例按 0 宽度算死布局。**修**：`App.tsx` 已在传 `visible={desktopWorkspace === "quick-notes"}` 的先例，
      现在一路透传到 `QuickNoteEditor.active`，**首次可见后才建内核实例**；且用「见过一次可见」的闩，
      隐藏时**不卸载**（卸载会用陈旧 `initialBody` 重建 ⇒ 丢正在写的正文）。
      实测：冷启动（列表版式）隐藏时 **0 个内核实例**；点开小记 → 工具条 `961/961`、编辑器 `1015/1015`（修前 `961/1064`、`1015/1091`）。
      ⚠️ 同源风险：文档页的隐藏标签（`EditorTab` 用 `display:none`）理论上也可能踩这个坑，本批未动（见 §3 待办）。
    - **② 视频/音频卡在卡片预览里显示「附件（资源缺失）」**：内核卡片 value 的字段名**按卡类型不同** ——
      图片/附件卡 `src`、**视频块卡 `url`**、**音频卡 `audioId`**（=canonical URL）；展示名：附件卡 `name`、音频卡 `fileName`。
      旧解析只读 `src` ⇒ 一条实测小记 9 个资源只认出 1 个。**修**：三字段取一 + 用卡里的原始展示名做文件条文案
      （修后同一 fixture **9/9 命中**，见 `quickNotePreview.test.ts` 新增用例）。
    - **③ 段落里文字与行内卡混排时卡片被整段丢掉**：「先打字、再点图片/附件」产出的正文就是
      `<p><span>文字</span><card image/><card file/></p>`（真实采样），旧实现只在"段落里只有一张卡"时才当媒体渲染
      ⇒ 图片/附件静默消失（用户上一轮「附件卡片展示不对」的另一个真因）。**修**：按卡切分段落，文字与媒体各自成节点。
    - **④ 写作卡的「取消」会误关右侧正在编辑的小记**：`cancelDraft()` 用的是 `activeDraft = editingDraft ?? createDraft`
      （save 路径 260919 已修过同一个坑，cancel 漏了）⇒ 块状视图里点左侧「取消」，被取消的是右边那条。
      **修**：`cancelDraft(draft)` 由点击的那个 composer 传自己那份；顺带清掉该草稿的 staging 登记。
      实测：点左侧取消后卡片仍处于编辑态、卡片草稿 id 不变，写作卡自己换成新草稿 id。
    - **整洁化**：删掉随「卡片预览改自研渲染」废弃的三套 CSS（`.quick-note-image-grid` / `-saved-images` /
      `-saved-media`，含 `b3/dark.css` 里的深色覆盖）与两个未使用 import；`hasDraftContent` 的报错文案与模型口径统一
      （"文字、一张图片或一个附件"）；`waitForPendingUploads` 注释 8s→15s（代码本来就是 15s）。
      CSS 围栏基线：`styles/app/quick-notes.css` 547 → **499**、`b3/dark.css` 55 → **54**。
    - 门禁（本轮改完复跑）：`tsc` 0 · `vitest` **1057 passed / 16 skipped** · 桌面 + 移动 build 全绿 ·
      `check:bundle` app-js 1.83MB/2.90MB · `check:core` 0 · `git diff --check` 干净。
    - **自审里"看到但本批没改"的项（留作待办，见 §3）**：小记附件走 `Array.from(bytes)` 的 number[] IPC（大文件内存/耗时）；
      永久 pending 的媒体卡会让该条小记**无法保存**（等 15s 后报错，弱网/中断场景）；`DEFAULT_TOOLBAR_ITEMS` 是内核默认的硬拷贝
      （内核升级会静默漂移）；「+」面板白名单只有代码级证据（本机合成点击打不开内核面板，未做 UI 实测）；
      展开态工具栏的「…」溢出菜单仍可能给出表格/代码块等插入入口（用户只要求收「+」面板）。
19. **第十六轮（用户 260920 逐条回复上轮自审 + 报「附件没转成视频卡」「展开后 UI 乱」）**：
    - **① 附件按类型成卡：小记漏挂路由（真 bug，已修）**。内核「附件」路径是
      `insertFiles(files,{from:'ui',category:'file'})` ⇒ 一律 file 卡；按类型分发（音频/视频/图片 → 原生卡）
      的路由 `src/features/editor/mediaCardRouting.ts` **文档侧与移动端各自装了，小记这套新编辑器当时漏挂**
      ⇒ 小记里 mp4 只是附件条，而卡片预览按 MIME 渲染出可播放视频（用户截图 1 vs 2 的不一致根因）。
      修：`QuickNoteEditor` 里 `installMediaCardCategoryRouter(editor)` + 卸载 detach。
      **实测**（小记编辑器内直接走附件路径 `insertFiles(...,{category:'file'})`）：mp4→`video` 卡、mp3→`audio` 卡、
      png→`image` 卡、pdf→`file` 卡 ✓（用户截图里那条老小记的附件是**修前**写进去的 file 卡，不会自动改写）。
    - **② IPC 传字节不再 `Array.from`（真问题，已修）**：`saveResource` 收到的 `input.bytes` 本就是 `Uint8Array`，
      早前沿用旧图片路径转成了 `number[]` ⇒ 附件上限 100MiB 时凭空多出几百 MB 的 JS 数组。
      现原样走结构化克隆；`QuickNoteStageInput` / `QuickNoteImageInput` / IPC 校验都改成「`Uint8Array` 或 `number[]`」
      （移动端 HTTP JSON 仍是数组，两条路都通）。
    - **③ 工具条入口再收两个（用户「5 也需要收一下」）**：小记展开态工具条 = 内核默认项 **减去 `toc` / `materialLibrary`**
      （`QUICK_NOTE_FULL_TOOLBAR_ITEMS`）——这两个能往正文插预览还原不了的块。核对过：工具栏的「…」溢出菜单
      `content: props.widgets` 就是同一批 items（bundle 实测），所以从 items 去掉，溢出里同时消失；文档页不受影响。
    - **④ 分块视图「卡片展开」UI 乱（真 bug，已修）**：`.ne-ui-fullscreen` 是 `position:absolute; inset:0`，
      而卡片 `.quick-note-entry` 是 `position:relative` ⇒ 展开只覆盖卡片那一小块（793×274），工具条挤成溢出、
      页脚动作行压正文（用户截图 3）。修：展开期间 `.quick-note-entry.editing:has(.ne-ui-fullscreen){position:static}`
      ⇒ 展开层 + 页脚都落到小记面板（1375×810 实测），工具条 `1285/1285` 不再溢出，右下角「取消/保存」浮层不压内容。
    - **⑤ 用户对"内核默认工具栏硬拷贝"表示接受**（漂移 = 跟着内核升级对齐，不算问题）⇒ 不改，本轮只补注释说明。
    - **⑥ 文档页隐藏标签的"0 宽创建"风险：实测当前不可达**。`EditorTab` 确实用 `display:none` 隐藏非活动标签、
      且它的补丁只在可见时做 hydration（`requestCardHydration` / codeblock heal），**不重算工具条布局**；
      但文档标签只在**打开时**创建（那一刻就是活动的），重启只会恢复**当前活动标签**（实测：5 个标签重启后只剩活动那个）
      ⇒ 现状不会出现"隐藏里创建"。**若以后加"后台打开标签 / 全量恢复标签"，必须照小记这样加可见性闩**，
      否则会复现同款工具条/布局错乱。
    - 门禁（本轮）：`tsc` 0 · `vitest` **1061 passed / 16 skipped** · 桌面 + 移动 build 全绿 ·
      `check:bundle` app-js 1.83MB/2.90MB · `check:core` 0 · `git diff --check` 干净；
      CSS 围栏基线 `styles/app/quick-notes.css` 499 → **507**。
20. **第十七轮（用户 260920：附件路由对齐文档 + 报「点保存反复闪、退不出去」）**：
    - **① 附件按类型成卡：文档侧本来就是这套逻辑**（`EditorTab` 装 `installMediaCardCategoryRouter`，移动端同款实现），
      小记上一轮已改成**复用它**（同一个模块，不是另写一套）⇒ 这条不需要再动。
    - **② 点保存反复闪、退不出去（真 bug，已修）**：**只在列表视图**出现。`saveDraft` 存成功后关掉编辑态，
      而列表视图的"默认选中第一条"兜底（用户 260919 要求）立刻又把该条重新打开 ⇒ **两次提交 = 连拆两次内核编辑器**
      （先换回"新建小记"面板、再重开该条）⇒ DOM 变更实测 **103 次**，肉眼一闪一闪且看起来"保存退不出去"。
      修法：列表视图保存后**留在编辑器里**（云端语义：右侧始终是打开的那条），只把基线刷成刚存下的内容 ——
      统一收口到 `settleAfterSave()`（⚠️ **"没改动不写库"的早退分支也必须走它**：第一版只改了真保存那条，实测仍在闪）；
      取消同理：列表视图**原地重开**该条（一次提交）。实测：保存 DOM 变更 **103 → 7/8 次**、草稿 id 不变；
      再点一次保存 `updatedAt` 不变（没改动不写库）；分块视图保存仍照旧关闭编辑态（回归通过）。
    - **③ 展开态下的反馈被展开层盖住（真隐患，已修）**：错误条/提示条是面板里的普通流内容，而展开层铺满面板且
      `z-index:30` ⇒ 一旦保存失败，用户只看到按钮闪、看不到原因。修：展开态把 `.quick-notes-error` / `.quick-notes-hint`
      抬到 `z-index:32`，并改成贴面板左下角的浮层（与右下角动作行成一对）。
    - **⚠️ 本轮踩的坑（写下来别再犯）**：① **`window.lakeNative`（contextBridge）对象是冻结的**，
      `bridge.xxx = ...` 静默失败 ⇒ 想"注入失败"做实验时执行的是**真实保存**，把测试字写进了用户小记
      （已用同一套 IPC 精确回滚：删掉插入的 `<span>Z</span>` + 还原 text，三份资源与正文逐字核对一致）。
      要造失败场景请走真实路径（超限/断网）或临时改渲染层代码。② dev 实例是**用户与自动化共用**的：
      在同一实例上跑 CDP 点击会污染用户的操作与录屏（用户 01:16 的 gif 里"视图来回切换"就是我点击造成的）——
      只读排查没问题，**会点 UI 的实验要先和用户错开**。
21. **第十八轮（用户 260920 回：「没报错，还是闪烁无法保存，连取消都取消不了了」）—— 真凶找到并修掉**：
    - 上一轮修的"列表视图保存后连拆两次编辑器"是真问题，但**不是**用户看到的那一条。这轮从**日志**里抓到关键证据：
      `~/Library/Application Support/lake-notes-dev/logs/lake-notes.log`（以及 dev 终端）在 01:25:19–01:25:30 连续出现
      **20+ 条** `Uncaught TypeError: Cannot read properties of undefined (reading 'undo'/'redo'/…/'hr'/'slash')`，
      **每个工具项一条**。
    - 根因（内核行为）：hotkey 插件 `destroy()` 里 `delete this._named`（bundle ~154560），而工具条按钮渲染时必调
      `getTooltip → renderer.getHotKeyByName(name) → this._named[name]`（~112132 / ~154613）⇒ **实例销毁后再渲染一次**
      就抛错；且插件先于 hub 销毁 ⇒ `hasExtendMethod("getHotKeyByName")` 仍为 true ⇒ 每次渲染都再抛一次。
      这是 **React 渲染期抛错**：整棵工具条→整个小记面板崩掉并反复重试 ⇒ 用户看到"面板反复闪 + 保存/取消/取消都点不动"。
      我们的生命周期里"销毁旧实例 + 重建"是常态（切草稿/换条目/保存后重建），所以很容易踩到。
    - **修法**：`createLakeDocument` 里对每个实例装 `hardenDestroyedHotKeyLookup(editor)` —— 给
      `renderer.getHotKeyByName` 包一层 `try/catch → null`（迟到的渲染只丢一个快捷键提示，不再炸 UI）。
      挂在共用入口而不是只挂小记：文档侧同样有销毁/重建路径。
    - **实测**：脚本化压力（列表视图连续 保存→取消→换条目 ×5）错误数 **41 → 0**；分块视图（编辑→展开→保存→编辑→取消 ×4）
      也是 **0**，面板全程存活、保存/取消都生效。日志里那串错误是**每条工具项一条**，以后排查"闪+按钮失灵"先看这个特征。
22. **第十九轮（用户 260920 补全复现路径：「块状小记 → 编辑 → 右上角全屏 → 点保存/取消」；这才定位到真凶）**：
    - 前面两轮（列表视图连拆两次编辑器 / 热键补丁）都是**真问题但不是这条**。这轮按用户路径逐步采样，抓到决定性证据：
      **真鼠标**点「保存」时 `mousedown` 落在按钮上、`mouseup` 时同一点已经变成卡片（`click` 派发到共同祖先
      `quick-notes-timeline`，按钮 onClick 永不触发）；逐帧采样显示展开层高度 **810 → 约 220 → 810**（约 150ms）。
    - **真凶（CSS 规范级）**：`.ne-ui-fullscreen` 是 `position:absolute; inset:0`，按最近定位祖先定位；而
      **`transform` 会让元素成为绝对定位后代的定位基准**（即使 `position:static`）。我们卡片有按压缩放
      `src/styles/quick-notes.css` 的 `.quick-note-entry:active{transform:scale(.98)}` ⇒ **按下鼠标那一瞬**
      卡片成了定位基准 ⇒ 展开层塌回卡片大小、鼠标下的按钮跑掉 ⇒ 真鼠标点不动 + 面板闪。
      实测抖动帧里卡片 computed transform = `matrix(0.992536, ...)`，`classList` 钩子显示 fullscreen 类**根本没被切换**。
    - **修法**：编辑态卡片禁止按压缩放（`.quick-note-entry.editing, .quick-note-entry.editing:active { transform: none }`）。
    - **实测（全部真鼠标 CDP 事件）**：块状小记→编辑→全屏→点保存：`clickHandlerFired=1`、`editing=false`、回到卡片列表 ✓；
      点取消：`cancelHandlerFired=1`、`editing=false`、卡片数与内容不变 ✓；帧采样 406 帧只有**一个**稳定状态（不再抖）；
      列表视图真鼠标点保存/取消：草稿 id 分别**不变**（原地留存）/换新（原地重开），均无报错 ✓。
    - **教训（写给下个会话）**：① **合成 `.click()` 绕过命中测试** —— 任何"点了没反应"的问题必须用真鼠标事件
      （`Input.dispatchMouseEvent`）复现，否则会误判成"已修好"；② 自定义 UI 贴在内核展开层旁边时，先量**祖先的
      computed transform/filter/perspective/contain**；③ 逐帧采样（rAF）+ `elementFromPoint` 对比 mousedown/mouseup
      是定位这类"按钮从鼠标下跑掉"的最快手段。
23. **第二十轮（用户 260920：「永久 pending 我给了方案了，看文档那边怎么做的，复用就行」）—— 已按文档口径重写保存策略**：
    - **先查文档侧**：`useWorkspaceState` / `EditorTab` / `MultiTabEditor` 里**没有任何 pending/uploading 判断**（命中的
      `pendingChanges`/`pendingDispose`/`heal.pending` 都与上传无关）⇒ **文档保存从不因为"卡还在上传中"而等待或拒绝**，
      正文原样存下（两阶段卡：内核先落 `status:"pending"` + `url:null`，上传完再回填）。
    - **小记改法**（`saveDraft` 三处）：
      ① 只有**本会话真的在传**（`pendingUploadsRef.current > 0`）才等上传落地（最多 15s），等不到也**不再拒绝**、只提示；
      ② 正文里有 pending 卡：有上传在传→等满；没有在传→只在"**刚上传完 2s 内**"等 1.2s 收尾窗口
      （`lastUploadSettledAtRef`，覆盖"内核回填 url"那几十毫秒，防止把 `url:null` 写进正文 = 260919 那个"一编辑就消失"复发），
      否则**直接存**；存完若卡仍是 pending → `setViewHint("有媒体还没上传完，已按当前内容保存")`（**不再 return false**）；
      ③ 暂存文件没落进正文同理：只提示"有 N 个附件还没落到正文，已按当前内容保存"，不再拒绝保存。
    - **实测**（造一条带 pending 死卡的小记，`createQuickNote` 直接写 `status:pending/url:null` 的 video 卡）：
      点保存 → **编辑器正常退出**（原来会卡死在编辑器里出不来）、耗时 ~1s（不再是 15s 阻塞）、
      提示 `有媒体还没上传完，已按当前内容保存`、**卡片原样保留**（与文档一致）、零报错；用完已删掉该测试小记。
    - **测试环境坑（写下来）**：窗口在后台时 `document.visibilityState === "hidden"` ⇒ Chromium **丢弃 CDP 合成鼠标输入**
      并节流 rAF（document 级监听一个事件都收不到）。所以"真鼠标点击没反应"必须**先确认窗口在前台**
      （本会话就因此误判过一次）；验证保存策略本身可以用 DOM `.click()`，但验证命中/几何必须真鼠标 + 前台窗口。

**四、交接要点**

- 小记版式的机制与两个坑：`docs/LAKEX-CONTRACT.md` **§5.11**（改这块前先读）。
- 判据（note 版式是否真生效）：`.ne-editor` 有 `ne-note-ui` + `.ne-ui-enter-fullscreen` 有子节点 +
  工具条 `data-toolbar-name="note"`；任一不满足 = `document.ready` 没来或 toolbar 配置被整体替换。
- **别用** note 专用图标项（`note-image` / `notetaskList` / `note-file`）：语雀 App 私有 symbol，本地渲染为空白按钮。
- `note-file`（附件）**必须用**（file 插件没有别的工具项）⇒ 用 `ensureNoteFileIcon()` 自补 symbol；
  改工具条后先看 `.ne-ui-toolbar[data-toolbar-name="note"]` 里每个按钮的 `<use href>` 是否命中 symbol。

---

## 2.11 本会话总交接（260920 · 小记内核化收尾：附件路由 / 预览保真 / 展开层与保存策略）——新会话从这里读

> **给零上下文的新会话**：先读本段的「一 ~ 五」，需要细节再回 §2.10 / §2.10 续做 / §5.11 / §5.12。
> 本会话所有改动**已提交并推送到 origin/master**（见 §六 的 commit 记录）。

### 一、任务目标（用户口径，原话要点）

1. **小记（Quick Notes）底层换用 Lake 内核**，功能仿照语雀云端小记（`https://www.yuque.com/dashboard/notes`）：
   - **默认是一小块写作卡**（图片 · 待办 · 有序 · 无序 · 分割线），**也能展开成完整 Lake 编辑器**做完整功能；
   - 列表视图右侧**直接复用文档样式的完整编辑器**（不挂小框、也不每卡一个内核实例）；
   - 上传附件要**接入"附件按类型成卡"的能力**：视频→视频卡、音频→音频卡、图片→图片卡，其它保持附件卡（**对齐文档侧**）。
2. **不做标签/分组，不额外增加功能**；只把我们已有的功能对齐样式与细节。
3. **绝对不能影响文档**；小记数据独立存放（`quick-notes/` 前缀 + `.qnote`），顺序/置顶等展示偏好只存本机 localStorage、不进 S3。

### 二、已完成（本会话与上一段 §2.10 续做合起来的最终形态）

**A. 编辑态（内核）**
- 小记编辑器 = **Lake 文档编辑器外观**（同一套内核），只用**两个白名单**收窄入口：
  小卡片工具条 `QUICK_NOTE_TOOLBAR_ITEMS`（图片/待办/有序/无序/分割线）；「+」插入面板 `slash.filterOption = filterQuickNoteInsert`
  （`src/features/quickNotes/quickNoteInsertFilter.ts`）。**卡片注册保持全量**（摘了会让老内容里的表格/自定义卡一编辑就被内核丢弃，见 §5.8）。
- 列表视图的编辑器直接用**完整默认工具栏**；展开态工具栏 = 内核默认项**减去 `toc`/`materialLibrary`**
  （`QUICK_NOTE_FULL_TOOLBAR_ITEMS`，这两个能插预览还原不了的块；「…」溢出菜单就是同一批 items，收 items 即收它）。
- 展开 = 内核 fullscreen：限定在小记面板内（`position:absolute; inset:0; z-index:30`），退出按钮在面板右上角；
  分块视图的**编辑卡片常驻 `position:static`**（否则展开层只覆盖卡片那一小块）+ **编辑态禁止按压缩放**（见坑 3）。
- 展开态把「取消/保存」浮层（z-index 31）与错误/提示条浮层（z-index 32）都抬到展开层之上，贴面板右下/左下角。
- **隐藏视图不建内核实例**：`App.tsx` 的 `visible={desktopWorkspace === "quick-notes"}` → `DesktopQuickNotes` → `QuickNotesWorkspace`
  → `QuickNoteComposer.active` → `QuickNoteEditor`（`everActive` 闩：首次可见后建实例，之后隐藏不销毁）。

**B. 卡片预览（自研只读渲染，零内核实例）**
- `src/features/quickNotes/quickNotePreviewParser.ts` + `QuickNotePreview.tsx`：按 `body` 解析白名单块
  （段落/标题 H1-H6/有序无序列表/待办/引用/分割线/行内格式：加粗·斜体·下划线·删除线·行内代码·链接·字号·颜色·背景·对齐·行高·缩进/媒体卡）。
  白名单外的块显示占位条；**绝不改写原文**。
- 媒体卡字段**按卡类型不同**：图片/附件 `src`、**视频块卡 `url`**、**音频卡 `audioId`**；展示名 `name`/`fileName`（坑 6）。
- 行内媒体卡常与文字同段（`splitParagraphCards` 按卡切开，历史 bug：整段被丢）；超长卡片默认收起 220px + 「展开/收起」；
  图片点击放大（复用 Lightbox）；**待办可点**（`toggleTaskInBody` 精确翻转正文里第 N 个 checkbox 卡）。

**C. 附件链路**
- **附件按类型成卡**：小记编辑器挂 `installMediaCardCategoryRouter(editor)`（与文档 `EditorTab`、移动端**同一个模块**，本轮只是把漏挂补上）。
  实测：mp4→`video` 卡、mp3→`audio` 卡、png→`image` 卡、pdf→`file` 卡。
- 附件与图片共用 staging/promote：`stageQuickNoteFile`（附件，协议上限 100MiB、宽高 null）与 `stageQuickNoteImage`（图片，25MiB、走 sharp 校验）。
- IPC 传字节统一用 **`Uint8Array`**（`QuickNoteStageInput`；`Array.from(number[])` 会让 100MiB 附件凭空多出几百 MB 数组）；移动端 HTTP 仍传数组，两条路都收。
- 资源清单**以正文引用为准**（`body.includes(filename)`）：补齐"卡已在正文、id 还没到"，并清掉"编辑器里删了卡但清单还在"的幽灵资源。

**D. 数据与保存**
- `.qnote` v2：`{ version:2, text(纯文本镜像), body(内核 lake 标记), images(资源清单，允许非图片/附件宽高 null) }`。
- 保存策略（**本轮按文档侧口径重写**，见坑 7）：只有**本会话真的在传**的上传才等（15s 上限）；正文里若有**历史遗留的 pending 死卡** ⇒ **照存 + 一行提示**，绝不拒绝/锁死编辑器；"刚上传完 2s 内"保留 1.2s 收尾窗口（防把 `url:null` 写进正文）。
- `settleAfterSave`：**列表视图保存后留在编辑器里**（原地刷基线，对齐云端右侧常开）；分块视图保存后关闭回到卡片列表；取消在列表视图＝原地重开该条。
- **没改动就不写库**（与基线比正文 + 资源数）；避免"点开编辑再切走"平白触发 S3。
- 「小记 → 正式文档」= 正文搬运 + 资源作用域改写（`convertQuickNoteToLake`），本轮未回归验证。

**E. 列表视图（对齐云端）**
索引列（标题**只取前 10 字** + 时间）、右侧文档式编辑器、默认选中第一条、标签行固定「全部」、行内 ⋯ 菜单（置顶/取消置顶 · 编辑 · 复制文本 · 转为正式笔记 · 删除）、批量条（全选 + N 篇 + 取消 + 转为正式文档/批量删除）。
置顶**纯本地**（`localStorage: lake-notes-v3.quick-notes-pinned`，顺序不跨端，已核查同步清单只带 `{id,createdAt,updatedAt,contentHash,isConflict,images}`）。

**F. 内核兼容补丁（挂在共用入口 `createLakeDocument`，文档同样受益）**
`hardenDestroyedHotKeyLookup(editor)`：给 `renderer.getHotKeyByName` 包一层 `try/catch → null`（坑 5）。

**G. 文档与测试**
`docs/LAKEX-CONTRACT.md` §5.11（note 版式三件套）与 **§5.12（本轮新增 9 条内核行为坑/口径）**；`docs/QUICK-NOTES-SPEC.md` 更新；
源码级护栏测试 `quickNoteNoteUi.test.ts` / `quickNotesView.test.ts` / `quickNoteInsertFilter.test.ts` + 解析器单测 `quickNotePreview.test.ts` + 主进程 `electron/quickNotes.test.ts`。
门禁（提交前实测）：`tsc` 0 · `vitest` **1065 passed / 16 skipped** · 桌面 + 移动 build 全绿 · `check:bundle` app-js 1.83MB/2.90MB · `check:core` 0 · `git diff --check` 干净。

### 三、当前问题（已知未解决 / 待用户确认）

1. **待用户真机点验（最高优先级）**：块状小记「编辑 → 展开 → 保存/取消」；列表视图保存/取消；四类附件插入（视频/音频/图片/其它）；
   贴完立刻保存；⌘Enter 发布；「小记 → 正式文档」后附件可达；文档页一切照旧。
2. **「+」面板白名单只有代码级证据**：内核插入面板用合成点击打不开，未做 UI 实测（逻辑与文档同源、风险低）——建议用户手点一次确认条目。
3. **死卡（永久 pending）现在"照存 + 提示"，但卡本身仍是坏的**（`url:null`）。若用户要更友好，可考虑保存时把死卡降级为附件条或直接移除（**未做，需用户拍板**）。
4. **移动端（安卓）本轮未跑真机**：类型改动向后兼容，但无实机证据。
5. `DEFAULT_TOOLBAR_ITEMS` 是内核默认工具栏的**硬拷贝**（内核升级不会自动跟）——用户已明确"漂移=跟着内核升级对齐，不算问题"，故保持。
6. 编辑器实例挂/卸的**内存 churn soak**（§3 第 6 条）仍未做量化。

### 四、下一步计划（按优先级）

1. 让用户按 §三.1 逐条点验；有现象就按"是应用问题还是内核行为"分流（内核结论沉淀进 §5.12）。
2. 补「+」面板 UI 实测（或直接问用户点验结果）。
3. 移动端复用同一套（用户口径：按安卓工具栏改，后期做）。
4. 若用户要：死卡处理升级、小记→文档转换回归、展开态「素材库/大纲」是否回归。
5. 把"小记编辑器挂/卸"纳入内存回收专项（churn soak 三条触发面之一）。

### 五、踩过的坑（本会话新增，**最有价值的部分**）

1. **合成 `element.click()` 会骗过验证**：它绕过命中测试 ⇒ "点了没反应"类问题**必须用真鼠标事件**（CDP `Input.dispatchMouseEvent`，本会话脚本 `/tmp/qn.mjs click <selector>`）。
   本会话就是先被它骗过两次（脚本测着"好了"，用户点着没反应）。
2. **窗口在后台时 CDP 合成鼠标输入会被直接丢弃**：`document.visibilityState === "hidden"` 时 document 级监听一个事件都收不到、rAF 也被节流
   ⇒ 验证前先 `Page.bringToFront` + 检查 `visibilityState`。用 DOM `.click()` 可以验证"行为/逻辑"，但**不能**验证命中与几何。
3. **`transform` 会成为绝对定位后代的定位基准（即使 `position:static`）**：卡片的按压缩放 `.quick-note-entry:active{transform:scale(.98)}`
   一按下就把内核展开层的定位基准从面板换成卡片 ⇒ 展开层高度 810 → 约 220、鼠标下的「保存/取消」跑掉 ⇒ 真鼠标点不动 + 面板闪。
   修：`.quick-note-entry.editing, .quick-note-entry.editing:active { transform: none }`。**任何贴在内核展开层/绝对定位层旁边的自定义 UI 都要先查祖先 transform**。
4. **内核工具条溢出布局只在实例创建时算一次**（之后容器变宽/派发 window resize 都不重算）⇒ **隐藏（0 宽）容器里不要创建 Lake 实例**
   （App 的 keep-alive 视图就是 `display:none`）。判据：`.ne-editor.scrollWidth === clientWidth` 且 `.ne-ui-toolbar` 两个值相等。
5. **内核 hotkey 服务在 `destroy()` 里 `delete this._named`**，而工具条每个按钮渲染都会 `getTooltip → renderer.getHotKeyByName(name) → this._named[name]`
   ⇒ 实例销毁后再渲染一次就 **React 渲染期抛错**、整棵工具条/面板崩掉并反复重试（现象：面板闪 + 保存/取消全失灵；
   日志特征：**每个工具项一条** `Uncaught TypeError: Cannot read properties of undefined (reading 'undo'/'slash'/…)`）。
   修：`hardenDestroyedHotKeyLookup`。任何"销毁旧实例并重建"的生命周期都可能踩到。
6. **媒体卡是两阶段的**（先 `status:"pending"`+`url:null`，上传完回填 `url`）⇒ 保存时若不管，会把 `url:null` 写进正文（用户 260919 报的"一编辑视频/附件就消失"）。
7. **文档保存路径里没有任何 pending 检查**（`useWorkspaceState`/`EditorTab` 命中的 `pending*` 与上传无关）⇒ "复用文档口径" = **不等、不拒绝、正文原样存**；
   小记据此改成"只有本会话在传才等，死卡照存 + 提示"。
8. **不要用 `:has(.ne-ui-fullscreen)` 做展开态的条件样式**：内核会在"点击编辑器外部"时**瞬间摘掉再装回** fullscreen 类，
   条件样式随之跳变 ⇒ 布局抖动（这次抖动的表层原因）。需要稳定的布局条件就写成常驻规则（如编辑态卡片恒 `position:static`）。
9. **dev 实例是用户与自动化共用的**：会点 UI 的脚本会污染用户操作与录屏（本会话发生过一次，用户 gif 里的"视图来回切换"就是我的点击）。
   只读排查没问题；**会点 UI 的实验先跟用户错开**。
10. **`window.lakeNative`（contextBridge）对象是冻结的**：`bridge.xxx = ...` 静默失败 ⇒ 想"注入失败"做实验时实际执行的是**真实保存**
    （本会话误把测试字写进用户小记，已用同一套 IPC 精确回滚）。要造失败场景请走真实路径（超限/断网）或临时改渲染层代码。
11. 改 `electron/**` 会触发 vite-plugin-electron **重启 Electron**（可能 9222 端口冲突 / `ERR_CONNECTION_REFUSED` 白屏）：
    别 `pkill -f Electron`，按具体 PID 杀 + 重启 `npm run dev`。

### 六、环境、命令与提交记录

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"   # 必须 Node 24（项目 vitest/vite 要求）
cd /Users/admin/file/local-lake/lake-notes-electron
npm run dev                                                  # vite 1421 + Electron CDP 9222 + asset 19876
npx tsc --noEmit && npx vitest run                           # 门禁 1/2
npx vite build && node node_modules/vite/bin/vite.js build --config vite.mobile.config.ts   # 桌面 + 移动 bundle
npm run check:bundle && npm run check:core && git diff --check
# 小记开发数据：~/Library/Application Support/lake-notes-dev/workspace-default/quick-notes/{items,assets,staging} + metadata.sqlite3
# CDP 走查脚本（临时件，不在仓库）：/tmp/qn.mjs  →  eval / evalfile / shot / click(真鼠标) / reload / prescript-reload / dismiss
```

- 提交记录（已 `git push origin master`，`master == origin/master`）：`e2f0a4d` 代码批（feat(quick-notes)…）、
  `c4d5abc` 本交接（docs(handoff): §2.11），随后一个只补哈希的 docs 小提交（当前 HEAD）。
- 用户红线（沿用）：不擅自 `git commit`（**本批是用户明确要求合并推送**）；开发数据只用 `lake-notes-dev`；只 kill 具体 PID。

---

## 2.12 本会话总交接（260920 · 自研多维表 bitable，9 轮迭代）—— 新会话从这里读

> 写给完全没有上下文的新会话。本会话把「自研多维表（kind=bitable）」从零做到 v1，并按用户多轮真机反馈做了 9 轮打磨。
> 状态：分支 feat/bitable，**未提交、未合 master**（红线：代码批次需用户验收，不擅自 commit/merge）。基于 master 79e4d0d。
> 产品口径 = docs/BITABLE-PRODUCT-SPEC-260919.md（用户定义的「完成」判据）；技术设计 = docs/SHEET-BITABLE-DESIGN-260918.md §3.2/§6.2/§7。

### 一、任务目标（原始目标 + 历轮追加，均已实现）
1. 自研多维表 kind=bitable，对齐语雀云端「数据表」；形态参考钉钉：**一个文档 = 多张数据表**（为后期多表联合预留）。
2. v1 视图 = 表格视图 + 表单视图；7 种字段（文本 / 数字 / 单选 / 多选 / 日期 / 图片和附件 / 关联占位）；字段必填 + 默认值；视图级筛选 / 排序 / 行高 / 隐藏列 / 列顺序 / 列宽；记录增删改 + 记录详情抽屉；附件走资产管线；移动端只读占位；搜索走 searchTextFor 抽文本。
3. 历轮追加（用户真机反馈，都已做）：横向滚动可用；文本单元格「扩大」按钮 + 贴单元格可拖动/缩放的全文本浮窗；严格对齐云端观感（索引列、网格线、表头、行 hover、批量选择、右键菜单、行手柄拖拽、数据表列表可调可收、顶栏快速切换、去非 doc 面包屑）；列选择、列宽拖拽、单元格范围选择 + 复制粘贴、自研日期选择器、视图标签拖拽排序；选项颜色（默认给色 + hover 色卡 + 选项拖拽排序）；行号默认只显示序号、hover 才出多选框（居中覆盖序号）；筛选/排序等一律自研下拉；附件打开与文档侧统一并公共化。

### 二、已完成（按层）
**A. 数据层 src/core/bitableDoc.ts（纯核心、可单测）**
- BitableDoc = { kind:"bitable", version:1, tables[], activeTableId }；BitableTable = { fields, records, views, activeViewId }。
- 字段类型开放字符串（未知类型只读展示、不清空）；值按 fieldId 存；附件存 filename 数组。
- 工厂 + parseBitableBody（归一化）+ bitablesToBody + bitableToSearchText + orderedTableFields / applyViewToRecords / evaluateFilter / defaultRecordValues。
- 选项调色板 BITABLE_OPTION_PALETTE（18 色 hex）+ optionColorHex / optionChipStyle（兼容旧 gray/blue 命名色键）。
- 单测 src/core/bitableDoc.test.ts（往返、非法、未知类型、搜索、视图求值、默认值、附件 refs 提取）。

**B. 主进程 / 协议**
- electron/store.ts：createBitableIn + bodyPathFor 含 bitables/ 路径 + **构造时 mkdir bitables/** + searchTextFor 分派 bitableToSearchText。
- electron/historyLifecycle.ts：restoreHistory 搜索缓存改为按 kind 分派（ctx.deriveSearchText → Store.searchTextFor），修掉「非 doc 恢复把 JSON 喂 Lake 解析器」。
- IPC create_bitable_in（electron/ipc/registerNotes.ts）+ preload.cjs + webApiServer + src/lib/native.ts。

**C. 渲染层新建入口**
- src/hooks/useNoteLifecycle.ts::createBitableIn；useTreeActions 支持 "bitable"；App.tsx 装配；Sidebar 右键「新建数据表」（Database 图标）+ 行图标按 kind 区分。

**D. 编辑器 src/features/bitable/**
- MultiTabEditor 按 tab.kind 懒加载 BitableEditor（与 SheetEditor 同一错误边界隔离）。
- BitableEditor.tsx（多数据表左栏 + 视图标签 + 工具栏 + 网格 + 记录详情抽屉 + 表单视图 + 字段编辑器）、bitableCells.tsx（Popover / SelectMenu / OptionPicker / CellEditor / AttachmentCell / DatePicker / ColorPalette / TextExpandPopover）、BitableRecordDrawer.tsx、BitableFormView.tsx、bitableEditor.css。
- 只读（回收站/锁定/他端删除）禁用编辑 + 不自动保存；自动保存 800ms 防抖 + 与上次序列化比较（不打开即标脏）。
- 视图配置：筛选 / 排序 / 行高（低中高）/ 隐藏列 / 列宽 / 列顺序（视图级 fieldOrder）都在视图上。
- 交互：行手柄拖拽排序（指针式）、列宽拖拽、列选择、单元格范围选择 + 复制粘贴（TSV）、多数据表拖拽排序、数据表列表可拖宽（140–420）+ 完全收起（顶栏展开 + 名称下拉切换）、视图标签拖拽排序、右键行菜单（复制/粘贴/删除）。
- 文本单元格「扩大」按钮 + 贴单元格浮窗（可拖动/缩放、编辑回写并持久化）。
- 索引列：默认只显示序号、hover 出多选框（居中覆盖序号）+ 行手柄；表头保留全选。

**E. 公共化（第九轮）**
- 新增 src/features/attachment/openAssetEntry.ts = 统一附件打开入口：图片→应用内 Lightbox；音视频→内嵌预览；其它→系统默认应用（directOpen:false 时→信息预览层）。
- EditorTab / LakeEditor / BitableEditor 三处重复的「按类型分流」已全部收敛到它；内核 DOM/fiber 卡片解析（resolveCardAsset / attachFileCardClick）仍留文档侧，不公共化。
- 多维表内挂同一套 ImageLightbox / AttachmentPreview 单例。

**F. 测试 / 文档**
- src/features/bitable/bitableEditorMount.test.ts（路由、不碰 Lake 内核、多表、只读、防抖、各轮对齐点的源码级护栏）。
- src/features/attachment/openAssetEntry.test.ts（4 条分流）。
- electron/store.test.ts（新建多维表；多维表 restoreHistory 搜索缓存）。
- docs/STORAGE-LAYERS.md 补 bitables/ 正文层与 ManifestNote.kind。

### 三、门禁（最近一次实测，全绿）
tsc 0 · vitest 1095 passed / 16 skipped (1111) · 桌面 + 移动 vite build 全绿 · check:bundle app-js gzip 1.826MB / 2.90MB · check:core 0 · git diff --check 干净。
懒加载分包：BitableEditor-*.js ≈ 45KB raw + 14KB CSS，不在首屏 index chunk。

### 四、真机点验（已做多轮，隔离 userData + CDP，全部通过）
起法：LAKE_USER_DATA=$TMPDIR/lake-bitable-smoke LAKE_ASSET_PORT=19879 npm run dev（独立于 lake-notes-dev；跑完按端口 kill 具体 PID 并 rm 临时目录，真实数据未被读写）。
- 主干 12/12：右键新建数据表→目录出现 + 打开的是多维表编辑器（无可见 Lake 编辑器）；默认 1 表 3 字段；文本编辑持久化；新增附件字段；附件真实上传落 note-assets 并写入正文；落盘 kind=bitable。
- 视图/记录 21/21：多表切换（activeTableId）、行高持久化、筛选/排序持久化、记录详情抽屉、表单提交、多表拖拽排序。
- 横向滚动 + 文本扩大浮窗通过；云端对齐两批通过（网格线、无批量浮条 + 底部状态、右键删除、行手柄拖拽、表名去边框、数据表列表收起 + 顶栏切换、列选择/列宽/范围复制/日期选择器/视图拖拽）；选项色卡/拖拽/行号 hover 覆盖序号通过；附件打开（图片 Lightbox / 音频内嵌）通过；附件公共化后复测 6/6，行为不变。
- 脚本（临时件，未入库）：/tmp/bitable-smoke5/7/8/9/10/11/12/13.mjs；截图 /tmp/lake-bitable-smoke-evidence/*.png。

### 五、当前问题（已知缺口 / 未测）
1. **AB 多端 S3 同步往返 sha256 未测**：正文/附件走既有同步管线（对象内容寻址 + manifest.kind），但没跑过 A→B 跨端；「附件他端可达」同属此项。
2. Excel 导入导出、新版小记：用户点名「回头一起测」。
3. 单元格范围复制/粘贴只覆盖 text/number/date/select/multiSelect（select 按选项名匹配）；attachment/relation 未纳入。
4. 列选择目前只高亮，未做「整列批量操作」菜单。
5. 表单「新增题目」只能从已有字段勾选，不能在建表单时新建字段。
6. 代码未提交（分支 feat/bitable）。

### 六、下一步计划（按优先级）
1. 用户真机验收本会话全部改动；有问题按现象定位（多为 CSS/交互细节）。
2. 跑 AB 多端同步（建议照 electron/sync.integration.test.ts 用两个 store/桶，或起 A/B 双实例），确认：kind 往返、正文 sha256 不变、附件可下载、搜索无 JSON 碎片。
3. Excel 导入导出 + 新版小记 一起测。
4. 可选补齐：范围粘贴纳入 attachment/relation；列选择批量操作；表单内新建字段。
5. 验收通过后再提交（不擅自合 master）。

### 七、踩过的坑（本会话，务必记住）
- **新建 kind 正文目录必须显式建**：只改 bodyPathFor 不够；store 构造里要 mkdir sheets/ 与 bitables/，否则 createBitableIn 写盘 ENOENT。
- **create* 返回的 NoteDocument 不带 kind**：新建入口（useNoteLifecycle）必须显式给 OpenTab.kind，否则退回 Lake 编辑器（打开已有文档走 useTabLifecycle，读 note.kind）。
- **CSS 围栏 src/styles/cssLayers.test.ts**：新增文件要加进 FILES + BASELINE 实测值；**同一文件里同 (选择器,属性) 出现 ≥2 次会算重复组** —— 别用「文件末尾追加覆盖」改样式，要改原规则（本会话踩过一次，追加覆盖导致 6 个重复组）。
- **.tab-panels 是 grid**：面板宽被子元素内容撑宽（实测到 2985px，grid 永不横向滚动）；根修 = .tab-panels 加 grid-template-columns:minmax(0,1fr) + 面板 min-width:0 / width:100% / overflow:hidden。
- **td 改 display:flex 会失去表格拉伸**：行号单元格因此只有 22px（比同行 32px 矮一半）；要显式 height:var(--bt-row-h)。
- **组件里别用 window.lakeNative 直调**（无类型）；用 src/lib/native.ts 的 native.*。
- **历史恢复也要按 kind 派生搜索缓存**：historyLifecycle.restoreHistory 原硬编码 lakeHtmlTo*，非 doc 会写坏缓存。
- **资产引用提取是全文本正则**（ASSET_NAME_RE = {13ts}_{8hex}.{ext}）：多维表把附件名存 JSON 字符串里同样被 extractAssetRefs 命中 ⇒ 声明 / GC / 孤儿无需按 kind 分支。
- **CDP 自动化测试**：① 合成 .click() 会绕过命中测试，验证「点了有没有反应」要用真事件；纯 onClick 逻辑用 .click() 可测。② :hover 在窗口非前台时 Input.dispatchMouseEvent(mouseMoved) 不一定生效，别用 hover 断言，改断 CSS 规则存在 + 默认态。③ 弹层 portal 到 body，R.querySelector('.bt-popover ...') 取不到，要用 document 或「最后一个 .bt-popover」。④ 上一轮的隐藏标签/隐藏编辑器会污染选择器，测试要按「新建后的新 tab id」精确作用域，或每次起干净实例。⑤ 窗口失焦时 navigator.clipboard 报 Document is not focused，需 Emulation.setFocusEmulationEnabled。
- **dev 进程会被 exec 会话回收 / 端口残留**：重起前先按端口 kill 具体 PID（lsof -ti），别 pkill -f Electron；测试完 rm 隔离 userData。

### 八、关键文件定位 + 复现命令
- 数据模型 src/core/bitableDoc.ts；编辑器 src/features/bitable/**；公共附件入口 src/features/attachment/openAssetEntry.ts；路由 src/features/editor/MultiTabEditor.tsx；主进程 electron/store.ts（createBitableIn / bodyPathFor / searchTextFor）。
- 产品规范 docs/BITABLE-PRODUCT-SPEC-260919.md；设计 docs/SHEET-BITABLE-DESIGN-260918.md；存储分层 docs/STORAGE-LAYERS.md。
- 门禁：export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"; npx tsc --noEmit; npx vitest run; node node_modules/vite/bin/vite.js build; node node_modules/vite/bin/vite.js build --config vite.mobile.config.ts; npm run check:bundle; npm run check:core; git diff --check。

## 2.13 本会话总交接（260920 · 独立画板文档 kind=board）—— 新会话从这里读

> 写给零上下文新会话。分支 `feat/board-document` @ **`5da17cd`**（基于 `feat/bitable` 检查点 `b1355de`），**未合 master**（红线：代码批次等用户验收）。
> 起因：用户问「当前 lake 资源下，画板和思维导图能不能做成单独的目录，新建一个画板、只做画图」→ 调研后按用户指示切分支做验证。
> 完整调研 + 实测数据 + 剩余风险 = **`docs/BOARD-DOC-FEASIBILITY-260920.md`**；内核侧结论 = `docs/LAKEX-CONTRACT.md` §5.13；vendor 改动 = LOCAL-CHANGES **#18**。

### 一、任务目标（用户原话要点）
画板/思维导图能否独立成「目录里的一个文档类型」：新建一个画板 → 打开就是一张整屏画布，**只做画图**（不夹 Lake 正文）。

### 二、调研结论
- **能做，且比表格/多维表更轻**：画布引擎是独立 npm 包（`lakex-drawnix` + `@plait/*`，MIT），vendor 的 `DrawnixBoardCore` 只吃 `{value, readOnly, locale, theme, ai, onChange}`，**运行时不 import 内核**；它的 5 个子组件也不碰内核。
- 「只做画图」是原设计：`.lakex-drawnix-core .app-toolbar{display:none!important}`（文件/分享菜单在卡片阶段就被隐藏）。
- 语雀自己也把它们当文档类型：内核 `getIconClassName` 白名单 `['doc','sheet','design','thread','board','mind']` + 镜像里的 `doc-type-board.svg`。
- **思维导图两条路**（未做，见 §五.5）：走画板 preset `mindmap`（`@plait/mind`，+0.5 天）；或独立 `kind=mindmap` 挂 `@xiangfa/mindmap`（markdown 进/出，+1~2 天）。

### 三、已完成（本批，全部在工作区）
**A. 数据层** `src/core/boardDoc.ts`（纯核心）：`BoardDoc = {kind:"board",version:1,engine:"drawnix",preset,elements[],viewport?}`；`emptyBoardBody` / `parseBoardBody`（坏数据退化成空白画板，不抛错）/ `boardToBody` / `boardToSearchText`（形状文字/文本块/思维导图节点/连线标签）/ `boardDocFromCardValue`+`cardValueFromBoardDoc`（卡片 ↔ 独立文档无损互搬）。单测 `boardDoc.test.ts` 7 条。

**B. 主进程 / 协议**：`store.createBoardIn` + `bodyPathFor` 加 `boards/{id}.board.json` + 构造时 `mkdir boards/` + `searchTextFor` 分派 `boardToSearchText`；IPC `create_board_in`（`registerNotes.ts` + `preload.cjs` + `webApiServer.ts` + `src/lib/native.ts` 三处齐）；`noteExport.assertDocKind` 标签加「画板」。

**C. 渲染层**：`Sidebar` 右键「新建画板」（`PenTool` 图标 + 行图标按 kind 区分）→ `useNoteLifecycle.createBoardIn`（**必须显式给 `OpenTab.kind`**）→ `MultiTabEditor` 按 kind 懒加载 `src/features/board/BoardEditor.tsx`（复用 SheetEditorErrorBoundary 隔离）。状态栏非 doc 分支加「画板」。

**D. 编辑器 `src/features/board/BoardEditor.tsx` 的四条硬约束**（护栏 `boardEditorMount.test.ts` 6 条）：① 零内核实例（不 import lakeRuntime/EditorTab）；② 只存场景+视口（卡片专用 `previewImage`/`cardHeight` 收到即丢）；③ 视口走 `onViewportPersist` 存 ref、**不回灌 value**（pan/zoom 不触发保存）；④ 首次可见才挂画布 + 800ms 防抖自动保存 + 与上次序列化比较。

**E. 协议安全闸**：`kind` 新增取值 ⇒ **`MANIFEST_VERSION 6 → 7`**（`READABLE_MANIFEST_VERSIONS={4,5,6,7}`）。理由：旧端对未知 kind 静默回退 `doc` ⇒ 会把画板 JSON 当 Lake 文档导入保存 = 毁正文；升版本让旧端整轮拒绝（代价：所有端一起升级）。同步补：`syncEngine.test.ts` / `sync.test.ts` 的版本断言、`syncDecisions.test.ts` 的 kind 传播用例。

**F. 移动端**：`syncDbPort` 映射 + `noteRepository.normalizeDocKind` + `NotebookWorkspace` 占位文案；**顺手修了既有缺口** —— `mobile/trash/TrashPreviewPage.tsx` 原先**无条件挂 LakeEditor**，现在非 doc（表格/多维表/画板）一律挡成占位。

**G. vendor（`vendor/lakex-doc-react/`，已重建 `dist/**`）**：`src/index.ts` 新增 **`loadDrawnixBoardCore()` 懒加载器** + 导出类型 `DrawnixBoardCoreProps`；`DrawnixBoardCore.tsx` 的 `Props` 改名导出 + 新增可选 **`onViewportPersist`**（`onViewportChange` 由 no-op 改为转调它）。LOCAL-CHANGES #18 记录。

### 四、门禁 + 实测
- **门禁（本批实测全绿）**：`tsc` 0 · `vitest` **1112 passed / 16 skipped** · 桌面 + 移动 `vite build` 全绿 · `check:bundle` app-js gzip **1.784MB / 2.90MB** · `check:core` 0 · CSS 围栏已加 `features/board/boardEditor.css`（11 声明/0 重复组）· `git diff --check` 干净。
- **运行时（隔离 `LAKE_USER_DATA=$TMPDIR/lake-board-smoke-a1` + `LAKE_ASSET_PORT=19879` + CDP 9222，真实数据未读写）**：
  1. 右键「新建画板」→ 目录出现（`lucide-pen-tool`）+ 打开的就是画板，画布 1082×778 铺满 tab，`tab-panels` 内无 Lake 编辑器；
  2. 懒加载：首次打开才请求 `DrawnixBoardCore-*.js`（118KB gzip）+ `drawnix-*`（415KB gzip）；
  3. 画图：形状库 → 矩形 → 拖拽 ⇒ 落盘 `elements:[geometry]`，正文 **271B**，**无 previewImage**（对照文档内画板卡 `.lake` = 455KB，其中 413KB 是那张 PNG）；
  4. 落盘/DB：`boards/{id}.board.json` + `notes.kind='board'`（`sheets/`、`bitables/` 未污染）；
  5. 关标签→从目录重开 = 场景恢复；切标签 keep-alive 切走 0×0 / 切回 1082×778 且图形还在；
  6. **只读**（锁定后重开）：自研工具（素材库/AI/导出）不注入，试画矩形后 `elements` 不变；
  7. 4 个画板 tab = 4 个实例，渲染进程 JS 堆 251→249MB（无明显增长）；
  8. 全流程 `Runtime.exceptionThrown` = 0；`npm run test:drawnix` 通过 ⇒ **文档内画板卡未被本批影响**。
- 证据：截图 `/tmp/lake-board-evidence/board-{4-rect,6-multi,8-locked}.png`；脚本 `/tmp/board-smoke{1..7}.mjs`（临时件未入库）。

### 五、当前问题 / 未做（按优先级）
1. **AB 多端 S3 往返未测**（正文+kind 走既有管线，已单测；但没跑 A→B）。v7 清单在旧端整轮拒绝 ⇒ **升级期必须所有端一起升**。
2. ~~图片不进资产管线~~ **已做（260920 用户定稿「走独立管理」）**：**磁盘/同步口径 = 资产文件**（data URL 经内核同一条 `uploadLakeResource` 通道落 `note-assets/{noteId}/`，写盘时把元素 URL 换成 canonical URL ⇒ 声明/GC/S3/移动端全复用现成能力），**内存口径 = data URL**（引擎导出/预览要把 `<img>` fetch 成 base64，跨源资产 URL 会被资产服务 CORS 拦）；打开画板用 `readAssetPreview` hydrate 回 data URL 并反向登记映射 ⇒ 不重复上传、不改 hash、不「打开即标脏」。**顺带修掉的既有缺陷**：`connect-src` 不放行 `data:` 会让 plait 的 `convertImageToBase64` 被 CSP 拦 ⇒ 画板带图导出 PNG/SVG 静默失败（改造前就存在）；现已在桌面 DEV/PROD + 移动 CSP 放行 `data:`，实测导出 0 报错。详见 `docs/BOARD-DOC-FEASIBILITY-260920.md` §九。
3. **画布实例 soak 未做**：建议合入前跑「连续开关 20 个画板」看堆/DOM 释放。
4. ~~preset 无 UI~~ **用户 260920 定稿：不做模板 UI，新建一律空白画板**（数据层四条 preset 保留，将来要再加二级菜单）。
5. ~~思维导图独立 kind / 移动端只做占位~~ **用户 260920 定稿并已落地**：
   - **思维导图就在画板里做**（自由画布，用工具栏自带的「思维导图」工具；**不新增 `kind=mindmap`**）；
   - **移动端只读画板已做**：`src/mobile/board/MobileBoardViewer.tsx`（`readOnly` + `fitOnInit` + 隐藏工具条 + 不保存），
     顶栏「编辑」对非 doc 禁用；**Android 模拟器真机实测通过**（画布 412×786、0 个 Lake 编辑器、正文 419B 全程不变）。
6. **viewport 只在「内容变化时」落盘**（pan/zoom 单独发生不写盘）。**用户 260920 决定：不做「纯看也记住视角」**。
7. **蓝点快创的图形选择面板（260920 已做，B 档「先选后建」）**：plait 的快创提交永远复制源形状类型
   （`createDefaultGeometry(..., originElement.shape)`），现用 **`patches/@plait+draw+0.93.4.patch`** 把提交权交给宿主
   （`setAutoCompleteCommitHost` + `host.requestShapeChoice({..., commit(shape?)})`，不注入 = 上游原行为）：
   **点蓝点只弹面板、此时画布上还没有新形状**，选完 `commit(shape)` 才落地；Esc/点外面 = `commit()` 落到源形状副本（老习惯不变）。
   面板「最近使用」第一位固定放**源形状**（一键"和自己一样"，替代悬停预览）+ 基础图形 / 流程图 / Smart（图标与「形状」图形库共用）。
   补丁只改提交块、不碰几何/连线/绑定（`commit` 内部仍是上游那两次插入，元素 id 不变 ⇒ 绑定不破）；**升级 `@plait/*` 必须重做补丁**。
   实机验证：画圆 → 点蓝点（面板开、画布仍只有 1 个圆）→ 选「判断」⇒ `[ellipse, elbow, decision]`；再点蓝点按 Esc ⇒ `[..., elbow, ellipse]`；0 异常。
   **追加（同日）**：① **悬停预览已彻底关掉**（`host.hoverPreview:false`：放大蓝点 / crosshair / 幽灵形状 / 预览连线都不再出现；实测悬停期间 SVG 元素数 104→104）——
   现在只有「点蓝点」才有反应，最大程度避免误弹；② **文档内嵌的画板卡同样生效**（卡片与独立画板共用 `DrawnixBoardCore`；
   卡片实测：卡内画矩形 → 点蓝点 → 选「判断」⇒ 卡片 value = `[rectangle, elbow, decision]`）。
   见 LOCAL-CHANGES #20/#21、`docs/LAKEX-CONTRACT.md` §5.13.10、`docs/BOARD-DOC-FEASIBILITY-260920.md` §十。

### 六、踩过的坑（本批新增）
- **vendor 暴露画布核心必须用懒加载器**：写 `export { DrawnixBoardCore }` 会让 vendor 入口静态依赖它 ⇒ 构建报 `INEFFECTIVE_DYNAMIC_IMPORT`、`DrawnixBoardCore-*.js` 分包消失、首屏多背 ≈500KB gzip。已实测复现并改回 `loadDrawnixBoardCore()`（LOCAL-CHANGES #18）。**改 vendor 后一定要看构建有没有这条警告 + `dist/` 里 chunk 还在不在。**
- **新增 kind 取值不止改 `noteKind.ts`**：TS 会在「窄联合类型」处报错（`syncEngineTypes.LocalNoteRow`、`mobile/NotebookWorkspace.TabState`、`electron/syncAdapters` 的 `rowFromSync`、`noteQueries` 的 mapSummary/mapTreeNode、`desktopDerivedState.activeKind`、`DesktopOverlays.activeKind`、`lib/types.ts` 两处）——**run `tsc` 会一次性把它们全列出来**，别只改类型定义。
- **`noteQueries` 的两处映射**（`kind: row.kind === "sheet" ? … : "doc"`）不做会静默降级成 doc ⇒ 目录/打开路径会把画板交给 Lake 编辑器。**这是毁正文级别的坑，必须改。**
- **新建入口必须显式给 `OpenTab.kind`**（`create*` 返回的 `NoteDocument` 不带 kind），否则退回 Lake 编辑器（与 §2.12 同坑）。
- **移动端回收站预览原先无条件挂 LakeEditor**（表格/多维表也中招），本批一并按 kind 挡住。
- **vite 会在 dev 首启时 reload 页面**（`optimized dependencies changed. reloading`）：首轮 CDP 操作如果撞上它，会看到「窗口里啥都没有」的假象 —— 复测/等待后再判定（本批踩过一次）。

### 七、关键文件
- 数据模型 `src/core/boardDoc.ts`；编辑器 `src/features/board/BoardEditor.tsx`(+css)；路由 `src/features/editor/MultiTabEditor.tsx`；主进程 `electron/store.ts`（createBoardIn/bodyPathFor/searchTextFor）；协议 `src/core/noteKind.ts` + `src/core/syncUtils.ts`；vendor `vendor/lakex-doc-react/src/index.ts` + `src/cards/DrawingBoard/DrawnixBoardCore.tsx`。
- 文档：`docs/BOARD-DOC-FEASIBILITY-260920.md`（主交付）· `docs/STORAGE-LAYERS.md` · `docs/SYNC-PROTOCOL.md` · `docs/LAKEX-CONTRACT.md` §5.13。
- 复现命令：见 §六 的隔离实例起法（上面 §四 顶部）+ 门禁命令同 §2.12 八。

---

## 2.14 本会话批次（260920 · 移动端对账补齐 + 小记完整编辑）—— 新会话从这里读

> 起因：用户要求盘点「表格 / 多维表 / 画板 / 小记」三批桌面功能在移动端还缺什么并补齐；随后追加要求
> **移动端小记编辑必须完整**（小记是移动端核心场景）。完整对账表 = **`docs/MOBILE-PARITY-260920.md`**。
> 分支 `feat/board-document`（与画板批次同一分支、同一工作区），**未合 master**；移动端专职交接仍在 §8（本批未改 §8）。

### 一、已完成（全部已提交并实测）
1. **表格 `kind=sheet` 移动端只读视图**（`src/mobile/sheet/MobileSheetViewer.tsx`，懒加载分包）：值/粗斜体/字色底色/对齐/合并单元格/行列号 + 吸顶表头 + 双向滚动（上限 500×60）。桌面 FortuneSheet 未进移动分包（要 100% 保真需另议）。
2. **多维表 `kind=bitable` 移动端只读视图**（`src/mobile/bitable/MobileBitableViewer.tsx`，懒加载）：多表切换 + 视图口径（筛选/排序/隐藏列/列顺序，全部复用 `core/bitableDoc`）+ 选项色块（共享 `optionChipStyle`）+ 附件缩略图（canonical URL）+ 只读角标。
3. **非 doc 搜索/缓存口径统一**（`src/core/noteSearchText.ts` 的 `searchTextForKind`）：桌面 `Store.searchTextFor` 与移动端**搜索索引 / `saveNote` / 历史恢复**共用 ⇒ 表格/多维表/画板的 JSON 碎片不再进 FTS（旧行为会把 `drawnix`、`activeTableId` 这类键名也索引进去）。
4. **小记卡片预览对齐桌面**：移动端卡片改用桌面 `QuickNotePreview`（同一份白名单渲染）+ `listQuickNotes` 返回 `body/images`；并让卡片上的图片点击**回到「打开编辑」**（否则点图只会弹放大预览、进不去编辑）。
5. **小记完整编辑（重点）**：`src/mobile/home/QuickNoteComposer.tsx` 重写 —— 直接复用桌面 `QuickNoteEditor`（内核实例 + 白名单工具条：图片/待办/有序/无序/分割线）；附件按类型成卡（`installMediaCardCategoryRouter`，与文档同一模块）；新增 bridge `stageQuickNoteAsset`（**直接写正式目录** `quick-notes/{id}/`，移动端没有桌面那套 staging/draft-journal）与 `saveQuickNoteContent`（body+text+按正文引用派生的资源清单）；`saveQuickNote` 在**纯文本未变**时保留原 body（不再压平桌面排版的富内容）。
6. **共享图片放大浮层**：`MobileApp` 挂上 `<ImageLightbox />`（此前只 import 样式未挂组件）。

### 二、门禁 + 实测
- 门禁：`tsc` 0 · `vitest` **1129 passed / 16 skipped** · 桌面 + 移动 build 全绿 · `check:bundle` app-js gzip 1.784MB/2.90MB · `check:core` 0。
- 移动端实测（模拟器 + CDP，真实 dev 数据，测试行验证后已删）：
  - 表格：`.mst-grid` 渲染全部单元格 + 行列号 + 只读角标，0 个 Lake 编辑器；
  - 多维表：表头/记录/选项色块/只读角标，0 个 Lake 编辑器；
  - 小记卡片：标题/列表/引用/加粗由 `quick-note-preview-*` 渲染；
  - 小记编辑：内核编辑器 + 粘贴 PNG → 保存 → `content.body` 含图片卡、`images` 1 条（120×80、size 1341）、文件落 `quick-notes/{id}/` 且 AssetServer 能渲染；重开编辑态正文与图片都在；0 异常。

7. **表格图片（浮动图）移动端只读渲染（260920 追加）**：`src/core/sheetDoc.ts` 新增 `sheetImages` / `sheetImageSrc`（三种 src 形态都认 ⇒ 桌面 P1 落地后零改动）；`MobileSheetViewer` 加图片叠层，偏移用**实测网格原点**（ResizeObserver 量 A1；顺带修行号列被通用 `th` 规则撑到 84px 的优先级问题）。实测图片矩形与 A1 **逐像素对齐**（alignedX/Y=0）。
8. **长按桌面图标 →「小记」（260920 追加，对齐思源）**：静态 App Shortcut（`res/xml/shortcuts.xml`，`lakenotes://quick-note` 深链）+ 宿主侧 `src/mobile/quickNoteShortcut.ts`（冷启动 `App.getLaunchUrl()` **短轮询重试** + 热启动 `appUrlOpen`）⇒ 直接进「小记」标签并打开新建写作区；**机型兜底** = 新原生插件 `PinShortcutPlugin`（`isAvailable/isPinned/requestPin`）+ 设置 → 编辑器 →「添加到桌面」（对齐思源的 `requestPinShortcut`，实测系统弹窗确认后 flags 变 `Pin`）。
   ⚠️ **坑**：订阅**不能**用 `hasNativeBridge()`（判 `window.lakeNative`，移动端是启动流程之后才注入 ⇒ 冷启动瞬间判假、订阅被跳过）；要用 `window.Capacitor.isNativePlatform()`。思源参考实现见 `/Users/admin/file/local-lake/siyuan-android-main`（AGPL-3.0，只参考不抄）；与思源的差距（原生轻量 Activity 秒开 + 草稿 + inbox 转入、系统分享入口）估 1.5–2 天，见 `docs/MOBILE-PARITY-260920.md` §七。

9. **深链/长按那条路径 = 不挂内核的轻量速记框（260920 续，收尾）**：`src/mobile/home/QuickNoteFlashComposer.tsx`
   —— `textarea` + 图片按钮、**不可展开**、零内核实例；`HomePage` 只把 `newQuickNoteRequest`（深链）路由到它
   （`key={newQuickNoteRequest}` 保证每次重开是空框），工作台底部「新建小记」与「编辑」仍是完整内核编辑器。
   正文走无内核写入者唯一被认可的通道 `core/quickNoteModel.quickNoteBodyFromTextAndImages` → `core/lakeDocForm`
   （`<p>` + 图片 `<card>` 容器，**无裸 `<img>`**），图片按 `quick-notes/{id}/` 落盘。
   ⚠️ **核实结论**：内核**没有**"不建实例就把文本转成 Lake 正文"的能力（`setDocument('text/*')` 要编辑器实例、
   `markdownStream` 要阅读器实例）—— 已回填 `docs/LAKEX-CONTRACT.md` §5.12.10；护栏
   `src/mobile/home/quickNoteFlashComposer.test.ts`。
   ⚠️ **顺带修掉一个真 bug（CDP 复现）**：`quickNoteShortcut.subscribeQuickNoteShortcut` 原用**永久布尔量**去重冷启动双触发
   ⇒ 一次冷启动后进程存活期间再长按图标（热启动）被永久忽略；改为 **1.5s 短窗口去重**，护栏
   `src/mobile/quickNoteShortcut.test.ts`。
   🚀 **冷启动提速（260920 续）**：先量后改——`bridge.init()` 87ms、`refreshAll()` 11ms，真正大头是**入口 chunk 6.7MB**
   （整个 Lake 内核被三条静态路径拖入）。① 内核按需加载（`NotebookWorkspace`/`QuickNoteComposer`/`TrashPreviewPage` 改 `React.lazy`）
   ⇒ 入口 **6.7MB → 80KB**、`effectStart` **712→200ms**；② 轻量框改挂 `MobileApp` 独立入口，**在 `bridge.init/refreshAll` 之前**渲染
   （保存才 `ensureDb`）。冷启动到可输入 **~1.3s → 0.30–0.43s**（实测）；
   ⚠️ 别用 `codeSplitting.groups` 拆内核（会拆坏 vendor 的 DrawnixBoardCore 懒 chunk、白屏）；护栏 `src/mobile/mobileLazyChunks.test.ts`。
   🧭(v1.3) 改名「新建小记」+ 未提交草稿防丢：快捷方式深链**必须用 intent 的 `android:data` 属性**（嵌套 `<data>` 被
   ShortcutParser 忽略 ⇒ 快捷方式丢深链）；轻量框挂载从 `device_state` 恢复未提交文字、300ms 防抖落库、保存/取消清除
   （纯本地不进 S3）。实测模拟器：输入→force-stop→重开文字还在；取消后重开为空。护栏 `quickNoteDraft.test.ts`。
   🚀(v1.4) 草稿纳入图片；系统分享（ACTION_SEND）→ 小记（`SharedContentPlugin` 接住文本/图片 + 轻量框 seed）。
   护栏 `sharedContent.test.ts` / `quickNoteDraft.test.ts`。
   ❌ **原生秒开「新建小记」（QuickCaptureActivity）—— 试过后已回退并彻底删除（260920）**：用户试用觉得原生框太丑、
   原来 WebView 轻量框速度可以接受 ⇒ 决定不做。快捷方式**切回** `MainActivity` + `lakenotes://quick-note` 深链；
   `QuickCaptureActivity.java` / `res/layout/activity_quick_capture.xml` / `src/mobile/quickCaptureInbox.ts`(+测试) /
   manifest 声明 / MobileApp 接线**全部删除**。⚠️ 以后别重复造原生快捷方式 UI。

### 三、下一步（详见 `docs/MOBILE-PARITY-260920.md` §五）
1. 小记**音视频/PDF 附件**在真机点一次确认四类卡；2. ~~移动端新建 sheet/bitable/board~~（**用户定稿：不做，除文档外一律只读**）；3. 表格 100% 保真是否引入 FortuneSheet（+0.5MB gzip 懒加载，用于公式求值/条件格式/冻结窗格）；4. **AB 多端 S3 往返**（画板图片/表格/多维表/小记资源）；5. 移动端小记工作台能力（→正式文档、批量、置顶/列表视图）；6. ~~【可选】小记对齐思源的原生轻量 Activity + 系统分享入口~~ 系统分享（SharedContentPlugin）已做；**原生轻量 Activity 试过后已回退删除**（用户 260920：太丑、WebView 框速度可接受）。

---

## 2.15 本会话总交接（260920 晚 · 移动端小记完善）—— 新会话从这里读

> 本会话承接 §2.14 之后，专注把**移动端「小记 / 长按新建小记」**这条路做扎实：
> 清构建告警 → 冷启动提速 → 改名「新建小记」→ 修快捷方式深链 bug → 草稿（文字+图片）防丢 → 系统分享 → 试做原生秒开框（**已回退删除**）。
> 全部在 `feat/board-document` 提交，收尾 fast-forward 合入 `master` 并 push。

### 一、任务目标（用户口径，按顺序）
1. 先修移动端构建的 `INEFFECTIVE_DYNAMIC_IMPORT` 告警。
2. 把「深链 → WebView → 轻量框」这条长链路的冷启动做快（用户："实现更快的速度/快速响应"）。
3. 用户可见名 = 「**新建小记**」，不要多余说明。
4. 草稿防丢（先文字、后图片）——对齐思源闪念的"不丢"。
5. 系统分享（ACTION_SEND）→ 直接记一条小记（文本/图片）。
6. 原生秒开 Activity（用户点名）——**试用后决定不做，已回退删除**。
7. 移动端小记工作台能力（转正式文档/批量/置顶/列表视图）——**只记待办，先不做**。

### 二、已完成内容（均已提交）

**A. 构建告警（`871163e`）**
- `quickNoteShortcut` 改为动态 `import("@capacitor/app")`（它被 `MobileApp` 静态引入，会让其它模块对 `@capacitor/app` 的懒加载分包失效）；
- `bridge.createS3Client` 去掉对 `capacitorHttpHandler` 的冗余动态 import（`s3Store.ts` 已静态引入）。移动 bundle **0 告警**。

**B. 冷启动提速（`2d962a8`，1.3s → 0.30–0.43s）—— 先量再改，本会话最关键的一条**
- 实测分解：`bridge.init()` **87ms**、`refreshAll()` **11ms** —— **都不是瓶颈**。真正的大头是**入口 chunk 6.7MB** + React 挂载 ≈**712ms**；
  内核是被三条**静态 import** 拖进入口的：`MobileApp → NotebookWorkspace`、`HomePage → QuickNoteComposer`、`SettingsDrawer → TrashPreviewPage`。
- **① 内核按需加载**：三条改 `React.lazy` ⇒ 入口 chunk **6.7MB → 80KB**，内核进独立懒 chunk（不 modulepreload），`effectStart` **712→~200ms**。
- **② 闪念速记独立入口**：轻量框改挂 `MobileApp` 的 `captureOpen` 分支，**在 `bridge.init()/refreshAll()` 之前**渲染（保存才 `ensureDb()`），返回键先关它。
- 实测（模拟器 API36，3 次冷启动到可输入）：**305 / 337 / 428ms**（改前 ~1250–1500ms）。
- 护栏 `src/mobile/mobileLazyChunks.test.ts`；⚠️ 坑见「五·1/2」。

**C. 改名 + 修快捷方式深链（`e08d3d4` / `f7e2af4` / `54bc861`）**
- 用户可见名统一「**新建小记**」：`strings.xml` 的快捷方式短/长标签、设置项名、轻量框 aria/hint；去掉多余说明。
- **修「快捷方式丢深链」**：`shortcuts.xml` 原把深链写成 `<intent>` 的**嵌套 `<data>` 子元素**，而 Android `ShortcutParser` 只读 `android:data` 属性
  ⇒ 注册出的 intent 没有 `dat`，点开只开 App、进不了速记框。改为 `android:data="lakenotes://quick-note"`（`dumpsys shortcut` 复查已带 `dat`）。

**D. 未提交草稿防丢（`54bc861` / `d4f5c35`）**
- 轻量框挂载时从本机 `device_state`（**纯本地、不进 S3、不是小记本体**）恢复上次未提交内容；输入 **300ms 防抖**落库；保存/主动取消后清除；note id 挂载即固定。
- **图片也进草稿**：图片一加入就 `bridge.stageQuickNoteAsset` 落 `quick-notes/{id}/`，草稿只记引用（filename/mime/size/hash/宽高）；
  重开用 canonical URL 恢复缩略图；保存改走 `saveQuickNoteContent` + `quickNoteBodyFromTextAndImages`（不重传字节、不二次落盘）。
- 桥接 `getQuickNoteDraft / saveQuickNoteDraft / clearQuickNoteDraft`；单测 `quickNoteDraft.test.ts`。
- 实测：输入（文字+图）→ `force-stop` 杀进程 → 重开 → **文字与图都在**；取消后重开为空。

**E. 系统分享（ACTION_SEND）→ 小记（`bc41d4f`）**
- MainActivity 加 SEND intent-filter（`text/plain`、`image/*`）→ 原生 `SharedContentPlugin` 接住（文本原样；图片/文件复制到
  `filesDir/shared-inbox/`，按 URI 去重避免 `load`/`onNewIntent` 双触发重复复制）→ JS 冷启动 `consume` / 热启动 `shared` 事件
  → 打开轻量框预填（`seed`：文本 + 图片字节；读完删临时文件）。
- 单测 `sharedContent.test.ts`；实测分享文本（冷/热）、分享图片（`thumbs=1`、保存后 `imageCount=1`）均通过。

**F. ❌ 原生秒开框（`QuickCaptureActivity`）—— 做过、试用后回退并彻底删除（`3c7d740` → `d04d020`）**
- 曾做原生纯文本 Activity（长按直开、提交写 `filesDir/quick-capture-inbox/`、App 启动/回前台导入、草稿存 SharedPreferences），首帧 `Displayed` ~0.87–0.99s。
- 用户试用后觉得**原生框太丑**、**原来 WebView 轻量框的速度可以接受** ⇒ 决定不做。**代码全部删除**：
  `QuickCaptureActivity.java` / `res/layout/activity_quick_capture.xml` / `src/mobile/quickCaptureInbox.ts`(+测试) / manifest 声明 / `MobileApp` 接线；
  快捷方式切回 `MainActivity` + `lakenotes://quick-note` 深链。**系统分享 + 图片草稿保留。**

**G. 移动端小记工作台能力 —— 只记待办**（用户 260920 定）：见 §3 第 15 条 + `docs/MOBILE-PARITY-260920.md` §五。

**H. 关键文件 / 护栏**
- 轻量框：`src/mobile/home/QuickNoteFlashComposer.tsx`（零内核、图片草稿、分享 seed）；入口 `src/mobile/MobileApp.tsx`（`captureOpen` 独立入口 + 懒加载）。
- 草稿：`src/mobile/quickNotesRepository.ts`（`read/write/clearQuickNoteDraft`）+ `bridge.ts` 三方法。
- 分享：`android/.../SharedContentPlugin.java`、`src/mobile/sharedContent.ts`。
- 深链：`src/mobile/quickNoteShortcut.ts`（1.5s 短窗口去重 + `getLaunchUrl` 轮询）。
- 护栏：`mobileLazyChunks.test.ts` / `quickNoteShortcut.test.ts` / `quickNoteFlashComposer.test.ts` / `quickNoteDraft.test.ts` / `sharedContent.test.ts`。
- 文档：`docs/MOBILE-PARITY-260920.md` §七（v1.1–v1.4）· `docs/LAKEX-CONTRACT.md` §5.12.10（内核无 headless 文本转正文）。

### 三、当前问题（不阻塞）
1. **真机未验**：以上都在**模拟器 API36**实测；真机（小米，可能 **edge-to-edge** 键盘模式）没跑过。
2. **分享图片的 CDP harness 限制**：shell `am start` 分享 `content://` URI **不会真正授予读权限**（SecurityException），
   用 App 自有 `file://` URI 才测通；**真实 App 分享会带 grant**，但没在真实第三方 App 上点过。
3. **轻量框是"不挂内核"的取舍**：只文字+图片；待办/有序/无序/分割线等富格式只在 App 内完整编辑器（有意的）。
4. **`quickNoteShortcut.ts` 的深链目前只由快捷方式触发**（无其它触发方）——是保留路径，别删。
5. **小记音视频/PDF 附件**四类卡只在移动端内核编辑器路径验过图片，其余未真机点。
6. **AB 多端 S3 往返**（画板图片/表格/多维表/小记资源）仍未测。

### 四、下一步计划（按优先级）
1. **真机验收本批移动端小记改动**：长按「新建小记」→ 轻量框（文字+图片/草稿/系统分享）；文档页与分享入口照旧。
2. **移动端小记工作台能力**（转正式文档 / 批量选择 / 置顶 / 列表视图；桌面 `QuickNotesWorkspace` 已有）—— §3 第 15 条。
3. **AB 多端 S3 往返**（画板图片/表格/多维表/小记资源）。
4. 小记**音视频/PDF 附件**四类卡真机确认。
5. 其余长期项见 **§3**。

### 五、踩过的坑（本会话新增，务必记住）
1. **入口 chunk 6.7MB 的元凶是三条静态 import，不是 `bridge.init/refreshAll`** —— 先量再改：init 87ms、refresh 11ms、`effectStart` 712ms。用 `React.lazy` 拆路径即可。
2. **⚠️ 不要给 `@dlient/lakex-doc-react` 加 rolldown `codeSplitting.groups`**：实测拆坏 vendor 内部 `DrawnixBoardCore` 懒 chunk 的 export 绑定
   —— 打开编辑器即 `SyntaxError: Export '..._exports' is not defined in module`、整页白屏。正确做法是**懒加载边界**；护栏 `mobileLazyChunks.test.ts`（连 `codeSplitting:` 配置都禁）。
3. **Android 静态快捷方式的深链必须用 `<intent android:data="…">` 属性**；嵌套 `<data>` 元素会被 `ShortcutParser` 忽略 ⇒ 快捷方式点开丢深链
   （`dumpsys shortcut` 看 `intents=[Intent { act=VIEW … cmp=MainActivity }]` 没有 `dat=`）。
4. **冷启动去重不能用永久布尔量**：`subscribeQuickNoteShortcut` 原一次冷启动后把热启动也永久忽略；改 **1.5s 短窗口去重**（护栏 `quickNoteShortcut.test.ts`）。
5. **轻量框两个启动竞态**：① 草稿读取完成前不能写草稿（否则空文本覆盖）；② `captureOpen` 分支必须放在 `phase === "booting"` 门**之前**才真正早渲染。
6. **`device_state` 是纯本地键值表**（草稿/设置/同步游标），**不进 S3**、不是小记本体。
7. **图片草稿要"加入即落盘"**：草稿只记 meta；重开用 canonical URL 恢复缩略图；保存走 `saveQuickNoteContent` 不重传字节。
8. **`am start` 分享 `content://` URI 不给读权限**（`SecurityException: no access to content://media/...`）：测试要用 `--grant-read-uri-permission` + 真实分享，或改用 App 自有 `file://` 绕过。
9. **`createImageBitmap` 会拒绝损坏/手拼的 PNG**（"The source image could not be decoded"）—— 测试图片用真图（`adb exec-out screencap -p`）。
10. **原生 Activity 计时口径**：`am start -W TotalTime`（含 IME/idle）与系统 `Displayed`（首帧）不同，别混着比；本机原生 ~0.87–0.99s、MainActivity 冷启动 ~1.5s，
    但**最终结论是 WebView 轻量框更快更漂亮 ⇒ 原生这条路不做**。
11. **切回/改快捷方式要同时改三处**：`shortcuts.xml`、`PinShortcutPlugin`（固定到桌面那条）、真机 launcher 缓存；reinstall 后 `dumpsys shortcut` 确认 intent。
12. **`android/app/src/main/assets/public/` 是 `cap sync` 产物**：只改 `src/` 后必须走 `scripts/android-build.sh --sync`，否则会测到旧 bundle。
13. **不要对 HANDOFF.md 这类大文件做「整文件 read→write」**：`read` 可能只返回**部分**内容（本会话把 1707 行读成 ~218 行、写回后截断，已用 `git checkout` 恢复）。要改大文件用 `edit` 或「写临时文件 + 按行区间 `head/tail` 拼接」。

## 2.16 本会话批次（260920/21 · 表格图片独立管理 P1）—— 未提交，等用户验收

> 写给零上下文新会话。用户在新会话接手时点名做这一项（源自 §3 第 14 条的立项规范）。
> 工作区改动 5 个文件（全在 `master` 上、**未提交**）；规范与落地记录见 **`docs/SHEET-IMAGE-MANAGEMENT-260919.md` §12**。

### 一、任务目标
把表格浮动图从「base64 内联进正文」改成「资产文件 + 正文只存 filename」，复用现有资产管线（声明/GC/同步/历史/移动端）。

### 二、已完成（全部在工作区，未提交）
1. **`src/core/sheetDoc.ts`**：新增 `sheetImageDiskSrc`（本地资产 URL（含 `?token=`）→ filename）；`sanitizeSheetWorksheet` 落盘时把 `images[].src` 统一磁盘化；
   `sheetImageSrc(src, noteId, port?)` 加端口参数（A=19876 / B=19877 各用各的）。
2. **`src/features/sheet/SheetEditor.tsx`**：`initialSheets` 把磁盘 filename 拼成渲染 URL（`withRenderableImageSrc`）；
   `Workbook.onChange` 里 `promoteInlineImages` 把内核刚插入的 `data:image/*` 提升成资产（复用 `uploadLakeResource`，与画板同一套路）；
   `flush` 提升未落地前**推迟保存**（`promoteInFlightRef > 0`），保存时 `withPromotedImageSrc` 换写盘口径；**挂载时也跑一次提升 ⇒ 老正文里的 base64 自愈**。
3. **`src/lib/assetPort.ts`**：新增 `ASSET_PORT` 导出（`ASSET_ORIGIN` 由它派生）。
4. 测试：`sheetDoc.test.ts`（URL→filename、端口、base64 保持）+ `sheetEditorMount.test.ts` 新增 5 条源码级护栏。
5. 门禁：`tsc` 0 · `vitest` **1157 passed / 16 skipped (1173)** · 桌面 + 移动 build 全绿 · `check:bundle` app-js gzip **1.784MB / 2.90MB** · `check:core` 0 · `git diff --check` 干净。

### 三、实测（隔离实例 `LAKE_USER_DATA=$TMPDIR/lake-sheet-img-smoke` + `LAKE_ASSET_PORT=19879` + CDP；真实数据未读写，跑完已删隔离目录）
右键「新建表格」→ 真实插图链路（构造 1600×1200 PNG 塞进 `#fortune-img-upload`）⇒ 正文 `sheets/{id}.sheet.json` **323B**、
`images[0].src="1789954950409_1a1b16c1.png"`（无 base64、无 URL）、资源落 `note-assets/{id}/`（42319B）；
`notes.kind='sheet'`+`sync_state='local'`；`orphan_assets` 为空；`Page.reload` 重开后图片从
`http://127.0.0.1:**19879**/{id}/1789954950409_1a1b16c1.png` 正常渲染（`naturalWidth>0`）。

### 四、与原规范的**两处刻意差异**（用户如不同意可回退）
1. **不加新 IPC**：`native.uploadResource` / `ResourceRepository.upload` 已经就是「写 note-assets + 孤儿登记」，无需 `assets.putImage`。
2. **正文版本号不升**（仍 `version:2`，原稿写 2→3）：结构未变、`src` 两种形态读写天然都支持，升版本会让**既有表格静默变空表**（零收益破坏）。
   ⇒ 原稿「旧 v2 表删了重建」也不再需要。

### 五、当前问题 / 未做
1. **AB 多端 S3 往返**未跑（图片他端可达、正文 sha256 不变）——沿用 §3 的既有缺口。
2. **删除图片后的 GC 回收**未跑实测（机制是现有 GC + 年龄保护 + 孤儿保护，未另写）。
3. **粘贴图片未做**：内核 `onPaste` 只读文本，且没暴露 `insertImage`（要自研粘贴拦截 + 自己算落点几何）⇒ 单独立项。
4. **P2 单元格图 / P3 移动端渲染**未做（规范 §5/§8）。
5. 未提交（红线：代码批次等用户验收）。

### 六、踩过的坑（本会话新增）
- **内核插图没有可复用的「提升钩子」**：FortuneSheet 的 `insertImage` 不外露、`applyOp` 也没必要用 ⇒ 走「插完 base64 再由宿主提升」（与画板 `BoardEditor` 同一套路，已验证）。
- **`manifest.assets` 不是从正文抽的、是磁盘实扫**（`scanLocalAssets` → `listLocalAssets`）：新 kind/新形态的图片只要落进 `note-assets/{noteId}/` 就天然被声明 —— 别再为「声明」写代码。
- **`orphan_assets` 的写时登记会被 `saveNote` 按正文引用撤销**：验证「保存链路是否真的把 filename 写进正文」，查 `orphan_assets` 是否为空是个很快的判据。
- **新建后目录行处于「待重命名」输入态**（`innerText` 为空）：CDP 脚本里靠文本找节点会失败，要用 `listNoteSummaries()`/`listTreeNodes()` 的真值取 id（本会话因此白跑一轮）。
- **`Page.reload` 后要重新 `Emulation.setFocusEmulationEnabled`**、且 `window.lakeNative` 要等一会儿才可用：poll 表达式要包 try/catch，否则 `Runtime.evaluate` 直接抛错打断脚本。

## 2.17 本会话续（260921 · 表格工具栏加回 4 项 + overlay 方案性能量测）

> 承接 §2.16（表格图片 P1）。本轮只动 `SheetEditor.tsx` 的一处常量 + 文档；代码改动未提交。

### 一、工具栏加回 4 项（用户点名）
- **加回**：`format`（单元格格式：数字格式/对齐/字体/边框）· `link`（插入链接）· `comment`（批注）· `locationCondition`（定位）——
  各自按**内核默认顺序**插进现有分组（18 → **22 项**）。
- **仍隐藏**（相对内核默认 41 项）：`currency-format`/`percentage-format`/`number-decrease`/`number-increase`（数字格式快捷键）、
  `font`（用户要求默认全局字体、不可改）、`text-rotation`、`conditionFormat`、`dataVerification`、`splitColumn`、`screenshot`。
- 核对结论：内核语言包里还有「图表 / 数据透视表 / 保护工作表」，但**这个版本的 Toolbar 没有实现**（只有翻译串）⇒ 加不进来。
- 门禁：`tsc` 0 · `vitest` **1157 passed / 16 skipped (1173)** · 双端 build 全绿 · `check:bundle` 1.784MB/2.90MB · `check:core` 0 · `git diff --check` 干净。

### 二、单元格图「overlay 方案（不改内核）」性能量测 —— **结论：不卡；唯一的成本是图片解码内存**
隔离实例 + 注入式近似（每张图一个「尺寸=单元格 + `overflow:hidden`」的盒子 + `max-width/height:100%` 的 `<img>`，
图 1200×900、全部 `decode()` 强制解码），滚动 1.6s 采样 rAF：

| 锚定图数 | renderer RSS | 帧 P50 | 帧 P95 | 最长帧 | 滚动期间 overlay DOM 变更 |
|---|---|---|---|---|---|
| 0 | 179 MB | 16.7 ms | 18.4 ms | 21.3 ms | 0 |
| 50 | 435 MB | 16.7 ms | 18.7 ms | 36.0 ms | 0 |
| 200 | 664 MB | 16.7 ms | 18.6 ms | 37.9 ms | 0 |

- **帧耗时与空表完全一致**（P50 16.7ms = 满 60fps）⇒ 多一层 overlay **不带来卡顿/响应变慢**。
- **滚动期间 overlay 零 DOM 变更** ⇒ FortuneSheet 的滚动是容器级移动，锚定图**不需要在滚动热路径上重算几何**
  （只在行列尺寸/冻结/隐藏/切表变化时算）。
- **成本全在解码内存**：≈ 像素数 × 4B（1200×900 → **5.1 MB/张**；50 张 +256MB、200 张 +485MB）。
  ⇒ **缩略图管线是 P2 的必须项**（不是可选优化）：单元格图渲染缩略图（≤512px ≈ 1MB/张，≤256px ≈ 0.26MB/张），点开再看原图；
  否则大表（几十张 4000×3000 图 = 48MB/张）会线性吃内存。这条与「overlay 还是 canvas 补丁」无关，两条路都要解码。
- 量测方式：临时脚本 `/tmp/overlay-perf.mjs`（未入库）；隔离实例用备用端口（1432/9233/19881），真实数据未读写，跑完已清理。

### 三、顺带修掉的 bug：目录栏切「收起/悬浮」后表格右侧留白（用户 260921 报，图见对话）
- **现象**：目录栏从固定切到悬浮收起后，表格右侧留一条**正好等于目录栏宽度**的白条。
- **根因（实测几何）**：`.fortune-sheet-overlay` 宽 **1074**，而容器 `.fortune-sheet-container` 是 **1375**；差 **301px = `--sidebar-width`**。
  FortuneSheet **只在 `window.resize` 时重算容器尺寸、没有 ResizeObserver**（`react/dist/index.esm.js:3978`）⇒ 壳层几何变化（目录栏固定↔悬浮↔收起、拖宽目录栏、轨道切换）不触发它，画布/内容宽停在旧值。
- **修法（不改内核）**：`SheetEditor` 观察自身宿主宽度（`ResizeObserver`），宽度变化时 **rAF 内合并补发一次 `window.resize`**，
  让内核重算；内核重算不改宿主宽度 ⇒ 不自激。顺带覆盖「隐藏标签 0 宽 → 显示」这条。
  护栏：`sheetEditorMount.test.ts` 新增断言（`new ResizeObserver` + `dispatchEvent(new Event("resize"))` + `ref={hostRef}`）。
- **实测（隔离实例）**：固定态 `workspace/container/overlay/canvas = 1082`、`cellArea = 1031`；点活动栏「资料库」切收起后
  全部同步涨到 **1242 / 1242 / 1242 / 1191** ⇒ 不再留白。
- ⚠️ 同类风险面：凡是「内核按容器宽度算一次」的东西都可能踩这个坑（Lake 内核的工具条折叠也是同源，见 §2.10 坑 4）。本次只修了表格这一处。

### 四、渲染层选型（本会话结论，P2 据此开工）
- 走 **DOM overlay（不改内核）**：零补丁、可回退，几何只有「行列尺寸变化」等少数触发面；
- 悬崖点已排掉两个（**滚动跟随** ✓ 实测逐像素一致、**视口裁剪** ✓ `.fortune-cell-area{overflow:hidden}`），
  仍待实测：**冻结窗格坐标**、**列宽拖拽逐帧同步**（→ 放在 P2 第一步的 spike 里）；
- 数据模型走「单元格持有图片」（`v.img = { asset, fit }` 或 `images[].cell = {r,c}`，二选一待定），
  ⚠️ 必须先实测「编辑单元格时内核会不会丢掉未知字段」（同当年"未注册卡片一编辑就丢"的坑）。

## 2.18 本会话续（260921 · 表格**单元格图片 P2** 落地）—— 未提交，等用户验收

> 承接 §2.16（P1 浮动图）/§2.17（工具栏 + 侧栏留白修复）。**用户 260921「可以开始做吧」= 开工 P2**。
> 规范与实测记录全文见 **`docs/SHEET-IMAGE-MANAGEMENT-260919.md` §5 / §13**；这里只留要点。

### 一、定案：**不再走原稿的 overlay/canvas 两条路**，复用内核「浮动图」通道
| | 原稿 | 落地 |
|---|---|---|
| 数据 | `cell.v.img = {asset, fit}` | **`sheets[].images[].cell = {r,c}`**（带它就是单元格图片；与浮动图共用一个数组） |
| 渲染 | 自建绝对定位 overlay + 自己跟滚动/裁剪 | **内核自己的图通道**（滚动跟随 / `.fortune-cell-area` 裁剪 / `×zoomRatio` 全免费） |
| 缩放/对齐 | 自研 fit 数学 | **CSS `object-fit: scale-down`**（等比缩进格内 + 不放大） |
| 几何 | `getCellRect` | **`src/core/sheetGeometry.ts`** 复刻内核 `calcRowColSize` 口径，随模型变化重算 |

- 写回模型用 `applyOp([{op:"replace", id:sheetId, path:["images"], value:next}])`：**整数组 replace 幂等**
  （`opToPatch` 会把同一份 patch 同时打到 `luckysheetfile[i].images` 与渲染源 `insertedImgs`，用 `add` 单元素会被打两次），
  且 `applyOp` 内部 `noHistory` ⇒ **不污染撤销栈**、也不回灌非受控 `data`。
- 指针事件关闭（`pointer-events: none`）：单元格图片是「单元格的内容」，点它要命中单元格，不能被当浮动图拖走/加手柄。

### 二、四个踩坑（都写进了代码注释，别再踩）
1. **几何取整必须在累加内层**：内核是 `ch_width += Math.round((len+1)*zoomRatio)`。按「先累加再取整」算，
   第 31 列就差 **12px**（实测 2430 vs 2442）——第一版就是这么错的，靠「图片 vs 内核选区 `style` 逐像素比对」抓出来。
2. **`.luckysheet-cell-input` 是 contenteditable div**（不是 `<input>`，没有 `.value`）⇒「用户是否在打字」只能看 `textContent`。
3. **内核在 `.fortune-container` 的 keydown 里 `stopPropagation()`** ⇒ React 合成事件收不到 `Delete`（实测 document 捕获能收到、
   冒泡收不到）⇒ 键盘/粘贴一律挂 **document 捕获阶段 + `host.contains(target)` 限流**。
4. **几何同步不能只靠 `onOp`**：实测拖列宽**有时一个 op 都不发**（内核 mouseup 直接改 config）⇒ 主触发点改 `onChange`
   （模型变了必回调），`onOp` 只作附带。同理，`.fortune-cell-area` 与冻结数据都要等首次 commit 之后才存在 ⇒
   滚动监听挂**宿主 + capture**，直接挂该节点会永远挂不上（冻结偏移静默失效）。

### 三、隔离实例实测（21 项断言全绿；端口 1432 preview / 19881 asset / 9231 CDP，未碰用户实例）
几何逐像素对齐内核选区（243.001/154/81.004/22 vs 243/154/80+1/21）· 指针穿透 · `scale-down` · 拖宽列跟格（81→131）·
`Page.reload` 后逐像素一致 · 冻结行 `translate(0px, scrollTop)` · Delete 删（2→1）· 粘贴插图（1→2）。
落盘：`images[0] = { id:"cellimg_…", src:"1789964532780_2c98163f.png", left:220.91, top:140, width:119.09, height:20, cell:{r:7,c:3} }`
（只有 filename + 模型单位几何，无 base64/URL/运行时字段；正文仍 `version:2`）。

### 四、门禁（260921）
`tsc` 0 · `vitest` **1177 passed / 16 skipped (1193)** · 桌面 build + **Android `assembleDebug` BUILD SUCCESSFUL** ·
`check:bundle` app-js 6.61MB raw/1.78MB gzip（预算 2.90MB）· drawnix 0.41MB · app-css 0.19MB · `check:core` 0 违规 · `git diff --check` 干净。
（`src/styles/cssLayers.test.ts` 基线 `features/sheet/sheetEditor.css` 24 → **26**：单元格图片两条规则，合法新增。）

### 五、P2 边界（未做，别当成已完成）
~~**缩略图管线**~~（**260921 续已做，见 §2.19**）· **移动端只读渲染（P3）** ·
「单元格格式 → 图片」对话框入口（要 patch 内核 React 弹窗，本批刻意不 patch）· AB 多端往返 + 删图后 GC 回收实测。

## 2.19 本会话续（260921 · 表格单元格图片**缩略图** 落地）—— 未提交，等用户验收

### 零、任务目标（按用户原话顺序，全部已完成）
1. `可以开始做吧。在此之前先解决一个问题，当固定目录栏改成悬浮目录栏且收起的时候，表格右侧没有自适应，留了一个目录栏宽度的留白` → 见 §2.17（已修）；
2. `format，locationCondition，comment，link 加回来这4个吧，就按照内核的顺序就行` → 见 §2.17（已做，工具栏 22 项）；
3. `关于上一个问题，如果使用B方案不改内核，是否有性能问题…先看是否会导致卡顿和响应慢的问题` → 实测帧耗时与空表一致，
   滚动期 overlay DOM 变更 0；**真正的成本在解码内存（像素 × 4B），不是帧率** —— 这就是本节的立项依据；
4. `先调研一下现有资产管线的缩略图能力。` → 结论：**全管线五层（写入/存储/服务/渲染/同步 GC）没有任何缩略图**（见下方「先调研后动手」）；
5. `多维表好像有缩略图，你看看是怎么做的，还是说我看到的小图片其时也是原图大小。` → **确实是原图**，26px 的格子解码整张；
6. `可以做。` → 落地 `?w=` 按需缩略图（本节一~五）；
7. `移动首页封面是什么意思这是哪里，另外两个没有问题可以做。` → 见本节六（多维表附件格 + 移动端封面 + 安卓 Java 侧）。

**先调研后动手**：用户先让「调研现有资产管线的缩略图能力」→ 结论是**全管线没有任何缩略图**（写入/存储/服务/渲染/同步 GC 五层全无）。
唯一的图片处理是 `?base64=1` 的 webp→png（尺寸不变）与 `imageConverter.worker` 的**原尺寸**转 PNG（给微信复制用）。
用户看到的「小图」全是 CSS 压的：多维表附件格 26px（`bitableEditor.css`）、移动首页封面 210px、闪记缩略条 88px、
表格单元格图片 —— **全都解码原图**。`NoteInfoDialog` 的 `thumbs`/`readAssetPreview` 名字最像缩略图，其实是主进程读整文件
→ base64 dataUrl → IPC 全量回传（比走 URL 更贵），别被命名误导。文档里两处已记过这个空白（`S3-GC-DESIGN.md` 319、本方案 §11）。

### 一、已完成①选型决策：按需缩放，**不落盘派生文件**
**为什么不落盘**：`manifest.assets` 是磁盘实扫、GC 保护是正文 filename 正则 ⇒ 派生文件会被当资产声明/上传，
却又不在正文引用集里，**注定被判孤儿回收**。真要保护就得把派生 filename 写进正文（结构变 + AB 往返都要管 + 删除要成对维护）。
⇒ 给 `electron/assetServer.ts` 加 `?w=<档位>` **按需生成、不落盘、不上传、可随时重建**，不碰数据格式/同步协议/GC。

### 二、已完成②实现（4 处，正文一个字节没变）
1. `src/core/assetUrl.ts`（**纯逻辑，禁 DOM**）：`ASSET_THUMB_WIDTHS = [128,256,512,1024]`（**离散**是关键，连续值会把浏览器 immutable 缓存
   与服务端缓存一起打散）+ `assetThumbWidthFor(设备px)`（取不小于目标的最接近档位；超最大档位 → null 用原图）+
   `withAssetWidth(url, w)`（改写/去掉 `?w=`，**保留 token**，非本地资产原样）。
   `src/lib/assetPort.ts`：`assetThumbWidthForCss(cssWidth)`（× DPR，封顶 3×）—— **它读 `devicePixelRatio`，属 DOM 依赖，
   只能放 lib 不能放 core**（`check:core` 会卡，见七）；
2. `electron/assetServer.ts`：`sharp(file).resize({width, withoutEnlargement:true})`，**保持原格式**（目标是解码内存，
   而内存只取决于像素数，与编码格式无关；保格式还避开 alpha/动画/编解码器一堆边界）。GIF（多帧会被压成首帧）与
   SVG（矢量无解码问题）**跳过**；解码失败落回原图（缩略图是纯优化，不能让它把图弄没）。内存 LRU 64 项（键含 mtime+size）
   + 并发闸 4 路（sharp 解一张大图峰值就是像素×4B，突发批量会打爆内存）。
3. `src/core/sheetDoc.ts`：`sheetImageSrc(src, noteId, port, width?)` —— 对 `http(s):` 输入也要能改写档位
   （渲染层拿到的是**已拼好的 URL**，不是 filename）。`sheetImageDiskSrc`/`sanitizeSheetWorksheet` **一行没改**
   （`parseLocalAssetUrl` 只取路径段、忽略 query ⇒ 带档位 URL 存盘照样换回 filename）。
4. `src/features/sheet/SheetEditor.tsx`：`cellImageThumbWidth(模型宽度, zoom) = assetThumbWidthForCss(模型宽度 × zoom)`
   （`sheetZoom` 从 `sheetGeometry` 导出，别自己读 `zoomRatio`）。三个触发点：挂载期 `withRenderableImageSrc`（阅读态也吃到，
   不用等几何同步）、插入时 `insertCellImage`（省掉「先按原图加载再换缩略图」那次多余解码）、列宽/行高变化后
   `syncCellImageGeometry` 一并改写 src（**早退条件必须把 src 也算进去**：`image.src === sized`）。
   **浮动图不带档位**（能被用户任意拖大，档位会连续抖动）。

### 三、已完成③端到端实测（隔离实例 1432 preview / 19881 asset / 9231 CDP，`/tmp/lake-thumb-verify.mjs`）
1. 注入 **2400×1600** PNG → `src` 带 `?w=256`，`img.naturalWidth = 256` ⇒ 浏览器解码的是缩略图：
   **位图 15.4MB → 175KB**（这才是省下来的东西，帧率本来就不是瓶颈）；
2. 几何仍与内核选区一致（676.005/66/81.004/22 vs 676/66/81/22，≤1px），`object-fit: scale-down` 仍在；
3. **拖宽列 81 → 257** ⇒ 档位 `256 → 1024`、`naturalWidth 1024`（这条路径会走 `applyOp` 改写 src，最容易写成死循环）；
4. **无死循环**：`?w=` 请求共 4 条 / 去重 4 个 URL；600ms 内 rAF **38 帧**（≈63fps）；
5. **落盘正文 745B 不含 `?w=`**，`images[].src` 全是裸 filename；
6. `Page.reload` → 重开仍是缩略图（挂载期就带档位），几何逐像素一致；
7. **几何同步改写 src 的档位**（把落盘几何改成与真实列宽不一致 → 挂载取宽档、同步后必须改写成真实档位）：
   `requested tiers=["1024","256"] final=256`，**两条请求即收敛**（确定性触发那条 `applyOp` 改写路径）。
证据截图 `/tmp/lake-thumb-evidence/{01-thumb-inserted,02-thumb-resized-column,03-thumb-after-reload}.png`。
**唯一未复现**：`拖宽列 → 档位换代`（列头 hover 拖拽在窗口被遮挡时不落点，属实测环境限制，非产品问题；已用第 7 条确定性替代）。

### 四、门禁（260921 续 2，全绿；与 §0 一致）
`tsc` 0 · `vitest` **1200 passed / 16 skipped (1216)** · 桌面 `vite build` 绿 ·
**Android `testDebugUnitTest`(AssetServerTest 8/0) + `assembleDebug` BUILD SUCCESSFUL** ·
`check:bundle` app-js raw 6608559 / gzip **1.78MB**（预算 2.90MB）· drawnix 0.41MB · app-css 0.19MB ·
`check:core` **65 文件 / 0 违规** · `git diff --check` 干净。
新增单测：`assetServer.test.ts`（真 PNG 缩到 128 且字节变小 / `?w=1024` 在 400px 原图**不放大** / 非档位值当没传 /
**GIF 直通**（不能把多帧压成首帧）/ 解不了码落回原图 / 同档位二次一致 / 换文件后缓存按 mtime+size 失效）、
`assetUrl.test.ts`（档位边界 + 保留 token + 非本地资产原样）、`assetPort.test.ts`（CSS×DPR 选档、封顶 3×）、
`sheetDoc.test.ts`（带档位 URL 落盘仍取 filename）、`sheetGeometry.test.ts`（`sheetZoom`）、
`sheetEditorMount.test.ts`（三处拼装都带档位、`image.src === sized` 计入变更判定、浮动图不带档位）、
`bitableEditorMount.test.ts`（附件格带档位 + 预览不带档位）、`AssetServerTest.java`（档位白名单/格式规则/`inSampleSize` 不下冲）。
注：既有护栏 `sheetImageSrc\(src, noteId, ASSET_PORT\)` 随签名加了 `width` 一并更新。

### 五、当前问题（**不阻塞**：本批没有已知缺陷，只有「未做」与「未验」两项）
**未验**：移动端缩略图**真机未验收**（唯一没验过的面，见八.1）· 表格侧「拖拽列宽换档」在实测里未复现
（环境限制，已用确定性替代，见三.7）。

**未做（边界，动手前先跟用户确认）**：
浮动图缩略图（可被任意拖大 ⇒ 档位会连续抖动）· 磁盘缩略图缓存（同会话重复请求已被浏览器 immutable 缓存吃掉，先不做）·
输出格式统一为 WebP（收益只在传输字节，与解码内存无关）。

### 六、已完成④扩展面（260921 续 2，用户确认「另外两个可以做」）
1. **多维表附件格（桌面）**：`bitableCells.tsx` 的格子显示 26px 却解码整张原图 ⇒
   `chipUrlOf = withAssetWidth(urlOf(f), assetThumbWidthForCss(ATTACHMENT_CHIP_PX))`。
   **关键不变量**：`onOpen`（放大预览 → `ImageLightbox`）继续走原图 —— 预览借道缩略图就是糊的。
   **实测 6/6**（`/tmp/lake-thumb-bitable.mjs`）：用应用自己的 API `lakeNative.createBitableIn` 建多维表
   （正文结构由应用产出，只补「附件字段 + 记录 + 大图资源」），`src` 带 `?w=128`（token 保留）·
   `naturalWidth 128`（原图 2400）· 格子仍 26px · **预览 `naturalWidth 2400` 且 URL 无 `?w=`**。
2. **移动端小记卡片封面**：`HomePage.tsx` 的 `.qn-card__img`（整列宽 × 最高 210px）取**最大档位 1024**。
   ⚠️ 这里**不能**用 `assetThumbWidthForCss`：整列宽 ≈ 360 CSS px、dpr 3 需要 1080 设备像素，
   按它算会**超过档位表上限而退回原图**（静默不优化）——固定最大档位才对。手机照片 48MB 位图 → ~3MB。
3. **移动端必须改 Java**：`src/mobile/**` 走 `android/.../AssetServer.java`（不是桌面那个 Node 服务）。
   已按同一语义实现：`?w=` 白名单（与 `ASSET_THUMB_WIDTHS` 同值）+ `inJustDecodeBounds` 读尺寸 +
   `inSampleSize`（只取 2 的幂、"解出来仍不小于目标宽"的最大值）+ `createScaledBitmap` + `compress`；
   **只对 png/jpg/jpeg 生效**（GIF 多帧/SVG 矢量/其余 Android 编解码支持不一的一律落回原图），失败也落回原图。
   `./gradlew testDebugUnitTest` → AssetServerTest **8 项 / 0 失败**；`assembleDebug` BUILD SUCCESSFUL。
   **⚠️ 真机未验**（生成走 `android.graphics`，JVM 单测覆盖不到）：请在设备上看一次小记封面/表格图片是否正常显示。
4. 顺手抽出 `assetThumbWidthForCss()`（CSS 宽度 × DPR，封顶 3×）作**唯一 DPR 入口**，各调用点不再自己读
   `devicePixelRatio`（`SheetEditor` 的内联 dpr 计算已改用它）。

### 七、踩过的坑（本批新增，务必记住）
- **Java 的 `URI uri` 原本声明在 `try { ... }` 内部**，函数后半段引用不到（编译期"找不到符号"）⇒ 提到 try 之前；
- **`dist/` 忘重建就跑去实测**：改动在构建之后做的话，页面上还是旧 bundle（表现为「代码明明改了但 `?w=` 没出现」）；
- 页面查询要挑**可见**元素：多 tab 会保留隐藏 DOM（`getBoundingClientRect().width === 0`），`querySelector`
  会命中旧 tab 那份，点击坐标就成了 (0,0)；
- **窗口被别的 App 遮挡时 `document.visibilityState === "hidden"`**：rAF 被节流到 ≈1 帧/600ms、
  列头 hover 拖拽也不落点（不是产品问题，但会让断言假红）⇒ 实测前先把窗口抬到最前（`osascript ... activate`；
  CDP 的 `Page.setWebLifecycleState("active")` **盖不住遮挡**）；
- **列宽换代不一定要靠拖拽验证**：把**落盘几何**改成与真实列宽不一致即可确定性触发 —— 挂载按落盘宽度取档、
  几何同步后必须改写成真实档位。实测 `requested tiers=["1024","256"] final=256`，**两条请求即收敛**（无抖动）；
- **`check:core` 抓到过一次真违规**：`assetThumbWidthForCss`（读 `devicePixelRatio`）一开始写在 `src/core/assetUrl.ts` ——
  DOM 依赖不许进 core，已挪到 **`src/lib/assetPort.ts`**（core 只留纯逻辑 `assetThumbWidthFor`/`withAssetWidth`，
  测试挪到 `assetPort.test.ts`）。**`tsc`/`vitest` 都不报，只有 `npm run check:core` 会卡** —— 别省这一步。

### 八、下一步计划（按优先级；**都未做，动手前先跟用户确认**）
1. **【需用户操作】移动端缩略图真机验收**：设备上看一眼小记卡片封面、表格里的图片是否正常显示。
   代码有「任何失败落回原图」兜底，但缩略图生成走 `android.graphics`，JVM 单测覆盖不到 —— **这是唯一没验过的面**。
2. **P3：移动端表格只读渲染**（`kind=sheet` 的 `sheets[].images[]` 叠层）+ 对拍 + 压测（大图/多图），见 §8 移动端交接。
3. **删图后的 GC 回收实测** + AB 多端 S3 往返（图片可达）—— 机制复用现有资产管线，只需跑一次实测。
4. **「单元格格式 → 图片」对话框入口**（要 patch 内核 React 弹窗，本批刻意不做）。
5. 可选：把小记闪记框的 88px 缩略条也接上 `?w=`（`QuickNoteFlashComposer`，一行）；浮动图缩略图；
   磁盘缩略图缓存；输出统一 WebP。
6. 用户验收通过后：**这批改动要提交**（22 个文件，未 push 未合 master）—— 提交前记得跑完整门禁
   （`tsc` + `vitest` + `check:core` + `check:bundle` + 桌面 build + `android/./gradlew testDebugUnitTest assembleDebug`）。

### 九、隔离实测怎么搭（下个会话可直接复用）
```
npx vite build                                    # 必须先重建！改了 TS 不重建，页面还是旧 bundle
npx vite preview --port 1432                      # 另开一个终端/后台
LAKE_DEV_SERVER_URL=http://127.0.0.1:1432 LAKE_USER_DATA=/tmp/lake-cellimage-iso \
  LAKE_ASSET_PORT=19881 npx electron --remote-debugging-port=9231 .
osascript -e 'tell application "Electron" to activate'   # 抬到最前，否则 rAF 被节流、hover 拖拽失效
node /tmp/lake-thumb-verify.mjs                   # 表格单元格图片缩略图
node /tmp/lake-thumb-bitable.mjs                  # 多维表附件格缩略图
# 收尾：按端口 PID 精确 kill（绝不 pkill -f Electron，用户的实例在 9222/1421）
lsof -ti:1432 -ti:9231 | sort -u | xargs kill
```
数据全在 `/tmp/lake-cellimage-iso`（可删可重建），**从未碰用户实例与正式数据**。
脚本都在 `/tmp`（不入库），要长期保留就搬进 `scripts/`。

**归档进去的踩坑**：① 同步函数的**早退条件必须把 src 也算进去**（`image.src === sized`），只比几何的话列宽变化后档位换代会被早退吃掉；
② 渲染层拿到的是**已拼好的 URL**，所以 `sheetImageSrc` 对 `http(s):` 输入也要能改写档位；③ 服务端并发闸要**移交槽位**
（`releaseThumbSlot` 直接把槽给下一个 waiter，`running` 不变），先减后加会留窗口让超量请求挤进来。

## 2.20 本会话续（260921 · 表格去掉浮动图 + 单元格图片工具弹窗 + 右键/滚动/色条）—— 未提交，等用户验收

> 承接 §2.19。用户在表格上点名 7 项（1 项大改 + 6 个 bug）。改动全在桌面表格编辑器 + 两份 FortuneSheet dist 补丁；**工作区未提交**（与 P1/P2/缩略图同批）。
> **最重要教训先说**：内核 `onChange` 的 effect 依赖 `onChange` 的**身份**（`useEffect(..., [context.luckysheetfile, onChange])`，而 `<Workbook>` 每次 render 都拿到新箭头函数）⇒ 任何「读 DOM 后 `setState` 新对象」的刷新 effect 都会与 rAF 形成 **60fps 死循环**（实测 TaskDuration 打满）。修法：值没变时 `setState` 返回 `prev`。

### 一、已完成（按用户原话顺序）
1. **完全去掉浮动图片**（工具栏 + 右键）：`TOOLBAR_ITEMS` 与 `CELL_CONTEXT_MENU` 里的 `"image"` 全部换成 `"cell-image"`；原在工具栏**最左**的单元格图片工具，现在正好占原「插入图片」位（自定义项按 `toolbarItems` 里的 key 就位）。`#fortune-img-upload`（内核浮动图 file input）不再渲染。
2. **单元格右键「插入图片」改走单元格图片**：内核 `ContextMenu` 补丁按 `customToolbarItems` 里同 key 的项渲染菜单项（`_lakeCustomMenu`，label 取 `label || tooltip`）。
3. **右键「清除内容」连带清除单元格图片**：内核只删文字、不动 `images[]`（`activeImg` 只管浮动图）⇒ 补丁在 `clear` 分支调 `settings.hooks.afterClearCellContent()`；宿主 defer 一轮后 `removeCellImageAtSelection()`（**不在 `setContext` 更新器里改模型**）。
4. **单元格图片工具弹窗**（对齐云端截图）：`hooks.afterSelectionChange` + 几何 rAF + 滚动/resize 触发 `refreshCellImageMenu`；位置取图片元素**实测矩形**（合并/冻结/缩放都不用重算），滚出可视区隐藏；三个按钮 = **查看大图**（共享 `ImageLightbox`）/ **下载原图**（`native.saveAssetAs`）/ **删除**（`applyOp` 删 `images[]` 项；只读态不显示删除）。
5. **表格细滚动条**（对齐文档/多维表）：`.sheet-editor .luckysheet-scrollbar-ltr::-webkit-scrollbar` 改 10px + 透明边框内阴影拇指（复刻 `src/b3/siyuan/util/_scroll.scss` 那套），覆盖内核自带 8px 实心 `#babac0`。
6. **滚动速度调低**：补丁改 core `handleGlobalWheel` —— 竖向累计 `deltaY` 过 **100px** 才动一格（鼠标滚轮手感不变、触控板明显变缓）；横向改 **1:1 跟随 `e.deltaX`**（原实现每个事件固定 `20*zoomRatio`）。
7. **修「文字色/背景色两条色条」**：内核这两个图标自身带一条灰底线，选中颜色后宿主再画一条色条 ⇒ 用 CSS `clip-path` 裁掉图标底线（`.fortune-toolbar > div:has(> div[style*="absolute"]) svg`），只留宿主色条（位置与原底线基本重合）。
8. **浮动图删除钮接上**（顺带定位的 bug）：内核 `ImgBoxs` 的裁剪/恢复/**删除**三个控制钮**原本没有 onClick** —— 这就是「浮动图片无法删除」的真因 ⇒ 补丁给两个 `.luckysheet-modal-controll-del` 加 `removeActiveImage + jfrefreshgrid`。

### 二、补丁（`patches/` 已重新生成，勿手改 patch 文件）
- `@fortune-sheet+react+1.0.4.patch`：① 允许 `toolbarItems` 引用 `customToolbarItems`（按 key 就位，领头自定义块过滤掉已引用的）；② 右键菜单自定义项；③ 清除内容 hook；④ 删除钮 onClick。（原有 InputBox 宽度、图片 input 两个 hunk 保留。）
- `@fortune-sheet+core+1.0.4.patch`：`handleGlobalWheel` 滚动累计 + 横向 1:1。（原有三个 hunk 保留。）
- 重生成命令：`npx patch-package @fortune-sheet/react @fortune-sheet/core --patch-dir patches`（会联网装一份干净 1.0.4 做 diff）。**esm 与 cjs 两份都要改**，且变量名不同（`React` vs `React__default['default']`、`toolbarItemSelectedFunc` vs `core.toolbarItemSelectedFunc`、`removeActiveImage` vs `core.removeActiveImage`）。

### 三、验证（隔离实例，**未碰用户实例/正式数据**）
- `LAKE_USER_DATA=/tmp/lake-sheet-menu-iso` + `LAKE_ASSET_PORT=19881` + CDP 9231；**CDP 真实鼠标**（`Input.dispatchMouseEvent`）+ **真实粘贴**（`ClipboardEvent` 带 `DataTransfer`）驱 9 项断言全绿：无 `#fortune-img-upload` · 工具栏 cell-image 唯一 · 单元格图片落格内 · 弹窗三按钮 · 右键菜单含「插入图片」 · **弹窗打开 1.5s `TaskDuration` 增量 0.037s（无死循环）** · 弹窗删除生效。
- 门禁：`tsc` 0 · `vitest` **1205 passed / 16 skipped (1221)** · 桌面 + 移动 build 绿 · `check:core` 0 · `check:bundle` app-js gzip 1.78MB/2.90MB · `git diff --check` 干净。

### 四、当前问题 / 未做（都不阻塞）
- 「插入图片」**按钮/右键的真实文件选择对话框**未走通自动化（隔离实例只验了粘贴链路；按钮与右键都只是 `cellImageInputRef.click()`）。
- 老文档里**已有的浮动图仍会渲染**（只是不能再新建）；删除钮已修，但不会自动转成单元格图片（数据迁移未做，等用户决定）。
- 弹窗**只认焦点格**：合并单元格内、多选区间里的图不弹（单独点中才弹）。
- 拖拽列宽换档在隔离实例里仍受窗口遮挡影响（同 §2.19 五）。

### 五、踩过的坑（本批新增，务必记住）
- **内核 `onChange` effect 依赖 `onChange` 身份**：`useEffect(..., [context.luckysheetfile, onChange])`，Workbook 每次 render 传新箭头函数 ⇒ **任何刷新 effect 的 `setState` 新对象都会变成 60fps 死循环**（症状：CPU 打满、`Performance.getMetrics` 的 TaskDuration 线性增长）。刷新类 effect 必须「值没变返回 `prev`」，或把 `onChange` memo 化。
- **窗口被遮挡时 rAF 被节流**（同 §2.19）：CDP 实测弹窗/几何同步前先 `osascript -e 'tell application "Electron" to activate'`，否则假红（本次一度误判「弹窗不出现」）。
- **`customToolbarItems` 项没有 `label` 字段**（只有 `tooltip`）⇒ 右键菜单 label 必须 `label || tooltip`，否则菜单项渲染成**空白**（`innerText` 里看不到，极易误判「补丁没生效」）。
- **改内核 dist 后必须重新生成 patch**，否则下次 `npm i`（postinstall 打 patch）会退回未打补丁状态；只改 `node_modules` 不重生成 = 别人拉下来没这个行为。
- **`vitest` 跑不了内核**：这类行为只能 CDP 驱真 Electron 验（本次脚本在 `/tmp`，未入库）。

### 六、同会话第二轮（用户 4 项反馈：多选清图 / 插入数量 / 行列拖拽 / 图片跟随）
- **✅ 多选区域「清除内容」连带清图片**：原 `removeCellImageAtSelection` 只按**焦点格**删（单格 OK、多选漏）⇒ 改为按 `wb.getSelection()` 的**所有选区范围**删（`imageAnchorInRanges`；整行/整列的范围内核已给全）。隔离实例 shift 多选 4 行实测：图片被清掉。
- **✅ 右键「向上/向下插入」默认数量 = 选中行/列数**：内核 insert-row/column 输入框写死 `defaultValue:"1"` ⇒ 补丁改成按 `context.luckysheet_select_save[0]` 的 `row`/`column` 跨度算。实测：单击 = 1/1；shift 选 4 行 = 4/1（**选中即整批**，用户口径）。
- **✅ 拖拽列宽换档**：用户复测**没问题**，无需改。
- **整行/整列拖拽 —— 内核不支持（结论）**：FortuneSheet 行/列头只有「选择 / 边界拖拽改尺寸 / 右键菜单（插入·删除·隐藏·复制·粘贴·清除·排序）」；`handleRowHeaderMouseDown`/`handleColumnHeaderMouseDown` 只做选区，core 里**没有** `moveRow`/`moveColumn` 之类 API。要换行/列位置只能用剪切粘贴、或「插入 + 删除」。
- **✅ 已实现「图片跟随 cell 移动」**（用户 260921 选 A+B）。根因仍是：单元格图片是宿主扩展（`sheets[].images[]` + `{r,c}`），内核行列操作只重排 `data`/`celldata`/`config`、**从不碰 `images[]`**。
  - **A（插入/删除行列）**：应用层 `onOp` 识别 `insertRowCol`/`deleteRowCol` op，延迟一 tick 后按 (type,index,count,direction / start,end) 平移或删除受影响锚点（撤销会以相反 op 再发一次，天然对称）。实测「向上插入一行」图片下移 22px。
  - **B（内部 copy/cut + paste）**：**应用层剪贴板桥**（不依赖内核剪贴板内部状态）：`copy`/`cut` 捕获阶段记下选区内单元格图片与源左上角 → 粘贴（剪贴板 HTML 含内核标记 `fortune-copy-action-table`）后 `setTimeout(0)` 按 (目标−源) 偏移搬迁（copy 复制 / cut 移走源图）。实测 copy 多一张、cut 源图移走且目标出现。
  - **⚠️ 为什么没走内核补丁（弯路，务必记住）**：先给 core 的 `pasteHandlerOfCutPaste`/`pasteHandlerOfCopyPaste` 打补丁搬迁 `insertedImgs`，**copy 能过、cut 不行** —— CDP 实测 `handlePaste` 进入时 `ctx.luckysheet_paste_iscut` 恒为 `false`（内核公开粘贴入口对 cut 标志/`isEqual` 的时序不稳），该补丁已**回退**（core patch 只剩滚动那一处）。应用层桥只依赖 `copy`/`cut`/`paste` 三个 DOM 事件，确定性可测。
  - **仍不支持**：整行/整列**拖拽**（内核无此能力）；跨表 / 粘贴到不同 sheet；只含图片、没有文字的单元格，内核自身的 cut/paste 可能抛错（与本改动无关）。
- **✅ 同会话第三轮（用户 3 项反馈：多选 / 右键粘贴 / Cmd+A）**：
  - **多选、整行整列 copy-cut-paste**：`recordClipboardCellImages`/`pasteClipboardCellImages` 去掉「只认单块选区」，改为取**所有选区的包围盒左上角**（`rangeBoundingBox`）⇒ 多块选区 / 整行 / 整列都跟随。实测整行 copy（目标行出现副本）、整行 cut（源图移走、目标出现）均通过。
  - **右键菜单「粘贴」不可用（内核 bug）**：内核 `ContextMenu` 的粘贴项把系统剪贴板**纯文本**回写 `#fortune-copy-content`，冲掉内部表格标记 `fortune-copy-action-table` ⇒ 内部内容被当外部文本粘贴。补丁：当 `#fortune-copy-content` 含该标记且系统文本 == `sessionStorage.localClipboard`（即内部内容）时传 `null`（不覆盖，走内部 HTML）。另：右键粘贴**不走 `paste` DOM 事件** ⇒ 应用层监听右键菜单「粘贴」点击，补一次图片搬迁。
  - **Cmd/Ctrl+A 偶发选中整页（含目录栏文字）**：内核 `handleGlobalKeyDown` 的 `KeyA` 分支调 `selectAll(ctx)` 但**没有 `preventDefault`** ⇒ 浏览器原生全选把整页 DOM 文本（含侧栏）一起选中。补丁加 `e.preventDefault()`。**注意**：编辑单元格文字时内核在 77150 行已对非方向键 `return`，走不到这里 ⇒ 单元格内 Cmd+A 选文字不受影响。

- **🔬 Spike（260921）：自定义 cell 字段穿透性 —— ✅ 通过，路 2 的 2A 可行**（完整报告 `docs/CELL-IMAGE-SPIKE-260921.md`）：
  - 运行期实测（用户实例上的临时表，跑完已删）：**插入/删除行列、`setCellValue` 编辑、序列化都保留 `__probe`**；copy/paste 因探针里用了 `wb.setSelection`（把 `luckysheet_select_save` 弄成非数组）没验完，但**源码判定通过** —— `getdatabyselection` 按引用取 cell、`setCellValue`/`updateCell` 原地改已有对象、`insertRowCol/deleteRowCol` 用 `unshift/splice` 搬 cell。
  - **顺带修掉一个真 bug**：内核 `getSelection()` 在选区非数组时抛 `TypeError: ...map is not a function` ⇒ 冒到 `SheetEditorErrorBoundary`，**整个表格编辑器被卸载**（用户视角「表格突然没了」/「偶发」）。新增 `safeGetSelection(wb)`（try/catch + `Array.isArray` 兜底）替换全部调用点，护栏已加。
  - **结论**：走 **2A**（图片进 cell 附加字段如 `cell.img`，宿主在 `onChange` 从 cell 反推 `images[]` 渲染条目与几何）；copy/cut/paste、插入删除行列、撤销、跨表、序列化全部由内核负责，**结构性**消除这一类 bug。2B（canvas 原生渲染）暂不做。预计 vendor+构建 1–2 天、2A 实现 3–5 天。
  - 遗留：回收站里有临时表 `SPIKE-临时` / `SPIKE-临时2`（只有 `__probe`），用户可自行清空。

## 2.21 本会话总交接（260921 · 单元格图片方案 2A：`cell.img` 成为唯一真相）—— 未提交，等用户验收

> 承接 §2.20 六的 Spike（自定义 cell 字段能穿过内核搬运）。本批把单元格图片从「宿主扩展的 `images[].cell` 锚点」改成 **`cell.img` 为唯一真相**，让 copy/cut/paste、插入删除行列、编辑、撤销、跨 sheet、序列化**全部由内核负责**。

### 一、改了什么
- **数据**：插入单元格图片写 `cell.img = { id, src }`（src = 资产 filename），同时立即写一份 `images[]` 渲染条目（不等 rAF，窗口被遮时 rAF 会停）。
- **派生**：`reconcileCellImages()` 在每次模型变化（rAF + 120ms 兜底定时器）后，从「格子上有 img」反推 `images[]` 的 cell 条目（浮动图原样保留）；同一 id 被 copy 到多格时补新 id（内核 copy 会连带复制 `img.id`）。不变时返回 prev 早退（防环）。
- **删除**：内核 `deleteSelectedCellText` 把 cell 换成 `{}`（`modules/selection.ts:2101`）⇒ Delete/「清除内容」自动带走 `img`；弹窗「删除」逐个清格子的 `img`。**删掉了** Delete 捕获、`afterClearCellContent`、`removeCellImageAtSelection`。
- **删除旧桥**：`applyRowColImageShifts`（onOp 平移）、`recordClipboardCellImages`/`pasteClipboardCellImages`（应用层剪贴板桥）、右键粘贴点击桥、`imageAnchorInRanges`/`rangeBoundingBox` 全删 —— 不再需要宿主搬图。
- **保留**：两处独立内核补丁（右键「粘贴」用内部 HTML、Cmd+A preventDefault）、`safeGetSelection`、几何同步/缩略图/弹窗/冻结偏移。

### 二、验证（隔离实例，未碰用户数据/实例）
- 2A e2e **5/5**：粘贴图渲染 · 正文 `celldata[].v.img` 落盘 · **copy/paste 图跟随到目标格** · **插入行后图跟随下移（96→118）** · **清除内容后图消失（2→1）**。
- 模型级（临时探针，跑完已删）：**编辑（setCellValue）后 img 保留** · **插入行后 `cell(3,1)`→`cell(4,1)`、`images[].cell.r=4`** · **Cmd+Z 撤销后 img 回原行**（需先把焦点点回网格，否则 Cmd+Z 到不了内核）· **跨 sheet copy/paste 图跟随**（点 sheet 标签切表；`addSheet` 也会切当前表）。
- **顺带修掉一个真 bug**：内核切换 sheet 只改 `currentSheetId`、**不更新 `status`** ⇒ 原来的 `activeSheetOf`（`status===1`）在多表下**永远认第一张**（人在第二张表，插入/几何/弹窗却作用在第一张）。新增 `activeSheet(wb, sheets)`：优先 `wb.getSheet()`（跟 `currentSheetId`），退化才用 status；所有调用点已改。
- **跨表 id 去重**：copy/paste 会连 `img.id` 一起复制（含跨 sheet）⇒ `reconcileCellImages` 的 id 去重从「单表内」改成「**跨表全局**」，否则两张表会出现同 id 图片。

### 三、门禁
`tsc` 0 · `vitest` **1210 passed / 16 skipped (1226)** · 桌面 + 移动 build · `check:core` 0 · `check:bundle` app-js gzip 1.78MB/2.90MB · `git diff --check` 干净。

### 四、当前问题 / 未验
- **含图单元格 cut**（Cmd+X 后粘贴）只跑了 copy 路径 + 撤销；2A 下无论内核把它当 copy 还是 cut，图片都随 cell 到目标；「源是否清空」取决于内核剪贴板行为（§2.20 六的 `luckysheet_paste_iscut` 不稳），未单独断言。
- 正文同时保留 `images[]`（含派生 cell 条目）与 `cell.img`：冗余但安全；将来可只在保存时剔除 cell 条目（以 `cell.img` 为准）。**遗留浮动图仍原样保留**（不再新建）。
- 老 P2 数据（只有 `images[].cell`、无 `cell.img`）**不做自动回填**（Spike 扫描用户数据里没有这种；红线 #7 不写兼容）。

## 2.22 本会话批次（260921 · UI 重设计 P1/P2：@layer 层骨架 + 主题即数据）—— 在途分支 feat/ui-redesign

> **写给完全没有上下文的新会话**。本批是「彻底剥离思源样式层 + 重做套壳 UI」的开始，用户已授权自主执行。
> 方案/硬指标/阶段/验收口径 = `docs/UI-REDESIGN-260921/README.md`；**元素底账（防丢）** = `docs/UI-REDESIGN-260921/01-ELEMENT-LEDGER.md`。
> 设计规格（外部）= `/Users/admin/file/local-lake/ui-design-inputs/out/design-system/`（8 项交付，**只作参考**）。
> 分支 `feat/ui-redesign`，基线 `origin/master` = `17bafbe`；**未 push、未合 master**。

### 一、已完成（25 个提交）· ✅ 本批（P0–P8）收尾
- **b53a456 docs**：元素底账 + 实现方案（阶段 P0–P8 / 层序 / 主题即数据 / 硬指标 / 验收口径变更）。
- **e5f171e P1 @layer 层骨架**：新增 `src/styles/index.css` 单入口，`@layer legacy,tokens,reset,kit,shell,feature,overlay,a11y`；旧样式（含内核 style.css / 思源 / 旧壳层）**按原顺序整体入 legacy 层**；删 `src/styles.css`；围栏 `cssLayers.test.ts` 入口项同步。
  - 关键机制：**legacy 最低 ⇒ 新层写入即压过旧样式**，迁移期不靠特异性取胜。
  - 实测：Vite 正确内联 `@import ... layer()`（输出 0 残留 @import）；3 个未分层组件 CSS 与 legacy **零选择器重叠** ⇒ 语义透明；截图与基线一致。
- **bf8bfde P2 主题即数据**：`src/styles/themes/{base,light,dark,warm}.css`（layer tokens）+ `src/lib/themes.ts` 注册表；`ThemeMode` 收敛为 `LakeThemeId`；`applyTheme` 按注册表设 `colorScheme`；设置面板主题控件按 `LAKE_THEMES` 渲染（浅/深/**暖色纸质**）；`settingsSearch` 关键词补充。
  - 对比度脚本校验 **42 项全过 AA**（含把 `text-3` 在卡内块上从 4.21 修到 ≥4.5）。
  - 隔离实例实测：设置按钮 → `data-theme=warm` 且 `colorScheme=light`（warm 属 light 系）。
- **P3 字体可替换**：`src/styles/feature.css`（layer feature）把**正文**字体接到 `--lake-font-family-reading`，与界面(`--lake-font-family`)/等宽(`--lake-font-family-mono`)分离；`src/lib/fontTrial.ts` = **仅 dev** 的试用切换器（不进设置项、不落盘、**生产已 tree-shake**，实测产物搜不到 `__lakeFontTrial`）。
  - 候选清单 + 本机可用性实测见 `docs/UI-REDESIGN-260921/02-FONTS.md`（本机有 冬青黑/宋体/黑体-简，未见苹方独立字体文件）。
  - 实测：三个令牌一旦改值，界面/目录/编辑器正文三处同时生效（截图全文宋体）。
- **P4 组件库 14 件**：`src/styles/kit.css`（layer kit，422 声明）——按钮/图标钮/列表项/菜单/对话框/提示条/输入/下拉/开关/徽章/卡片/气泡/分段/滚动条/表单行；
  命名 `ln-*` 但**刻意避开 legacy 已占用的名字**（ln-dialog*/ln-tabs*/ln-toolbar*/ln-row2*/ln-empty*/ln-close/badge/seg/checks/panel-title），
  且**现有 TSX 未把任何 kit 类名当作完整 token 使用** ⇒ 加入当天零视觉回归；P5 才逐屏迁移过来。
  - 规格保真：**43/43 项关键数值核对通过**（对照 COMPONENTS.md）；**0 颜色字面量、0 `!important`**（为此给三套主题补了 `--lake-accent-ink-hover/-press`、`--lake-shadow-knob`）。
  - 视觉验证：`docs/UI-REDESIGN-260921/kit-demo.html`（独立 demo，直接引用源 CSS，三套主题切换）已渲染截图核对。
- **P5 逐屏迁移（第 1 片：活动栏 / 目录栏头部 / 状态栏）**：新增 `src/styles/chrome.css`（layer shell，87 声明，**0 `!important` / 0 颜色字面量**）。
  - 活动栏：右侧 1px `--lake-border-1`；按钮 28→**32px** + md 圆角；hover/active/选中按规格（选中 = accent-tint + accent，无左条）。
  - 目录栏头部：5 个紧凑图标钮改 `--lake-radius-xs`（6px，原来被 `!important` 统一压成 md）。
  - 状态栏：从 b3 的 `!important` 底色改为**实心底 `--lake-bg-panel` + 1px 描边 + 卡片阴影**；同步状态改**软底药丸**（4 态走 `--lake-status-*-soft`）；底部提示条同规格。
  - **拆掉的 legacy `!important`（4 处）**：`b3/layout.css` 活动轨两根 border 与状态栏底色、`b3/base.css` 状态栏两条、`app/misc.css` 状态栏 border/shadow、`app/shell.css` 硬编码 `rgba(31,35,41,.055) !important` 描边色、`styles/shell.css` 圆角统一 `!important`。
  - 实测（三套主题 `getComputedStyle`）：轨道描边 = 令牌色（light `rgb(231,233,236)` / dark `rgb(42,47,53)` / warm `rgb(231,223,208)`）；rail 按钮 32px/10px；dock 6px；状态栏实心 + 1px 描边、状态药丸软底。
  - 底账已打勾：**A1–A7、A12–A14**（见 `docs/UI-REDESIGN-260921/01-ELEMENT-LEDGER.md`）。
- **P5 逐屏迁移（第 2 片：顶栏 / 标签页 / 面包屑）**：chrome.css 87 → **189 声明**（仍 **0 `!important` / 0 颜色字面量**）。
  - 顶栏：`.toolbar__item`（工作空间触发 + 右侧搜索/同步钮）26px 高、sm 圆角、hover/active/焦点环按规格；同步钮状态色直连 `--lake-status-pending/error`（不再经旧别名）。
  - 标签页：`.tab-item` 圆角 md、默认 text-3、hover bg-hover、**active = 画布底 + 1px `--lake-border-2` + `--lake-shadow-card`**；脏点 7→**6px** + `--lake-status-pending`；固定图标 text-4。
  - 面包屑（原样式**整段在思源层 `b3/layout.css`**）：新规则落 shell 层 —— 32px / 11px / text-3、下缘 1px `--lake-border-2`、笔记本名 text-2+600、分隔符 text-4、尾部「更多」按钮 26×24 xs 圆角；仍守「超长直接裁切不打省略号」。
  - 实测三套主题 `getComputedStyle`：面包屑 32px/11px/令牌色；页签 active 底=canvas、边=border-2、阴影=card；顶栏钮 26px；同步钮状态色随主题。
  - 底账：**A8–A10、A15 打勾；A11 记 `[~]`（页签本体已迁，溢出切换器菜单留 P5-c）**。
- **P5-c 逐屏迁移（浮层：对话框 / 菜单 / 气泡）**：新增 `src/styles/overlay.css`（layer overlay，57 声明，**0 `!important` / 0 颜色字面量**）。
  - 统一三类浮层表面：**实心底 `--lake-bg-panel` + 1px `--lake-border-1` + 抬升阴影**（`popover` / `dialog`），对应设计「全实心」决策。
  - 菜单项统一规格：高 **27px**、圆角 xs(6)、hover = `accent-tint` + `accent-text` + 600、危险项 = `status-error`；覆盖 `.top-menu` / `.context-menu` / `.context-menu-item` / `.create-menu` / `.tab-switcher-menu`。
  - 对话框：`.ln-dialog`（属性/历史）与 **`.floating-dialog`**（设置/回收站/历史面板，两套历史实现）统一到 radius-lg(14) + 面板底 + border-1 + dialog 阴影；`.modal-backdrop` 等遮罩走 `--lake-scrim`。
  - **拆掉阻塞的 legacy `!important` 1 处**：`styles/app/settings.css` 的 `border: 1px solid var(--floating-dialog-border) !important`（并把 `b3/components.css` 里三个 `--floating-dialog-*` 变量从 b3 令牌改指新令牌）。
  - 实测三套主题：菜单 面/边/圆角 10/内边距 6、项 27+6；`.floating-dialog` 底=panel、边=**border-1**（light rgb(231,233,236) / dark rgb(42,47,53) / warm rgb(231,223,208)）、圆角 **14**、dialog 阴影。
  - 底账：**B1 打勾**（工作空间菜单两项均实测存在）。
- **P5-d 逐屏迁移（设置面板内层）**：规格写进桌面专属的 `src/styles/feature.css`（限定 `.settings-panel` 作用域，**不改类名、不动移动端也加载的共享文件**）。
  - 分组标题 12px/600 text-2；分组卡 `--lake-bg-block` + radius 10；行 **≥44px** + 8/12 内边距 + 1px `--lake-border-2` 分隔；标签 12px/600 text-1；控件列 `min-width: 200px` 右对齐；左侧分类导航选中 = accent-tint + accent-text + 600。
  - 实测三套主题 `getComputedStyle`：title 12/600、items bg=block+radius 10、item 44px+分隔、name 12/600/text-1、ctl 200px、navActive tint —— 全部达标；设置面板截图核对。
  - **设置项存在性全量核对：56/56 全部存在**（默认可见 54 条；`sync-auto-interval`、`browser-open` 为**条件渲染**，已在源码核对条件）⇒ 底账 **C 区 56 条全部打勾**。
  - ⚠️ **两项被共享层 `!important` 挡住，本批刻意未迁**（见下文「待移动端批次」）。
- **P5-e 逐屏迁移（目录树行）**：chrome.css 189 → **244 声明**（仍 **0 `!important` / 0 颜色字面量**）。
  - 行：min-height **27px**（笔记本 29px）、圆角 sm、字 `--lake-text-1`、hover `--lake-bg-hover`、按下 `--lake-bg-press`（去掉原来的 `filter: brightness()`）。
  - **选中 = `--lake-accent-tint` 底 + `--lake-accent-text` 字 + 600（无左条）**；图标 `--lake-text-3`（选中转 accent）；展开箭头 16px/`--lake-text-4`；行内动作钮 20×20/xs 圆角。
  - **产品既有决策保留**：标题超长**直接裁切（`text-overflow: clip`）不打省略号**；行内动作（⋯ ＋）**仅 hover/聚焦显形**（选中不常驻）。
  - 删掉 `styles/app/shell.css` 里两条**颜色字面量**（`.note-row:hover #e9ebee` / `.note-row.active #eff0f0`）——行态单一来源改为 chrome.css。
  - 实测（三套主题 + **真实鼠标 hover**）：行 27/29px·圆角 8·字 text-1；选中底 tint（light rgb(236,239,245) / dark rgba(147,169,207,.14) / warm rgb(240,232,216)）+ accent-text + 标题 600；title `overflow: clip`；图标 text-3；箭头 16px；动作钮 20×20·6px；**hover 时 bg=bg-hover 且动作 display=flex**。
  - 仍待：**回收站/历史面板内层**（下一轮）。
- **P5-f 逐屏迁移（大纲侧栏）**：规格写在 `src/styles/feature.css`（桌面专属；outline.css 在 legacy 层 ⇒ 同选择器更高层天然胜出）。
  - 项高 26 → **25px**、字 13 → **11px**；默认 text-3、hover `bg-hover`+text-1、**选中 = accent-tint + accent-text + 600**；级别徽标 text-4 + `bg-block`；头部 12px/600。
  - **去掉选中项左侧竖条**（用户确认）：`.outline-item--selected::before { display: none }`，并清掉 `.outline-item` 的 `border-left`。
  - 实测（三套主题）：item 25px/11px/border-left 0/radius 6；selected 底 tint + accent-text + 600 + **`::before` = none**；level text-4。
  - ⚠️ **重要发现（先记录，正文在下）**：**默认配置下的大纲是内核原生 TOC**（设置项 `editor-outline-enhance` 默认 false ⇒ 直接用 Lake 原生大纲），不是我们的 `.outline-item`；上面这套只在用户开启「大纲增强」后生效。**内核原生大纲属编辑器外观（第三方），不在本次重做范围**。
- **P5-g 逐屏迁移（回收站 / 历史 / 搜索 面板共享件）**：kit.css 422 → **466 声明**（仍 0 `!important` / 0 颜色字面量）。
  - `.ln-tabs` **从「下划线页签」改成设计要求的「分段控件」**：轨道 `--lake-bg-block` + radius sm + 2px 内边距；选中段 `--lake-bg-raised` + `--lake-shadow-card` + 600；旧 `::after` 下划线隐藏。
  - `.ln-row2`（回收站/历史/搜索/草稿共用的两行行）：4/6 内边距 + sm 圆角 + `--lake-text-1`；hover `bg-hover`；选中（与思源 `--focus` 叠用）→ `accent-tint` + `accent-text`。
  - `.ln-toolbar` / `.ln-empty` 改走间距与文字令牌。
  - **实现要点**：这些类常与思源 `.b3-list-item` 叠用，但**本层高于 legacy ⇒ 普通规则即可胜出**，所以既没改 TSX、也没加 `!important`。
  - 实测（三套主题 + 截图）：tabs 底 = block、radius 8、内边距 2px、**下划线圈 `::after` = none**；选中段 22px 高 / `bg-raised`（light #fff / dark rgb(43,48,55) / warm #fffefb）/ 600 / radius 6；行 4/6 + radius 8 + text-1（回收站 274 行渲染正常）。
  - 仍待：面板内的 `.b3-button` 动作钮（清空 / 恢复 / 彻底删除）—— 属「01 按钮」批次。
- **P5-h 逐屏迁移（面板/对话框控件：按钮 + 输入 + 下拉）**：kit.css 466 → **525 声明**（仍 0 `!important` / 0 颜色字面量）。
  - **`.b3-button` 家族 → 设计 01 按钮**（桌面专属层；移动端不加载本层 ⇒ 移动端不受影响）：
    `.b3-button` = **primary 实心 `--lake-accent-ink`**；`--outline` = **描边 secondary**；`--cancel` = **ghost**；统一高 **27px** / 内边距 0 11 / radius sm / 12px·500 / 焦点环；hover/active/disabled 按规格。
  - **`.b3-text-field` / `.b3-select` → 设计 07 / 08**：高 27 / radius sm / 1px `--lake-border-1` / 画布底 / hover 边 `--lake-border-strong` / focus = accent 边 + 2px 光晕。
  - 实测：回收站「清空」= 27px·0 11·radius 8·12px·500（且保留危险色）；设置面板 `.b3-select` 三套主题均 27px/8px 内边距/radius 8/1px border-1/画布底/12px。截图核对（暗色设置面板）无破版。
  - ⚠️ 分段控件的段也带 `.b3-button--outline`，但 `.seg__item` 的 `!important`（共享层）压过本层 ⇒ 段外观维持现状（同「待移动端批次」第 2 条）。
  - ~~仍待（P5 收尾）：小记工作台、搜索面板~~ → **P5-j 已完成**（见下）。
- **P5-i 逐屏迁移（开关 + 页签溢出菜单项）**：kit.css 525 → **547 声明**、chrome.css 244 → **252 声明**（均 0 `!important` / 0 颜色字面量）。
  - **`.b3-switch` → 设计 09 开关**（桌面专属层）：轨 **32×19** capsule；关 = 透明 + 1px `--lake-border-1`、hover 边 `--lake-border-strong`；开 = `--lake-accent` 底 + 边；钮（`::after`）**15px**、关 `left 10.5px` / 开 `left 21.5px`、底 `--lake-bg-raised` + `--lake-shadow-knob`；按下钮宽 16；隐藏原 hover 光晕（`::before`）。
  - **页签溢出菜单项**：min-height 32 → **27px**、radius xs、hover `bg-hover`、选中 `accent-tint` + `accent-text` + 600；并删掉 `app/tabs.css` 两条**旧品牌色字面量**（`rgba(59,91,219,.11/.08)`）。
  - 实测：开关轨 32×19/radius 999、开态 `rgb(91,111,150)`（浅色 accent）、钮 15×15 且 left 10.5↔21.5、暗色钮底 `rgb(43,48,55)` + knob 阴影；截图核对（暗色设置面板）。

- **P5-j 逐屏迁移（搜索面板 + 小记工作台）—— P5 收尾**：overlay.css 57 → **83 声明**、feature.css 50 → **67 声明**（均 0 `!important` / 0 颜色字面量）。
  - **搜索面板**：面板表面沿用 overlay 层（**并覆盖掉 `app/dialogs.css` 里那条残留的「弹窗毛玻璃」**）；输入行改 `--lake-border-2` 分隔；输入字 `--lake-text-1`、占位 `--lake-text-4`；spinner 走 accent；关闭钮 22px/xs 圆角 + hover bg-hover；help 10.5px `--lake-text-4`；`.search-snippet` hover/选中按列表项规格。
  - **小记工作台**：`.quick-note-convert-dialog` 去毛玻璃 → 实心 panel + border-1 + radius-lg + dialog 阴影；卡片 `.quick-note-entry` = `bg-canvas` + 1px `--lake-border-2` + radius md + `--lake-shadow-card`（选中/多选 = accent 边 + tint）；`h1` 17px/600；索引行 hover/选中按列表项规格。
  - 实测：搜索面板 bg=panel、1px border-1、radius **14**、dialog 阴影、输入行 12px、help 10.5px/text-4；小记卡片 1px border-2 + radius **10** + 卡片阴影、h1 **17px/600**、5 张卡片渲染正常；暖色截图核对无破版。
  - **P5（逐屏迁移）到此收尾**；仅剩两项被共享层 `!important` 挡住（分段控件段态、设置项说明字号），已记入「待移动端批次」。
- **P6 第三方容器壳统一**：`feature.css` 67 → **71 声明**。
  - `.sheet-editor` / `.bitable-editor` / `.board-editor` 三类编辑器容器统一成 **radius md + 1px `--lake-border-1` + 画布底**（只统一容器层，**内部观感一律不动**；三个编辑器 CSS 是**未分层**的，所以只新增它们没设过的属性）。
  - 顺手把 `bitableEditor.css` 容器/左栏那几处 `var(--b3-theme-background, #fff)` / `var(--b3-border-color, rgba(...))` 等改成新令牌（少 4 条 b3 引用 + 若干字面量）。
  - 实测：**表格**容器 1px border-1 + radius 10 + canvas 底（网格铺在圆角内，截图核对）；**多维表**容器同样 1px border-1 + radius 10 + canvas 底（改令牌后底色由 bg-panel 变为 canvas）。
  - ⚠️ **画板没能完成视觉验证：打开画板会落进错误边界**（"该类型编辑器渲染出错（已隔离…）"，控制台 `TypeError: Wt is not a function @ BoardEditor-*.js`）。
    **已做归因**：在 `git worktree` 里构建 **origin/master（未改动基线）** 并打开同一个画板 —— **同样报错** ⇒ **既有 bug，非本次重构引入**；另核对本分支 diff 完全没碰 `src/features/board/**`、`editor/**`、`sheet/**`、`bitable/**`、`lakeRuntime.ts`。**待用户/后续会话单项处理**（可能与本项目 §2.15 记录过的 vendor 懒 chunk 打包问题同类）。
- **P7-a 令牌换血（为删 b3 铺路）**：把**我们自己 CSS 里**的 `var(--b3-*)` 全部换成等价的 `--lake-*`。
  - 先清点：我们自己的 CSS 只用到 **25 个不同 `--b3-*` 变量 / 401 处**（最大：`--b3-theme-on-surface` 68、`--b3-border-color` 50、`--b3-theme-primary` 45）。
  - 用**平衡括号**的脚本替换（连 `var(--b3-x, 字面量回退)` 的**回退一起删掉**），14 个文件 **399 处**；`--b3-dock-shadow-color`（被当阴影色用）特殊处理为 `--lake-shadow-card`。
  - **值等价**：这些映射与 P2 主题里的 b3→lake 桥接**完全一致**，所以是零视觉变化；仅 1 处源码级断言写死了旧令牌名（`sheetEditorMount.test.ts` 的细滚动条），已同步更新。
  - 实测（三套主题 `getComputedStyle`）：lake 令牌、`.note-row` 字色、`.tab-item.active` 底色、状态栏底全部正常。
  - **效果**：桌面侧 `var(--b3-*)` 引用 **599 → 200**（**剩余 200 全部在 `src/b3/*.css` 自身**，即下一步要删的思源层）；颜色字面量 **365+227 → 294+176**。
- **P7-b 删源（第一次尝试 —— 已回退，附完整归因 + 草稿）**：
  - 已把 b3 的**承重规则**与仍在用的**思源类**复刻到 `src/styles/compat.css`（**暂未导入**）：A. 壳层几何（`.tab-bar` fixed/尺寸、`.activity-rail` padding-top、`.tab-item` 行高/margin、`.sidebar.sidebar-docked` 卡片几何与 `!important` 抑制、`.workspace/.document-pane` 圆角）；B. `.b3-list-item*` / `.b3-label*` / `.b3-menu*` / `.b3-snackbar*` / `.b3-dialog` / `.b3-switch` 基础 / `fn__*` 工具类（`fn__none` 必须 `!important`，它负责隐藏 keep-alive 编辑器）。
  - 用**删前/删后计算值快照**（6 屏 × ~15 选择器 × 18 属性，脚本 `/tmp/lake-ui-shot/p7b-*.mjs`）逐项对拍：删源后**标签栏/活动轨/页签/侧栏的差异全部消失**（compat 生效），只剩 6 处（多为**有意的设计取值**：侧栏圆角 10、P5 的行内距）。
  - ⚠️ **但出现一处真实回归**：**工作区下拉菜单被定位到窗口底部**（`偏好设置` 的 rect y≈876，而触发按钮在 y=6）⇒ **设置面板打不开**。已排除视口覆盖假象（清掉 `setDeviceMetricsOverride` 后同样 876）。
  - **按「绝不丢功能」先回退**（`styles/index.css` 恢复 8 行 b3 导入），实测恢复：菜单回到 **y=58.5**、设置面板正常打开（`nav: 11 / title: 编辑器`）、vitest 全绿。
  - **下次继续的关键线索**：DOM 里存在**两个** `[data-top-menu-trigger="workspace"]`（一个 192×? @82,6、一个 0×0 @0,0）；菜单定位读的是 `wsMenuWrapRef` 的 rect，删源后它似乎指向了一个**底边=视口底**的元素。优先查「为什么会有第二个 trigger / ref 指向谁」，很可能与某个只在 b3 里存在的 `display/position` 规则有关。
- **P7-b 删源（第二次尝试 —— ✅ 成功）**：
  - **真因**（上一轮线索的答案）：`clampPopoverPosition` 的公式是 `top = max(6, min(anchor.bottom+6, maxTop))`，观测到 876 已超过 `maxTop=782` ⇒ 说明**内联坐标根本没生效**。根因是 **`.top-menu` 的 `position: fixed` 只写在 `b3/layout.css`**（注释写明"fixed + 内联坐标：逃离 document-pane 的 overflow 裁剪"），我们的 `overlay.css` 从未设过 `position` ⇒ 删源后菜单变 static、内联 top/left 被忽略、portal 落到 body 末尾（y≈视口高）。
  - **修法**：把这条定位搬进 `src/styles/overlay.css`（`position: fixed; top: 0; left: 0; z-index: 1000; display: flex; flex-direction: column; min-width: 170px`）。注意**只给 `.top-menu`**——`.context-menu`/`.create-menu`/`.tab-switcher-menu` 的定位在各自 legacy 规则里，不能一刀切。
  - **同时补齐首轮漏搬的**：`.config-*` 整套设置页骨架（漏搬时 `.config-name` 宽度从 510px 塌成 105px）、`.b3-select` 基础、`.b3-list-item` 的 `gap: 8px / margin: 1px 8px`、`.b3-label__text` 的 `margin-top: 4px`。
  - **对拍结果**（同一套 6 屏快照）：**元素消失 0 个**；差异从 22 → **8 处，且全部是有意的设计取值**：侧栏圆角 12→10（设计 radius md）、`.note-row`/`.quick-note-entry` 宽 −5px（P5 的行内距）、`.b3-select` 由内阴影环改为真 1px 描边（设计）、设置项高度 −20px（**说明文字从 13px 改为设计的小字号**）。
  - 🎁 **顺带解除「待移动端批次」阻塞项 ①**：原先 `.config-items .b3-label__text { font-size: 13px !important }` 在共享层挡住设计的小字号；删掉思源层后该 `!important` 不复存在 ⇒ 设置项说明**终于可以按设计显示小字号**。
  - **硬指标达成**：桌面侧 `var(--b3-*)` 引用 **200 → 0** ✅、入口 b3 import 行数 **8 → 0** ✅。度量口径同步升级为**「入口可达的桌面样式图」**（`ui-metrics.mjs` 沿 `@import` 求可达集）：`src/b3/*.css` 已只被移动端 import，故不再计入桌面指标（否则"保留给移动端的思源文件"会让指标永远归不了零）。
  - 剩余（P7 续）：颜色字面量 **109 hex + 102 rgb**（大头是 `styles/tokens.css` 65、`outline.css` 31）、`!important` **95**。
- **P7-c 归并 4 对同名文件 —— ✅ 完成（同名文件对 4 → 0，且用对拍证明零视觉变化）**：
  - **先证后动**：写脚本比对「被后移文件」与**所有中间文件**的 (选择器,属性) 交集 ——
    `editor` / `quick-notes` / `settings` 三对**选择器级交集为 0**；`shell` 对选择器级有重叠（`motion.css` 6 个），但**属性级交集为 0**（`styles/shell.css` 与 `motion.css` 那 5 条 `transition` 本来 motion 就在后面、本来就在赢）⇒ 四对都可安全前移。
  - 做法：`cat styles/X.css >> styles/app/X.css`（app 在前、polish 在后，保持文件内相对顺序），删掉 4 个 `styles/X.css` 与入口里对应的 4 行 `@import`。
  - **对拍**：同一套 6 屏计算值快照，**missing 0 / diffs 0** ⇒ 层叠等价，零视觉变化。
  - 同步更新：`cssLayers.test.ts` 的 FILES/BASELINE（去掉 4 个已删文件，`app/{editor,quick-notes,settings,shell}.css` 基线改为 69/519,8/122/511,10）、`quickNotesView.test.ts` 读的文件路径。
  - 指标：桌面样式文件 32 → **28**（入口可达）。
- **P7-d 颜色字面量（第一步：`styles/tokens.css`）**：
  - 先证：脚本比对 `tokens.css` 定义的 50 个变量 vs `themes/{base,light,dark,warm}.css` 的定义集 —— **50 个全被主题覆盖**（主题在 tokens 层，更高）⇒ 桌面端 100% 是死代码。
  - 做法：把 `tokens.css` 精简为**只留 4 段非令牌规则**（`@keyframes ln-indicator-in`、`.lake-editor-mount` 阅读态字号继承、`:where(...):focus-visible` 焦点环、两个无障碍媒体偏好块），删掉 `:root` 与 `[data-theme="dark"]` 两段共 50 个定义。
  - **文件位置不变** ⇒ 层叠等价；对拍 **missing 0 / diffs 0**。
  - 指标：颜色字面量 **109+102 → 67+79**。剩余大头：`app/shell.css` 33、`outline.css` 31、`app/tabs.css` 22、`attachment-preview.css` 15、`app/misc.css` 15。
- **P7-d 续（第二步）**：颜色字面量 **109+102 → 43+63**。
  - **删死回退**（机械且可证）：`var(--x, 字面量)` 里，只要 `--x` 在桌面可达集合里**有定义**，回退就是死代码 ⇒ 共删 **17 处**（shell 5 / misc 2 / quick-notes 1 / attachment-preview 1 / outline 8）。
  - **大纲 6 级调色板令牌化**：`outline.css` 的 6 组「级别色 + 级别底」（级别是**语义**不是主题色）收进 `themes/base.css` 的 `--lake-outline-lv{1..6}(-bg)` —— 字面量只允许出现在主题文件，使用处只引用令牌。`outline.css` 现 **0 字面量**。
  - 其余旧品牌蓝/中性色按语义换成 `--lake-accent-tint` / `--lake-bg-panel` / `--lake-bg-block` / `--lake-border-1` 等。
  - 对拍：**missing 0 / diffs 0**（大纲侧栏默认不渲染，故这批换色在快照里无差异）。
  - **P7-d 第三步（shell + tabs 清零）**：颜色字面量 **43+63 → 27+29**。
    - 方案：为**需要保留方向**的阴影与半透明叠层新增**取色令牌**（写进三套主题，字面量只在那里出现）：`--lake-shadow-color-1..7`、`--lake-neutral-veil-1..3`、`--lake-veil-soft/strong/open`、`--lake-hairline-soft`、`--lake-pinned-tint/-border/-tint-hover`。**深色/暖色各自给值**（深色更重的黑、暖色带暖调），所以方向与几何都保住，只是取色改为令牌。
    - `app/shell.css` **28 → 0**、`app/tabs.css` **22 → 0**（旧品牌蓝 → `--lake-accent*`；白/黑透明叠层 → veil 令牌；文字灰阶 → `--lake-text-2/3/4`）。
    - 对拍：**missing 0 / diffs 0**。
  - **P7-d 第四步（收尾，颜色字面量归零 ✅）**：27+29 → **0**。
    - 新增取色令牌（都写进主题文件）：`--lake-media-*`（媒体查看器：**任何主题下都是暗底**，故放主题无关的 `themes/base.css`）、`--lake-tooltip-bg/fg`、`--lake-conflict-border`、`--lake-board-canvas-{default,soft,dark,starry}`（drawnix 各 vendor 主题画布底色）、`--lake-error-shadow`。
    - 逐文件映射：`attachment-preview.css` 14→0、`misc.css` 13→0、`image-lightbox.css` 9→0、`dialogs.css` 5→0、`base.css`(两个 legacy 阴影变量)4→0、`quick-notes.css` 4→0、`vendor-board.css` 4→0、`editor.css` / `panels.css` / `components.css` 各 1→0。
    - 对拍：**missing 0 / diffs 0**。
  - ✅ **硬指标「颜色字面量只出现在主题文件」达成**：桌面颜色字面量 **394+234 → 0**。
- **P7-e `!important` 95 → 9 —— ✅ 达成（五项硬指标全部达成）**：
  - **先删玻璃**：删掉 `tokens.css` 的 `prefers-reduced-transparency` 块与 `app/dialogs.css` 的「弹窗统一毛玻璃」规则（用户决策是**全实心**，实心表面早已由 overlay 层给出）——正解是删掉源头，而不是继续用 `!important` 压制。
  - **批量去 `!important`**：桌面各域文件 **95 → 16**（思源层已删，绝大部分 `!important` 已无对手）。**用对拍找出真需要保留的 3 处**：
    - `components.css` 的 `.settings-panel-large { width: … !important }` —— 面板宽度由 JS 的 FloatingPanel 以 **inline style** 给出，**只有 `!important` 能压过 inline**（删掉后对拍立刻显示宽度 1000 → 840）⇒ 保留并加注释。
    - `components.css` 的 `.seg__item` 5 条 —— 与 `.b3-button--outline` 同元素、且该文件**双端共享**（原先记录的「阻塞项 ②」）⇒ 保留并加注释。
    - compat 的 `.fn__none { display: none !important }` —— 工具类语义要求 ⇒ 保留。
  - **a11y 改造（本步最漂亮的一处）**：把散在 `tokens.css` / `motion.css` 的 reduced-motion 契约**合并进新的最高层 `src/styles/a11y.css`**（`@import "./a11y.css" layer(a11y)`）。层序声明里 `a11y` 本来就是最后一层 ⇒ 这些规则天然压过所有其它层（含内核 legacy），**因此一个 `!important` 都不需要**，比原来靠 `!important` 取胜更正确、也不再和组件规则打架。
    - **实测验证**（CDP `Emulation.setEmulatedMedia` 模拟 `prefers-reduced-motion: reduce`）：正常态 `.tab-item`/`.sidebar`/`.tab-close`/`.tree-row`/`.dock-icon-btn` 过渡分别为 0.13s/0.19s/0.1s/0.25s/0.13s；**reduced 态全部变 0s** ⇒ a11y 契约仍然生效。
  - **顺手修一个真回归**：批量去 `!important` 时误删了 `.seg__item` 的必需项，对拍发现「分段控件变成描边按钮」⇒ 已恢复并在注释里写明原因。
  - 顺带：`.ft__error`（破坏性动作，如回收站「清空」）的红色此前被 kit 层的 `.b3-button--outline` 压过 ⇒ 在 kit 层补 `.b3-button.ft__error` 危险变体（**用层序/特异性取胜，不用 `!important`**）。
  - ⚠️ **围栏盲区（已修）**：`cssLayers.test.ts` 的扫描器**不进入 `@layer {}` 块**，所以「文件内自包 `@layer`」会被漏检 —— `a11y.css` 最初就是自包写法（围栏里声明数恒为 0）。已改为**与其它新层一致**（文件内不写 `@layer`，由入口的 `@import … layer(a11y)` 指定），围栏随即报出真实值 **9** 并纳入基线。
  - ⚠️ 注意 `tokens.css` 里还压着 **11 个 `!important`**（reduced-motion 6 + reduced-transparency 5），是 P7-e 的大头；其中 reduced-transparency 那两条 `backdrop-filter: none !important` 在"全实心"决策后本就多余（应改为删掉 `app/dialogs.css` 里的玻璃规则）。

### 二、过渡桥接（P7 删 legacy 时一并移除）
- 旧 `--lake-*` 名字（`--lake-shell/panel/canvas/surface/accent-soft/shadow-* …`）→ 指向新令牌。
- 思源 `--b3-*` 关键表面/主色/文字/边框/阴影/字体 → 桥接到新令牌（避免新旧两套配色并存）。
- lakex 编辑器外围变量按设计 MIGRATION §3 映射（背景/边框/正文色/光标）；**选区色按用户决策刻意不动**。

### 二·补 硬指标度量（P5 起随手可跑）
`node scripts/ui-metrics.mjs`（P5 新增）：桌面侧 `var(--b3-*)` 引用 / 颜色字面量（非主题）/ `!important` / 入口 b3 import 行数 / 同名文件对，并**分开**统计移动端（本批不动）。
- **基线（P5-c 后实测；口径已修正为「先剥块注释再计数」——早期把注释里的 `!important`/#hex 也算进去了）**：桌面侧 样式文件 41 · `var(--b3-*)` **604** · 颜色字面量 **hex 370 / rgb 230** · `!important` **103** · 入口 b3 行数 **8** · 同名文件对 4；移动端 `--b3-*` 233、`!important` 19；思源层 `!important` 32。
- **最大头（P7 优先）**：`features/bitable/bitableEditor.css`（b3 114 / 颜色 124）、`styles/components.css`（b3 95）、`b3/components.css`·`b3/layout.css`·两个 `b3/theme-*.css`（随 b3 一起删）、`styles/tokens.css`（颜色 74）。

### 三、门禁（P4 后实测）
`tsc` 0 · `vitest` **1210 passed / 16 skipped (1226)** · `check:core` 0 · `check:bundle` app-css **195KB**/2MB · `git diff --check` 干净。

### 四、下一步（P5 起）
P4 组件库 14 件 → P5 逐屏迁移（每屏对照底账打勾）→ P6 第三方容器壳统一 → P7 收尾（删源/归并 4 对同名文件/hex-rgb 收口/`!important` ≤10）→ P8 验收交付。

### 五·补 待移动端批次（本批刻意未做，桌面侧已就绪但被共享文件挡住）

> 这两条的 CSS 声明在**移动端也会加载的共享文件**里，且用了 `!important`（`@layer` 下 legacy 层的 `!important` 会压过任何新层，所以只能删、不能对压）。删了会让移动端外观发生变化 ⇒ 按「桌面做完再做移动端」的决策，**留到移动端批次一起处理**。

1. `b3/siyuan/business/_config.scss` 的 `.config-items .b3-label__text { font-size: 13px !important }` —— 挡住设计要求的**设置项说明文字 10.5px**（现为 13px）。
2. `styles/components.css` 的 `.seg__item` **5 处 `!important`**（`border/background/color` 与 `.is-active`）—— 挡住**分段控件 22px 高 / raised 选中**的设计规格；该 `!important` 是移动端用来压 `b3-button--outline` 的，动了会影响移动端。

### 五、坑（本批新增）
- **不要用反引号包裹内容去 `git commit -m`**：bash 会做命令替换，提交信息被吞（本批踩一次，已 `--amend -F` 修正）。
- 隔离实例克隆 dev 数据时**必须删 `SingletonLock/Socket/Cookie`**，否则 Electron 单实例锁判定「已有实例」直接退出。
- `@layer` 的 `!important` 层序是**反的**（早层重要声明赢）：迁移某元素时必须把 legacy 里的 `!important` 一起删干净。

## 2.23 本会话总交接（260921-2 · UI 视觉优化批次，14 个提交）—— 新会话从这里读

> 承接 §2.22（UI 重设计 P0–P8：剥离思源层 + 自有设计系统，五项硬指标已达成）。
> 本批是**用户验收后反馈「太丑」引发的视觉回修 + 顺手挖出并修掉的一批真 bug**。
> 分支：`feat/ui-redesign`（**已 push origin 备份**）。**本批 14 个优化提交的末提交 = `fc04ac9`**，其后是本交接文档提交；**未合 master**；`origin/master` 仍是 `17bafbe`。

### 一、任务目标（用户本批原话与约束）

1. 用户看过后说「**这个版UI太丑了啊，怎么会这个样子**」→ 要求**批量优化**。
2. 约束（**用户明确立规，后续必须遵守**）：
   - 选中态**蓝底保留**（不要改回中性灰）；
   - 「**除非要压内核和组件的样式，否则尽量不要层级压层级，同时要注意规范**」→ 已写进 `AGENTS.md §3 #14` 的「改动落点」条；
   - 「**绝对不能合并到 master，你这版是备选**」；
   - 用户同时在**另一个会话重做**（主检出里有其探路文件 `style-directions.html` / `handle-variants.html` / `layout-space-*.html` / `product-shell.html` / `real-shots/` 等，**不要动**）。
3. 用户在过程中两次用截图直接指出真 bug（这是本批最有效的发现链路，见「踩过的坑」）。

### 二、已完成内容（14 个提交，均在 `feat/ui-redesign`，已 push origin）

**A. 视觉优化 3 批（对齐「改造前观感」，不动架构）**
- `5d98854` 第一批：**字号阶梯整体 +1px**（micro 10.5→11.5 / tiny 11→12 / small 12→13 / body 13→14 / bodyLg 14.5→15.5 / title 17→18 / h1 23→24，目录树行与设置说明**回到 13px**）；**层次恢复**（`--lake-bg-panel` → `#ffffff`、`bg-block` 更明确、卡片阴影加强、深色 panel 比 window 亮一档）；**hover 由 5% 透明叠层改实色** `#e9ebee`；**主色提饱和**（`#5b6f96→#4f6bb8`、深色 `#93a9cf→#8ba4e6`）；**深色下内核编辑器纯白修复**（见 D）。
- `8d0fdf3` 第二批：对齐 master 取值（`.note-list` 内距 5px、`.note-row` `padding: 2px 7px` 去掉 min-height、行色 text-2 / 标题 text-1、`.tree-row-action` 18px、选中页签纯 raised 底）；**修回归**：动作按钮显形条件由 `:focus-within` 改回 master 的 `has(:focus-visible)`（否则鼠标点击后的残余 focus 会把 ⋯ 钉住、把标题从 49px 挤到 31px）。
- `ce60395` 第三批：活动栏按钮 32→**28px**、补 `transform: scale(.965)` 按压反馈、目录栏图标钮 hover 由中性底改**主色淡底**（master 就是 accent-soft）；并把「改动落点」规矩写进 `AGENTS.md §3 #14`。

**B. 深色主题逐屏体检**
- `a2628f8` 深色下内核 **`.ne-ui-toolbar` 纯白 452×38** 与文档内图片占位块发白 → 补进「内核主题桥」（feature.css）。复测：主界面/设置/回收站/搜索/**小记** 五屏扫描**全部为空**。
- 暖色主题 5 屏 + 深色下表格/多维表容器：同样扫过，**干净**（只剩有意项：暖色青铜强调按钮、黑视频底）。

**C. 小记按钮语义回归**
- `e0a4433` master 的「小记一下 / 取消」是**中性描边胶囊**（有内容时 `.is-emphasized` 才变主色实心），我的 kit 把 `.b3-button` 一律做成实心 → 两个都变大蓝按钮。修法按用户规矩：在 kit.css 用 `:not()` 把这两类**从通用按钮规格排除**（**不新增层**、不动双端共享的 `app/quick-notes.css`）。实测：空输入=白底+1px 描边；有内容 publish=`rgb(79,107,184)` 强调实心。

**D. P7-b「删源」漏搬样式的一批真 bug（用户截图触发，本批最有价值的产出）**
- `2b6cd20` **菜单项布局三件套**（`display:flex / align-items:center / gap:8px`）——用户截图报「图标和文字贴在一起」；同批补回 `.tabbar-trailing`（顶栏右槽位，**之前完全没样式**）、**`.sync-toast*` 12 条 + 入场关键帧**（同步浮窗，**之前完全没样式**）、`.toolbar__sync.syncing svg` 转圈 / `.error` 变红、空间名 `text-overflow: ellipsis`、三个提示气泡圆角、`.context-menu-submenu` 内边距圆角。
- `f5cc383` **活动栏右侧那条 1px 竖线**（用户报「顶部红绿灯区域没有融合」）—— 那是 **P5 我自己加的**，master 本是 `border-left/right: 0`；删掉后分界改由目录栏卡片边提供。
- `fa778ef` **大纲轨 / 收起悬停展开**（大纲增强态，用户可开启）。
- `651c926` **全局细滚动条**：实测 `.note-list` 滚动条 **15px（系统默认）**，设计是 **10px** —— 自绘在 `siyuan/util/_scroll.scss` + `b3/layout.css`，同样漏搬。补回后实测 **10px**。⚠️ 沿用 260914 结论：**绝不写全局 `scrollbar-width/color`**（标准属性会让 Chromium 忽略 `::-webkit-scrollbar` 自绘）。
- `4011e68` 审计剩余 5 条：`.toolbar__item{white-space:nowrap}`、`.toolbar__menu-wrap{position:relative}`（下拉锚点）、`.top-menu > button span{min-width:0}`、`.protyle-breadcrumb{flex-shrink:0}`、面包屑 focus 圆角。

**E. 误判更正 / 死代码清理 / 交付文档**
- `89301c7` + `c6d32fe` 深色工具条图标「发暗」——**实为 antd 禁用态**（33 个按钮全部 `disabled: true`，禁用色 `rgb(88,90,90)`），**不是主题 bug**；改造前基线同样。**结论：不加任何覆盖**（否则会把真正禁用的按钮照亮）。曾误记为「已知缺陷」，已更正。
- `954d24d` 删掉 `app/misc.css` 里 3 条与 `chrome.css` **逐字重复**的死声明（`.note-row:hover` / `.tab-item{background:transparent}` / `.tab-item:hover`）。
- `fc04ac9` **「改造前 vs 现在」逐屏并排对比页**：`docs/UI-REDESIGN-260921/compare/index.html`（10 组：主界面/工作空间菜单/偏好设置/回收站/小记 × 浅·深，左=master 基线、右=现在，点图放大；每组附一句「这屏改了什么」）。

**F. 审计方法（本批遗产，建议固化）**
把 master `src/b3/*.css` 里**打向我们自己类**的规则（不含 `.b3-`/`fn__`/`__`）**展开逗号选择器**后，按 `(选择器, 属性)` 与当前分支桌面样式全集比对，只看**布局类属性**（display/position/gap/padding/margin/width/height/flex/overflow/white-space/animation/border-radius/top/left/z-index…）→ 找出「漏搬」。本批 **71 → 15 → 5 条**，其余经核对为**假阳性**（选择器写法不同如裸类 vs 带父级、同元素多类、TSX 已不使用、脚本把注释当选择器）。临时脚本见 `/tmp/lake-ui-shot/b3gap3.py`（临时目录，重写约 30 行）。

### 三、当前问题（均已知、不阻塞）

1. **画板（drawnix）打不开 = 既有 bug，非本批引入**：打开画板落进错误边界，控制台 `TypeError: Wt is not a function @ BoardEditor-*.js`。已用 **origin/master 未改动基线**复现同样的错 → **建议单独立项**（可能与本项目 §2.15 记录的 vendor 懒 chunk 打包问题同类）。因为渲染不出来，画板容器壳**未做视觉验证**（表格/多维表已验证）。
2. **默认配置下的大纲是内核原生 TOC**（`editor-outline-enhance` 默认 false）→ **编辑器外观（第三方）**，不在本次重做范围；我们自建大纲（增强态）已迁移并通过实测。
3. **审计剩余**：`.tree-row{border-radius}`（与 `.note-row` 同元素，已覆盖）、`.sync-panel` / `.form-grid` / `.secret-field`（TSX 已不使用）——**无需处理**；如后续要再查，按 F 的方法重跑即可。
4. **冗余分支**：`feat/ui-redesign-opt` 与 `feat/ui-redesign` 指向同一提交（收尾时已 FF 合并、worktree 已撤），**可删**。
5. **移动端零改动**：`src/mobile/**` 未动；`src/b3/*` 仅保留给移动端加载。

### 四、下一步计划（按优先级）

1. **等用户测试反馈**（本批证明：用户截图链路比自动体检有效 —— 两次真 bug 都是这么发现的）。用户若在另一会话定稿了设计方向，在这个备选分支上**只改 tokens/kit 即可**（架构不动）。
2. **顶栏 / 标签页观感细调**：目前几何仍是 master 原值（`.tab-item` 29px/6px margin/8px padding），若用户觉得仍偏重可再收。
3. **把 F 的「漏搬审计」固化进 `scripts/ui-metrics.mjs`**（或新脚本 + 单测）：防止将来再有「删样式层漏搬」。这是本批最有复用价值的资产。
4. 继续收「贴近改造前」的细节：`.toolbar__text` 宽度（现 180px / master 160px）、`.tree-row.type-notebook` 行高与图标对齐等。

### 五、踩过的坑（本批新增，务必记住）

1. **删一个样式层后，必须逐属性比对，不能只看「页面没坏」**。P7-b 把 `src/b3/*` 移出桌面入口时只搬了部分承重规则，之后用户陆续发现：菜单项图标贴字、活动栏竖线、同步浮窗**完全没样式**、`.tabbar-trailing` **完全没样式**、滚动条回落系统 15px。
2. **「颜色/背景」逐屏体检抓不到布局丢失**。我扫 `backgroundColor` 的体检报告五屏全绿，但 `gap/display/padding/border` 全丢了 ⇒ 体检要按 **(选择器, 属性) 属性集**比对。
3. **测试环境借用了用户的端口，验的是别人的构建**。我一连几轮用 `http://127.0.0.1:1442`，而那个端口是**用户会话从主检出起的 preview**（`lsof -p <pid> -a -d cwd` 才看出 cwd 是主检出）⇒ 部分「验证通过」其实验的是主检出的旧产物，还让我误判「改了我这边没生效」。**教训**：用**独立端口**（本批后段改用 1452）；先确认 `dist` 与 `lsof cwd` 一致；`vite preview --strictPort` **报端口占用要当错误处理**，不要忽略。
4. **围栏基线没同步就提交**（`cssLayers.test.ts` 的逐文件声明数上限）：本批**两次**在红着的时候提交，都是发现后 `--amend` 修基线。**规范：先跑绿、再 commit**。
5. **「正则 + 花括号配平」搬 CSS 规则太脆弱**：批量搬页签规则时，`.tab-items`（轨道）被 `.tab-item*` 前缀误匹配删掉、`@media` 内嵌套规则漏掉 ⇒ 发现后立即 `git checkout` 回滚。**教训**：跨文件搬规则要么不做，要么**先干跑 + 精确白名单匹配 + 每步对拍**。
6. **`var(--x, 字面量)` 的回退是死代码**（只要 `--x` 在桌面可达集合里有定义）——本批删 17 处，颜色字面量直接下降，且**零视觉变化**。
7. **省略号会白吃一个字宽**：窄容器里 `text-overflow: ellipsis` 比 `clip` 少显示一个字（49px 时：3 字+… vs 4 字）⇒ 目录树标题最终**按产品既有决策保留 `clip`**（面包屑保留省略号）。
8. **antd 禁用态会被误判成 bug**：深色下工具条图标「发暗」其实是那 33 个按钮 `disabled: true`（禁用色 `rgb(88,90,90)`）；注入同样的 `color` 规则能改，说明选择器没问题 ⇒ **先查元素状态，再改样式**。
9. **`:focus-within` ≠ `:focus-visible`**：用前者会把「鼠标点击后的残余 focus」也当成显形条件（动作按钮常驻、标题被挤窄）。master 用的是 `.tree-row-actions:has(:focus-visible)`。
10. **内核运行时注入的「无层」样式层序压不过**（如 `.ne-editor-wrap-box{background:#fff}`、antd/内核给元件写的 inline style）⇒ 只能 `!important` 或改内核；但 `!important` 有预算（全桌面 ≤10，当前 9）。
11. **在 worktree 里的改动，用户在主检出看不到**。本批末按用户要求把 `feat/ui-redesign-opt` **FF 合回 `feat/ui-redesign`** 并 `git worktree remove`；用户随后可自行测试。（另：worktree 会让某些 GUI 的分支树显示异常。）
12. **bash heredoc 里写 JS 模板串/正则极易写坏命令**（本批踩多次：`\n` 被展开、双引号未转义、`$` 插值）⇒ 改用 `tools.write` 落一个脚本文件再执行；**不要在 JS 双引号串里写未转义的引号，也不要在模板串里写未转义的反引号**。
13. **导出子菜单在底账里曾经过时**（漏记「导出为 Word（开发中）」「导出为原生 Lake」）⇒ 「以现网为准」不只是口号，核对时要按实际项更新底账。

## 2.24 本会话总交接（260922 · UI 主题 A/B/C + 空间切换 + minimap）—— 新会话从这里读

> **写给完全没有上下文的新会话。** 分支 **`feat/ui-theme-abc`**（自 `feat/ui-redesign` @ `d3bfc56` 切出）。
> **全部未提交**（铁律⑦：等用户验收）；**绝对不要合 master**（用户红线：`feat/ui-redesign` 仍是备选）。
> 规格：`docs/UI-REDESIGN-260921/04-LAYOUT-SPACE-SPEC.md` · `05-THEME-TOKENS-ABC.md` · `06-BASELINE-REVIEW.md`。

### 一、任务目标（用户 260922）

1. 基于 `feat/ui-redesign` 做**视觉层重构**（架构续用，不改业务逻辑）。
2. **绝对不改功能**；**小记布局结构不动**（仿云端 Lake，只对齐主题质感）。
3. **回收站做成与小记同级的独立空间**（成页，布局贴近原弹窗，可微调留白）。
4. 重点做好 **目录栏 + 增强大纲**：整边触发 / 悬浮与固定 / 可调宽。
5. 主题：**A 亮·蓝（默认 light）· C 亮·橙（warm）· B 暗·紫（dark）** 全保留。
6. 空间切换 **S1 + A 图标**：并进工作空间菜单 + 顶栏嵌当前空间图标；**去掉活动栏**；⌘1/2/3。
7. **UI 改动必须改根位置，禁止一层层套 CSS**（已写入 `AGENTS.md` §3 #14「改动落点」硬约束）；唯一例外 = 压内核/第三方无层样式。

### 二、已完成（`feat/ui-theme-abc` 工作区，未提交）

**A. 主题 A/B/C（只改值）**
- `themes/light.css` = A 亮蓝（`#3d7eff` 族）· `themes/warm.css` = C 亮橙（`#ff6a00`）· `themes/dark.css` = B 暗紫（`#9b94ff`）。
- `src/lib/themes.ts` 显示名：亮 · 蓝 / 暗 · 紫 / 亮 · 橙。
- 硬指标仍全绿：b3=0、颜色字面量=0、`!important`=9。

**B. 空间模型 S1+A**
- `DesktopWorkspace` 增加 `"trash"`；三空间：资料库 / 小记 / 回收站。
- 顶栏工作空间钮内嵌 **18px 软底空间图标**（Files/Feather/Trash）+ 合一菜单（空间 ⌘1–3 + 偏好设置）。
- **去掉「历史快照…」菜单项**（用户要求）；活动栏不再渲染（`activity-rail-hidden`）。
- ⌘1/2/3 在 `useDesktopLifecycle`。

**C. 回收站成页**
- `TrashPanel` 增加 `embed`：`trash-space-pane`（对齐 `quick-notes-pane`），**不是** `floating-dialog`。
- 布局沿用弹窗（文档/小记页签、列表+预览、恢复/彻底删除）；打开回收站 = 切空间。

**D. 目录 / 增强大纲**
- 左 `edge-hotzone` + 右 `outline-sidebar__trigger` **整边触发**；📌 在面板头固定（无空白叠宽）。
- **去掉右侧 38px 常驻轨**；收起不占列。
- 调宽 200–420 仍可用；大纲 `right: 0` 贴窗口右缘（修空隙）。
- **minimap 按条目画横线**（完全仿内核 `.ne-toc-small-view`）：22px+6 间距、2px 线、depth 定宽 24/16/12/8/4/2、选中 accent；条数=真实条目数。组件 `OutlineMinimap.tsx`；左目录用 `treeNodes` 同款。

**E. 钉住页签**
- `.tab-item.pinned` = `--lake-accent-tint` 浅染 + 图钉 accent（根规则在 **chrome.css**，因 shell 层会盖掉 legacy 的 tabs.css）。

**F. 文档**
- `AGENTS.md` #14 改动落点强化；`settingsSearch` 主题关键词；`cssLayers` 基线已按需上调。

**门禁（会话末）**：`tsc` 0 · `vitest` 1210 passed / 16 skipped · `ui-metrics` 五项全绿。

### 三、当前问题 / 待用户确认

1. **「继续优化…」三条 ✅ 260922 续已做**（均在 `feat/ui-theme-abc` 工作区，**未提交**）：
   - **窗口底部「不可见横条」根因已定位** = **左侧整边热区 `.edge-hotzone` 的 minimap 尾巴**：热区 `top: topbar+28 / bottom: 0`（全高）+ `overflow:hidden`，而浮层只到「窗口底 −72px」⇒ 面板下沿与窗口底之间露出 minimap 最后 2~3 条横线（用户截图底部左侧的短横线）。**修法**：浮层铺到窗口底后自然盖住；热区 top 也随浮层移到工具条下缘。
   - **目录浮层不再「半幅」**：`top/bottom 72px` → 顶 = **编辑器工具条下缘**、底 = **窗口底**。
   - **增强大纲同规格**（与目录引用同一对令牌）。
2. **正文右移让 minimap ✅ 260922 续已做**（用户 260922 追加：块手柄与目录缩略图错乱）。**根因**：左侧整边缩略图条是浮在壳上的 39px 覆盖层（`chrome.css .edge-hotzone`），而正文块手柄是 `position: fixed` 画在块左缘外 34px（标题还要再让 20px 折叠钮）⇒ 实测段落手柄 x=6..40、H1 手柄 x=-14（既压住缩略图、又跑出窗口）。**修法**：非停靠态 `.document-pane { padding-left: 53px }`（= 条 39 + 块操作槽 54 − 内核正文左内距 40）⇒ 正文块左缘 93、手柄命中区 ≥39，与缩略图条**严格不重叠**；停靠态目录自己占列、条被目录卡盖住，不加。**实测（1280×820）**：collapsed 下 pane 内距 53 / 正文块 x=93 / 工具栏与面包屑 x=53 / H1 手柄 39..73（缩略图条 12..36）；docked 下块 x=308（侧栏右缘 264）不受影响。围栏基线 `shell.css 511→512`（合法新增）。
3. 用户对误解「收窄=高度」发火：**高度一律不动**；收窄只指水平留白。
4. 未 commit / 未 push；`docs/UI-REDESIGN-260921/*.html` 原型仍 untracked。
5. 画板 BoardEditor 崩溃 = master 既有问题，与本批无关。

### 四、下一步计划

1. ~~按用户口径做「继续优化」三条~~ ✅ **260922 续已做**：几何令牌单一来源 = `--lake-floating-panel-top`（= 顶栏 38 + 面包屑 36 + 内核工具条 38 = **112**）/ `--lake-floating-panel-bottom: 0`；目录浮层、大纲浮层、左右整边热区全部引用同一对令牌。改动文件：`src/styles/app/shell.css`、`src/features/outline/outline.css`、`src/styles/chrome.css`。**隔离实例（1280×820）实测**：三者均 `y=112 / bottom=820 / h=708`，工具条完整可见，底部 minimap 尾巴消失。门禁：`tsc` 0 · `vitest` 1210 passed / 16 skipped · `ui-metrics` 五项全绿 · `git diff --check` 干净。
2. ~~正文右移~~ ✅ **260922 续已做**：见 §3 第 2 条（`.document-pane` 非停靠态 `padding-left: 53px`；**未改任何** `ne-*` 正文列宽规则）。
3. 用户真机点验主题 / 空间菜单 / 回收站成页 / minimap 条数随大纲变化 / 钉住页签。
4. 验收后整理 commit（**不 push master**）。

### 五、踩过的坑（本批，务必记住）

1. **`workspace-view` 是 `display: contents`**：子节点直接进 `.workspace` grid；成页要像 `DesktopQuickNotes` 那样「tab-bar + pane」兄弟节点，不要再包一层浮层壳。
2. **`floating-dialog` 不要挂在成页上**：会居中/浮层/可拖，看起来永远像弹窗。
3. **chrome.css（shell 层）会盖掉 legacy 的 tabs.css**：`.tab-item` 在 chrome 写 `background: transparent`，legacy 的 `.tab-item.pinned` **输在层序**（层序优先于特异性）→ 钉住样式必须写在 chrome。
4. **outline 右缘空隙的根**在 `shell.css` 浮动定位：`right: calc(rail + scrollbar-clearance)`；要贴边就改**这一处** `right: 0`，不要再叠规则。
5. **热区与浮层重叠会闪烁**：浮出面板盖住 edge → leave → 收起 → enter → 弹出。修法：edge `pointerLeave` 时 `relatedTarget` 仍在 shell 内则不收 + 延时 220ms。
6. **`LAKE_DEV_SERVER_URL` 不能带尾斜杠**（`isAppPageUrl` 比的是 `URL.origin`）；隔离实例：`vite preview` + `LAKE_USER_DATA` + 独立 CDP，**勿用用户 9222**。
7. **cssLayers 围栏**：加 CSS 后声明数会红；要么收敛重复，要么只上调该文件基线并注明理由。
8. **用户沟通**：「收窄」= 宽度/留白；「不要越过工具栏」= 热区最高到工具栏；高度不要自作主张改。**听不懂就问，不要连改三轮。**
9. **工具调用会被 flood 取消**：批量改文件时 **1–3 个/步**；heredoc/正则搬 CSS 仍易写坏（沿用 §2.23 教训）。
10. **内核原生 TOC minimap 几何**（`vendor/.../lakex-doc.css` `.ne-toc-small-view`）：item 高 22 + 下距 6；`:before` 线 2px，depth1–6 宽 24/16/12/8/4/2；选中主题色。仿它就按**条目**渲染，不要 repeating-gradient。
11. **固定定位 + `height: auto` + 同时给 `top`/`bottom` 在 Chromium 下不会撑满**：实测 `top:112; bottom:0; height:auto` → 盒子仍取内容高（957）并把 top 顶到 0（内容溢出视口）。浮层必须给**显式高度** `height: calc(100vh - var(--lake-floating-panel-top) - var(--lake-floating-panel-bottom))`。
12. **浮层几何只能有一处公式**：目录浮层、大纲浮层、左右热区都引用 `--lake-floating-panel-top/bottom`；`outline.css` 里旧的 `max-height: calc(100% - 144px)` 是「半幅」残留（会把新高度又压回 676），已删。
13. **`.edge-hotzone` 是「整边热区」，它的 minimap 会画满全高**：任何「浮层只占一部分高度」的写法都会让 minimap 尾巴露在浮层外（260922 报的「底部横条」）。浮层几何与热区几何必须同源。
14. **块手柄需要 54px 左侧槽**：`BlockHoverHandle` 的命中区 `hitAreaWidth=34` + 标题折叠钮 `ne-heading-fold` 20px ⇒ 正文块左缘必须 ≥ 条宽 + 54；内核 `.ne-engine` 默认只给 40px 左内距（右侧 56px 才是我们的）⇒ 单靠内核内距 **H1 手柄会跑到 x=-14**（既压缩略图又出窗口）。
15. **停靠/非停靠必须分开写**：目录停靠时左侧条被目录卡盖住（z-index 250 > 30），编辑区不需要让位；写成无条件 `padding-left` 会让停靠态白吃 53px、正文无谓变窄。


## 2.25 本会话批次（260922 · 增强大纲「进编辑区」A 方案第一步）—— 分支 `feat/ui-opt-260922`

> 用户 260922 定调：**先只做增强大纲**（原生大纲、目录树都不动）。参照飞书 wiki 的「文档目录」形态：面板是**编辑区内部的一块**（不是 app 第 4 列），顶边**运行时动态量**、绝不盖住内核工具条。
> 分支：`feat/ui-opt-260922`（= 交接基线 `604913a` + 本批提交）；基线备份 `backup/ui-theme-abc-handoff-260922` / `feat/ui-theme-abc`。

### 一、改了什么
1. **动态顶 `--lake-editor-top`**（新 `src/hooks/useEditorTopVar.ts`，写回 `.document-pane`）：量 pane 内**从顶部连续停靠**的 chrome 栈底边（`.protyle-breadcrumb` + `.ne-ui`），ResizeObserver + MutationObserver + window resize 驱动；工具条隐藏/换高自动跟随，明显有间隙的浮动元素（将来）不计入。
2. **DOM 搬家**：`<OutlineSidebar>` 由 App 顶层改为经 `DesktopLibrary` 的 `outlineSlot` 渲染进 `.document-pane`（**仍是单实例**，不是每标签一个；`.tab-panels` 是它的兄弟）。
3. **几何（以内核原生大纲为基准；260922 二次修正）**：`.outline-sidebar` = pane 右缘的绝对定位**槽位**（宽 `--outline-sidebar-width`，整体 `right: var(--lake-outline-clearance)`=13px 给垂直滚动条）；内容/触发器/桥 `top: var(--lake-editor-top)` + 显式 `height: calc(100% - …)`；**固定态的「让位」只加在正文块上**（`.ne-engine { padding-right: calc(56px + var(--lake-outline-inset)) }`，原生是 `ne-normal-toc .ne-engine > * { margin-right: 280px }`）⇒ 面包屑与内核工具条保持**满宽**（不出现右上角缺口），状态栏 `right` 同步让位。
4. **删栅格列**：`--outline-grid-w` 取消（`desktopDerivedState` 改注入 `--lake-outline-inset`），`outline.css` 4 列→3 列、`misc.css` 3 列→2 列。
5. **固定态与悬停态同一个盒**（用户 260922 定稿，替代先前「固定态填满槽位」的错误做法）：两者都 `top: var(--lake-editor-top)`、底 = pane 底、整体右让 13px；唯一区别是固定态把正文推开（引擎右内距），悬停态浮在正文上。

### 二、实测（隔离实例 1280×820；原生基准与增强版同实例对照）
**原生大纲基准（`outlineEnhance=false`）**：`.ne-toc-sidebar` x1225..1265 / y**112**..808（`right:15px` 让滚动条）、`.ne-ui` x53..**1280**（**满宽、不被大纲收窄**）、正文块 `margin-right: 280px`。
**增强版（`outlineEnhance=true`）**：

| 状态 | `--lake-editor-top` | 面板盒 | 面包屑/工具栏 | 正文块 |
|---|---|---|---|---|
| 收起 + 悬停 | 70px | x1067 **y112** w200 h708 b820（右让 13） | r=**1280**（满宽） | r=1214（不让位） |
| 固定 | 70px | x1067 **y112** w200 h708 b820 | r=**1280**（满宽） | 引擎右内距 256 ⇒ r=**1014**（让位） |
| 工具条 `display:none`（只读/隐藏/未来浮动） | **32px**（回退到面包屑底） | y**74**..820 | 满宽 | 同上 |

固定态触发器 `display:none`；滚动条 10px 在 1270..1280，面板右缘 1267 ⇒ 可点可拖。**原生大纲、目录树未动**。

### 三、坑（本批新增，务必记住）
- **动态顶必须「从 pane 顶连续」地量**：工具条顶在 pane 顶下 32px，只判「贴近 pane 顶」会把它整个漏掉（本批踩过）。做法 = 候选按 top 排序、只收与当前栈底相接（tol 8px）的。
- **绝对/固定定位 + `height: auto` + `top/bottom` 在 Chromium 下不撑满**（会被内容顶出视口）→ 必须显式 `height: calc(100% - var(--lake-editor-top))`。
- **同文件里更早的高特异性规则会赢**：旧 `.outline-sidebar--docked .outline-sidebar__content { top:0; bottom:0 }` 把新的固定态几何覆盖回 0（已改写）。改大纲几何要全文件搜同一选择器。
- **「让位」只能加在正文块上，不能推 pane**：推 pane 会把面包屑/内核工具条一起收窄、面板顶边上方出现空白缺口。内核原生的做法就是只推正文（`ne-normal-toc .ne-engine > * { margin-right: 280px }`）、工具条满宽。
- **面板要整体右让滚动条宽度**：原生 `.ne-ui-scrollbar-visible .ne-toc-sidebar { right: 15px }`；我们 `right: var(--lake-outline-clearance)`（13px，单一来源 `OUTLINE_SCROLLBAR_CLEARANCE`）。否则面板会盖住垂直滚动条、拖不动。
- **面板必须盖住缩略图**：`.outline-sidebar__content` 的 z-index 必须 > 触发器(3) 与桥(4)（现为 **5**）。用户 260922 报的「悬浮大纲右侧被缩略图横线压住」就是这个层序问题；收起态因为 `visibility:hidden` + `pointer-events:none` 不挡缩略图命中（实测 `elementFromPoint` 仍命中 trigger）。

### 四、下一步
1. 用户真机点验：固定/悬停/收起三态手感、缩放手柄、筛选/展开级别、窄窗、专注模式。
2. 目录树**暂不动**（用户明确）；将来若做，复用同一 `useEditorTopVar` + 同一「槽位」模型。
3. **待用户定的偏差**：本批按原生「工具栏满宽、只推正文」实现 ⇒ 大纲**不会**让内核工具条压缩。若用户要「打开大纲时工具栏也变窄、触发内核压缩/更多」，把内推从引擎挪回 pane 即可（2 行），代价是右上角会留一块空白。

## 2.26 本会话批次（260922 · 目录栏：去缩略图 + 壳层回归满宽 + 触发条/块手柄边界）—— 分支 `feat/ui-opt-260922`

> 用户 260922 定稿的**第一步**（三态大方案见原型 `docs/UI-REDESIGN-260921/dir-panel-3states.html`，**已认可但暂不实施**）。

### 一、改了什么
1. **去掉目录栏缩略图**：`App.tsx` 中 `.edge-hotzone-l` 内的 `.toc-minimap` 整块删除（热区与 hover/click 交互保留）。`.toc-minimap` 样式保留——右侧大纲触发器仍在用。
2. **热区收窄 39px → 8px**（`chrome.css`）：旧 39px 既画缩略图、又会和「伸手去抓块手柄」的指针路径打架。
3. **面包屑 / 内核工具条回归满宽**：删掉上批的 `.app-shell.sidebar-floating/.sidebar-collapsed .document-pane { padding-left: 53px }` 让位 hack。
4. **正文左内距 40 → 56**（`editor.css`，压内核默认）：块手柄簇要 54px（命中区 34 + 标题折叠钮 20），内核只给 40 ⇒ 实测 H1 手柄 x=-14（出窗口）。给 56 后手柄簇恒在窗口内，也给 8px 热区留出边界。
   - 替代关系：**旧 = 热区占位 53px 内推（正文左缘 93）；新 = 只留手柄槽 56px（正文左缘 56）⇒ 收回 37px**。

### 二、实测（隔离实例 1280×820，CDP）
- 面包屑右缘 **1280**、内核工具条右缘 **1280**（满宽）；左侧 `.toc-minimap` 数量 **0**；热区宽 **8**；`ne-engine` padding-left **56**。
- 块手柄：H1 **x=2..36**（旧 -14..20，已不出窗）；段落 **22..56**。
- **指针落在手柄上**（x=39,y=192）→ 目录**不弹出**（`app-shell` 保持 `sidebar-collapsed`）；**指针到最左 3px** → 目录浮出（`sidebar-floating`）。⇒「抓手柄」与「唤目录」不再打架。

### 三、坑（本批）
- **左缘热区不能宽**：只要 > 手柄簇左缘（H1 为 2px、段落为 22px），就会在「伸手去抓手柄」的路上误触发目录浮层。
- **手柄簇 54px 是内核常数**（`hitAreaWidth=34` + `ne-heading-fold` 20）⇒ 正文左内距必须 ≥ 54；「左缘要有触发条」与「手柄要够位置」是天生的张力，只能靠**窄热区 + 手柄槽**共存。

### 四、下一步
1. 三态大方案按原型实施：**SidePanel 原语 + 目录栏三态（固定/悬浮/隐藏触发把手）**，等用户发话。
2. 目录栏面板顶边目前仍是用 `--lake-floating-panel-top`（常量 112）；将来搬进编辑区时改用 `--lake-editor-top`（现成 hook）。

## 2.27 本会话批次（260922 · 左缘触发条：隐形 8px 热区 + 跟手把手）—— 分支 `feat/dir-trigger-handle`

> 用户 260922 定稿的**第二步**：把原型里的触发条形态落到真实应用（三态大方案仍**未实施**）。
> 分支从 `feat/ui-opt-260922` @ `12e60eb`（上批检查点）切出。

### 一、改了什么
1. **跟手把手**（`chrome.css` 的 `.edge-hotzone-handle`）：30×64 圆角把手（六点抓握纹 + 「目录」标签），`position:fixed` + `top: var(--edge-handle-y)` 跟指针；默认透明度 0，指针进热区才浮出。
2. **交互时序**（`App.tsx` + `desktopTypes.ts` 新增 `EDGE_HANDLE_DWELL_MS=240`）：进热区 → **立刻**浮把手；**驻留 240ms** 才浮出面板预览（防止只是划过左缘就弹目录）；点把手 = 固定/取消固定（stopPropagation，与热区点击同语义）。
3. **性能**：Y 跟随与显隐都用 **ref + class / CSS 变量**直接改 DOM，**不 setState**（mousemove 高频，不能触发整棵 App 重渲染）。
4. **层序**：`.edge-hotzone` 的 z-index **30 → 110**（要压在块手柄 vendor z-index:100 之上），仍低于目录浮层 250 / 大纲 260 / 顶栏 400。
5. **面板一出就把把手压掉**：`.app-shell.sidebar-floating/.sidebar-docked .edge-hotzone-handle` 透明度 0 + 不可命中 —— 把手只负责召唤。

### 二、实测（隔离实例 1280×820，CDP 真实指针）
| 步骤 | 结果 |
|---|---|
| 静止 | 把手透明度 0（只剩 8px 隐形热区） |
| 指针进热区 120ms | 把手可见、`--edge-handle-y=400px`、**app-shell 仍是 sidebar-collapsed**（面板没抢跑） |
| 驻留 540ms | app-shell → **sidebar-floating**（面板浮出）、把手被压掉 |
| 指针移到正文 | 面板收起、把手退场（is-active 移除） |
| 指针改到 y=640 | 把手跟到 top 608（跟手 ✓） |
| 点把手 | app-shell → **sidebar-docked**（固定） |
| 已固定时再碰左缘 | 面板保持固定、把手不出现 |

### 三、坑（本批，务必记住）
- **热区 onPointerLeave 里「把手退场」必须写在 relatedTarget 判断之前**：原有守卫（指针进入 app-shell 内元素就不收起面板）会把 hideEdgeHandle() 一起吞掉 ⇒ 指针移到正文后把手赖着不走（实测踩过）。
- **把手 z-index 必须 > 块手柄的 100**：否则跟手把手会被块手柄盖住；但 .edge-hotzone 自身仍要低于面板，才能在面板出现时被压住。
- **高频指针事件不要 setState**：Y 跟随走 CSS 变量、显隐走 class，只有面板开关这种低频状态才进 React。

### 四、下一步
1. 用户真机点验这版触发条（跟手手感 / 240ms 驻留是否合适 / 把手尺寸与位置）。
2. 三态大方案（SidePanel 原语 + 固定/悬浮/触发）按原型 `docs/UI-REDESIGN-260921/dir-panel-3states.html` 实施——**等用户发话**。

### 五、同日补做（用户试用后：半幅浮卡 + 把手样式 + 宽度默认值 bug）
1. **目录「悬浮」改「贴底浮卡」**（`chrome.css`）：`--lake-dir-peek-top: calc(var(--topbar-height) + 42px)`（=80，贴面包屑下缘 + 6）、`--lake-dir-peek-height: calc(100vh - var(--lake-dir-peek-top) - 12px)`（**一直延伸到离窗口底 12px**）、**left: 0 贴边（左侧直角、只圆右侧）**、`max-height: none`、柔和投影。（先做过 `min(60vh,560px)` 半幅版，用户 260922 试用后要求"做长一点、默认底部往上一些"⇒ 改贴底；两版都保住同一组收益，且**卡片身份**靠"离底/离边留白 + 四角圆角"体现。）
   - **为什么半幅**：peek 是**临时**的（用完就收）⇒ 固定高度就**不用再跟「只读没有工具条 / 表格工具条 / 画板 / 多维表」的高度做适配**；顶边比原来（工具条下缘 112）高 30px，不再偏下；**有意盖住工具条**（用户同意）。
   - **固定态不受影响**：它占栅格列（`.sidebar-docked`），这套几何只作用于 floating/collapsed。这样「悬浮 = 浮卡圆角有投影」「固定 = 贴边满高无投影的连体列」两态一眼可辨。
2. **把手样式**：6 点抓手纹 → lucide `PanelLeft` 图标（语义是「开侧栏」而不是「拖拽抓手」）；尺寸 30×64 → **28×56**；入场从窗口外滑入 + 轻微缩放（130ms）；hover 长胖到 34px + 主色描边。
3. **修掉一个真 bug（顺手，非新功能）**：`initialSidebarWidth()/initialOutlineSidebarWidth()` 用 `Number(localStorage.getItem(...))` ⇒ 没存过时 `Number(null) === 0` 且 `isFinite(0)` 为真 ⇒ **首次启动宽度被钳到最小值**（目录一直 160、大纲一直 200，而不是默认 224/280）。改为「null/空串 → NaN → 走默认值」。

**实测（隔离实例 1280×820）**：peek 盒 `**x0** / y80 / w224 / **h728 / 底 808**（贴左缘、离窗口底 12px）/ 右侧 radius 10 / 1px 边框 / 柔和投影`；面包屑底 74 ⇒ 面板顶 80；把手可见时 34×56（hover 长胖）、默认隐藏。⚠️ 别再用另一个数值写 `max-height` 钳高度——会把底缝偷偷改成别的数（本批踩过：被 `- 16px` 钳成 724）。

**⚠️ 贴左缘是硬要求（260922 用户实测 bug）**：曾经的 `left: 8px`（离边留白）会让面板浮出时指针仍停在 0..8 的缝里 ⇒ 被 App 的「指针不在 `.sidebar` 里就收起」守卫立刻收掉；而指针**没离开热区** ⇒ `pointerenter` 不再触发、驻留计时也不会重新武装 ⇒ **那一轮再也唤不出面板**。三层修复：① 面板贴边（盖住热区）；② 该守卫把 `.edge-hotzone` 也算「在目录里」；③ 热区 `onPointerMove` 里「计时没在跑就重新武装」（自愈）。实测：面板开着时指针移到 x=1 / x=0 仍保持浮动；移开再回来能重新唤出。

**已知小瑕（未改，等用户决定）**：把手在面板浮出后就被盖住 ⇒ 「点把手固定」只在进热区后的 ~240ms 内有效；之后要靠面板头的 📌。若要改，可让面板从把手右侧（left ≈ 36）开始、把手常驻当「侧栏拉手」。
### 六、用户 260922 定稿（**冻结项，别再改/别再提**）
- **悬浮 + 触发条逻辑冻结**：隐形 8px 热区 + 跟手把手（240ms 驻留）+ **贴左缘弹出** + 底缝 12px、顶贴面包屑下缘（80）。用户原话：「逻辑比较完美了，没有必要再继续改」。
- **固定目录栏 = 自成一个区域**：继续用 app-shell 栅格列（`--sidebar-grid-w`）把正文推开，**不搬进编辑区**。⇒ 左侧（栅格列）与右侧（编辑区内槽位 + 只推正文）的 docked 机制**刻意保持不同**。
- **SidePanel 组件原语：决定不做**。理由：两侧在「docked 机制 / 悬浮纵向策略（左固定 80..底−12、右动态 chrome 底→编辑区底）/ 触发条形态（把手 vs 缩略图条）/ 推挤对象（整列 vs 只推正文块）」上刻意不同；两个实例不构成抽象依据（Rule of Three），强行参数化会变成配置驱动的大组件（AGENTS §3 #17 点名的过度设计信号）。
  - 若要降维护税，只做**小件**：`usePanelResize()`（左右各约 60 行几乎同构的橡皮筋/键盘微调/commit）、`usePanelHoverCorridor()`（延时 + 触发条/桥/面板并集判定）、以及一份 `docs/PANEL-CONTRACT.md`（几何/z 序/延时/宽度持久化的单一契约）。
## 2.28 本会话总交接（260922 · 桌面 UI：主题 A/B/C → 增强大纲进编辑区 → 目录触发条/贴底浮卡）—— **新会话从这里读**

> 写给完全没有上下文的新会话。本会话从「UI 视觉优化批次」（`feat/ui-redesign`）接手，连做四段：
> ① 把 §2.24 那批未提交的「主题 A/B/C + 三空间 + minimap」落成提交；② 浮层铺满 + 编辑区右移（后被取代，见 §2.26）；
> ③ **把增强大纲搬进编辑区**（§2.25，高仿内核原生大纲）；④ **目录栏：去缩略图 + 隐形热区 + 跟手把手 + 贴底浮卡**（§2.26/§2.27）。
> 全部已 **fast-forward 合入 `master` 并 push origin**；功能分支已清理，只留备份分支 `backup/ui-theme-abc-handoff-260922`。

### 一、任务目标（用户 260922 原话要点，按顺序）
1. 「继续优化」三条：① 查窗口底部「不可见横条」根因；② 目录/大纲浮层**不再半幅**（顶到工具栏下缘、底到窗口底）；③ 大纲同规格。
2. 「正文右移让 minimap」——**块手柄和目录缩略图打架**，要**严格边界**。
3. 随后改口：**先只做增强大纲**、**高仿原生大纲**（不是飞书）；**目录树不要动**。
4. 固定态与悬浮态都**不能盖工具栏 + 要动态计算**（只读无工具栏、工具条换高都要跟）；再改口：悬浮可**固定高度**（不做适配）；最终定稿 **贴底浮卡**。
5. 目录栏三态**必须保留**：固定 / 悬浮 / 悬浮触发条（**可隐藏但必须存在**）；触发条形态 = **隐形 8px 热区 + 跟手把手**。
6. 收尾：**提交到 master + push、删除冗余分支、写交接**。

### 二、已完成内容（全部已在 master）
**A. 底部「不可见横条」根因** = 左侧整边热区的 **minimap 尾巴**露在浮层下沿之外（浮层当时只到「窗口底 −72」）⇒ 看起来是一条横条。该 minimap 本会话已按用户要求删除。
**B. 增强大纲搬进编辑区（§2.25）**
- `<OutlineSidebar>` 改经 `DesktopLibrary` 的 `outlineSlot` 渲染进 `.document-pane`（**单实例**，`.tab-panels` 的兄弟；实测切标签**不重建**：节点身份保留、MutationObserver 记录 0 次移除）。
- `--outline-grid-w` 栅格列删除；**固定态只推正文块**（`engine padding-right = 56 + inset`，学原生 `ne-normal-toc .ne-engine > * { margin-right: 280px }` ⇒ 面包屑/内核工具条**满宽不留缺口**）；悬浮态与固定态**同一个盒**。
- **动态顶** `--lake-editor-top`（新 `src/hooks/useEditorTopVar.ts`）：量「从 pane 顶**连续停靠**的 chrome 栈底边」（面包屑 + `.ne-ui`），工具条隐藏/换高/切主题自动跟随；明显有间隙的浮动元素不计入。
- 右侧让开垂直滚动条 13px（`--lake-outline-clearance`，来源 `OUTLINE_SCROLLBAR_CLEARANCE`）；面板 z-index 5 > 触发器 3 / 桥 4 ⇒ **面板盖住 minimap**（用户报的层序 bug）。
**C. 目录栏（§2.26 / §2.27）**
- **删掉左缘缩略图**；**热区 39px → 8px**；删掉 `.app-shell.sidebar-{floating,collapsed} .document-pane { padding-left: 53px }` 的让位 hack ⇒ **面包屑 / 内核工具条回归满宽**。
- **正文左内距 40 → 56**（`styles/app/editor.css`，压内核默认）：块手柄簇要 54px（命中区 34 + 标题折叠钮 20），内核只给 40 ⇒ 实测 H1 手柄被画到 x=-14（出窗口）。
- **左缘跟手把手**：指针进热区 → 立刻浮出（28×56、`PanelLeft` 图标 + 「目录」标签、Y 跟指针）；**驻留 240ms**（`EDGE_HANDLE_DWELL_MS`）才浮出面板预览；点击 = 固定/取消固定；面板一出即退场；`.edge-hotzone` z-index 30 → **110**（压块手柄 100）。
- **悬浮 = 贴底浮卡**：`left: 0`（贴左缘）、顶 = 面包屑下缘 + 6 = **80**、底 = **窗口底 − 12**、右侧圆角 + 柔和投影；**不做任何高度适配**。
**D. 顺手修掉的真 bug**：`initialSidebarWidth()/initialOutlineSidebarWidth()` 用 `Number(localStorage.getItem(...))` ⇒ 没存过时 `Number(null)===0` 被钳到**最小值**（目录一直 160、大纲一直 200，而不是默认 224/280）。已改为 null/空串 → `NaN` → 走默认值。
**E. 原型**：`docs/UI-REDESIGN-260921/dir-panel-3states.html`（目录栏三态交互原型，用户在浏览器里试过并认可；本批**未纳入提交**，仍是 untracked）。

### 三、当前问题（均不阻塞）
1. **三态大方案不做**（用户定稿，见 §2.27 六）：固定目录栏继续自成一个区域；不搬进编辑区；SidePanel 组件原语不做。
2. **「点把手固定」只在进热区后 ~240ms 内有效**：面板浮出后把手被盖住，之后固定要靠面板头的 📌（可改成「面板从把手右侧开始、把手常驻」，属可选优化）。
3. **目录 peek 顶边 80 写死在 token** 里（依赖面包屑恒高 32）；面包屑若改高会漂。
4. **目录栏只有鼠标入口**：把手 `aria-hidden` 不可聚焦、无快捷键。
5. **外部改动不自动刷新目录**（需手动点「刷新目录」，§2.6 加的那个按钮）。
6. **目录树全量渲染**（只靠 `content-visibility` 省绘制），10 万文档量级未解决。
7. 本会话的隔离验证实例（`$TMPDIR/lake-*`）与临时脚本**均已删除**；用户 9222 实例与正式数据**未被触碰**。

### 四、下一步计划
见 **§3 下一步计划** 顶部新增的第 0 条（本会话留下的桌面面板/目录优化项：面板契约文档 / 键盘可达性 / `library-changed` 广播 / 目录树窗口化 / 小件去重 / peek 顶边口径）。

### 五、踩过的坑（本会话新增，务必记住）
1. **绝对/固定定位 + `height: auto` + 给了 `top`/`bottom` 在 Chromium 下不会撑满**（内容会把盒子顶出视口，实测 y=0/h=957）⇒ 必须显式 `height: calc(...)`。
2. **动态顶必须「从 pane 顶连续」地量**：工具条顶在 pane 顶下 32px，只判「贴近 pane 顶」会把它整个漏掉（候选按 top 排序、只收与当前栈底相接的，tol 8px）。
3. **同文件里更早的高特异性规则会赢**：旧 `.outline-sidebar--docked .outline-sidebar__content { top:0; bottom:0 }` 会把新几何覆盖回去 ⇒ 改大纲几何要全文件搜同一选择器。
4. **「让位」只能加在正文块上，不能推 pane**：推 pane 会把面包屑/内核工具条一起收窄、面板顶边上方留缺口。
5. **`Number(localStorage.getItem(x))` 的 `null → 0` 陷阱**（见二·D）。
6. **另一个数值的 `max-height` 会偷偷改掉底缝**：写 `height: calc(... - 12px)` 时忘了删旧 `max-height: calc(... - 16px)` ⇒ 实测底缝变 16。
7. **热区 `onPointerLeave` 里「把手退场」必须写在 relatedTarget 守卫之前**：守卫（指针进 app-shell 内元素就不收面板）会把它一起吞掉 ⇒ 指针移到正文后把手赖着不走。
8. **面板必须盖住热区（贴左边）**：留 8px 缝的那版，指针停在缝里 ⇒ 被「指针不在 `.sidebar` 里就收起」守卫立刻收掉；而指针没离开热区 ⇒ `pointerenter` 不再触发、驻留计时不重新武装 ⇒ **那一轮再也唤不出面板**。三层修：贴边 + 守卫把 `.edge-hotzone` 也算「在目录里」+ 热区移动时重新武装计时（且**不能重置已在跑的计时**，否则永远开不了）。
9. **左缘热区不能宽**：只要 > 手柄簇左缘（H1 为 2px、段落为 22px），就会在「伸手去抓手柄」的路上误触发目录。
10. **块手柄簇 54px 是内核常数**（`hitAreaWidth=34` + `ne-heading-fold` 20）⇒「左缘要有触发条」与「手柄要够位置」天生抢同一条带，只能靠**窄热区 + 手柄槽**共存。
11. **隔离验证的正确姿势**：`vite preview`（独立端口）+ `LAKE_USER_DATA=$TMPDIR/lake-*` + 独立 CDP 端口；**绝不碰用户 9222 / `lake-notes-dev`**，跑完删目录。hover 类交互必须用 `Input.dispatchMouseEvent` 真实指针（合成 `dispatchEvent` 测不出来）。
## 3. 下一步计划 + 当前问题（真正的待办，按优先级）

### 下一步计划
0. **【260922 留下 · 桌面面板/目录优化项】260923 用户裁定并落地：(a)(b)(f) 已做，(g) 已撤销；余下 (c)(d)(e) 仍挂起（定性见各条）。**
   - **✅ (a) 已做（260923）**：`docs/PANEL-CONTRACT.md` —— 垂直几何栈（令牌 + 派生式）/ 层序 / 悬停延时与并集判定 / 宽度持久化与默认值陷阱 / 键盘入口 / 已知取舍。
   - **✅ (b) 已做（260923）**：`⌘]`（Feishu 口径）固定/收起目录栏 —— `useWindowShortcuts` 新增 `onToggleSidebarDock`（capture 阶段），App 在 `useDesktopShell` 之后注册；📌 加 `aria-keyshortcuts`，设置「快捷键」加一行。隔离实测 docked→collapsed→docked，正文 hash 不变（内核未占用该组合键）。
   - **(c) `library-changed` 广播 —— 暂不做（260923 复核）**：生产侧暂无触发面（AI 写入 §3.1、浏览器端写功能 §3.10 都未落地；同步已有广播）。等真实写入方出现再做，届时与 §3.10 的 SSE 一起。
   - **(d) 目录树窗口化 / 按笔记本懒加载 —— 先测再定**：现开发库 `tree_nodes=549`、`content-visibility` 已上（`shell.css` 的 `.tree-row`），无实测卡顿；懒惰化要动 `listTreeNodes` 契约，回归面大。先造 5k/10k 合成数据量渲染耗时，量到卡再立项（优先虚拟滚动）。
   - **(e) 小件去重 —— 不做**：两侧"同构"实为两套语义（左栏向右长、大纲向左长；几何/推挤刻意不同）⇒ 收益仅"更整洁"，命中 AGENTS #17 过度设计信号。出现第三个面板或证实某 bug 源于分叉时再抽，且只抽无策略差异的部分。
   - **✅ (f) 已做（260923）**：目录 peek 顶边改为 `calc(var(--topbar-height) + 4px + var(--breadcrumb-height) + 6px)`（浮层顶、阅读态大纲顶同批派生）——不再写死 80/112/74，用户调顶栏/面包屑/工具条高度时不再漂。
   - ~~(g) 「点把手固定」的 240ms 窗口~~ **已撤销（用户 260923：不做）**；并已在 `docs/PANEL-CONTRACT.md` §已知取舍 里记为定稿，别再提。
1. **画板 AI 助手接入**（真功能，待定后端）
   - 钩子：`config.drawingBoardAI.generate`（vendor `LakexEditor` 会挂到 `editor.__lakexDrawingBoardAI`）；我们不走 `LakexEditor`，是直接 `Doc.createOpenEditor`，需在 `src/features/editor/lakeRuntime.ts` 创建 editor 后**手动挂**这一行。
   - 截图那个绿色 AI 徽标是**内核**的「文本绘图 AI 助手」（`.ne-text-diagram-ai-assistant-*`，正是 `mass-office` 背景图所在元素）；vendor **无注入点**（`KernelAssistantConfig` 只有 `supportEmoji`）→ 接不了。
   - 可接的是画板卡的「AI 画板助手」（`.lakex-ai-board-*`）；未配置时面板提示「尚未配置 AI 服务」。
   - 官方示例：`vendor/lakex-doc-react/examples/`（前端 `generate` / `aiProxyPlugin.ts` 后端代理 / `mockDrawingBoardAI.ts` / `.env.example`）；契约见 `src/components/lakex/types.ts`。
   - 待定：模型/服务与 endpoint、API Key 存放（**建议 Electron 主进程代理**，勿用 `VITE_`）、设置项、移动端网络。
2. **离线残余（均「外观级」，非功能）**——详见 `docs/OFFLINE-ASSETS-AUDIT-260916.md`：① `__puml` 预设缩略图 8 张（`cdn.nlark.com` / `lark-assets-prod…`）仍外链；② `mass-office.alipay.com` 的内核内联 AI 图标；③ 思维导图 KaTeX CSS（@xiangfa 注入 jsdelivr，待运行时确认）。（PlantUML ✅ 已解决。）
3. **移动端剩余批次**：B7/B8 + 真机复验缺口 —— 明细见 **§8**。
4. **产品/技术债（长期）**：W-8 ACAO / W-10 dompurify（**安全，建议优先**）；大纲 viewer 只读点击不跳转；回收站首拉成本（惰性下载暂缓，动恢复红线）；Word/PDF 导出 + 附件大文件 S3 分片；`docs/LAKEX-CONTRACT.md` §4 的 `lakex-contract.d.ts` 落地。CSS 层级冗余见 §3.9（260917 已收口）。
5. **非代码**：安卓同步偶发 `UnknownHostException` = 设备网络（联网重试）。
6. **小记（Quick Notes）设计取舍 —— 是否直接挂 Lake 内核底座**（用户 260917 提出）：**260919 已定稿并落地 =「挂」**。小记正文升 v2（内核形态 `body`，`docs/QUICK-NOTE-LAKE-BODY-260919.md`），写作区**编辑时挂一个**内核实例（`src/features/quickNotes/QuickNoteEditor.tsx`），转换退化为「搬运 + 资源作用域改写」。**260919 晚又续做 note 版式对齐云端**（工具条「图片/待办」+ 展开成完整编辑器，内核机制见 `docs/LAKEX-CONTRACT.md` §5.11）。剩余：真机点验 + 上一条的 7~9 潜在缺陷 + `QUICK-NOTES-SPEC.md` 文档过期。
7. **Lake 正文写入收口**（约定见 `docs/LAKE-CONTENT-WRITING.md`）：① 自动化程序（不在仓库）**直接写库 + 手写裸 `<img>`**，导致 287 篇测试文档一被打开就被内核重写（图片降级成失败卡片 + 变待同步 → 随下次同步上传）→ **必须改成走应用写入路径，或只写纯文本**；② 仓库内 4 处手拼写入者**已收口**到 `src/core/lakeDocForm.ts`，并加了"绝不产出裸 `<img>`"的单测围栏；③ 旧数据按 §3 原则 7 **不写归一化兼容**，用修好的姿势重建（见第 8 条）。
8. **旧数据处置 —— 等用户决定，别擅自动数据**：287 篇含裸 `<img>`（+7 篇已降级成失败卡片）。选项：**A 删掉重播（推荐，符合原则 7）** / B 留着但别打开 / C 就地改写成卡片（= 为损坏数据写代码，与原则 7 冲突，不推荐）。
9. **「深层重复」CSS 候选清理（260917 已收口；结论：不做整批）**：档0（围栏基线纠偏）+ 档1（可证死声明清理）已完成，见 §2。按严格口径（同 at-rule 上下文 + 同单选择器 + 同属性）**全库只有 55 条可安全删**，已删并 ab2 全矩阵 34 状态证 0 差异。此前估算的"29 文件 / 3835 声明 / 184 争用（147 跨层）/ 92 选择器"**大多是把不同 `@media` 条件（宽/窄两套）算成争用**——那些不能删。**结论：不再推进 8–12 人日的整批清理**；若日后新增重复，围栏 `src/styles/cssLayers.test.ts` 会卡住，`scripts/css-audit/plan-dup-decls.mjs` 可随时重生成候选。
10. **浏览器端（本机附属窗口）后续 —— 等用户决定是否做**：本次只交付"开关 + 说明 + 打开按钮"，功能未细化。若要做，已知缺口按此顺序：① **推送**（最大）：浏览器收不到 `sync-progress`/`pending-summary-changed`（shim 里是 no-op）→ 需给 `webApiServer` 加 SSE + 在 `main.ts` 两处广播点接 sink（事件少、广播集中，约 0.5–1 天）；② **宿主能力浏览器化**：导出/备份走 `dialog`、`openAttachment`/`reveal*` 走 `shell`、`copyAsset*` 走 `clipboard`/`nativeImage`——在浏览器里语义错（会去操作桌面机），需换下载 / `navigator.clipboard` / `<input type=file>` 或隐藏；③ **开发体验**：只服务构建产物 `dist/`（无 HMR），无 `npm run dev:web` 脚本；④ **安全**：`/api/*` 只校验 `x-lake-token`（复用 assetToken）、不校验 Origin，`/__native.js` 不校验 token（与 W-8 ACAO 同类，建议一起定调）。
    - **AI 生成的文档能否"各端发现"（用户 260917 提问 → 结论）**：只要 AI **走应用写入路径**（`createNote` + `saveNote`，媒体让内核产出——**禁直写库/手拼 `.lake`**，见 `docs/LAKE-CONTENT-WRITING.md`），就会以 `sync_state='local'` 落库 → **跨设备**靠现有 S3 同步天然可见（无需新机制）；**同机多窗口/浏览器**要"立即看到"则需再加一个 `library-changed` 事件（复用同一 SSE 通道）。**浏览器端本身只覆盖本机**（绑 127.0.0.1，不是同步参与者）；AI 若在云端生成属另一套设计（走同步协议或把 webApiServer 暴露到网络 = 需单独的安全方案）。

11. **【优化项 · 用户 260918 决定「先不做」】块拖拽的两个进阶能力：多块选区批量拖拽 + 拖拽改层级（蓝色导引线）**
    - **用户决策（260918 原话）**：「拖拽改层级 + 蓝色导引线 这个列入待办吧，我感觉现在就挺好的，云端的跨层级有点乱，并不是很好用。先不做了」；并要求与「多块选区的批量拖拽」**合并成一项优化项**记录（非 bug、不进主线待办）。
    - **共同触发条件**：用户明确需要时再做；不做不影响现有功能（现有拖拽=单块+整段列表父项，已满足日常）。

    **(a) 拖拽改层级（云端那种蓝色导引线）—— 已调研：可做**
    - **能力齐备，不用新内核能力**：纵向移动已可用；层级 = 列表项 `ne-level`（模型 `attrs.level`/`parentIndex`）；内核有 `indent`/`outdent`/`canIndent`/`firstIndent`（§5.9 注册表；**`editor.execCommand` 上有效、移动端 `renderer.execCommand` 上无效**），菜单「缩进」已在用。
    - **要补的是交互与落点语义**：① 拖拽时按光标**水平偏移**算目标层级（候选 `0..(上方块层级+1)`，按列表缩进宽度 32px 量化）；② 导引线按层级改 `left/width`（现有 `positionIndicator` 已画 2px 横线，扩展很小）；③ 落点 = 垂直照旧 + 层级差用 `indent`/`outdent` 补齐（或同一模型事务里改 `level`）；④ 顺序要实测：先移动后改层级 vs 先改层级后移动（插入同列表会重建列表节点、range/选区失效——§2.5 的坑）。
    - **代价/风险**：约 **0.5–1 天**（含新 e2e：拖后断言 `ne-level` 与顺序）。风险集中在跨列表边界与「层级变更后子项是否跟着走」（云端按「父项 = 整段」，我们已有 `blockSpanElements` 可复用）。用户主观评价：**云端这套跨层级交互偏乱、不算好用** ⇒ 做的话不要照搬，要先定交互。

    **(b) 多块选区「批量拖拽」（260917 记录；云端 Lake 也未实现）**
    - **现状**：Issue 4 已支持多块选区的聚合手柄 + 批量删除/复制/剪切/转化；**拖拽仍按单块**（`moveBlockNative` 遇到多块选区直接返回 false），手柄在拖拽时不进入拖拽态。
    - **难度：中等偏易**，可复用现有原语、无需新内核能力：`selectedTopBlocks` + `selectBlocksInEditor` 取整段选区 → `getSelectionContent('text/lake')` 取整段 fragment → **节点级删除整段**（`removeBlockNodesNative`，260918 起；**不要**用 `deleteByRange`——它在根级整块上会补空段落，见 §5.8.5）→ `insertAtPosition(dropPos, 'text/lake', frag)`。与单块「摘节点 → 落点插入」同一套路，只是把「一个块」换成「一个选区」。
    - **三个真实风险（决定工作量）**：① **卡片保真**：单块卡片走 `moveCard` 逐字节保真；整段 fragment 里含卡片时只能走 lake 序列化再插入 ⇒ 卡 id 会重发（已注册卡字节应保真，**未注册卡会丢**，与「打开即保存」同因）；要跟单块一样保真，需在移动前把选区里的卡片逐个 `moveCard` 或按卡类型分流。② **列表层级/顺序**：整段跨列表时层级依赖 fragment 顺序与 `data-lake-indent`，删+插后要复核层级不被压平（Issue 3 只验证了单个父项）。③ **落点边界**：落点落在选区内部要拒绝（现有 self/span 判断需扩展到整段选区）。
    - **UI**：ghost 需渲染整段（多块）预览；落点线 / 边缘自动滚动可复用（ghost 已支持「列表父项整段」，扩展到多块改动不大）。
    - **代价**：约 **0.5–1 天**（含 e2e）。

12. **【S3 审计遗留 · 低优先级】**（260918 审计三条 P0/P1 已落地，见 §0 本批 + `docs/S3-STORAGE-AUDIT-260918.md` §7.5/§8）：① **B4 实测**——该篇附件哈希全量重算在上传**和下载**两侧都会发生，有痛感再做 `(filename,size,mtime)→hash` 缓存（贴 AGENTS §3 #11 红线，**单独立项**）；② **D4** purge 文件删除失败 → 阻断云端前缀删除；③ 移动端 `note_history` 补 `refs_json`/`protected_until`（建议并入 §8.7 真机验收批次）。

13. **【表格文档（kind=sheet）收口 · 进行中 · 260918】分支 `feat/sheet-document` 上已写完且门禁全绿，但【未提交】【未真机验收】** —— 完整交接见 **§2.8**，设计/实测见 `docs/SHEET-BITABLE-DESIGN-260918.md`。
    - **（260919 已变更）**：表格内核已由 **jspreadsheet-ce 换成 FortuneSheet 1.0.4**；下面 CE 相关的收口项部分已随迁移作废/改写，**当前表格状态一律以 §2.8 的 260919 各轮补充 + `docs/FORTUNESHEET-FEASIBILITY-260919.md` 为准**；图片相关见第 **14** 条。剩余项（用户已同意先列入待办）：
    - **（必做）真机验收**：新建表格 → CE 渲染 → 编辑 → 落盘 `sheets/{id}.sheet.json` → 自动保存 → 同步 → 另一端/移动端表现。见 §2.8 四.1 的 5 个观察点。
    - **（✅ 260919 已解决）`SheetEditor.tsx` 的 2 处内联样式**：CE→FortuneSheet 重写后消失——容器尺寸走 `.sheet-editor` CSS（`src/features/sheet/sheetEditor.css`，fence 基线已同步），CE host `pointerEvents` 随 CE 删除；`grep -rn "style=" src/features/sheet/` = 0。
    - **（✅ 260919 已完成）非 doc 类型的导出/MD 守卫**：`electron/noteExport.ts` 的 `exportHtmlNote`/`exportPdfHtml`/`exportNotePackage` 已加 `assertDocKind` 前置守卫（非 doc 抛 `InvalidInput`）；桌面 `TreeNode` 已加 `kind`（`listTreeNodes` LEFT JOIN notes + `mapTreeNode`），目录树右键「导出」子菜单与文档 ⋯ 菜单对非 doc **隐藏**；状态栏对非 doc 把「字数/图片」**替换为「表格/多维表」**；大纲侧栏对非 doc 隐藏。回归测试见 `electron/store.test.ts`。
    - **（✅ 260919 已确认）文档回填**：`docs/SYNC-PROTOCOL.md` 已有 260919 段（manifest **v6** + 每条 note 可选 `kind` + 旧端读 v6 显式拒绝）；`docs/STORAGE-LAYERS.md` 已有 `sheets/{id}.sheet.json` + `notes.kind` 决定路径 + `sheetToSearchText` 段。无需再改。
    - **（提交前）清理 spike 产物**：`spike.html`、`src/spike/`、`scripts/spike-sheet-ce.mjs`、`vite.spike.config.ts`、`vite.spike.build.config.ts`（保留两份 `docs/*-260918.md` 设计文档）。
    - **（提醒）manifest v6 ⇒ 所有端一起升级**：旧端读到 v6 显式拒绝同步（刻意安全闸）。

14. **【表格图片独立管理】浮动图 P1 ✅ 260920 / 单元格图片 P2 ✅ 260921 / 缩略图 ✅ 260921 续（均未提交，见 §2.16 / §2.18 / §2.19）** —— 规范与落地记录见 **`docs/SHEET-IMAGE-MANAGEMENT-260919.md` §5 / §13 / §14**。
    - **✅ P1（本会话）**：正文 `sheets[].images[].src` 存 **filename**（**版本号不变**，仍 v2 —— 结构未变、两种形态读写都支持，升版本会让既有表格变空表）；
      文件落 `note-assets/{noteId}/`，**清单声明无需改（磁盘实扫）**，同步/GC/历史复用现有资产管线（红线 #11/#17）；老正文里的 base64 在**打开时**自愈（同一条提升路径，不是兼容分支）。
      实机实测：正文 323B 只有 filename、资源落盘、reload 后按**本实例端口**渲染。
    - **✅ P2（本会话）**：单元格图片 = `images[].cell = {r,c}` 锚点 + 几何跟单元格走（`src/core/sheetGeometry.ts` 复刻内核口径）+
      CSS `object-fit: scale-down` 锁比例不放大 + 指针事件关闭；插入/替换/Delete 删除/粘贴插入/冻结窗格偏移都做了；
      **不走原稿的 overlay/canvas 两条路**（复用内核浮动图通道，滚动/裁剪/缩放全免费）。见 §2.18。
    - **✅ 缩略图（260921 续）**：assetServer `?w=` 按需缩放（`sharp` + 原格式 + GIF/SVG 跳过 + 内存 LRU + 并发闸 4），
      档位随显示宽度换代；**不落盘派生文件**（会被磁盘实扫声明成资产、却不在正文引用集里 ⇒ 注定被判孤儿回收）。
      实测 2400×1600 在 81px 格里解码成 256px（位图 15.4MB → 175KB），落盘正文不含 `?w=`。
      **续 2**：同一套已接**多维表附件格**（26px 取 128 档，放大预览仍原图）与**移动端小记封面**（最大档位 1024），
      安卓 Java AssetServer 同语义实现（`inSampleSize`，只认 png/jpg/jpeg，8 项 JVM 单测过，**真机未验**）。见 §2.19。
    - **仍待做**：**P3 移动端表格只读渲染 + 对拍 + 压测** · **移动端缩略图真机验收**（设备上看小记封面/表格图片）·
      AB 多端往返 + 删图后 GC 回收实测 · 「单元格格式 → 图片」对话框入口（要 patch 内核 React 弹窗，本批刻意不做）·
      浮动图缩略图。
    - **前置已做**：图片按钮按实例定位（patch react）、本地插入可用（见第七轮）。
15. **【移动端小记工作台能力 · 待办 · 用户 260920「先计入待办，先不做」】**：移动端小记目前只有 编辑/删除/排序；桌面的**转正式文档 / 批量选择 / 置顶 / 列表视图**尚未搬过来。详见 `docs/MOBILE-PARITY-260920.md` §五。

16. **【移动端复用小记能力 · 后期】** 桌面小记已定稿为「内核当写入器 + 自研读取器（白名单）」（见 §2.10 续做第五~八轮）。
    移动端小记目前是纯文本输入 + 合成 lake 段落/图片卡（`src/mobile/quickNotesRepository.ts`）；
    用户要求后期**复用同一套能力**（同一份白名单 + 同一个预览读取器 `quickNotePreviewParser.ts`），
    工具栏形态可按移动端（`EditorDock`）调整。做之前先读 §2.10 续做 + `docs/LAKEX-CONTRACT.md` §5.11。
17. **【UI 重构收尾 · 待办清单】** —— 方案见 **`docs/UI-REDESIGN-OPTIMIZATION-PLAN-260923.md`**（行为不变的优化 + 与安卓重做的排期）；评价见 `docs/UI-REDESIGN-REVIEW-260923.md` **§四**：P0 安全（`W-10 dompurify` + `webApiServer` 的 `/api/*` Origin）· P1（`library-changed` 广播 / 目录树窗口化 / 面板契约可执行化 / 分段控件与设置说明字号的共享层 `!important` 阻塞）· P2（设计词表裁剪 / 历史文档标注 / 画板 `Wt is not a function` 立项）· P3 见本 §3 其余条目。

### 当前问题 / 已知坑（不阻塞）
- 画板**不再记忆视口**（拖动/缩放后重开为默认/自适应）：这是 260916 为「不让视口触发保存/上传」刻意做的取舍，**用户已确认接受**（"谁知道下次进来要看什么"）。不要改回去。
- 离线残余 3 处（见上，全外观级）。
- `public/vendor/cdn` 的 32 个静态无引用文件**不能删**——它们是 `electron/cdnRedirect.ts` 的**运行时兜底白名单**（用「镜像里是否存在该文件」决定是否把 `gw.alipayobjects.com` 请求回本地）。
- 桌面日志里的 `download_remote_resource` **INVALID_INPUT（不允许下载本机或私网地址）不是"无关噪声"**（260917 更正）：它标记着「打开了自动化手写裸 `<img>` 的文档」→ 内核回写失败态卡片 + 该文档变待同步，**打开即发生**。详见 §3.7 与 `docs/LAKE-CONTENT-WRITING.md`。（403 仍是远端策略问题。）
- **小记转换产物是"内核容忍"而非"内核产出"**：`electron/quickNoteConversion.ts` 写的图片卡片是 `originalType:"url"` + `originWidth/originHeight` + `from:"quick-note"`，内核自产卡片是 `originalType:"binary"` + `width/height` + OCR 字段（`search/ocrLocations`）。今天**实测稳定**（`.lake` mtime 停在转换时刻、无脏点、无快照、对拍 PASS），但依赖内核容忍度 → 与 §3.6 的取舍一起讨论。
- **判定"是否被内核重写"的口径**（别再靠肉眼）：`.lake` 的 **mtime 不变** + 标签无脏点 + 无新增历史快照 + 正文里 `status%22%3A%22error%22` 为 0；批量判断用 `scripts/lake-roundtrip-check.mjs`（只动副本）。
- **`vitest` 是 `node` 环境，跑不了内核**：涉及内核行为的验证只能 CDP 驱真实 Electron；不要试图为它写单测（对拍脚本就是这种模式）。

## 4. 踩过的坑（合并版；通用红线/环境见 AGENTS.md）

### 本批（260918 表格文档 SheetDocument）新坑 —— 完整版见 §2.8 五
- **`NoteSummary` 有两份**（渲染层 `src/lib/types.ts` + 主进程 `electron/noteQueries.ts`）、**`mapSummary` 有三处 SELECT**（`noteQueries.listNoteSummaries` + `store.ts` 回收站列表 + `store.ts` saveNote 回读）：加字段漏一处 = "保存后类型丢成 doc"，症状极隐蔽。
- **TS 推断返回类型会放宽字面量**：`{ kind: cond ? "sheet" : "doc" }` ⇒ `string`，外层端口类型不兼容。用嵌套三元/`as`/显式返回类型。
- **远端导入必须按 manifest 的 `kind` 解析路径**：导入时 DB 还没行，`notePathFor` 会回退 doc ⇒ 表格写到 `notes/{id}.lake`。已注入 `bodyPathFor(noteId, kind)`。
- **CE `parseFormulas: true` 在严格 CSP 下整表崩**（只出表头）；`false` 则完整渲染 + 0 违规。CE image 列只认 `data:image`（图片只能内联 base64，且 base64 不匹配 `ASSET_NAME_RE` ⇒ 不污染 `manifest.assets`）。
- **Univer 实测过重**：产物 9.77MiB/2.48MiB gzip（55 个 locale chunk ≈4.3MiB）、依赖 118MB（含本项目原本没有的 `rxjs` 11MB）、堆 23.76MiB、**≈20MB/实例（与 keep-alive 多 tab 冲突）**；其多维表本体在 Pro。
- **开源多维表选型事实**：`@teable/core` 是 MIT（field/formula/convert，可当自研底座）；`@teable/sdk` MIT 但强绑 Teable 服务端；NocoDB 是 Sustainable Use License；成熟开源多维表全是服务端应用。
- **`npx vite dev` 会拉起第二个 Electron 抢 CDP 9222**（探针会看到 `chrome-error://`）——调研用独立 config + 1422 端口规避；**依赖 9222 的脚本先探测本机 Electron 是否在跑**（用户会关掉 dev 实例）。

### 本次会话新坑（2026-09-18 S3 审计批次）
- **验证「清单拉取失败」不能只改错密钥/endpoint**：桌面同步先 `remote.test()`（ListObjectsV2），坏凭据/不可达都在那里抛、UI 本就正确报失败。只有「清单非法 JSON / 解压后 >20MiB / `test()` 之后那次 GET 瞬时失败」才会走到引擎 pull 的 catch。**写审计复现步骤前先确认「实际在哪一层抛」**（本次审计 §7.4 的 F2/D2 两步复现都因此验不出来，已按 §8 更正）。
- **同步失败语义已改「真失败一律抛」**：`syncEngine` pull manifest 的 catch 不再有「降级成 return」分支（对象缺失=首次同步走 null 分支，不是异常）。改这段代码若加回吞错，会退回「同步成功、0/0」假安全；且引擎早退后 Controller 的 purge 前缀删除/`markPurgeSynced` 也会跟着执行（顺序问题）。
- **留档快照是「被覆盖编辑」的唯一保障，不许吞错**：`syncAdapters.createHistorySnapshot` 的空正文（""）= `.lake` 读失败（应用永不产出空 `.lake`，`emptyLakeBody` 是 `<p><br></p>`），必须抛；`createHistorySnapshot` 遇 `.lake` 缺失是**静默 return null**（不留档）——「无空快照」≠「无问题」。
- **「资源能否被删」的单一真相 = `AssetRepository.getProtectedRefs`**（当前正文 ∪ 历史 refs ∪ 未保存草稿 refs）。任何新的删除路径（自动/手动清理、GC）都走它，**不要**自己另写「当前正文引用」判定——草稿引用这层就是这么漏掉的（审计 D3）。
- **给审计文档下结论前跑独立复测脚本**：清单体积这类估算用 `crypto.randomUUID()` 按 `buildUploadEntry` 字段构造实测（本批 `/tmp` 脚本复测 5K+2万附件 = 4.30MiB，与文档 4.08MiB 同口径）；纯文字估算容易把「字节余量」和「条数余量」混着说。

### 本次会话新坑（2026-09-17 第三批：浏览器端）
- **dev 改 `electron/preload.cjs` 不会热重启**：vite-plugin-electron 只 watch 入口 `electron/main.ts`；dev 下 preload 是**直接读源文件** `../electron/preload.cjs`（不在 `dist-electron/` 里）。改完 preload 必须**手动重启 Electron**（或 `touch electron/main.ts` 触发重建）才生效，否则渲染层还是旧方法（症状：`window.lakeNative.getWebStatus is not a function`）。
- **改主进程/共享模块后要确认 `dist-electron/main.js` 已重建再测**：重构中途会短暂出现 main.js 与源码不同步（本次报 `store.getWebSettings is not a function`），重建后即消失——别当业务 bug 查。
- **浏览器端"不落盘"是有意的**（用户 260917 明确：每次启动默认关闭、用时再开）：**不要再加回持久化**（无论 `settings` 表还是 localStorage）。开关是运行期起停（`createWebServerController`），不是"启动时读开关"。
- **打开外部链接的 URL 必须主进程构造**：`open_web_client` 不接受渲染层传 URL（只按固定端口拼），避免把任意链接丢给 `shell.openExternal`（开放重定向/本机文件）。

### 本次会话新坑（2026-09-17 第二批）
- **"同一几何只修了一处视图"的漂移**：底部 4px 灰缝在小记视图早已单独去掉，基础 `.workspace` 却还留着 `margin-bottom: 4px` → 文档页最底露灰条。**修共享几何前先 grep 有没有"某个状态单独覆盖过同一属性"**（那通常说明基础层漏改了），别只改报障的那一处。
- **审计装置会随 UI 批次漂移**：`scripts/css-audit/css-audit.mjs` 的 `nav.search` 还在找左上角下拉（入口已搬右上角）→ `ab2` 在**状态准备阶段**抛错（不是比对差异，易误读成回归）。跑审计装置前先确认它跟得上最近 UI 搬位。
- **`ab2 plan` 测不了 `app/*.css`**：它们被 Vite 内联进 `src/styles.css` 那张表（dev-id 实测 424 规则）；按文件名注入会 `missing` → **假 PASS**（见 `scripts/css-audit/README.md` §七）。必须用 `SPEC` 注入"整份内联内容"（本会话 `build-spec-dup.mjs` 即此）。
- **`ab2` 的 `only` 过滤是状态全名精确匹配**：传 `search-empty` 匹配不到 `search-empty:1315:light`，会被**静默跳过**（本会话白跑一轮）。

### 本次会话新坑（2026-09-17，务必记住）
- **`scrollIntoView` 会滚动"所有"可滚动祖先**：它不认"我只想滚这个容器"。本会话因此把 `body` 滚了 42px（`.sidebar` 的 `margin-top: 42px` 让外壳多出 42px 可滚区间）→ 整个 `.app-shell` 被顶上去 → 固定顶栏与壳内容错位（侧栏头钻进顶栏下、面包屑挤进 tab 行）。**要滚就只改目标容器的 `scrollTop`**；已把 `html/body` 改 `overflow: clip` 兜底（`hidden` 挡不住程序化滚动）。
- **可见区要按"窗口"裁剪，不能只看容器矩形**：停靠目录栏底边在窗口外 42px（`.sidebar` 的 `height: 100% !important` 没补偿自己的 `margin-top: 42px` —— 见 `app/shell.css:238` 的 2026-08-13 注释）→ 只用 `listRect.bottom` 判断"是否可见"会**永远少滚 42px**（症状："向上定位正常、向下永远差一截"）。副作用：目录栏最后 ~42px 内容看不全（既有布局债，未修）。
- **Chromium 给 `::view-transition-group` 默认 250ms 形变动画**：只压 `::view-transition-old/new` 不够 —— 这个默认 group 动画才是"切标签慢"的主因（实测占掉 anim 阶段 276ms 里的 ~250ms）。我们最终**整个 View Transition 都不要**。
- **对拍/等待窗口别拍脑袋定**：内核水合改写延迟 **0.5s～7.8s 不定**，短窗口会给**假 PASS**。高风险形态（正文含裸 `<img>`）必须等满上限。
- **加"对拍单测"是死路**：`vitest` environment = `node`，内核要 DOM → 只能用 CDP 脚本（`scripts/lake-roundtrip-check.mjs`）。
- **改 `electron/**` 会触发 vite-plugin-electron 重启 Electron**（老坑见下），本会话改了 `store.ts`/`schemaInit.ts`/`quickNoteConversion.ts`，构建与重启实测正常；仍按老规矩：改完别再频繁动主进程文件。

### 更早新坑（2026-09-16，仍需记住）
- **rolldown `codeSplitting.groups`**：`includeDependenciesRecursively` 默认 `true`，会把**入口也需要的依赖**并进该分组的 chunk，令入口**重新静态引用**它（懒加载失效）。要真正惰性必须设 `false`（app `vite.config.ts` 的 drawnix 组）。
- **vendor lib 构建默认 `inlineDynamicImports:true`**：会把动态 import 内联回单文件。画板卡懒加载要求关掉它，并**提交新增的 chunk 文件**（`DrawnixBoardCore-*.js/.cjs` 会随内容改名，旧的要删）。
- **`external` 匹配 package 子路径必须用正则**：精确字符串 `'@plantuml/core'` 匹配不到 `@plantuml/core/plantuml.js`（7MB 会被内联进主 chunk、预算炸）。用 `/^@plantuml\/core(\/|$)/`。
- **根 `.gitignore` 别写裸 `dist`**：会吞掉 `vendor/.../dist` 和 `public/.../katex/.../dist`（katex 镜像差点因此没进 git）。锚定 `/dist`。
- **内核 maxView（卡片/表格全屏）**：`.ne-ui-max-view{position:fixed;inset:0;z-index:1000}` 是「无外壳独立编辑器」口径；我们带侧栏/顶栏 → 会盖住整个窗口（表格缩左上、外壳被压）。适配：`.document-pane{position:relative}` + 把 `.ne-ui-max-view` 改 `position:absolute;inset:0;z-index:30`（外壳保留，内核「返回文档」退出按钮也才有布局）。
- **`src/styles/cssLayers.test.ts` 是 CSS 围栏**：新增声明会超基线。**合法新增**（不是多层覆盖回涨）就同步抬高该文件基线并注明原因；只允许变小。
- **画布滚轮门控要覆盖所有 canvas 卡**：`prepareCustomCards` 原来只给 `isMindmap` 加 `withCanvasWheelGate`；Drawnix 的 `drawing-board/flowchart-board/uml-board/drawing-mindmap-board`（slash `/hb`）漏了 → 光标路过就滚画布。识别 = 卡名集合 + `slash.mainSearch === "/hb"`。
- **画板 viewport 不是内容**：`DrawnixBoardCore.onViewportChange → onChange({plaitViewport})` 会让**每次拖动/缩放**都改卡片值 → `contentchange` → 保存 → `syncState=pending` → S3 上传。已在 vendor 改 no-op（LOCAL-CHANGES #8）。
- **keep-alive 多编辑器**：每个打开 tab 的编辑器都在 DOM 里（隐藏）。CDP 用 `document.querySelector('.mindmap-interaction-gate' / '.ne-ui-exit-max-view-btn')` 会抓到**隐藏 tab** 的元素（尺寸 0）→ 误判。必须按「可见元素过滤 / 限定 active tab 内」再判断。
- **CDP 测画布缩放别用 ctrl+wheel**：那是 Chromium 的**浏览器缩放**（会缩放整个 app 并卡住脚本）。测画板缩放要走画布自带缩放控件，或先**真实点击**激活门控再用普通 `mouseWheel`。
- **CDP 探针**：Node 24 有内置 `WebSocket`（别用系统 node 18 会 `WebSocket is not defined`）；改完 vendor/app 必须 `location.reload()` 后再测，否则测到旧状态。
- **vendor 源码改了要重建产物**：`npm run build:vendor`（`vite build` + `tsc` + postbuild），产物 `dist/**` 入库；只改源码不重建 = 运行的是旧产物。

### 同步 / 数据语义（最危险的一类）
- **`purged_at` 不是"已彻底删除"的永久标记**：`markPurgeSynced()` 在前缀删除成功后清空它（防重复删）。任何"别让它复活"的判定必须看**永久墓碑**（folder 看 `deleted_notes.node_type='folder'`）。
- **purge 的墓碑必须无条件写**：`notes` 行缺失时跳过 = 云端永不下架 = 之后必然复活成"父不存在的不可见文档"（本轮实数据踩到）。
- **不要给"资产存在性"做本机持久缓存**（GC 会真删对象 → 缓存失真 → 破坏跨端自愈）；用"刚下载的远端清单"做差集（AGENTS #11）。
- **`contentHash` 会骗人**：`syncAdapters.localHashOf` 对 synced 笔记返回 `store.baseHash`（不读 `.lake`）；判"本地可复用"必须**实读正文 + sha256**。
- **清单声明⇒存在**：上传走差集但 `manifest.assets` 仍**全量声明**（裁剪声明 → 他端 GC 误删在用资产）；禁逐对象 HEAD。
- **兜底「未分类」只惰性创建**：下载阶段无条件 `defaultNotebookId()` 会凭空建"未分类"并上传扩散；`effectiveParent()` 也只能在"真应用"处解析。
- **S3 并发峰值 ≤8**（七牛建议）：`NOTE(2)×ASSET(4)`；曾 16 偏高、无必要。
- **软删 = 移动到回收站笔记本**（`parentId=TRASH + trashedAt`），`deleted:true` 只用于 purge 墓碑。混用 = B1 级致命 bug。
- **守卫不能只挂在一条路径上**：`tab.deleted` 此前只在同步刷新里设置，启动恢复/点击打开都不判定 ⇒ 同一文档"同步过就只读、没同步就能编辑"。这类判定必须收敛成一个纯函数（现 `isGoneNote`）在所有入口调用。
- **静默丢弃用户输入是最坏的失败模式**：`if (deleted) return;` 不打提示 → 用户以为已保存。拦截必须同时给可见反馈 + 出口。
- **文档漂移**：易过期事实（分支/hash/计数/当前焦点）**只写 HANDOFF §0**，别写回 AGENTS/README。
- **`git worktree list` 要纳入开工检查**（历史上漏看过一次 android WIP）。

### 渲染 / CSS
- **浮层 flex 列的固定区必须 `flex: 0 0 auto`**：`header/页签/提示条/错误条` 默认 `0 1 auto`，内容一多就被压扁，溢出文字被**后绘制的列表**盖住（就是"回收站左侧列盖住顶部提示"）。复现：CDP 把面板压到 200px 高，比对 `Range` 文字底边与列表 `top`。
- **预览/图片切换不要清空旧内容**：`setState(null)` + 文本占位 = 塌陷再撑开 = "闪一下"。正解：保留旧图 + 新图 `img.decode()` 后替换 + 容器固定高度。
- **居中缩放容器别用 grid 的隐式 auto 行**：`display:grid; height:300px; overflow:hidden` 里图片按原始尺寸撑高行 → `max-height:100%` 失效、图被裁切。要 `display:flex; align-items:center; justify-content:center`。
- **同一元素被多层 CSS 覆盖会互相打架**（styles.css → b3/components.css → overlays.css）。改 UI 前先 `grep` 类名看有几处定义；跨层加 modifier 时写进**同一层**（`.badge` 会赢过 styles.css 里的 `.quick-notes-count`）。
- **vendored `text-clamp` 混入不等于省略号**：`.b3-list-item__text` 只有 `overflow:hidden`，长文件名会把 `__meta/__action` 挤出列宽，需自己补 `min-width:0 + text-overflow:ellipsis + white-space:nowrap`。
- **lucide 图标把 `className` 直接给 `<svg>`**：`el.className` 是 `SVGAnimatedString`（`.replace` 会炸），且 `.b3-list-item__graphic svg{}` 匹配不到 → 包一层 `<span className="b3-list-item__graphic">`。
- **密集列表行不要做 `:active scale()`**：28~40px 的行按压缩放会抖字、与滚动条抢空间（思源只给 hover 底色）。

### 工程 / 环境
- **hooks 必须在早退之前**：`SettingsPanel` 的 `if (!open) return null;` 之后全是普通函数，把 `useState/useEffect` 插进去 → "Rendered more hooks…" → **整个 React 树卸载**（`#root` 变空，长得像 GPU 崩溃）。
- **改 `electron/*.ts` 或 `src/core/*`（含 `syncDecisions.ts` 这类被主进程 import 的共享模块）→ vite-plugin-electron 重启 Electron → 命中未带 `--use-angle=metal` 的 GPU `exit_code=15`，整个 dev 实例被带走**。fresh `npm run dev` 一般不崩、**热重载才崩**。改完别再动主进程文件，或直接重启一次。
- **窗口被关掉 ≠ 进程退出**：`/json` 返回空数组但 Electron 还活着时，`open -a <Electron.app>` 触发 `activate` 会重建窗口。
- **`nohup` 起的 vite/vitest 会随 exec 会话回收而死**：dev server 必须 **tty=true 长驻**；测试直接前台跑（vitest 全量 ~3s）。
- **量 DOM 逐帧变化前必须解除后台节流**：窗口不可见时 rAF 一帧不跑、`setInterval(10ms)` 被节流成 ~1000ms（第一版数据因此全错）。解法：CDP `Emulation.setFocusEmulationEnabled{enabled:true}` + `Page.setWebLifecycleState{state:'active'}`，并用"10ms 定时器 1 秒跑了几次"自检。
- **别用跨进程往返做时序观测**：点击和采样要放在页面内**同一个 async 表达式**里，否则错过 <100ms 的中间态。
- **CSS `:nth-of-type` 数的是同类型兄弟**（含分组标题 div），不是"第 N 个列表行"；脚本里用 `rows[i].click()` 显式取索引。
- **`Page.reload` 之后 CDP `Input.dispatchMouseEvent` 可能点不动**（窗口非激活），`element.click()` 仍可靠；要测真实 hover/拖拽/剪贴板才用鼠标事件。
- **CDP 裸驱无需第三方库**：Node **v24 有内置 global `WebSocket`**（别用系统 node 18，会 `WebSocket is not defined`）；页面 target 在 `http://127.0.0.1:9222/json`。
- 压测真实云用一次性前缀 `lake-stress-<ts>/`，**结束必 `deletePrefix` 清场 + 复核 0 残留**；凭证只走环境变量、绝不入库。合成 `Readable` 流式 PUT 在七牛会大面积超时 → 测脚手架用字节 PUT。
- `better-sqlite3` 是 **N-API**（Electron/vitest/node 都能加载）；命令行查库：拷 `.sqlite3`+`.sqlite3-wal` 到别处用 `/usr/bin/sqlite3 -readonly`（app 在跑时读快照）。
- S3 `[perf]` 日志行尾数字是 **epoch 时间戳不是耗时**（旧坑，head 已移除）。
- 七牛：`ObjectStore.test()` 必须用 ListObjectsV2（HeadBucket 对存在的桶也返回 404）；正确配置 Endpoint `https://s3.cn-north-1.qiniucs.com`、Region `cn-north-1`、Bucket `local-lake-hebei`、`forcePathStyle=false`。
- 同步完成必须广播 `sync-progress`；`markSynced` 要同时改 `notes` 与 `tree_nodes.sync_state`；IPC 三处同步（`main.ts` handle + `preload.cjs` + `src/lib/native.ts`，preload 暴露名是 **`lakeNative`**）；多表写必须 `db.transaction`。
- 结束 electron 只能 kill 具体 PID，**禁 `pkill -f Electron`**（机器上还有 SiYuan/VSCode/Trae）。

## 5. 下一步建议（新会话）
1. 先跑 §6 门禁确认基线；有问题先测再改。
2. 当前待办见 **§3**（AI 接入 / 离线残余 / 移动端批次 / 技术债）。
3. 任何同步/GC 改动**先读** `AGENTS.md §3 #11/#12/#13/#15/#16` + `docs/SYNC-PROTOCOL.md` + `docs/S3-GC-DESIGN.md`，改前想清"声明是否仍全、被引用对象会不会被 GC 删、跨端自愈是否成立、复活路径在哪"。
4. UI 改动先看 `AGENTS.md §3 #14`（思源版式语法），别再造第四套类名、别写内联样式。
5. 移动端一律按 **§8**（`§8.0` 移动端/桌面硬隔离已解除——桌面与移动可自由改；仅 `src/b3/**` 思源 vendored 等共享/合规件仍须谨慎）。
6. **写任何 Lake 正文之前先读** `docs/LAKE-CONTENT-WRITING.md`：禁手拼媒体（裸 `<img>`）；无内核的主进程只写纯文本；写完用 `scripts/lake-roundtrip-check.mjs --note <id>` 对拍。
7. §3.6（小记是否挂 Lake 内核底座）与 §3.8（旧数据处置）都**等用户决定**：不要擅自大改小记，也不要擅自删/改数据。

## 6. 环境与命令
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"      # node 24（别用系统 node 18）
cd /Users/admin/file/local-lake/lake-notes-electron
# 门禁（合并前必过）
npx tsc --noEmit && npx vitest run && npx vite build && npx vite build -c vite.mobile.config.ts
git diff --check                                                # 空白错误（注意会报出移动端会话的文件）
# 开发（CDP 9222；改主进程/src/core 文件会重启 Electron 并可能命中 GPU 崩溃，见 §4）
npm run dev                 # = vite --host 127.0.0.1 --port 1421（vite-plugin-electron 拉起 Electron）
# 压测（opt-in，默认被 npm test 跳过）
LAKE_RUN_BENCHMARK=1 npx vitest run src/core/syncEngine.benchmark.test.ts
LAKE_RUN_BENCHMARK=1 npx vitest run src/core/syncEngine.dualStress.benchmark.test.ts
# Tier B 真实云（隔离前缀+自动清理；凭证仅环境变量，勿入库）
LAKE_RUN_BENCHMARK=1 LAKE_STRESS_S3_ENDPOINT=... _REGION=... _BUCKET=... _AK=... _SK=... npx vitest run electron/syncStress.benchmark.test.ts
# 云端对象查看
node scripts/s3-ls.mjs --count | --note <id> | --prefix <prefix>
node scripts/lake-roundtrip-check.mjs --note <id>   # 对拍「这篇一打开会不会被内核改写」（只动副本，退出码 1=会被改写）
```
- **UI 实测姿势**：`curl http://127.0.0.1:9222/json` 拿 page target → Node 24 内置 `WebSocket` 直驱 `Runtime.evaluate` / `Page.captureScreenshot{clip}` / `Input.*`（本会话用这套量出了预览闪烁的逐帧数据）。详见 `docs/CODEX-GUIDE.md`。
- 日志：A `~/Library/Application Support/lake-notes-dev/logs/lake-notes.log`；B `$TMPDIR/lake-device-b/logs/lake-notes.log`。数据目录见 `AGENTS.md §5`（**正式数据禁碰**）。
- 安卓/模拟器：全部命令与环境见 **§8.1 / §8.9**。

## 7. 文档索引（`docs/` 按需查）
- **契约/规格（单一来源）**：`STORAGE-LAYERS.md`（存储分层 + 设备本地契约）· `SYNC-PROTOCOL.md`（同步协议 v4）· `S3-GC-DESIGN.md`（存储/删除 GC v4）· `HISTORY-DESIGN.md`（历史快照）· `TRASH-NOTEBOOK-DESIGN.md`（回收站）· `QUICK-NOTES-SPEC.md`（小记）。
- **内核**：`LAKEX-CONTRACT.md`（闭源 lakex 行为契约 + 速查表，编辑器相关**先读**）· `LAKEX-MIGRATION-260916.md`（换源/懒加载/离线）。
- **正文写入（写 `.lake` 前必读）**：`LAKE-CONTENT-WRITING.md`（约定 + 反例 + 校验判据；配套 `src/core/lakeDocForm.ts` 与 `scripts/lake-roundtrip-check.mjs`）。
- **指南**：`CODEX-GUIDE.md`（CDP 驱动真实 Electron，动手前必读）· `DEVELOPMENT.md` · `ARCHITECTURE.md` · `TROUBLESHOOTING.md` · `RELEASE.md` · `SYNC-RELIABILITY-VERIFY.md`（数据完整性门禁）。
- **移动端**：`MOBILE-TECH-STACK.md` · `ANDROID-TECH-SCHEME.md` · `ASSET-URL-MOBILE-PLAN.md`。
- **近期简报/对账**：`CSS-LAYERS-BRIEF-260916.md`（UI 样式层）· `OFFLINE-ASSETS-AUDIT-260916.md`（离线清理对账）· `NARROW-UNIFY-BRIEF-260915.md`（窄窗统一）。
> 历史审计/研究/计划（`*-AUDIT`/`*-REVIEW`/`*-PLAN` 等）已删除（git 历史可查）；权威待办以本文件 §3 为准，移动端以 §8 为准。

## 8. 移动端（安卓模拟器 + 编辑器）专职交接（260908 收尾）

> **260920 晚更新**：移动端小记完善（不挂内核轻量框 / 图片草稿 / 系统分享 / 冷启动提速 / 用户可见名「新建小记」）本会话交接见 **§2.15**；本节其余内容仍是移动端长期基线。

> 本节是移动端（安卓模拟器 + 编辑器）交接：如何用**本机安卓模拟器**熟练验证移动端 UI/编辑，以及移动端任务的目标/已完成/遗留/坑。桌面 Electron 工作见 §0-§7。**注（260907）：原「只做移动端、别碰桌面」的硬隔离已解除**——现在桌面与移动可自由改动（见 §8.0）。

> **面向零上下文新会话——当前状态一句话（260908 收尾）**：移动端已完成**设置项收口** + **完整端**（历史快照列/恢复/删/24h去重/上限/定时、资源管理本地孤儿+云端GC、运行诊断）+ **大纲 viewer 跳转根因修复**（docs 高度塌陷）。主数据同步/编辑基础早已就绪（见 §8.4/8.5）。下一步见 §8.7（真机验收 + 数据导出/导入 + 剪贴板/资源URL）。本会话所有改动已提交 `master`（最新 `8e26910`）。
>
> **260910 更新**：移动端生产存储已切到 **Android native SQLite（WAL）**；`sql.js` 只保留为测试/一次性迁移验证实现。跨端同步端口已全部显式 `Promise`，共享 GC keep set、嵌套树契约、资源大小契约已锁定。最新分支已在 `emulator-5554` 安装并通过重启持久化与资源上限验证；见 git 历史。
>
> **更新的状态（2609xx 之后一个会话）**：又完成两块移动端大改——**编辑器底部工具栏**（修面板展开抖动、命令生效高亮、+/Aa 展开变 ×+震动、去冗余完成钮）与**首层首页重做**（小记卡片、知识库书架/列表+最近文档、底部栏[搜索|新建|云同步]、tab 滑入动效），并修**最近文档/搜索直达**、**第二层底栏滚动隐藏/显示**，且**按用户决策删除知识库排序**（改用共享 sort_order=桌面顺序）。**这批未提交**。

### 8.0 移动端注意（原「移动端铁律」已降级为注意项，260907 用户明确解除硬隔离）
- **桌面与移动已可自由改动**（不再限定 `src/mobile/**`；当前无并行会话，不会有提交冲突）。仍请谨慎：`src/b3/**` 是**思源 vendored 组件（AGPL-3.0）**、`src/features/editor/lakeRuntime.ts` 等是**两端共享模块**，改动前先确认影响面；`electron/`、`src/main.tsx` 改动会触发 vite-plugin-electron 重启 Electron（见 §4 踩坑）。
- 移动端设置/浮层 UI 受 `AGENTS.md §3 #14` 约束：用思源 vendored b3 类，**禁内联样式**（`style={{...}}`）。
- **移动端数据在安卓模拟器 App 沙盒（`com.lakenotes.mobile`）里，不是 macOS 的 `lake-notes-dev`**。开发数据可 `adb shell pm clear com.lakenotes.mobile` 整体重建（`seed_initialized` 会重新种子"个人笔记"笔记本）。
- Node **24** 必须：`export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`（别用系统 node 18）。安卓相关 JAVA/SDK 环境**脚本里已内置，不用手动 export**。

### 8.1 安卓模拟器使用（本机 AVD `lake_mobile`，pixel_6 / API36 / arm64）
**一键脚本**（都在 `scripts/`，环境变量自备，直接跑）：
| 场景 | 命令 |
|---|---|
| 启动模拟器并等开机 | `bash scripts/emu-up.sh`（纯 CDP/远程会话用 `--no-window`） |
| 构建+同步+安装+启动 App | `bash scripts/android-build.sh --sync --install` |
| 把 App WebView 转发到本地 CDP | `bash scripts/emu-cdp.sh`（默认端口 9335） |
| 不起模拟器、浏览器里速测移动 UI | `bash scripts/mobile-preview.sh`（`http://127.0.0.1:1422/preview.html`，390×844 手机框） |

- AVD 名 `lake_mobile`；SDK 在 `/opt/homebrew/share/android-commandlinetools`；gradle 复用缓存 `~/.gradle/wrapper/dists/gradle-8.14.3-bin/.../gradle`（公司网络下不了 distribution，**别走 wrapper**，脚本已指好）。包名 `com.lakenotes.mobile`；`adb` 在 SDK `platform-tools`。
- `npm run dev`（桌面）与移动端无关；移动端构建= `vite build -c vite.mobile.config.ts` → `dist-mobile/`。

**CDP 自动化驱动（本会话验证过的可靠方式）**：
1. `bash scripts/emu-cdp.sh` → 本地 `tcp:9335`。**注意：App 每次重启/导航后 WebView socket 会变**，`/json/list` 可能连不上旧 socket——用 `adb shell cat /proc/net/unix | grep -oE "webview_devtools_remote_[0-9a-f]+" | sort -u` 找所有 socket，逐个 `adb forward tcp:9335 "localabstract:$s"` 后 `curl -s http://127.0.0.1:9335/json/list` 校验 `type=="page"`，命中即 break。
2. 程序：`const list = await fetch("http://127.0.0.1:9335/json/list").then(r=>r.json())`，取 `type==="page"` 的 `webSocketDebuggerUrl`。
3. 连 WebSocket，`Runtime.enable`，用 `Runtime.evaluate`（`returnByValue:true, awaitPromise:true`）执行任意 JS 驱动/断言。
4. **触摸（触发键盘/IME）**：`Input.dispatchTouchEvent {type:"touchStart",touchPoints:[{x,y}]}` → 延时 ~70ms → `{type:"touchEnd",touchPoints:[]}`，再对 contenteditable `.focus()`。
5. **打字**：`Input.insertText {text}`；**选中文本**：`document.createTreeWalker` 找文本节点 + `Range.setStart/setEnd` + `sel.removeAllRanges();sel.addRange(r)`。
6. `window.__mobileEditor` 暴露当前活跃文档的 Lake 编辑器实例，用于 `renderer.execCommand`/`queryCommandEnabled`（比查 DOM 可靠）。

### 8.2 Lake 编辑器命令名（移动端用 `renderer.execCommand`，命令名与桌面 toolbar 不同）
- **有效**（`queryCommandEnabled`=true）：`bold`、`unorderedList`（列表！）、`orderedList`、`taskList`、`quote`、`code`、`underline`、`italic`、`insertLink`、`hr`、`color`、`style`（块级，传 `"p"/"h1"/"h2"`）、`undo`/`redo`。
- **无效**（no-op/返回 false，别用）：`insertUnorderedList`、`formatBlock`、`heading`、`setHeading`、`insertBulletList`、`strike`/`strikethrough`、`justifyLeft/Center/Right`、`clearFormat`、`fontsize`。
- **命令生效前提**：需要真实 caret/选区在文本块里——`bold` 先选中文字；`style "h1"`/`unorderedList` 需 caret 在段落里。**命令名写错/焦点丢了 = 点了没反应，还会疑似"正在下载"。**
- 渲染 DOM（验证用这些选择器）：列表=`ne-uli-i`/`ne-uli-c`/`ne-tli`（**不是** `<ul>/<li>`）；加粗=`ne-text` 且 `font-weight:700`（**不是** `<strong>`）；标题=`ne-h1`/`ne-h2`。

### 8.3 编辑器 Dock 键盘/面板机制
- `src/mobile/useKeyboard.ts` 返回 `{ base, innerHeight, offset, height, keyboardOpen }`。`base`=键盘收起满高度（max innerHeight）；`innerHeight`=当前；`offset`=edge-to-edge 上移量（adjustResize=0）；`height`=键盘实际高；`keyboardOpen=height>8`。
  - 模拟器是 **adjustResize**（键盘弹 `innerHeight 842→530`，`offset=0`，`bottom:0` 元素天然在键盘上方）；真机可能 **edge-to-edge**（`offset>0` 需上移）。两模式都被覆盖。
- `src/mobile/editor/EditorDock.tsx`：`if(!editing) return null`。工具栏 8 钮：`[+]插入 [Aa]字体 [B]加粗 [列表]unorderedList [任务]taskList [...]字体 [键盘]切换 [√]完成`。
- **工具栏 `--kb-offset`（bottom 基准）**：面板开时 `usable = Math.max(0, innerHeight - base + panelHeight, offset)`；无面板 `usable = offset`。作用：键盘收起 `innerHeight 530→842` 全程工具栏屏幕 Y **不跳**；`max(…, offset)` 兜底 edge-to-edge 真机（键盘回弹瞬间工具栏实时抬到实测键盘上方）。CSS：工具栏 `bottom: var(--kb-offset)`（**无 transition**——对 resize 中的视口做动画会把一帧错位放大成抖动）；面板 `bottom:0; height:var(--kb-offset)` 占键盘区（**有 `box-sizing:border-box`**，塌缩到 0 时不会剩 padding 细条）。
- **面板⇄IME 硬互斥兜底（260911 新增，EditorDock guard effect）**：Lake 命令（hr 等）执行后**内核会异步重聚焦 contenteditable → 输入法弹回**，面板开着时会把面板压扁盖住工具栏（用户三次报此现象，260911 定位到真因）。兜底：`useEffect` 监听 `panelMode && keyboardOpen`（实测键盘状态驱动）→ `setPanelHeight(max(h, height))` + `blurActiveEditable()` 再压回。**任何机型/输入法通用**，因为依据是 visualViewport 实测而非输入法假设。
- **焦点/键盘**：`onMouseDown={(e)=>e.preventDefault()}` 加在 `.med-toolbar`/`.med-panel` 上，**防按钮抢走编辑器焦点**（否则键盘关、caret/选区丢→命令 no-op）。`runInline`（工具栏）= 仅 `exec`；`runPanel`（面板项）= 仅 `exec`，**都不要调 `focusEditor`**。
- 面板开关：开=`setPanelHeight(max(round(height),280))` + `setTimeout(()=>blur(),0)`（提 IME、占住键盘区）；关=`setPanelMode(null);setPanelHeight(0); focusEditor()`（自动恢复键盘）；`收起键盘/显示键盘` 切换。

### 8.4 任务主线（用户定位：移动端=完整端）
用户把移动端定位为**完整端**（大平板轻办公趋势，可能长期只用移动端），要求对齐桌面端的体验与逻辑（AGENTS §3 红线全适用）。
**近期主线（260908 本会话，已全部完成）**：
1. **设置项收口**：移除 `showToolbar`/`showToc`；设置项加 `platform` 标记（桌面专属/移动专属/两端）；设置版式原语抽共享 `settingsPrimitives.tsx`。
2. **移动端完整端**：历史快照（列/恢复/删除/去重/上限/定时自动快照）、资源管理（本地孤儿检测+清理、云端 GC）、运行诊断。
3. **大纲 viewer 跳转根因修复**：编辑器滚动容器塌陷（`.mobile-workspace-body` 非 flex → doc 高度 0）。

**更早（260904，移动端编辑器核心）**：面板闪烁/堆叠、命令名错、焦点/键盘、`--kb-offset` 稳定（见 §8.2-8.3 机制）。

### 8.5 已完成（本会话 + 早前，按领域组织；全部已提交 master）

**编辑/会话基础（早前）**：多 tab+左右抽屉、设置竖向菜单+子页、移动精仿思源样式、seed 数据、keep-alive 性能、settings 重构、`useKeyboard`/`EditorDock`/`editor-dock.css`（命令名、焦点/键盘、`--kb-offset` 稳定）。

**设置收口（260908）**：移除 `showToolbar`/`showToc`（AppSettings schema + 桌面/移动 UI + settingsSearch 全清）；`SettingItemEntry.platform`（desktop/mobile/both）+ `isSettingVisibleFor` 助手；桌面专属项标 `platform:desktop`（快捷键/历史/GC/备份/日志/关于详情）；设置版式原语抽 `src/components/settingsPrimitives.tsx`（桌面 `SettingsPanel` + 移动 `SettingsDrawer` 共用，对齐思源"内核+薄前端"分层）。

**移动端完整端**：
- **历史快照**：`listNoteHistory`/`restoreHistory`（恢复前先给当前正文留档=可反悔）/`deleteHistory`/`cleanupHistory`（共享 `selectHistoryDrops` 分层保留+上限+保留天数）/`snapshotNote` + **24h 去重**；`HistoryMobileSettings`（maxSnapshots/retentionDays/cleanupIntervalHours/snapshotIntervalMinutes，存 device_state）+ 设置「历史」视图 + MobileApp 定时器（`snapshotIntervalMinutes` 周期快照）；目录树长按「历史版本」sheet。
- **资源管理（本地）**：`orphan_assets` 表 + `detectOrphans`（保存登记未引用资源，含历史 refs 保护）+ `listLocalAssets` 跳过孤儿（**删图不再重传**）+ list/delete/clean API + 设置「资源管理」视图。
- **资源管理（云端 GC）**：`S3Store` 扩 `listObjects`/`deleteMany`；共享 `src/core/gcDecisions.buildGcKeepSet`（含 `extraManifests` prev 链引用保护，+单测）；`s3_gc_pending`/`s3_gc_log` 表 + add/remove/list/record；`syncNow` 加 `onPublished` 钩子（新 manifest 不再引用的旧正文/资源→登记待回收，full key）；`gcDeepCleanup` double-anchor 窗口 + 删除写 gc 日志 + 设置「云端清理」按钮。
- **运行诊断**：`getDiagnostics`（文档/分组/小记/资源/孤儿/待回收/快照数+库大小）+ 关于页「数据诊断」区块（移动端无桌面日志文件，此为「关于/日志」等价）。

**其他**：标签保持（localStorage 记上次打开标签 + `maxOpenTabs` LRU 淘汰）；工作区改标题；插入面板纯图标；小记缩略图批量（`listQuickNotes` 一次返回 `firstImage`）；目录树长按管理（重命名/图标/移动/删除）；**大纲 viewer 跳转根因修复**（`.mobile-workspace-body` 加 flex + `.doc-pane` flex:1，编辑器滚动容器恢复）+ `OutlineSheet.jump` 补 DOM 校正。

**lakeNative 暴露（调试契约）**：listOrphanAssets/cleanOrphanAssets/deleteOrphanAsset/gcDeepCleanup/listNoteHistory/restoreHistory/cleanupHistory/getHistorySettings/saveHistorySettings/snapshotNote/getDiagnostics。

门禁：`tsc` 0 · `vitest` 838 通过/15 跳过 · desktop `vite build` + 移动 `vite build -c vite.mobile.config.ts` 全绿 · `android-build.sh --sync --install` 过。

**（2609xx 后续会话，未提交）编辑器工具栏 + 首层首页 —— 见 git 历史**：
- **编辑器工具栏**（`EditorDock.tsx`/`editor-dock.css`）：面板展开抖动修复（`--mobile-dock-space` 由动画 `usable` 驱动，正文区恒 436px）；命令生效高亮（mark 用 DOM 计算样式、块级用 `queryCommandState===1`）；+/Aa 展开变 ×（`med-open`）+ 触感；去底部冗余"完成"。
- **首层首页**（`HomePage.tsx`/`NotebookGrid.tsx`/`mobile.css`）：小记卡片；知识库书架（白卡+线条图标）/列表 + "最近文档"；右上书架↔列表；底部栏[搜索|新建|云同步]；tab 滑入动效；空态不提示创建。
- **其它**：最近文档/搜索/新建直达文档（`NotebookWorkspace` 的 `initialNoteId` 优先）；第二层底栏滚动隐藏/显示；**删除知识库排序**（改用共享 sort_order=桌面顺序）；最近文档简约样式 + 书架默认线条 `BookOpen` 图标。

**（260911 本会话新增，提交 a18a95b）安卓 AssetServer + Dock 竞态 —— 见 git 历史**：
- **AssetServer token 语义对齐桌面**：仅 CORS（带 Origin）校验 token，no-cors（`<img>` 等）放行，外部 Origin 仍 403；修 no-token canonical URL 403 → 图片空白（87e4642 的过度限制）。`+3` 单测（`AssetServerTest`）。
- **Dock 面板⇄IME 硬互斥**（guard effect + panelHeight 跟踪实测 + border-box + usable max(offset)），模拟器实测 0 遮挡。
- **实验痕迹清理**：12 条实验笔记 UI 删除→purge→三端 purged=true。

### 8.6 当前问题 / 未决（需用户真机给现象）
1. **大纲 viewer 跳转 —— 已修复，但待长文档真机验证**：根因（`.mobile-workspace-body` 非 flex → doc 高度塌陷 0）已修复（e95ec6f，实测 doc 高 0→794）。**但**完整"点击大纲标题滚动到位"未端到端验证——因为**用测试文档造不出 Lake 可接受的高内容**（`ne-p`/`ne-h1` 格式不被编辑器接受，渲染成短内容），这是测试固件问题非 bug。**用真实长文档（正确内容格式）点大纲标题确认**。若仍不滚，给现象。
2. **"正在下载"从未复现**（MutationObserver 实时抓也没有）——判断是编辑器初始化瞬时态/旧命令报错后遗症，修复后未见。**若真机仍见，要截图或位置**。
3. 命令在**被改乱的段落**上可能不生效（caret 落标题/边界时 list 0→0）——编辑器 caret 语义，非命令 bug；干净段落正常。
4. **剪贴板粘贴不解析为空**（§3.6-3.8 遗留）：静态线索=移动端入口没挂 `installPasteInterceptor`；android worktree 已补挂，先沿那条线验证。
5. ~~**本地资产 canonical `http://127.0.0.1:19876/{noteId}/{file}` 真机不可达**~~ **✅ 已解决（260911）**：安卓端 `AssetServer.java` 让 canonical URL 在本机可达，403 过度限制已修，模拟器实测编辑器内图片正常渲染。`adb reverse tcp:19876 tcp:19876` 仅宿主机浏览器调试时需要。
6. 用户"移动端整体编辑还有问题"现象未细化——**真机反馈给具体现象再定位**。
7. ~~**首层首页 + 编辑器工具栏改动未提交**~~ **✅ 已提交**（a752f2a，260911 前批次）。
8. **首层"最近文档"= 最近*更新*代理**：非"最近打开"；对用户说清后可再加 `last_opened_at` 追踪。
9. **知识库排序已删除**（用户决策，不再做）：手机端不再写本地 `sort_order`，展示共享顺序 = 桌面端顺序。若日后想"每端独立顺序"，需改同步协议（manifest `folders[].sortOrder`），属红线区、须谨慎。
10. **首层新 UI 真机确认项**：书架白卡+线条 `BookOpen` 图标（已去彩色/红 emoji）；最近文档极简 icon+标题（已去灰底）；顶部排序按钮仅小记显示；知识库右上角为书架↔列表切换。

### 8.7 下一步（移动端，按优先级）
0. **（最新）真机（小米）验收 260911 双修复**（模拟器已实测通过，真机待验）：① **图片/附件插入后立即显示**（AssetServer no-cors 放行修复，此前上传后空白 403）；② **编辑态工具栏不被面板/键盘盖住**（插入分割线→回车复现路径）；③ 同步后图片加载。注意真机很可能是 **edge-to-edge 模式**（与模拟器 adjustResize 不同），兜底已覆盖但值得盯一下。
1. **真机验收本会话交付**（历史/资源/GC/设置/大纲）：重点用**真实长文档**验证①大纲跳转滚动②资源管理（删图不再重传、孤儿清理、云端 GC）。
2. **整库备份/云端恢复**：桌面走「文件系统拷贝 + 应用重启」；移动端数据在沙盒（native SQLite + Capacitor FS，无 workspace 目录），架构不匹配——需另做「**数据导出/导入**」（导出 DB 快照 + 资产清单到文件）。当前已有「运行诊断」统计。
3. **定时自动快照真机验证**：`snapshotNote` 复用 `createHistorySnapshot`（已带 24h 去重）；**移动端模拟器 app 生命周期可能不触发 `setInterval`**，需前台运行验证。
4. **剪贴板粘贴真机验证**（§8.6.4）：沿 android worktree `installPasteInterceptor` 线索。
5. **资源 canonical URL 真机可达**（§8.6.5）：`adb reverse tcp:19876 tcp:19876`。
6. **大纲 viewer 跳转**（§8.6.1）：长文档确认。

### 8.8 移动端踩坑（本会话新增）
- **`insertUnorderedList` 不是 Lake 命令**：`unorderedList` 才对；命令名错=静默 no-op/疑似"下载"。
- **点 dock 按钮会抢走编辑器焦点**：键盘关、caret/选区丢→命令失效。解法：容器 `onMouseDown={e=>e.preventDefault()}`。
- **面板项别调 focusEditor**：`renderer.execCommand("focus")` 重开 IME→叠成"工具栏-面板-键盘"3 层；面板项只 `exec` 不聚焦。
- **别在 setState updater 里 blur**（键盘有时仍开着）；blur 挪到 `setTimeout(0)` 外。
- **工具栏 `transition: bottom` 有害**：它在对"正在 resize 的视口"做动画（键盘收起 `innerHeight 530→842`），把本来稳定的一帧错位放大。改 `--kb-offset=innerHeight-base+panelHeight`（屏幕 Y 恒定）并删 transition。
- **adjustResize vs edge-to-edge**：模拟器 adjustResize（键盘弹 `innerHeight` 变小、`offset=0`）；真机 edge-to-edge（`offset>0` 上移）。用 `height>8` 判键盘开、`offset` 区模式。
- **测试污染**：往文档打字/改格式会改脏 doc → 后续 caret 不可靠（list 0→0）。验证命令用**新建干净文档**（`window.lakeNative.createNote(name,'notebook-personal')`），别在已改过的 PRD/文档上测。
- **模拟器 `.click()` 无 mousedown**：测不了 `preventDefault` 焦点路径；`Runtime.evaluate` 里 `element.click()` 测逻辑，真实 preventDefault 要真触屏/真机。
- **模型看不了图**：`read_image` 失败（模型不声明图片输入）→ 用 DOM/computed style/`getBoundingClientRect` 量测代替截图。

**（260908 本会话新增）**
- **`.mobile-workspace-body` 必须显式 `display:flex`**：它 `flex:1`（高度来自父 flex）但非 flex 容器，`.doc-pane`/`.mobile-doc-body` 的 `height:100%` 在其中**塌陷为 0** → 编辑器无滚动容器 → 大纲跳转/长文滚动失效。修：workspace-body `display:flex; flex-direction:column` + doc-pane `flex:1; min-height:0`。
- **Lake 内容格式 ≠ 裸 HTML**：测试文档别用 `<h1 class="ne-h1">`/`<p class="ne-p">`（编辑器不认，渲染成短内容、无真实标题）。要用**应用内真实生成的 Lake 内容**（或从真实文档读 content 再改）做高度/跳转测试，否则测不出滚动。
- **`S3Store` 接口（共享 `src/core/syncEngine.ts`）扩 listObjects/deleteMany 是可选方法**（`?`）：桌面 `createS3StoreAdapter` 没实现也不报错（GC 用 legacy `electron/sync.ts` ObjectStore）；移动端必须实现才能云端 GC。
- **GC key 带 prefix 一致性**：移动 `listObjects` 返回 **full key**（含 `{prefix}/`），而共享 `buildGcKeepSet`/`collectManifestRefs` 返回 **无 prefix 的 key**——`buildGcKeepSet` 里统一 `keep.add(prefix + "/" + ref)`；`onPublished` 钩子里 `addS3GcPending` 也要传 full key（`${prefix}/${objectKey(...)}`），否则与 `gcDeepCleanup` 的 full-key listing 对不上。
- **`selectHistoryDrops` 是共享函数**（`src/core/storeUtils.ts`）：桌面 `cleanupHistory` 与移动 `cleanupHistory` 共用同一分层保留逻辑；移动端 note_history 无 `protected_until` 列，不涉及桌面那种"冲突归档保护期"。
- **设置项加/改必须同步 settingsSearch 注册表**（AGENTS §3 #14）：新增 `itemId`（如 resources-clean、history-*、appearance-theme）若只在移动端（无搜索），不入 SETTING_ITEMS 也不报错；但**桌面**新增的设置行必须入 SETTING_ITEMS，且 `vitest src/components/settingsSearch.test.ts` 会卡漂移。

**（260908 移动端 UI 对齐思源批次新增）**
- **CSS 层叠顺序坑（同一类被两套定义打架）**：`mobile.css` 由 `MobileApp.tsx` import，注入顺序**早于** `main.tsx` 里的 `src/b3/siyuan.scss` ⇒ 覆盖 `.b3-*` 的选择器必须比思源本体更具体（`.b3-menu.ln-sheet`、`.b3-button.ln-confirm__danger`），否则被反向压过（本次 danger 按钮不红、sheet 高度不生效都是这个原因）。
- **border-box 语义差异**：思源 `_mobile.scss` 的 `.toolbar__icon{width:20px;padding:10px}` 是 content-box 思路；本项目全局 `* { box-sizing: border-box }` ⇒ 照抄会让内容盒塌成 0（图标 0×18 不可见）。移植时写成"总尺寸 = 图标 + 2×padding"。
- **harness 截图假象**：Electron 窗口被遮挡时 transition 会**冻结**，`Page.captureScreenshot` 截到"半开的面板/半屏抽屉"，看着像布局 bug 其实是合成层没画完。解法：截图前注入 `*{transition:none!important;animation:none!important}`（本会话 harness 已内置）+ `Page.bringToFront` + `Emulation.setFocusEmulationEnabled`；另：`mobile:true` 的设备模拟会按 visual viewport 缩放，截图请用 `mobile:false, deviceScaleFactor:2`。
- **同一文档不允许两种壳**：`DocumentPage`（顶栏 4 图标）与 `NotebookWorkspace`（底部栏+抽屉+手势）并存 ⇒ 从首页/搜索打开的文档没有抽屉和守卫。统一后 `openNote()` 一处判定（`isGoneNote`），别再加第二条打开路径。
- **删除文档必须连带关标签**：`applyDelete` 里 `closeTab(node.id)`，否则回收站文档仍留在 tab 里可继续编辑（AGENTS §3 #16 的移动端形态）。

**（2609xx 首层 + 工具栏本会话新增）**
- **lakex `queryCommandState` 对 mark 命令恒返回 `-1`**（0=无效/1=生效/-1=不确定）：用 `!!v` 会把 -1 当"生效"→ 恒误亮。**行内标记生效判定改用 DOM 计算样式**（font-weight≥600 / font-style / text-decoration / code）；块级（quote/列表/待办/undo/redo）用 `queryCommandState === 1`。
- **`--mobile-dock-space`（正文底部留白）别用固定 `panelHeight + 工具栏`**：点开面板瞬间面板还没显形、键盘还开着，留白猛增 280 → 内容区先压扁再弹回（剧烈抖动）。要**用动画中的 `usable`（= `--kb-offset`）驱动**（`留白 = usable + 工具栏`），内容区才全程恒定。
- **`<button>` 默认有浏览器按钮底色 `#efefef`（灰）**：首层最近文档卡、任何"纯图标 button"要设 `background:transparent; border:none`，否则灰色露出来（本会话"最近文档灰底"就是这么来的）。
- **显式打开某文档（最近文档/搜索/新建）时 `initialNoteId` 会被"恢复上次标签"覆盖** ⇒ 打开错文档。修：`NotebookWorkspace` 启动改"显式 `initialNoteId` 优先打开并置为活动，再补开其它已存标签"。
- **emulator CDP socket 随 App 重启变化且 forward 常连不上**：先 `adb forward --remove-all`，再 `adb shell cat /proc/net/unix | grep -oE "webview_devtools_remote_[0-9a-f]+"` 找新 socket，`adb forward tcp:9335 localabstract:$s` 后 `curl /json/list` 校验（多轮重试 + 等 App「Displayed」后再连；用 `adb forward --list` 核对）。
- **知识库 `sort_order` 是共享字段**（manifest `folders[].sortOrder`，跨端同步）：跨端改会互相影响。用户已**决定不做**知识库排序（手机端不写本地 sort_order，展示共享顺序）；以后别再加回，除非先讨论同步语义（红线区）。
- **触感 `navigator.vibrate` 经 CDP 观测不到**：需真机/模拟器手动确认。

**（260911 同步收敛 + AssetServer + Dock 竞态新增）**
- **跨端平台代码先读对端实现再写**：安卓 AssetServer 当初对所有请求强制 token（87e4642），而桌面只对 CORS 请求校验——语义漂移直接造成「上传后图片全 403」。安全语义（token/Origin）两端必须逐字节对齐。
- **Lake 命令执行后内核会异步重聚焦 contenteditable**：面板开着时 IME 会被顶回。不要试图枚举谁在重聚焦（lakex 闭源），用**实测键盘状态兜底**（`panelMode && keyboardOpen` → 再 blur）；`panelHeight` 是打开瞬间的快照，真机输入法带候选条/工具条会更高，必须跟踪实测最大值。
- **`.med-panel` 的 `height:calc(var(--kb-offset))` 必须配 `box-sizing:border-box`**：否则塌缩到 0 时剩 27px padding+border 细条，压在工具栏下半截（就是用户截图里的「工具栏被弹窗盖住」）。
- **adjustResize 下「面板展开 + IME 弹回」的可视症状**：窗口 842→530、`--kb-offset`→0、面板变细条——看到的不是「键盘盖住工具栏」而是「面板细条盖住工具栏」，别误判成 z-index 问题。
- **`listNoteSummaries()` 没有 `trashedAt` 字段**（返回 id/title/parentId/sortOrder/updatedAt/syncState/isConflict/isLocked/lockedAt）：判定「回收站/活跃」必须用 `listTrash()` 的条目（含 `purged`/`deletedAt`）。本轮验证脚本两次因此误判「删除失败」。
- **桌面实例会占宿主机 19876/19877**：`adb reverse tcp:X tcp:19876` 想从宿主机 curl 安卓 AssetServer 时，请求会被宿主 Electron 的 asset server 截胡（404/语义不同）——先 `lsof -nP -i :<port>` 确认宿主端口归属，换冷门端口。
- **`adb kill-server` 后 reverse 规则可能注册了但监听没真正建立**（curl 000）：重启 adb server 后重建 forward/reverse，再 `lsof` 核对监听。
- **CDP 复现 IME 竞态的假象**：物理 `input tap` 后 `userTappedEditorRef` 可能残留 true（目标已聚焦时不再触发 focusin 消费）→ 程序化点击面板命令会把面板关掉，与真实用户路径不同。验证 IME 用 `dumpsys input_method | grep mInputShown` 当事实源；测兜底可直接 JS `el.focus()`（CDP 的 focus 足以唤起模拟器 IME）。
- **模拟器 headless 实例复用坑**：`emu-up.sh` 检测到已跑实例就复用；前会话 `--no-window` 启动的实例会让用户「看不到界面」。处理：`adb emu kill`（优雅关，AVD 数据不丢）→ 重跑脚本（默认带窗口）。

### 8.9 移动端常用命令
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npx tsc --noEmit                                             # 类型检查
node node_modules/vite/bin/vite.js build --config vite.mobile.config.ts   # 移动 bundle→dist-mobile
bash scripts/android-build.sh --sync --install               # sync+gradle+adb install+launch(com.lakenotes.mobile)
bash scripts/emu-cdp.sh                                      # 转发 WebView→tcp:9335（测 UI 前必跑）
bash scripts/emu-up.sh                                       # 启动模拟器（无窗口 --no-window）
bash scripts/mobile-preview.sh                               # 浏览器预览 http://127.0.0.1:1422/preview.html（需先 build）
# UI 走查（本会话用这套，比模拟器快得多；harness 脚本暂在 /tmp/lkm，待入库 scripts/）
node node_modules/vite/bin/vite.js -c vite.mobile.config.ts --host 127.0.0.1 --port 5173   # 移动 bundle dev（HMR）
./node_modules/.bin/electron --remote-debugging-port=9223 /tmp/lkm                          # 390×844 Chromium 壳
node /tmp/lkm/cdp.mjs --shot /tmp/lkm/x.png '<js>' ; node /tmp/lkm/walk.mjs steps.json      # 裸 CDP 求值/批量走查截图
adb shell pm clear com.lakenotes.mobile                      # 清 App 数据重建种子（dev 才做）
```

### 8.10 目录树交互对齐思源：桌面 ⋯＋ / 移动端 ⋯＋ + 长按拖拽（260912）
- **桌面**：每行 ⋯（竖向 lucide-ellipsis-vertical，= 右键菜单，弹出位置在按钮处）+ ＋（= 新建子文档）。动作默认 display:none 不占宽度（不逼标题缩略），行 hover/选中/聚焦才显形，此时标题才 ellipsis 截断让位；着重色只给光标所在的那个按钮。对齐思源 .b3-list-item__action / more-root / new（见 siyuan-master/app/src/layout/dock/Files.ts:1448-1451）。
- **移动端**：行内 ⋯ + ＋ 常显（触屏无 hover；对齐思源移动端 MobileFiles.ts:1505-1509——移动端行 class 不带 --hide-action）。⋯ → setMenuFor（现有 MobileSheetMenu）；＋ → 弹「新建文档 / 新建分组」再建（bridge.createNote / bridge.createGroup）。标题 min-width:0 + ellipsis 防超长名盖住按钮。
- **长按拖拽排序**：长按 350ms 进入拖拽（haptic），长按不再弹菜单（菜单交给 ⋯）；document 级 touchmove 跟手位移，用 elementFromPoint + 落点比例（<28% before / >72% after / 中间 inside）定落点，视觉 .nb-dragging / .nb-drop-before|after|inside；松手：同父 → bridge.reorderSiblings，跨父/拖入分组 → bridge.moveTreeNodeOrdered。真机实测：把「安卓上行-2」拖到「安卓上行-1」前，顺序生效。
- **已补齐（ed87eb7 / 9d78e6a）**：① 边缘自动滚动——手指进入面板上/下 64px 内，rAF 循环滚动；② 其他行让位——源行到落点之间的行整体上/下移一个行高；③ 拖起行 pointer-events:none，elementFromPoint 穿透到下层行，落点判定稳定；④ 落点线照搬桌面专做的那套（drop-line-before/after 伪元素画 2px accent 线 + soft 光晕；拖入分组 drop-parent），替换原 nb-drop-* box-shadow 方案。真机合成拖拽复验：第 3 行拖到第 1 行前顺序生效。

---
