# HANDOFF.md — Lake Notes 项目交接（唯一权威交接文档）

> 写给**完全没有上下文的新会话**。开工先读三份：本文件 → `AGENTS.md`（长期红线/机制/坑，每次自动加载）→ 相关 `docs/`。
> 历史所有 dated handoff 已合并进本文件（内容在 git 历史可查）。本文件只保留**当前状态 + 真正的待办 + 有价值的坑**。
> **§8 是移动端（安卓）专职交接**，由移动端会话维护；桌面会话不要改 §8，移动端会话不要改 §0-§7 之外的桌面文件。

## 0. 当前基线（新会话开工前）
- **本批（表格文档接入 kind=sheet，✅ 已提交并推 origin：`master` @ `71c2d90`；⚠️ 尚未真机验收）**：分支 `feat/sheet-document` 已 **ff 合入 `master`**（旧调研分支 `spike/sheet-ce` 已删）。**写给零上下文新会话的完整交接 = §2.8（新会话从这里读）**；设计/选型/实测数据全表 = `docs/SHEET-BITABLE-DESIGN-260918.md` + `docs/FORTUNESHEET-FEASIBILITY-260919.md`（260919 换内核）。
  - 一句话：新增**文档类型** `kind = doc | sheet | bitable`（只加在 `notes.kind` + `manifest.kind`，**不动 `tree_nodes.node_type`**）；表格正文落 `sheets/{id}.sheet.json`；**manifest 升 v6**（带 kind）；编辑器 = **FortuneSheet 1.0.4**（260919 由 jspreadsheet CE 换掉；CSP / 图片 input / 编辑态限宽 / setCellFormat 判空 走 `patches/`）；**多维表(bitable)本批不做**。
  - 门禁（本批实测）：`tsc` 0 · `vitest` **1025 passed / 16 skipped (1041)** · 桌面 + 移动 `vite build` 全绿 · `check:bundle` app-js gzip **1.82MB / 预算 2.90MB** · `check:core` 0 · 懒加载分包 `SheetEditor-*.js` ≈ **580KB gzip，首屏 index chunk 不含它**。
  - ⚠️ **manifest v6 ⇒ 所有端必须一起升级**：旧端读到 v6 会显式拒绝同步（`READABLE_MANIFEST_VERSIONS={4,5,6}`，未知 kind 也拒绝）——这是**刻意**的安全闸，防止旧端把表格 JSON 当 Lake 文档打开、保存即写坏正文。
  - ⚠️ **未做 / 待办**：① **真机验收**；② `SheetEditor.tsx` 的 2 处内联样式（**违反 AGENTS §3 #14**，改 CSS 基线需用户确认）。**清单见 §3 第 13 条。**
  - ✅ 已随本批完成：非 doc 导出 kind 守卫 + 目录树/⋯ 菜单/大纲/字数 的 kind 收口；`docs/SYNC-PROTOCOL.md`+`docs/STORAGE-LAYERS.md` 回填；spike 产物清理（`spike.html`/`src/spike/`/`scripts/spike-sheet-ce.mjs`/`vite.spike*.ts` 已删，**设计文档保留**）。
