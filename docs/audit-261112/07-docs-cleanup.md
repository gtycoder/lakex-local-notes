# 07 · 文档 / 指南 / 脚本 / 仓库卫生 · 清理与使用说明更新方案

> 审计日期：2026-11-12 · 只读审计（本轮未改任何产品代码/样式/配置/测试/文档，只写本文件）
> 基线：`master @ 8cc65e06`（`git log -1`）；工作树 clean（`git status --porcelain` 为空）
> 任务：task-6｜报告：`docs/audit-261112/07-docs-cleanup.md`
> 定位：本报告是**清单 + 方案**，不含任何已执行的删除；所有「可删」都必须先按文中给定的 grep 复核。

---

## 0. 方法与范围

### 0.1 方法（可复现）

| 手段 | 具体做法 |
| --- | --- |
| 事实地图 | `git ls-files` 全量清单 + 按目录计数；`wc -c/-l` 取体积；`git log -1 --format` 取每篇文档最后提交日 |
| 引用分析 | Node 脚本扫全部 tracked 文本文件，统计每篇文档/每个脚本的**被引用次数与引用来源类型**（package.json / CI / docs / guide / 代码 / 其它脚本）；脚本见 §2 复核口径 |
| 链接验证 | 正则抓 `[..](path)`，对 147 篇 md 解析相对路径后 `fs.existsSync` —— **结果：3 条失链，全部在 `docs/lakexEditor-developer-docs/` 的语雀原文绝对链接**（`/settings/tokens`、`/yuque/help`、`/yuque/developer/...`），属上游镜像原样保留，不算本仓问题 |
| 反链验证 | 再扫文本里出现的 `docs/…`、`scripts/…`、`src/…` 路径，检查存在性（用于抓「文档引用了已删/改名文件」） |
| 红线对照 | 逐条对照 `AGENTS.md` §2（文档分工/文档删除口径）、§3（#7 不为旧数据写兼容、#17 拒绝过度设计、#18 不清理 vendor）、§4（机制单一来源） |
| 门禁识别 | 用 `package.json` scripts + `vitest.config.ts:32` 的 include glob（`scripts/**/*.test.ts`）判定脚本「是否仍被门禁收集」，避免把测试用例误判成死文件 |

### 0.2 范围与计数（已核实）

- tracked 文件 **3217**；`docs/**` **164**（顶层 md **37**、`audit-261027` **4**、`lakexEditor-developer-docs` **79**、`mockups` **44**）；`guide/**` **47**（16 篇 md + 31 张截图）；`scripts/**` **148**；测试文件 **872**。
- 根文件：README / AGENTS / NOTICE / LICENSE / .env.example / .gitignore / .gitattributes / patched 目录 / public(406 tracked) / vendor(173 tracked) / build(2) / .github/workflows(3)。
- **不在范围内**：`vendor/lakex-doc-react/**` 内核与包装层本体（§3#18 禁清）、`public/vendor/{lakex,lakex-doc,cdn,pdfjs}`（内核产物，随仓库分发，见 NOTICE）、`patches/**`（4 处依赖补丁）。
- 本报告**不重审**其它域（同步协议正确性、UI 观感、安全实现），只记录跨域线索（附录 B）。

### 0.3 结论摘要（先看这段）

1. **用户手册（guide/）已经系统性落后于产品两个大版本**：16 篇里 **0 次**出现「日记」「AI 写作」「便携包」「更新中心」，而这四个都是 v1.1.0 已发布能力；仍写「资料库」（261110 已改名「知识库」）、仍把移动端首页描述成「底部胶囊」（261110 改为**五格 Dock + 中央悬浮＋**，如今「胶囊」指的是工作区胶囊）。**这是本次审计对「用户要的使用说明更新」最直接、最高价值的结论。**
2. **docs/ 不是缺文档，而是「单一来源被稀释」**：37 篇顶层 md 里约 1/3 是一次性研究/实测/台账（应删或归档），1 篇严重过期（`ARCHITECTURE.md`），2 篇体量失控（`HANDOFF.md` 176KB、`LAKEX-CONTRACT.md` 269KB）。
3. **脚本层存在明确的死文件**：148 个 tracked 脚本里 **23 个**在全仓（含文档、package.json、CI、其它脚本）**零引用**，其中 11 个是已完成 CSS `!important` 棘轮批的一次性 applier/planner。
4. **仓库卫生有 1 处高价值问题**：`.gitignore` 第 29–31 行把**正在入库**的三处内核产物标为忽略（注释还写「闭源内核不入库」），后果是**内核升级时新增文件会被静默忽略**；这是本次最值得在开源前修掉的一条。
5. **未发现敏感信息**：`AKIA…`/`LTAI…`/`sk-…`/`BEGIN PRIVATE KEY` 全仓 0 命中；`.env.example` 只有空值占位。

---

## 1. 文档健康度矩阵

判定口径：**现行**＝与当前代码/机制一致，可直接引用；**部分过期**＝主体仍有效但有已失效段落/引用；**严重过期**＝关键事实错误会误导执行者；**重复**＝与另一篇维一来源重叠；**应合并**；**应删/应归档**＝一次性研究/台账，无长期价值。

### 1.1 docs/ 顶层 md（37 篇）