- **上一批（S3 审计三条错误处理修复，✅ 已提交并推 origin，260918 用户验收）**：本批代码末提交 = `master` @ `2f46784`（其上为 HANDOFF 更新 `54b84dd`）；上一批代码基线 `e873809`。本批 = 审计文档 `docs/S3-STORAGE-AUDIT-260918.md` 的**三次复核 + 三条落地**（详细勘误与证据见该文档 **§8**）：
  ① **F2**：清单拉取失败 ⇒ 整轮中止并抛出（`src/core/syncEngine.ts` pull 的 catch 删掉「降级成 return」分支；对象缺失=首次同步走 null 分支不受影响）——顺带修掉「引擎早退后 Controller 仍删 purge 前缀 + `markPurgeSynced`」的顺序问题；
  ② **D1/F1/D2**：桌面留档不再静默吞（`electron/syncAdapters.ts` `createHistorySnapshot` 删整体 catch）+ 拒空正文（`.lake` 缺失被 catch 成 "" 时抛「留档内容为空」）；手动同步 UI（`src/hooks/useSyncController.ts`）catch 透出真实原因；
  ③ **D3/F6**：`AssetRepository.getProtectedRefs` 单点扩成「当前正文 ∪ 历史 refs ∪ **未保存草稿 refs**」（`electron/draftJournal.ts` 新增 `draftJournalDir`/`readDraftEntry` 只读助手；`store.ts` 装配注入；`main.ts` 改用共享目录函数）⇒ 自动清理/全局清孤儿/单条删孤儿/云端 GC keep 集/待回收标记五处口径一致。
  - 护栏：`src/core/syncEngine.test.ts`（D2 测试改 rejects 断言 + 新增「审计 260918 D1 留档失败整轮中止」）· `electron/store.test.ts`（新增「审计 260918 D3 草稿引用不被清理」+「D1/D2 留档 adapter 拒空/写盘失败抛出」）。
  - 门禁（本批实测）：`tsc` 0 · `vitest` **1014 passed / 16 skipped (1030)** · 桌面 + 移动 `vite build` 全绿。
  - 审计文档同步更新：`docs/S3-STORAGE-AUDIT-260918.md` 新增 **§8**（§7 勘误 + 落地记录），§7.1–7.5 按 §8 更正（F2/D2 复现步骤原文验不出来、D5 降为 Info、B4 补下载侧触发面与内存上界、F7/F9 明确不做）。
- **基线（上一批，已在 `master` 且已推 origin）**：`master` @ `e873809`（本批代码末提交；其上为本条 §0 更新）。本批 = **块级编辑三批收口 + 目录栏收口**（原在途分支 `feat/block-drag-native` 已**合入并删本地分支**）：
  ① **块手柄锚点**改锚「**项目符号 marker 左缘**」（原锚内容左缘 ⇒ 手柄压在符号上，实测 icon 中心落在 marker 内 16px；改后 = `marker.left − 16`）；
  ② **删除/剪切/拖拽不再留空行**：`deleteByRange` 语义是「删内容」，范围覆盖根级整块时内核会在原位补一个默认段落（实测删除 `63→63` 空段落+1、拖拽 `63→64`）⇒ 改走内核**模型事务节点级删除**（`removeBlockNodesNative`：`_model.editing` → `getNodeById/removeChild` → **选区复位** → `commitJob`），拖拽改「**先摘源节点 → 按删除后落点 `insertAtPosition`**」；修复后删除 `63→62`、拖拽 `63→63`、空段落不变；
  ③ **目录栏收口**：新增「**刷新**」按钮（**置于图标组最左**）、「＋」只留「新建笔记本」并收小弹窗（220×60/行高42 → **150×50/行高32**）、**点文档不再自动展开子项**（`expandAncestorChain` + 跟随定位 `expandSelf:false` + `autoExpanded` 只展开容器）、**自动定位去跳动**（改 `useLayoutEffect` 布局前同帧滚动；A/B 逐帧实测错位帧 **2 → 0**）、**重命名只留一个焦点环**（去 b3 outline + box-shadow + 重命名行的 `context` 环）；
  ④ 「**拖拽改层级 + 蓝色导引线**」经评估可做（0.5–1 天）但**用户决定先不做**，已并入 §3 第 11 条的**优化项**（与多块选区批量拖拽同项）。
  - **写给零上下文新会话的完整交接 = §2.7**（任务目标/已完成/当前问题/下一步/踩坑）；逐条过程见 §2.6；内核行为结论见 `docs/LAKEX-CONTRACT.md` **§5.8.5**；厂商改动见 `vendor/lakex-doc-react/LOCAL-CHANGES.md` **#17**。
  - 门禁（本批）：`tsc` 0 · `vitest` **1011 passed / 16 skipped (1027)** · 桌面 + 移动 `vite build` 全绿 · **三个块编辑 e2e 全绿**（`e2e-block-list-span` / `e2e-block-menu-smoke` / `e2e-block-multi-select`）· `git diff --check` 只报 vendor 生成产物里**原本就有**的行尾空格（HEAD 上同样 2 处，已核对）。
  - 关键入口（本批）：`vendor/lakex-doc-react/src/components/BlockHoverHandle/BlockHoverHandle.tsx`（`updateHandlePosition` 锚 marker）· 同目录 `blockMenuHelpers.ts`（`removeBlockNodesNative` / `deleteBlockByRange` / `moveBlockNative`）· `src/components/Sidebar.tsx`（刷新按钮 / `scrollRowIntoView` / `revealNode` / `expandAncestorChain` / `autoExpanded`）· `src/hooks/useTreeActions.ts`（`refreshTree`）· `src/styles/app/shell.css`（`.create-menu` / `.tree-rename-input`）· `src/features/editor/blockMenuNative.test.ts`（护栏）。
- **上一批（浏览器端「本机附属窗口」开关）**：代码末提交 `a3596ad`；同会话再上一批（壳层底部灰缝根修 + CSS 层级冗余收口 档0/档1 + 审计装置漂移）见 §2 第 1~5 条，代码末提交 `4faa5e1`：
  ① **定位**：浏览器端**不是移动预览**（那是 `mobile.html`/`preview.html`），而是桌面主进程起的**本机附属窗口**（`electron/webApiServer.ts`，初版 260916 `a481d08`）：`POST /api/<channel>` 复用同一批 IPC handler + 静态服务 `dist/` + `/__native.js` 注入 `window.lakeNative` 的 HTTP shim；**只绑 127.0.0.1**；
  ② **不做伺服（用户 260917 决定）**：不监听局域网、不对外开放、不允许其它设备访问，只供**本机**浏览器使用；
  ③ **新增「设置 → 浏览器端」开关**：`electron/ipc/registerWeb.ts` + `createWebServerController`（`electron/webApiServer.ts`）。**不落盘**（内存态，每次启动默认关闭）、**打开/关闭即时起停服务、无需重启**（旧的"启动时读落盘开关 + 需重启"写法已废弃）；
  ④ **「打开浏览器」按钮**：新 IPC `open_web_client` → 主进程 `shell.openExternal(url)`；**URL 由主进程按固定端口构造、不接受渲染层传 URL**（防开放重定向）。
  - 门禁（浏览器端那批）：`tsc` 0 · `vitest` **989 passed / 16 skipped (1005)** · 桌面 `vite build` + `vite build -c vite.mobile.config.ts` 全绿 · `git diff --check` 干净。
  - 桌面 dev 实测端口：`1421` vite / `9222` electron（CDP）/ `19876` asset / `19880` 浏览器端（默认关）。
  - 关键入口（浏览器端那批）：`electron/webApiServer.ts`（`startWebApiServer` / `createWebServerController`）· `electron/ipc/registerWeb.ts` · `src/components/SettingsPanel.tsx`（分类 `browser`）· `docs/TROUBLESHOOTING.md` #59/#60。
  - 关键入口（承前）：`scripts/css-audit/README.md`（CSS 审计，**动样式前必读**；含 §七 内联陷阱 + 34 状态矩阵）· `docs/LAKE-CONTENT-WRITING.md`（**写 Lake 正文前必读**）· `docs/LAKEX-CONTRACT.md`（内核契约，编辑器相关先读）· `docs/LAKEX-MIGRATION-260916.md`（换源/懒加载/离线）· `vendor/lakex-doc-react/LOCAL-CHANGES.md` · `docs/OFFLINE-ASSETS-AUDIT-260916.md`。