| 文档 | 体积/最后改动 | 结论 | 证据（file:line / 实测） |
| --- | --- | --- | --- |
| `HANDOFF.md` | 176,557B / 753 行，261112 | **部分过期（需压缩）** | §0「最新交接」标题写 261109（`docs/HANDOFF.md:9`）但内容已含 3 条 261112 批次；§0 占 **146,529B / 605 行 / 75 个 `###` 批次**＝全文 83%；§1 写「HEAD = `e19fa3da`」，实际 `git log -1` = `8cc65e06`，`git rev-list --count e19fa3da..HEAD` = **10** |
| `LAKEX-CONTRACT.md` | 269,120B / 2171 行，261112 | **现行（体量失控）** | 单一来源（AGENTS §2 检索顺序②），但无目录/分区索引，已 269KB；引用里夹带仓外绝对路径 `:1142` `/Users/admin/file/local-lake/yuque-developer-docs/` |
| `ARCHITECTURE.md` | 12,133B，261110 | **严重过期** | 文件索引里 `electron/quickNotesSync.ts`、`electron/s3Maintenance.ts`、`src/features/editor/BoardCard.tsx` **三个路径已不存在**（逐个 `test -e` 验证）；§4.2 表把 `sync_base`/`deleted_notes` 描述为现行同步基线，而 `electron/schemaInit.ts:90` 注释写明 `sync_base` 是「v2 hash 账本；v3 基线在 `sync-v3/baseline.json.gz`」；§四/§五 为 Manifest V2 时代（文档自己在 `:3`、`:131-136` 已承认，但正文仍在） |
| `SYNC-PROTOCOL.md` | 43,170B，261111 | **现行** | 协议唯一来源（AGENTS §4 多处以它为契约）；文中 V2 字样是「v2 不读不迁移」的正确口径，非过期 |
| `RESILIENCE.md` | 17,681B，261106 | **现行** | AGENTS §4 指定「容错与自愈契约 = docs/RESILIENCE.md」 |
| `STORAGE-LAYERS.md` | 14,050B，261107 | **部分过期** | 2 处 Manifest V2 描述（`docs/STORAGE-LAYERS.md` 内 `V2x2`）；引用 `electron/syncAdapters.ts`、`src/core/manifestTypes.ts`（后者仍在但已非同步主线）——需按 v3 三层重写一遍 |
| `DESIGN.md` | 28,468B，261111 | **现行** | AGENTS §3#14 指定规格；`.impeccable/design.json`（17,785B，已入库）与之配对 |
| `MOBILE-DESIGN.md` | 49,973B，261112 | **现行** | 移动端设计单一来源 |
| `PAD-ADAPTATION.md` | 88,118B，261103 | **部分过期/应压缩** | 88KB 里大量是十四批过程记录；AGENTS §4 现在只引 `src/mobile/pad/` + `pad.css` 两处结论；引用的 `src/layout/**`、`src/config/tabs/appearanceTab.ts`、`src/protyle/ui/padding.ts` 等路径已不存在 |
| `MOBILE-TECH-STACK.md` | 45,187B，261112 | **现行** | 移动端架构/存储分层唯一来源 |
| `MOBILE-OPS.md` | 16,950B，261112 | **现行** | AGENTS §6 指定「移动端构建/安装/CDP/点按口径 = docs/MOBILE-OPS.md」 |
| `MOBILE-AI.md` | 41,298B，261029 | **部分过期** | 引用的 `src/mobile/ai/AiComposer.tsx`、`AiConversation.tsx`、`AiMessageList.tsx`、`aiLimits.ts`、`AiSettingsSheet.tsx`、`src/mobile/ai/*` 多数**已不存在**（现为 `MobileAiPage.tsx`/`AiSendSheet.tsx`/`AiHistoryPage.tsx` 等）；且 261109/261110 AI 助手四项改造未回填 |
| `MOBILE-BITABLE-DINGTALK.md` | 34,524B，261103 | **应归档** | 一次性「钉钉实机实测 + 复刻方案」；结论已落进 `MobileBitableViewer` 与 `MOBILE-DESIGN`；仍被 README 文档表引用（`README.md` 表格行） |
| `MOBILE-USHEET-YUQUE-PARITY.md` | 16,202B，261029 | **应归档** | 一次性对齐调研；仅 3 处代码注释引用；结论已在 `src/mobile/usheet/` |
| `MOBILE-LONG-DOC-PROBE.md` | 20,053B，261109 | **应归档** | 探针实验报告（脚本 + 环境 + 读数）；被 `docs/MOBILE-OPS.md`、`scripts/mobile-audit/README.md` 引用；引用的 `scripts/mobile-audit/baseline/long-doc.json` 不存在 |
| `MOBILE-EMPTY-CATCH-LEDGER.md` | 8,933B，261103 | **应归档** | 空 catch 台账（198 行）；仅 `src/mobile/lib/emptyCatchGuard.test.ts` 引用；引用的 `src/mobile/editor/EditorDock.ts`、`MobileApp.ts` 等已改名 |
| `MOBILE-SHEET-EXCEPTIONS.md` | 3,887B，261105 | **现行（短）** | 由 MOBILE-DESIGN 引用，作例外清单；无需动 |
| `DIARY.md` | 19,465B，261110 | **现行** | AGENTS §4「契约只看 docs/DIARY.md」 |
| `AI-WRITING.md` | 14,562B，261110 | **现行** | README 文档表列为 AI 写作空间来源 |
| `PORTABLE-TRANSFER.md` | 7,931B，261109 | **现行** | 便携包唯一来源（README 引用） |
| `UPDATE-CENTER.md` | 8,266B，261109 | **现行（无重叠）** | 与 `RELEASE-NOTES.md` **不是**重复关系：前者是「应用内更新中心规格」§1–§9（范围/交互/清单/默认值/失败面/安全/CI/落点/测试），后者是「版本发布说明合集」。AGENTS §4 已明确「发布说明与更新日志同源 RELEASE-NOTES.md」⇒ 无需合并 |
| `RELEASE-NOTES.md` | 11,852B，261109 | **现行** | 头注「v1.1.0 → v1.0.0 倒序合集」（`:3`）—— 但 **README 文档表仍写「v1.0.4 → v1.0.0」**（`README.md:218`），需同步 |
| `RELEASE.md` | 11,948B，261109 | **现行** | 发版流程唯一来源 |
| `LOGGING.md` | 8,798B，261111 | **现行** | 日志口径，AGENTS §6 引用 |
| `TROUBLESHOOTING.md` | 31,780B，261106 | **部分过期** | 含 `HANDOFF §3#16` 旧编号引用（`:188`）—— HANDOFF §2 已声明「§3 不再编号，旧编号不对应本文」；引用 `src/styles.css`（不存在）、`audit-261027` 出处 |
| `SYNC-DEVICE-CONTRACT.md` | 15,875B，261029 | **部分过期** | 引用 `electron/s3v3/deviceConformance.desktop.test.ts`（不存在）；1 处「已过期」自注 |
| `SYNC-STATE-CONVERGENCE.md` | 21,335B，261105 | **待核（未深读）** | 被 `src/core/s3v3/state/{cloudDeleted,ports}.ts` 与移动端引用，疑为 v3 状态收敛设计；与 `SYNC-PROTOCOL` 有重叠风险，需作者确认是否为单一来源 |
| `TAG-SYSTEM-DESIGN.md` | 5,321B，261105 | **部分过期** | ARCHITECTURE `:127` 把它当标签设计来源；但 261107 起「桌面文档标签关系也已迁入小记标签库」（AGENTS §4），本文未回填；引用的 `src/features/quickNotes/QuickNoteEditor.tsx` 存在但标签实现已迁 |
| `PANEL-CONTRACT.md` | 9,327B，261029 | **现行（窄）** | 被 2 个 e2e 脚本、`sidebarHoverMachine.ts`、`geometrySources.test.ts` 引用，是侧栏面板契约 |
| `BITABLE-VIEWPORT.md` | 4,239B，261017 | **现行** | AGENTS §2/§4 指定「动视口/屏外交互前读它」 |
| `INK-PAD.md` | 28,164B，261104 | **现行** | AGENTS §4「改格式必须同步 docs/INK-PAD.md」 |
| `INK-DEVICE-CHECK.md` | 3,517B，261104 | **应删** | 全仓 **0 引用**（`git grep -l INK-DEVICE-CHECK` 除自身外为空）；一次性设备验收清单，已由 `MOBILE-OPS.md` + 装置脚本取代 |
| `USHEET-UPGRADE.md` | 31,751B，261103 | **现行** | AGENTS §2 指定「升级只走 docs/USHEET-UPGRADE.md playbook」 |
| `LAKE-CONTENT-WRITING.md` | 6,983B，2026-09-28 | **应归档（最旧）** | 最后改动 9/28，是「语雀写作规范」外部笔记；被 `quickNoteConversion.ts` 等 9 处引用但都是「参考语义」；语雀官方原文已在 `docs/lakexEditor-developer-docs/` |
| `CODEX-GUIDE.md` | 6,833B，261029 | **现行（开发辅助）** | CDP 驱动指南；含 3 处硬编码 `/Users/admin/...`（`:39`、`:56`、`:58`） |
| `DEVELOPMENT.md` | 7,815B，261108 | **现行（开发辅助）** | 环境/命令；含 1 处硬编码绝对路径（`:21`） |
| `PRODUCT.md` | 9,317B，261109 | **现行** | 产品定位；引 `TAG-SYSTEM-DESIGN` |

### 1.2 docs/ 子目录

| 目录 | 计数 | 结论 | 证据 |
| --- | --- | --- | --- |
| `audit-261027/` | 4 篇（02-security / 07-rfc-kernel-v4 / 09-core-data-models / 11-browser-end-plan） | **需用户裁决（两处规则冲突）** | AGENTS §2 `:30` 写「已完成的研究/计划/spike/审计**直接删**（git 可查），不建 archive」；但 HANDOFF §3 P1 明确「`docs/audit-261027/` 4 份**保留**（TROUBLESHOOTING / SYNC-PROTOCOL / 源码注释仍引用，删了会断出处）」。**已核实引用确实存在**：代码 5 处（`src/core/docBaseline.ts`、`src/core/docBodySafety.ts`、`src/core/s3v3/plan/types.ts`、`src/features/ink/inkOpenReadOnly.test.ts`、`src/features/board/boardOpenReadOnly.test.ts`）+ 文档 4 处（TROUBLESHOOTING / SYNC-PROTOCOL / SYNC-DEVICE-CONTRACT / HANDOFF） |
| `lakexEditor-developer-docs/` | 79（75 篇官方镜像 + README + `fetch-yuque-developer-docs.mjs` + index/toc） | **保留（AGENTS §2 检索顺序①）** | 官方出处优先；但其中约 **10 篇是语雀云开放 API / Webhook / 空间 API**（01、02、71、72、74、75 等），与本项目（本地编辑器内核）无关 —— 建议保留整包（小、可追溯），不逐篇剪 |
| `mockups/` | 44 = 42 PNG + 2 HTML（`mobile-bitable.html`、`ai-writing-b.html`） | **跟随宿主文档去留** | 被 `MOBILE-BITABLE-DINGTALK`（应归档）与 README 表格引用；若归档该文，mockups 只留 2 个 html 即可 |
| `audit-261112/` | 本批产出 | 现行 | — |

### 1.3 guide/（16 篇 + 31 张截图）

| 章节 | 结论 | 证据（实测） |
| --- | --- | --- |
| `README.md` | **部分过期** | `:17` 写「点左上角**资料库**」（261110 已改名「知识库」）；`:46` 把移动端首页写成「首页（小记/知识库）+ 底部胶囊」，而 261110 起首页是**五格 Dock（小记·知识库·日记·AI·标签）+ 中央悬浮＋**，且「胶囊」现在专指**工作区胶囊**（文档树/标签页/大纲/切换笔记本，见 `01-getting-started.md:65` —— 两篇指南对新旧「胶囊」用语未区分）；`:4` 能力清单缺「日记 / AI 写作」；`:26-40` 目录里没有日记、AI 写作、便携包、更新中心 |
| `01-getting-started.md` | **部分过期** | `:55` 「底部胶囊｜搜索、新建＋、AI 助手」= 旧首页模型；`:57` 长按上滑速记存在（仍准）；`:65` 又写「底部胶囊四格」= 新工作区胶囊 —— **同一篇里两种「胶囊」并存**；2 处「资料库」 |
| `02-notebooks.md` | **部分过期** | 2 处「胶囊」按新语义使用正确，但 `:30` 仍用「资料库」；缺「笔记本长按卡片=编辑入口」等 261110 定稿 |
| `03-editing.md` | 基本现行 | 261029 后未改；文档内查找/引用卡与当前一致 |
| `04-sheet.md` | 基本现行 | 表格能力 261104 后有「排序/冻结/保护=文档数据、阅读态只读」语义变化，未回填 |
| `05-bitable.md` | 基本现行 | 未覆盖 261105+ 的条件填色/关联选择器改动（可留作 v1.x） |
| `06-board-ink.md` | 现行 | 261104 后更新过（含手写板页签/导出） |
| `07-quick-notes.md` | **部分过期** | 未写 261110 定稿的「保存并同步＝单条快路径」与「长按 260ms+上滑速记」；`:12`、`:67` 仍是旧「底部胶囊」入口描述 |
| `08-search-outline-tags.md` | **部分过期** | 标签章节未写 261105/261107 的三条定稿：**顺序仅设备本地**、**删除=缺席**、桌面文档标签关系已迁入标签库 |
| `09-history-trash.md` | 现行 | 回收站 90 天（`trashAutoPurgeDays` 可改）与「云端已删除·仅本地」描述与 AGENTS §3#5 一致 |
| `10-ai.md` | **严重过期（覆盖不足）** | 只覆盖「AI 助手（配置/入口/资料集）」；**完全没有 AI 写作空间**（桌面 ⌘4，v1.1.0 主打功能之一）。全文 grep「AI 写作」= 0 |
| `11-cloud-sync.md` | **部分过期** | 有迁移码/开关/从云端恢复，但未写 v3 协议现状（无墓碑/内容寻址/资产声明）、未写「便携包」这条换机主路径 |
| `12-settings.md` | **部分过期** | 桌面设置分类里**没有「更新」**（`:9-99` 只有 编辑器/外观/快捷键/文档与历史/回收站/云端与同步/AI/浏览器端/日志/关于，而代码 `src/components/app/SettingsPanel.tsx:583` 有 `update` 分类）；Android 设置同样缺「更新中心」；缺「自动备份 / 便携包导出 / 按需下载附件 / 后台扫描间隔」等 2611xx 新增项 |
| `13-shortcuts.md` | **严重过期** | 「空间切换」只写 `⌘1 资料库` / `⌘2 小记`，而代码定稿是 `⌘1 文档 / ⌘2 小记 / ⌘3 日记 / ⌘4 AI 写作 / ⌘5 标签`（`src/hooks/useDesktopLifecycle.ts:115` 注释 + `README.md:37`）；缺 `⌘⇧Enter` 专注模式（仅设置项里有） |
| `14-faq.md` | 基本现行 | 换机章节只写 S3 迁移，未写便携包 |
| `15-import-export.md` | 现行 | 261106 后更新（分享导入 / 批量导出默认格式） |
| `assets/screenshots/` 31 张 | **无需动** | 逐个核对：31 张全部在 guide/*.md 中被引用（0 张孤儿） |

**guide 层面的一句话结论**：不是「润色」问题，而是**四个已发布功能整章缺失** + **一次一级空间改名未跟** + **一次移动端首页改版未跟**。按「不做会付什么代价」判断：v1.1.0 主打的两个空间（AI 写作 / 日记）在用户手册里查不到 ⇒ 新用户发现不了，属**必须修**。

---

## 2. 过期 / 无用文件与脚本清单

判定流程（**每条「可删」都要重跑这一步**）：
```bash
# 1) 是否被 package.json / CI 引用
grep -n "<name>" package.json .github/workflows/*.yml
# 2) 是否被文档 / 代码 / 其它脚本引用（排除自身）
git grep -l "<name>" -- '*.md' '*.ts' '*.tsx' '*.mjs' '*.sh' | grep -v "<self>"
# 3) 是否被 vitest 收集（scripts/**/*.test.ts 由 vitest.config.ts:38 收入）
# 4) 删除后跑 npx tsc --noEmit && npx vitest run && git diff --check
```

### 2.1 脚本：分类（148 tracked）

**A. 产品/门禁必需（保留）** —— package.json 或 CI 直接调用，共约 30 个（package.json 共 39 个 npm script）：
`dev.mjs`、`dev-clean.mjs`、`android-build.sh`、`ui-metrics.mjs`、`vendorCssLayer.ts`、`check-{arch,bundle-budget,core-boundaries,mobile-ui,android-release-config}.mjs`、`css-audit/{check-stylesnap,stylesnap,snapdiff,inpage,l3-plan,drive,walkthrough,mobile-walkthrough,audit-lookalike,audit-primitives,audit-dead-css,audit-vendor-css,paths}.mjs`、`mobile-audit/{check-mobile-snap,check-mobile-snap-tablet,check-bitable-snap,mobile-snap,perf-baseline,window-sweep,snap-gate,snap-lib,gate-fixture}.mjs`、`e2e-{electron,packaged,drawnix,window-state,renderer-recovery,service-crash,sidebar-interaction,tab-switch,tab-lifecycle-benchmark}-*.mjs`、`packaged-performance/{run.mjs,bitable/run.mjs,bitable/config.mjs}`、`setup-lakex-private.mjs`、`setup-remotes.mjs`、`ci-packaged-smoke.sh`、`generate-update-manifest.mjs`、`lakexLocalize.ts`。

**B. 开发/运维辅助（保留但要登记或收编）**：
`s3-ls.mjs`（AGENTS §6 指名）、`cdp-eval.mjs`、`emu-up.sh`/`emu-cdp.sh`（移动装置入口，被 11 处引用）、`mobile-preview.sh`、`ab-verify.{mjs,sh}`、`lake-roundtrip-check.mjs`、`table-paste-stress.mjs`、`usheet-kernel-probes.mjs`（USHEET playbook 用）、`verify-svg-csp.mjs`（被 `assetServer.test.ts` 引）、`multi-end-sync/{README,eval,cdpclient,configure-s3,delprefix,probe5,run5,run5b,run5c,run5d,run5e,s3verify,volume}`（有 README 说明、真实多端联调）、`packaged-performance/{README,seed,sidebar-regression,cdp,loopback-s3,make-fixture.py,bitable/{business,harness,interaction}}`（有 README）。
问题：这些**只有子目录 README 或 AGENTS 一句话**，没有统一索引；`s3v3-verify.mjs`（自称「v3 门禁一键跑」）与 `s3v3-manual-capacity.mjs`（仅被 `electron/s3v3` 注释提到）都没接进 package.json。

**C. 一次性研究/批次产物（建议删，均已确认零引用）** —— 共 **23 个**：

| 文件 | 判据 |
| --- | --- |
| `scripts/css-audit/{apply-imp,plan-imp,imp-scan,imp-safe}.mjs` 家族中的 `apply-imp`、`apply-dup-decls`、`plan-dup-decls`、`build-spec-dup`、`filter-plan`、`probe-allprops`、`abpix`、`pixdiff`、`sheetcheck`、`split-file`、`dedupe-vendor-board`（11 个） | 全部是 261016–261022 `!important`/重复声明棘轮批的**一次性 applier/planner**；零引用；其中 `dedupe-vendor-board`、`split-file` 的目标文件（`src/b3/*.css`、`src/styles/shell.css` 旧版）已不存在 ⇒ 运行必失败 |
| `scripts/css-audit/plans/plan-imp-260916{,-unfiltered91}.json`（2 个） | plan-imp 的输入数据（10月16日），对应源码批次已落地；零引用 |
| `scripts/bitable-stress.mjs` | 「AR04 多维表真实端压测」一次性结论产出（结论已在 `BITABLE-VIEWPORT`/`MOBILE-TECH-STACK`）；零引用 |
| `scripts/make-large-notes.mjs` | 自己在头注释写「**一次性**：创建 2M/5M/10M 大文档供实机体感测试」；零引用 |
| `scripts/multi-end-sync/run5assets.mjs`、`run5native.mjs` | run5 系列的一次性变体，零引用（同目录其它 run5x 有 README 提及，这两个没有） |
| `scripts/multidev.sh` | 本地多端联调（vite 临时禁用 electron 自动拉起/改 vite.config.ts），已被 `dev.mjs`+`emu-*` 覆盖；零引用；且它的做法与 AGENTS §8「vite.config.ts 不应有改动，用完必须还原」相冲 |
| `scripts/s3-v3-probe.mjs`、`s3v3-manual-perf.mjs`、`s3v3-perf-gate.mjs`、`s3v3-verify.mjs` | v3 转正期的探针/手工 perf；**s3v3-verify.mjs 内部引用 `docs/S3-V3-FINAL-REPORT.md` 与 `electron/s3v3/migrate.test.ts`，两者均已不存在** ⇒ 直接证据表明已死 |
| `scripts/verify/qiniu-stream-head-verify.mjs` | 七牛 Head/流式 PUT 兼容性一次性实测；头注释自己写「历史版本曾硬编码凭据」 |

> ⚠️ **两处不要误删**：`scripts/css-audit/audit-dead-css.test.ts` 与 `scripts/mobile-audit/snap-gate.test.ts` 在文本引用分析里也是「零引用」，但它们是 **vitest 用例**（`vitest.config.ts:32` 的 `include` 含 `scripts/**/*.test.ts`，AGENTS §3#14 也把 `audit-dead-css.mjs` 定为死 CSS 判定工具）⇒ **保留**。这是本次审计最容易误报的一处。

**D. 无引用资源/文件**：
- `docs/INK-DEVICE-CHECK.md`（0 引用，见 §1.1）。
- 根目录/文档目录下的 `.DS_Store`（`.`、`docs/`）：**未入库**（`git ls-files | grep -c DS_Store` = 0），只在磁盘上，可不处理。
- `.ai-writing-recon/`（磁盘 15MB / 61 文件）、`.css-audit/`（24MB）：都在 `.gitignore` 里（`:34`、`:12`），**不入库**；HANDOFF §1 已记录 261110 用 `git filter-repo` 把它们从全部历史移除 ⇒ 磁盘残留是**本机脏**，不是仓库问题；开源前建议本地清掉即可（不必进审计清单）。

### 2.2 docs/ 的去留清单（按 §1 判定汇总）

**应删（1）**：`docs/INK-DEVICE-CHECK.md`
**应归档/合并（6）**：`MOBILE-BITABLE-DINGTALK.md`（结论进 MOBILE-DESIGN）、`MOBILE-USHEET-YUQUE-PARITY.md`（结论已在代码）、`MOBILE-LONG-DOC-PROBE.md`（读数进 MOBILE-OPS §装置）、`MOBILE-EMPTY-CATCH-LEDGER.md`（护栏已由 `emptyCatchGuard.test.ts` 承担）、`LAKE-CONTENT-WRITING.md`、`PAD-ADAPTATION.md`（压缩到「现行结论 + 单一来源指针」，过程批记录删）
**需重写（2）**：`ARCHITECTURE.md`（严重过期）、`STORAGE-LAYERS.md`（v3 三层）
**需压缩（2）**：`HANDOFF.md` §0、`LAKEX-CONTRACT.md` 加目录/分卷
**需回填（5）**：`MOBILE-AI.md`、`TAG-SYSTEM-DESIGN.md`、`TROUBLESHOOTING.md`（旧编号）、`SYNC-DEVICE-CONTRACT.md`、`README.md`（RELEASE-NOTES 版本区间）
**保留不动**：其余 20 篇。

### 2.3 HANDOFF.md 压缩方案（用户点名问的「176KB 是否需要再压缩」）

**答：需要，但不是「删内容」而是「把 §0 的过程流水移出唯一交接文档」。**

| 事实 | 数值 |
| --- | --- |
| 全文 | 176,557B / 753 行 |
| §0「最新交接」 | **146,529B / 605 行 / 75 个批次条目**（占 83.0%） |
| §1 当前基线 | 13,842B / 64 行 |
| §2 风险 | 3,873B / 15 行 |
| §3 待办 | 11,057B / 57 行 |

- §0 的**信息已大量重复**：同一条结论在 §0 批次条目、§1 门禁基线（如「全量 vitest 871/870/869 文件」三行并列）、§3 待办「已闭合别重复」三处各写一遍。`docs/HANDOFF.md:9` 标题还停在 `（261109）`。
- 建议形态（不动 §1/§2/§3）：§0 只留**最近 3 个批次 × ≤5 行**（问题/结论/证据落点），更早批次一律删除（git 可查，符合 AGENTS §2「已完成的研究/计划/审计直接删」）；§1 只保留**当前值**（HEAD、版本、门禁计数各一行，不并列历史批）。预计 §0 从 146KB → ≤15KB，全文 ≤40KB。
- 代价与风险：**已发布 Release 的正文来源是 `RELEASE-NOTES`，不是 HANDOFF**（AGENTS §4），所以压缩不影响发版；风险只在「历史批次的问题复现细节」丢失 —— 但这类细节的正规去处是 §2 风险与 `TROUBLESHOOTING.md`，压缩时应把仍有效的坑**上移**到 §2。
- 另：AGENTS.md 当前 **54,207B**（预算 ≤64KB，`AGENTS.md:5`），HANDOFF §3 记「已精简到 46,610B」⇒ 261110 之后又长了 **7.6KB**，仍在预算内但需警惕。

---

## 3. 清理后的目标仓库结构（精简版）

```text
lakex-local-notes/
├─ README.md                 # 概览（补：5 个一级空间、便携包、更新中心一段）
├─ AGENTS.md                 # 长期红线（54KB，≤64KB 预算内）
├─ NOTICE / LICENSE / .env.example / .gitignore / .gitattributes
├─ docs/
│  ├─ HANDOFF.md             # ≤40KB：§0 只留最近 3 批
│  ├─ ARCHITECTURE.md        # 重写（v3 现状 + 现行文件索引）
│  ├─ PRODUCT.md  DESIGN.md  MOBILE-DESIGN.md
│  ├─ SYNC-PROTOCOL.md  STORAGE-LAYERS.md  RESILIENCE.md
│  ├─ SYNC-DEVICE-CONTRACT.md  SYNC-STATE-CONVERGENCE.md
│  ├─ DIARY.md  AI-WRITING.md  TAG-SYSTEM-DESIGN.md
│  ├─ LAKEX-CONTRACT.md      # 加 §目录 + 分卷（内核行为）
│  ├─ USHEET-UPGRADE.md  BITABLE-VIEWPORT.md  INK-PAD.md  PANEL-CONTRACT.md
│  ├─ MOBILE-OPS.md  MOBILE-TECH-STACK.md  MOBILE-AI.md  MOBILE-SHEET-EXCEPTIONS.md  PAD-ADAPTATION.md(压缩)
│  ├─ DEVELOPMENT.md  CODEX-GUIDE.md  TROUBLESHOOTING.md  LOGGING.md
│  ├─ RELEASE.md  RELEASE-NOTES.md  UPDATE-CENTER.md  PORTABLE-TRANSFER.md
│  ├─ lakexEditor-developer-docs/      # 官方镜像，整包保留
│  ├─ mockups/                          # 只留 2 个 html（随宿主文档归档）
│  └─ audit-261027/                     # ← 需用户裁决（见 §8-1）
├─ guide/                    # 16 → 20 篇：+日记 +AI 写作 +便携包与换机 +更新中心
│  ├─ README.md … 15-import-export.md
│  └─ assets/screenshots/    # 31 张，全部有引用
├─ scripts/                  # 148 → ~125：删 §2.1-C 的 23 个；新增 README 索引
│  ├─ README.md              # 新增：门禁 / 装置 / 运维 / 一次性 四组，各一行说明
│  ├─ css-audit/  mobile-audit/  multi-end-sync/  packaged-performance/
├─ electron/ src/ android/ public/ vendor/ patches/ build/
└─ .github/workflows/        # pr.yml / release.yml / packaged-smoke.yml
```

**删除/归档清单（不动三处 vendor 内核）**

1. 删 `docs/INK-DEVICE-CHECK.md`
2. 归档（合并结论后删，或移到 `docs/archive/`——但 AGENTS §2 明确「不建 archive」，故推荐**合并后删**）：§2.2 列的 6 篇
3. 删 `scripts/` §2.1-C 的 23 个（先按 §2 的 grep 复核脚本跑一遍）
4. 新增 `scripts/README.md`（四组索引），把「B 类辅助」里无 package.json 入口的 6~8 个登记进去（`s3-ls`、`s3v3-verify`、`lake-roundtrip-check`、`table-paste-stress`、`usheet-kernel-probes`、`ab-verify`）
5. `.gitignore` 第 28–31 行处理（见 §6-2，**需裁决**）
6. 根/文档 `.DS_Store` 本地清理（不入库，无需提交）

**不要动（§3#18 与 NOTICE）**：`vendor/lakex-doc-react/**`（173 tracked，含 9.3MB `lakex.js`）、`public/vendor/{lakex,lakex-doc,cdn,pdfjs}`（406 tracked）、`patches/` 3 处 + vendor 内 1 处补丁。

---

## 4. 使用说明更新方案

### 4.1 README.md 需要改的段落（逐条给落点）

| 位置 | 现状 | 改成 |
| --- | --- | --- |
| `README.md:218` 文档表 | 「发布说明合集（**v1.0.4 → v1.0.0**）」 | 「v1.1.0 → v1.0.0」（与 `docs/RELEASE-NOTES.md:3` 对齐） |
| `README.md:206-222` 文档表（`## 文档` 在 `:204`） | 缺 8 篇现行文档（RESILIENCE / PANEL-CONTRACT / SYNC-DEVICE-CONTRACT / SYNC-STATE-CONVERGENCE / INK-PAD / BITABLE-VIEWPORT / TAG-SYSTEM-DESIGN / LOGGING / RELEASE / PAD-ADAPTATION / MOBILE-SHEET-EXCEPTIONS / LAKE-CONTENT-WRITING / INK-DEVICE-CHECK） | 与 HANDOFF §1「文档地图」**合成唯一一份**（两份地图现在不一致，是 §1 矩阵外的一个独立问题：README 12 行 vs HANDOFF 7 组） |
| `README.md:5`「本地优先的语雀 Lakex 编辑器笔记应用…」段后 | 未提「5 个一级空间」 | 补一行：知识库 · 小记 · 日记 · AI 写作 · 标签（`⌘1–5`），与 `README.md:37` 已有的快捷键行呼应 |
| `README.md` 功能清单 | 有日记/AI 写作/便携包/更新中心散点 | 加「**换机两条路**：便携包（离线全量）与 S3 同步（增量）」一行，指向 `docs/PORTABLE-TRANSFER.md` + guide 新章 |
| `README.md:129-138` 首 clone 段 | 已写 setup:remotes / setup:lakex | 补一句「闭源内核已 vendored，**不需要**再导出；`.gitignore` 里那三行是历史遗留（修完后删）」——与 §6-2 一起改 |

### 4.2 guide 改造方案（按「不做会付什么代价」排序）

**P0（功能在手册里查不到）**
1. **新增 `guide/16-diary.md`**：日记 = 普通文档（`「日记」笔记本 + 标题即日期 + 年/月分组`）、⌘3 / 移动第 3 格、写今天/翻历史/空间内搜索、**转为文档**（正文与历史跟着走，不复制）、**不打标签 / 不做缺天提醒**（`docs/DIARY.md`、`README.md:35`）。
2. **新增 `guide/17-ai-writing.md`**：AI 写作空间（⌘4）——会话/多文档推理/提示词库/深度思考、答案用内核只读渲染、「生成文档」「保存到小记」、**会话只存本机、不进同步/搜索/目录树**（`docs/AI-WRITING.md`、`docs/RELEASE-NOTES.md` v1.1.0 段）。
3. **新增 `guide/18-portable-and-migrate.md`**：换机三条路对比 —— 便携包（桌面导出 `.zip.lln` ≤4GiB、不含历史、手机覆盖导入）/ S3 同步（增量、需两端配置）/ 迁移码（`LLN1.`，AES-GCM，仅防误读非安全边界）（`docs/PORTABLE-TRANSFER.md`、AGENTS §4、`settingsSearch.ts:71,83`）。
4. **新增 `guide/19-update-center.md`**：检查更新/更新日志/自动检查（启动 + 6/12/24h）/自动下载（Android 仅 Wi-Fi）/**不静默安装**/sha256 校验；桌面「设置 → 更新」、Android「设置 → 更新中心」（`docs/UPDATE-CENTER.md` §2–§6）。
5. **重写 `guide/13-shortcuts.md` 的「空间切换」**：`⌘1 文档 / ⌘2 小记 / ⌘3 日记 / ⌘4 AI 写作 / ⌘5 标签`（`src/hooks/useDesktopLifecycle.ts:115`），并补 `⌘⇧Enter` 专注模式、`⌘]` 目录栏、`⌘,` 设置。