- **工作区现状（本会话清理过）**：`/Users/admin/file/local-lake/` 下只剩 `lake-notes-electron`(主仓库) + `yuque-developer-docs`(语雀开发文档库/内核官方出处) + `lake-main`/`lake-editor-main`(内核机制参考) + `siyuan-master`(思源 v3.8.0 参考，AGPL-3.0)。已删：全部 worktree、过期截图/根级分析稿、`design-spec`、`release/`(910M)、`.css-audit/`(85M)、`test-node-abi/`、外部参考仓库副本（含 `lake-notes-tauri-poc`、`drawnix-develop`）。本地分支只剩 `master` + `refactor/store-split`(未合 master)。
- **✅ 分支 `feat/block-drag-native` 已合入 master 并删除本地分支（260918 用户指示）**：原生拖拽 + 块菜单/转化/剪切收口 + **列表父项 = 一个整块（Issue 3）** + **多块选区/批量操作（Issue 4）**。新增 `src/features/editor/blockHandleMount.ts`、`blockMenuNative.test.ts`、`scripts/e2e-block-menu-smoke.mjs`、`scripts/e2e-block-list-span.mjs`、`scripts/e2e-block-multi-select.mjs`；vendor 源码 + 重建 `dist/**`；文档 `docs/LAKEX-CONTRACT.md`(§5.8/§5.8.1/§5.8.2/§5.8.3/§5.8.4/§5.9)、`docs/BLOCK-*-260917.md`、`vendor/lakex-doc-react/LOCAL-CHANGES.md`(#9–#16)。**交接：本批 §2.7（写给零上下文新会话）· 过程 §2.6 · 前段 §2.5。**
- **dev 数据现状（重要）**：`到啦领导`（ee860a19）仍在回收站（`trashed_at=09-04 10:34`），用户未决定是否恢复，**别擅自删**；安卓回收站 48 条旧测试数据 + 笔记本「20-UI编辑测试」「测试本1」（含用户笔记）保留勿删。
- **测试产物**：上一会话的 1 篇 `TMP-P2-verify-*` + 4 份对拍脚本副本仍在回收站（可清空）；本会话第三批的块菜单验证又在回收站留下 **3 份 `clean-test-1788770558737` 副本**（可一起清空；原件全程未被打开，hash 复核未变）。注意：为排查"打开即重写"，早前打开过几篇测试文档（`压测3-图片-神里凌华/温迪/bilibili (26)`），它们已被内核归一化、图片降级成失败卡片并变成 `待同步`（**S3 未动**）。

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
2. **⚠️ SheetEditor 有 2 处内联样式（违反 AGENTS §3 #14）**：容器 `height/width/overflow`、CE host 的 `pointerEvents`（只读时）。合法收口路径（未做）：优先复用现成类（`.lake-editor-main` 或 `fn__*`/隐藏用原生 `hidden` 属性），否则往 `src/styles/components.css` 补最小 `.sheet-editor` 块——**但那是新增声明，`src/styles/cssLayers.test.ts` 的基线只允许"按职责归并"上调，需先与用户确认口径**。
3. **非 doc 类型的文档型入口未收口**：`electron/noteExport.ts` 的 `exportHtmlNote`/`exportPdfHtml`/`exportNotePackage` 会对表格 JSON 走 `lakeHtmlToMarkdown` → 垃圾产物或报错；侧栏「复制 Markdown」「导出 Markdown/HTML/PDF」对 sheet 节点仍可见。收口方案（未做）：① `noteExport` 加 kind 守卫（非 doc 明确抛 `AppError("InvalidInput", "表格文档暂不支持导出为 Markdown/HTML/PDF")`）；② 侧栏菜单按 kind 隐藏（需要给桌面 `TreeNode` 加 `kind`——树查询要 join `notes.kind`——或只靠 ① 的报错兜底）。
4. 其它文档型入口对 sheet 的表现未逐一核对（`EditorTab` 不渲染 ✅，但大纲/字数/状态栏等入口未逐个走查）。
5. **spike 调研产物仍在工作区**，提交前必须删：`spike.html`、`src/spike/`（`sheet-spike.tsx`）、`scripts/spike-sheet-ce.mjs`、`vite.spike.config.ts`、`vite.spike.build.config.ts`；**保留** `docs/SHEET-BITABLE-DESIGN-260918.md` 与 `docs/ASSET-HOST-FEASIBILITY-260918.md`。
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

## 3. 下一步计划 + 当前问题（真正的待办，按优先级）

### 下一步计划
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
6. **小记（Quick Notes）设计取舍 —— 是否直接挂 Lake 内核底座**（用户 260917 提出，**待讨论后再动**）：挂上后「小记→文档」转换天然就是内核规范形态，且小记本身能支持更多格式/样式；代价是更重（每条小记都要起内核实例）。当前 `electron/quickNoteConversion.ts` 产出的是「内核**容忍**并原样保留」的形态，不是「内核**产出**」的形态（字段口径差异见 `docs/LAKE-CONTENT-WRITING.md`）。
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
    - **（必做）`SheetEditor.tsx` 去掉 2 处内联样式**（违反 AGENTS §3 #14）：容器尺寸用现成类，隐藏优先用原生 `hidden` 属性；若要新增 `.sheet-editor` 规则需先与用户确认（`cssLayers.test.ts` 基线只允许"按职责归并"上调）。
    - **（✅ 260919 已完成）非 doc 类型的导出/MD 守卫**：`electron/noteExport.ts` 的 `exportHtmlNote`/`exportPdfHtml`/`exportNotePackage` 已加 `assertDocKind` 前置守卫（非 doc 抛 `InvalidInput`）；桌面 `TreeNode` 已加 `kind`（`listTreeNodes` LEFT JOIN notes + `mapTreeNode`），目录树右键「导出」子菜单与文档 ⋯ 菜单对非 doc **隐藏**；状态栏对非 doc 把「字数/图片」**替换为「表格/多维表」**；大纲侧栏对非 doc 隐藏。回归测试见 `electron/store.test.ts`。
    - **（✅ 260919 已确认）文档回填**：`docs/SYNC-PROTOCOL.md` 已有 260919 段（manifest **v6** + 每条 note 可选 `kind` + 旧端读 v6 显式拒绝）；`docs/STORAGE-LAYERS.md` 已有 `sheets/{id}.sheet.json` + `notes.kind` 决定路径 + `sheetToSearchText` 段。无需再改。
    - **（提交前）清理 spike 产物**：`spike.html`、`src/spike/`、`scripts/spike-sheet-ce.mjs`、`vite.spike.config.ts`、`vite.spike.build.config.ts`（保留两份 `docs/*-260918.md` 设计文档）。
    - **（提醒）manifest v6 ⇒ 所有端一起升级**：旧端读到 v6 显式拒绝同步（刻意安全闸）。

14. **【表格图片独立管理 · 已立项 260919】浮动图 P1 / 单元格图 P2** —— 规范见 **`docs/SHEET-IMAGE-MANAGEMENT-260919.md`（其他会话按此实施，勿另起炉灶）**。
    - **目标**：正文 `sheets[].images[].src` 由 **base64 内联**改为 **filename 引用**（正文 `version:2→3`）；文件落 `note-assets/{noteId}/`，`manifest.assets` 声明，同步/GC/历史**复用现有资产管线**（红线 #11/#17）；旧 base64 表**删了重建**（#7）。
    - **分阶段**：**P1 浮动图独立资产 ~1–1.5 天**（写文件 IPC + 正文改 filename + 清单声明 + 读回拼 URL；粘贴图可并入）· **P2 单元格图 ~3–5 天**（FortuneSheet 无 in-cell 字段 → 方案 A：`cell.img` + 自绘 overlay 锚定单元格）· **P3 移动端/浏览器渲染 + 对拍 + 压测 ~1 天**。
    - **前置已做**：图片按钮按实例定位（patch react）、本地插入可用（见第七轮）。

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