**P1（改名/改版未跟，会让用户对不上界面）**
6. **全 guide 把「资料库」→「知识库」**：实测 7 处 / 6 个文件（`guide/README.md`×2、`01`×2、`07`、`09`、`12`、`13`）；AGENTS §2 记 261110 定稿「两端同名」。
7. **改写「底部胶囊」两套语义**：`guide/README.md:17,46-47`、`01-getting-started.md:55,65`、`07-quick-notes.md:12,67`、`08-search-outline-tags.md:15,37`、`10-ai.md:47`。新口径（AGENTS §4「移动端入口分工」）：**首页 = 底部五格 Dock（小记·知识库·日记·AI·标签）+ 中央悬浮＋**；**胶囊 = 工作区胶囊（文档树/标签页/大纲/切换笔记本）**。顺手补「长按 260ms + 上滑速记」。
8. **`guide/README.md` 目录表**从 15 行扩到 19 行（新增 4 章），并更新「两个平台有什么不同」表（加「日记 / AI 写作 / 更新中心 / 便携包」四行）。
9. **`guide/07-quick-notes.md` 补「保存并同步」语义**：只推当前这一条（11 次请求；内容未变 0 上传 0 发布）、失败不写基线（AGENTS §4 小记快路径）。
10. **`guide/08-search-outline-tags.md` 补标签三条定稿**：顺序仅本机（不跨端）、删除=缺席、桌面文档标签关系已在标签库（AGENTS §4）。
11. **`guide/12-settings.md` 补桌面「更新」分类与 Android「更新中心」**，并补 4 个新项：自动备份、导出便携包、按需下载附件、后台扫描间隔（`src/components/model/settingsSearch.ts:63-73,91`）。

**P2（可选）**：`01-getting-started.md` 截图更新为五格 Dock 首页（现有截图是 261110 前）；`14-faq.md` 换机段补便携包。

### 4.3 10~15 条「独特使用技巧」（每条：事实依据 + 落点，可直接写进 guide）

> 选取标准：**别的笔记软件给不出/讲了才不踩坑**；全部有代码或文档依据；不编造数值。

| # | 技巧（面向用户） | 事实依据 | 建议落点 |
| --- | --- | --- | --- |
| T1 | **换机不想搬 S3，就用便携包**：桌面「设置 → 备份 → 导出便携包」出一个 `.zip.lln`（≤4GiB、**不含历史快照**），手机「导入便携包」覆盖导入；之后再把 S3 接上继续增量 | `docs/PORTABLE-TRANSFER.md`；`settingsSearch.ts:71`；HANDOFF §0「便携包只接受 .zip.lln」 | 新 guide 18 |
| T2 | **S3 配置可以「拷」给手机**：桌面导出配置 `.json` → 手机选文件导入；内层是 `LLN1.` 迁移码（AES-GCM 加密），**它只防误读、不是安全边界，别外传**；桌面端在主进程弹框，渲染层从不接触明文 Secret | AGENTS §4「S3 配置迁移（261017）」；`settingsSearch.ts:83` | guide 11 / 18 |
| T3 | **移动端图片自动用 1024px 缩略**（列表卡/标签详情/文档内嵌图），原图只在双击预览时才取 —— 流量紧张的人可以开「按需下载附件」，正文/元数据先到位，图片懒拉 | AGENTS §4「移动端列表图片 = 资产服务离散缩略」+「内核内图片 = 显示缩略」；`settingsSearch.ts:62` | guide 11 + 07 |
| T4 | **复制含图片的片段到微信/QQ，图不会变裂**：应用会在复制时把本地图同步换成原图 data URI（`?base64=1`，webp/avif 转 PNG） | AGENTS §4「复制/剪切 = 单一管线」；`docs/ARCHITECTURE.md` §三 | guide 03 |
| T5 | **看图片画廊别只在当前屏找**：桌面双击任意图片打开的是**整篇文档的图片**（按正文顺序，不按 DOM）；手机是单击预览、双击编辑 | AGENTS §4「图片预览画廊 = 正文全量」（261112 实测：107 张的文档 DOM 只到 8 张） | guide 03 |
| T6 | **回收站不是删除**：进回收站是「移入回收站笔记本」的软删除（正文/附件都留着、不写墓碑），**默认 90 天**才自动清理，天数可改；「云端已删除·仅本地」的副本也能恢复 | AGENTS §3#5；`settingsSearch.ts:90`；`guide/09-history-trash.md` | guide 09 |
| T7 | **标签顺序只属于这台设备**：跨端不会同步顺序（集合会同步）；标签**删除就是删除**（云端不留墓碑），所以「本机删了、另一台还显示」时**同步一次即消失**；新建标签追加到末尾 | AGENTS §4「标签顺序 = 设备本地」「标签删除 = 缺席」 | guide 08 |
| T8 | **小记的「保存并同步」比「保存」多走一条专用快路径**：只推这一条（11 次请求），重复点且内容没变就 0 上传 0 发布；失败不写基线、不标已同步。只想留本地就点「保存」——**不会背着你偷偷同步** | AGENTS §4「小记『保存并同步』= 单条快路径」；`docs/SYNC-PROTOCOL.md` §12.3 | guide 07 |
| T9 | **手机速记有两级**：首页中央「＋」短按是新建面板；**长按 260ms 后上滑**直接进全屏速记写作卡（不用先回首页）。桌面则是长按图标/固定入口 | AGENTS §4「移动端入口分工」（`ui/createPress.ts`）；HANDOFF §0「写作卡两条入口」 | guide 07 |
| T10 | **日记不是新数据结构**：它就是一个「日记」笔记本里的普通文档（标题即日期），所以历史快照、回收站、全文搜索、导出、同步**全都免费继承**；「转为文档」是把它移到别的笔记本，正文与历史跟着走，不复制 | `docs/DIARY.md`；`docs/RELEASE-NOTES.md` v1.1.0 段；`README.md:35` | 新 guide 16 |
| T11 | **AI 写作的会话只存在本机**：不进同步、不进搜索、不进目录树；「生成文档」只让你选到笔记本（不选目录），「保存到小记」落成小记卡片 —— 所以换机时 AI 会话不会跟过去 | `docs/AI-WRITING.md`；`docs/RELEASE-NOTES.md` v1.1.0 段 | 新 guide 17 |
| T12 | **浏览器端可以当「分屏阅读器」用**：设置 → 浏览器端（默认关）→ 打开，只有桌面端提供、只服务本机 `127.0.0.1` 同一份数据；分屏交给浏览器自己的并排窗口 | `settingsSearch.ts:91-92`；`docs/audit-261027/11-browser-end-plan.md` 决策段 | guide 12 |
| T13 | **更新中心不静默安装**：默认自动检查（启动 + 6/12/24h）与自动下载（Android 仅 Wi-Fi），下载后校验 sha256（Android 还验证书 SHA-256），最后必须由你点安装包 | `docs/UPDATE-CENTER.md` §4–§6；AGENTS §4「更新中心」 | 新 guide 19 |
| T14 | **数据不对劲先跑三个自愈入口**：设置 → 维护「一致性检查」、编辑器「重建全文搜索索引」、「重建数据」（从文件找回元数据丢失的笔记）；坏库走「从云端恢复（换机/坏库）」 | `settingsSearch.ts:51,58,64,74` | guide 14 |
| T15 | **删了文档但别处还能看见？** 那是「删除压编辑」的正常表现：被删侧会留历史快照，他端以「云端缺席」判定不再上传；真要恢复只能走本机回收站或历史快照（从未持有过的设备无法恢复，这是设计取舍） | AGENTS §3#3/#5/#15；`guide/09-history-trash.md` | guide 09 |

---

## 5. 全仓「为历史数据/旧协议写兼容」清单

判定标准 = AGENTS §3#7：**「这些数据能否删了重建？」能，就绝不写兼容**。下表逐条给结论；「允许」= 属用户不可再生正文/互操作，不违反红线但应登记。

| # | 位置 | 现象 | 结论 |
| --- | --- | --- | --- |
| C1 | `electron/s3v3/desktopSync.ts:18,87-88` | 环境开关 `LAKE_SYNC_PROTOCOL !== "legacy"` / `LAKE_S3V3_QUICK_NOTES !== "0"`，注释称「旧 quick-notes 通道只在 legacy 或显式 0 时使用」 | **死兼容（建议删）**：旧 quick-notes S3 通道的实现 `electron/quickNotesSync.ts` **已不存在**（`test -e` 失败），`quickV3=false` 现在的真实效果只是「小记这一轮不同步」（`quickNotesAvailability.ts:62-69`）。开关名与注释都在描述一个不存在的协议 ⇒ 误导运维；`docs/ARCHITECTURE.md:24,45` 还据此写了「小记 Manifest v1 独立同步」段落 |
| C2 | `src/core/s3v3/state/intentLogState.ts:11,166,261,299` | 设备侧同步状态 v1/v2 信封**单向迁移**到 v3（`legacyToV2` + 版本嗅探） | **需用户裁决**：设备同步状态「本可重建」，但它承载**删除意图**（`purges/purgeTimes`）—— 直接重置会让已删文档从云端复活（真实代价）。两案见 §8-3 |
| C3 | `src/core/boardDoc.ts:96,129` | 画板正文兼容 `elements` 与 `plaitValue` 两种键名 | **允许**：用户正文不可再生（与 inkDoc「读 1\|2\|3\|4」同性质）；但应在文档里登记为「只读兼容、写入恒用新键」 |
| C4 | `src/core/bitableDoc.ts:1705`（历史 ISO 日期值）、`:1232`（历史值一次性对齐） | 多维表读历史值形态 | **允许**（用户正文），建议注释写明「仅读；下次写入即归一」 |
| C5 | `src/mobile/data/quickNoteTagsRepository.ts`（12 处命中）+ `tag_absent_migrated` | 旧库 `tags.deleted_at` 行一次性清理 | **允许**：AGENTS §4 明确要求「旧库 `deleted_at` 行由一次性迁移清掉」，且**禁止**再引入标签墓碑。需确认只是一次性（不是每轮读取都兼容） |
| C6 | `electron/schemaInit.ts:209-222` | `deleted_notes.published_at` 检测到就 `ALTER TABLE … DROP COLUMN` | **允许**：schema 自愈（删列），不是兼容读取；但要注意它与 `ARCHITECTURE.md:114`「`deleted_notes` = 本地删除墓碑（同步用）」的说法冲突（v3 已无墓碑链） |
| C7 | `src/core/noteKind.ts:5,16` | 缺省/非法 kind 一律回退 `"doc"` | **允许但收紧**：注释已引 §3#7；建议只在**读**路径回退，写路径禁止猜 |
| C8 | `src/core/ipcLimits.ts:11` | 常量别名「以兼容既有导入」 | **允许**（内部导出别名，无数据语义） |
| C9 | `electron/s3v3/deviceConformance.ts:56` | 注入面注释「旧 API，保留兼容」 | **建议改名**：它是测试注入接口，与「旧协议」无关，字样会污染 grep 结论 |
| C10 | `src/mobile/v3/mobilePlatformPort.ts:72,305,345,369` | `legacyBodies` 命名（实为「桌面式正文批写」） | **建议重命名**（`batchedBodies`）：纯命名，零行为，但能消掉 4 处假阳性 |
| C11 | `electron/portable/zipStore.ts:11,145` | 「兼容 Java ZipInputStream」 | **允许**：跨平台/互操作兼容，不是历史数据 |
| C12 | 文档侧 | `ARCHITECTURE.md` §4.4/§5（Manifest V2 历史块，虽已折叠 + 警示）、`STORAGE-LAYERS.md`（V2×2）、`SYNC-PROTOCOL.md`（V2×6，多为正确的「v2 不读不迁移」说明）、`docs/audit-261027/07-rfc`（引用已删的 `docs/S3-REDESIGN.md`） | **建议删段**：ARCHITECTURE 的历史 §4.4/§5 整段删除（自己 `:3` 已声明过期，留着只会误导）；STORAGE-LAYERS 按 v3 重写；SYNC-PROTOCOL 保留（它是在明确「不做」）；07-rfc 里的 `S3-REDESIGN.md` 引用改成「已删，git 可查」 |

**grep 复核命令**（本次用它得到上表，可复跑）：
```bash
git grep -nE 'legacy|compat|migrat|deprecated|向后兼容|旧库|旧版|历史兼容' -- 'src/**/*.ts' 'electron/**/*.ts' ':!*.test.ts'
git grep -nE 'v1|v2|旧格式|单向迁移' -- src/core/s3v3/state/
git grep -nE 'Manifest V2|manifests/latest' -- docs
```

---

## 6. 发布前合规与仓库卫生

### 6.1 合规（结论：基本就绪）

| 项 | 状态 | 证据 |
| --- | --- | --- |
| LICENSE | ✅ AGPL-3.0-only（34,522B 全文）；`package.json:"license": "AGPL-3.0-only"` | 已核实 |
| NOTICE | ✅ 三段：①闭源内核（`@alipay/lakex-doc v1.99.0`，三处 vendored 路径，未授权风险自担）②其它第三方（Univer/PDF.js/unpdf/Drawnix/Lucide/MiSans/JetBrains Mono）③免责 | `NOTICE` 全文已读 |
| 第三方许可文件 | ✅ `public/vendor/pdfjs/LICENSE` + `cmaps/LICENSE`、`public/third-party/tanstack-virtual.LICENSE.txt`、`vendor/lakex-doc-react/LICENSE` | `find` 验证 |
| 敏感信息 | ✅ 0 命中：`AKIA…`/`LTAI…`/`sk-…`/`BEGIN … PRIVATE KEY` | `git grep -nE` 全仓 |
| 真实数据/密钥 | ✅ 仓库无真实笔记；`.env.example` 只有空占位 | — |
| ⚠️ 用户账号信息 | `docs/ARCHITECTURE.md` §4.5 列了该账号下**5 个真实桶名**（`image-store-hebei`、`joplin-s3-hebei`、`local-image-lake`、`local-lake-hebei`、`siyuan-qiniu-hebei`）与 endpoint/region | 属信息披露而非凭据；建议 §4.5 压成「示例配置」并删其它桶名（与 C1 一起处理 ARCHITECTURE 时顺手做） |
| 开源惯例文件 | ⚠️ 缺 `CONTRIBUTING.md` / `SECURITY.md` / `CODE_OF_CONDUCT.md`（README 已写「反馈」但没有渠道定义） | 可选，见 §8-5 |

### 6.2 高价值问题：`.gitignore` 与「内核已 vendored」自相矛盾

```text
.gitignore:28  # 公开镜像：闭源内核不入库（由私有开发仓导出；本地恢复见 README）
.gitignore:29  vendor/lakex-doc-react/
.gitignore:30  public/vendor/lakex/
.gitignore:31  public/vendor/lakex-doc/
```

- **事实**：这三处**确实入库**——`git ls-files vendor | wc -l` = **173**、`git ls-files public | wc -l` = **406**（`.gitignore` 不影响已 tracked 文件；注释行 = `.gitignore:28`，规则行 = `:29-31`）。
- **后果（已复现）**：`git check-ignore --no-index -v vendor/lakex-doc-react/NEW.js` → 命中 `.gitignore:29`；`public/vendor/lakex/NEW.svg` → 命中 `:30`；`public/vendor/lakex-doc/NEW.js` → 命中 `:31`。即**内核升级/重新导出时新增的文件会被静默忽略**，构建缺资源且 `git status` 看不出来。
- 来源可查：这三行是 `b8f67c33 2026-10-22 chore(public): sync from private@cb04fc0f` 引入的「公开镜像」时代残留；README 与 NOTICE 现在都说「以 vendored 形式包含在本仓库」，口径已经反转。
- **建议**：删除这三行 + 改注释为「内核以 vendored 形式入库，见 NOTICE」；**代价**：以后再想切回「内核不入库」的公开镜像形态需重加。**需用户裁决**（§8-4）。

### 6.3 其它卫生项

| 项 | 结论 | 证据 |
| --- | --- | --- |
| 大文件 | 均为内核/字体产物（`lakex.js` 9.3MB、`dist/index.es.js` 6.6MB、`public/vendor/cdn/**/CodeMirror.js` 1.5MB、`apng` 0.67MB）；**禁止清理**（§3#18） | `git ls-files -z \| xargs -0 ls -l \| sort -k5 -rn` |
| 构建产物 | `dist/`、`dist-electron/`、`dist-mobile/`、`release/` 全部 ignored（`.gitignore:2-5`）；`git status` clean | 已核实 |
| 硬编码本机绝对路径 | **21 个 tracked 文件**含 `/Users/admin/...`（AGENTS/DEVELOPMENT/CODEX-GUIDE/MOBILE-OPS/LAKEX-CONTRACT/MOBILE-DESIGN/MOBILE-AI/MOBILE-BITABLE-DINGTALK/audit-261027×2/多端与移动脚本） | `git grep -c '/Users/admin/'\|wc -l` = 21；对开源友好度有影响，建议脚本侧改 `process.cwd()`/`import.meta.url` 派生（尤其 `scripts/multi-end-sync/{delprefix,run5,run5b,run5c}.mjs` 里 `createRequire("/Users/admin/.../package.json")` 在别人机器上必崩） |
| 双远端 | ✅ 与 README/AGENTS 一致：`origin` = Gitee（+GitHub HTTPS pushurl）、`github` = GitHub SSH；`npm run setup:remotes` 补齐（remote 不入库） | `git remote -v` 实测 |
| CI 健康 | ✅ 三个 workflow 全部把 action **钉到 commit SHA**；`pr.yml` 无 secrets、只跑 tsc/vitest/双 build/check:core/ui-metrics/check:bundle/check:arch；`release.yml` 仅 tag 触发、macOS+Windows+Android+publish、Android keystore 走 secret 且校验缺失即失败；设备/视觉门禁不进 CI（与 AGENTS §3#21 一致） | `.github/workflows/{pr,release,packaged-smoke}.yml` |
| CI 小缺口（存疑，未定罪） | `pr.yml` 未跑 `npm run check:mobileui`（AGENTS §6 把 `check:mobileui` 列进日常门禁） | 需作者确认是否故意（该脚本可能依赖 `dist-mobile` 之外的环境） |
| 工作产物是否该入库 | `.impeccable/design.json`（17,785B）**已入库且应入库**（AGENTS §3#14 指定为设计系统机器可读层）；`.impeccable/questions/`、`live/`、`.css-audit/`、`.ai-writing-recon/` 已 ignore（`:16`、`:12`、`:34`）✅ | 逐个 `check-ignore` |
| 补丁目录 | ✅ 4 处（`patches/` 3 + `vendor/lakex-doc-react/patches/` 1），与 AGENTS §2「依赖补丁 4 处」一致；`.gitattributes` 对 `patches/*.patch` 关空白检查的理由已写明 | 已核实 |

---

## 7. 明确不做项（并说明理由）

1. **不清理 `vendor/lakex-doc-react/**` 与 `public/vendor/**` 的冗余/死代码**（AGENTS §3#18）——包括 9.3MB 的 `lakex.js`、`dist/*.cjs.js` 双份产物、`examples/**`。本轮**不提议**任何 vendor 删减。
2. **不动 `patches/` 4 处补丁**（改 = 改内核行为，需专门批次 + 设备验证）。
3. **不逐篇通读 `LAKEX-CONTRACT.md`（269KB）/ `SYNC-PROTOCOL.md`（43KB）**：本任务只判「体量与结构」，内容正确性属内核/同步审计域。
4. **不建议为 docs 引入静态站点/搜索（Docusaurus/VitePress 等）**：撞 §3#14「禁止第二套样式范式」与 §3#22 依赖准入四问，收益只有「好看」，是典型过度设计信号（§3#17）。
5. **不把 `HANDOFF.md` 拆成多文件**：它是「唯一交接文档」（AGENTS §2），拆分会让「单一状态来源」变复数；只压缩 §0。
6. **不做「文档自动生成 / 代码注释反向生成文档」**：没有证据表明现有漂移来自手工维护成本以外的问题，且会引入构建期工具链。
7. **不改 guide 截图**（31 张均有引用；截图与现版本差异**未取证**，只记录「五格 Dock 首页可能需重拍」为 P2）。
8. **不提议给 `docs/lakexEditor-developer-docs/` 逐篇裁剪**：官方镜像保持整包可追溯，剪掉语雀云 API 那 10 篇省不了多少空间（多为 1–9KB），却破坏「镜像」语义。
9. **不动 `.ai-writing-recon/`、`.css-audit/` 的 git 历史**：261110 已用 `git filter-repo` 清理，再动会再写一遍历史。
10. **不评估 `package.json` 依赖版本 / 不跑构建 / 不跑全量 vitest**（任务铁律）。

---

## 8. 需用户裁决

| # | 议题 | 方案 A | 方案 B | 我的建议 |
| --- | --- | --- | --- | --- |
| 1 | **`docs/audit-261027/` 4 篇去留**（AGENTS §2「审计直接删」vs HANDOFF §3 P1「保留，有引用」冲突） | **保留**并在 AGENTS §2 加一句例外（「审计产物若被源码/契约引用，保留至引用消除」） | 先消除引用（把 09 的 4 条结论搬进 `docs/RESILIENCE.md`/`SYNC-PROTOCOL`、把 5 处源码注释改成指向新落点），再整目录删 | **B 更彻底但成本约 0.5 天**；若开源优先「仓库干净」，选 B。两案都不该维持现在的「规则说删、实际保留」 |
| 2 | **HANDOFF §0 压缩幅度** | 留最近 3 批（≤15KB，全文 ≤40KB） | 留最近 10 批（≈30KB） | A；历史细节正规去处是 `RELEASE-NOTES`/`git log`/`TROUBLESHOOTING` |
| 3 | **`intentLogState` v1/v2→v3 迁移去留** | 保留（删除意图不可重建，重置会让已删文档复活） | 删除迁移 + 一次性重置设备同步状态（并在 UI 提示「将重新全量同步」） | **A**（数据安全 > 代码整洁；§3#7 的「能删了重建」在这里恰好不成立）。但要补一条注释写明「为什么这是例外」 |
| 4 | **`.gitignore` 第 28–31 行** | 删除三行 + 改注释（内核已 vendored） | 保留三行，但改注释说明「仅为防误加，内核已 tracked」 | **A**：B 仍会在内核升级时漏文件（风险已实测） |
| 5 | **是否补 `CONTRIBUTING.md` / `SECURITY.md`** | 补精简版（各 ≤60 行：环境、门禁、PR 口径、漏洞报告渠道） | 不补（README 已有「反馈」一节） | A（正式开源的最低礼数），但**不进本轮**，作为发版后第一批 |
| 6 | **`scripts/` 一次性脚本处置** | 直接删（git 可查） | 移到 `scripts/oneoff/` 子目录保留 | **A**（AGENTS §2 明确「直接删」，且这 23 个里多数已无法运行）；B 会新增「归档目录」这一第二形态 |
| 7 | **guide 新增 4 章的体量** | 4 篇精简章（各 60–100 行） | 1 篇「新功能合集」长章 | A（与现有「一章一主题 + 目录表」体例一致） |
| 8 | **`ARCHITECTURE.md` 返工范围** | 只修「失效文件索引 + 删 V2 历史段」（半天） | 整篇按 v3 重写（1–2 天） | A 立刻做（现在会误导新贡献者）；B 排进 v1.2 文档批 |

---

## 附录 A：本次审计未覆盖 / 需他人接续

1. `LAKEX-CONTRACT.md`（269KB）与 `SYNC-PROTOCOL.md` 的**内容正确性**未逐条核（只核了引用与体量）。
2. `SYNC-STATE-CONVERGENCE.md` 与 `SYNC-PROTOCOL.md` 是否构成「双份同步契约」未下结论（需同步域审计员判定）。
3. `PAD-ADAPTATION.md`/`MOBILE-AI.md` 的**逐段过期点**未穷举（只抽样验证了失效文件引用）。
4. 设备/快照门禁的实际绿灯状态未复跑（任务禁止跑装置）。
5. 未读 `release.yml` 全 306 行（只读了前 120 行 + 关键 job 头），Windows/Gitee 发布段未审。

## 附录 B：跨域线索（只记录，不深挖）

1. **设置搜索漏项（设置域）**：`src/components/app/SettingsPanel.tsx:583` 有 `update` 分类（label「更新」），但 `src/components/model/settingsSearch.ts` 的 `SETTING_ITEMS`（`:25-94`）**没有任何 update 条目** ⇒ 在设置里搜「更新」搜不到更新中心。AGENTS §3#14 要求「每加/改一行设置必须同步 SETTING_ITEMS」，此条疑似漏登记；需确认 `settingsSearch.test.ts` 是否只做单向校验（有 item ⇒ 有行）。
2. **文档 §编号漂移（全仓）**：`HANDOFF §3#N` 旧编号仍有 **7 处**（MOBILE-AI、TROUBLESHOOTING、mobile-f16-acceptance、audit-261027/09 等），`AGENTS §7.2x/3x` 旧编号 **11 处**（脚本注释、InkPad、clipboardHtml、QuickNoteComposer、nativeKeyboard 等）。HANDOFF §3 P2 已登记「下次碰时统一」，属**顺手可清**的低风险项。
3. **移动端首页改版未回填到任何用户文档**（本报告 §4 已覆盖 guide 侧）；设计侧 `MOBILE-DESIGN.md` 是否同步了「五格 Dock」未核。
4. **`public/brand/14a-paper-finch-loading-256.apng` 672KB** 为品牌动画资源，是否仍被引用未核（不在本任务清理范围，但开源前值得确认一次）。
5. **`docs/lakexEditor-developer-docs/fetch-yuque-developer-docs.mjs` 硬编码输出到 `/Users/admin/file/local-lake/yuque-developer-docs`**（仓外路径），别人复跑会落到自己机器任意位置或失败。

## 附录 C：本报告的复现命令集

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lakex-local-notes

# 计数
git ls-files | wc -l; git ls-files docs | wc -l; git ls-files guide | wc -l; git ls-files scripts | wc -l
# 文档体积/最后改动
for f in docs/*.md; do printf '%8d %s\n' "$(wc -c <"$f")" "$(git log -1 --format='%ad' --date=short -- "$f")"; done | sort -rn | head
# HANDOFF 分段体积
awk '/^## /{if(name){print bytes"\t"lines"\t"name} name=$0; bytes=0; lines=0; next} {bytes+=length($0)+1; lines++} END{print bytes"\t"lines"\t"name}' docs/HANDOFF.md
# 死脚本（文本零引用）
node /tmp/refmap.mjs     # 见 §2 判定流程；或直接用 §2 的三步 grep
# .gitignore 误伤复核
git check-ignore --no-index -v vendor/lakex-doc-react/NEW.js public/vendor/lakex/NEW.svg
# 敏感信息
git grep -nE 'AKIA[0-9A-Z]{16}|LTAI[0-9A-Za-z]{12,}|sk-[A-Za-z0-9]{20,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY' -- .
# 硬编码本机路径
git grep -c '/Users/admin/' -- '*.md' '*.ts' '*.mjs' '*.json' | wc -l
# 手册与产品脱节（应为 0，实测 0）
grep -l '日记\|便携包\|更新中心\|AI 写作' guide/*.md | wc -l
```
