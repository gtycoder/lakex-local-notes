# 01-core-backend — electron/** + src/core/** 终审（只读审计，261125）

> 审计域：`electron/**`（主进程）+ `src/core/**`（两端共享领域逻辑）。只读审计、只出方案；除本文件外未改任何代码。
> 编号 C-01 起。每条 file:line 均为本次实际读过核实；未能核实的显式标注「未核实」。

## 1. 概览

**范围与规模（实测）**：`electron/` 非测试 155 文件 / 28,856 行（测试 188 文件）；`src/core/` 非测试 185 文件 / 25,214 行（测试 178 文件）。跨域（`src/mobile`）只在「同一逻辑两端各写一份、落点应在 core/本域」时提出。

**方法**：AGENTS + HANDOFF §1–§3 → 既有审计吸收（`docs/arch/ELECTRON-LAYERING-AUDIT.md`、`docs/audit-261112/00-MASTER-PLAN.md`）→ 大文件逐个结构解析 → 迁移/兼容/legacy/v1/v2 全量 grep 逐条读码 → 重复实现扫描（同名文件对撞、SQL 片段、判据函数、hash/时间/转义小工具、重试/队列）→ 死代码可达性扫描（.ts/.tsx/.mjs 全量引用图）。§3#17 三问逐条过筛：不值得做的进「明确不建议做」，收益只停在整洁的降级或不做。

**总体评价**：本域的「单一来源」纪律执行得好——IPC 归口（`electron/ipc/registrar.ts` + 21 个 register* + 四面 parity 测试）、错误契约（`src/core/errorContract.ts` → `electron/ipc/errors.ts` 信封白名单透传）、云状态判据（`core/cloudState`）、gone 判据（`core/syncDecisions.isGoneNote`）、同步计划（`core/s3v3/plan/plan.ts` 纯函数）、路径安全（`core/storeUtils.isSafePathSegment`，`electron/store.ts:495-508` 校验下沉到路径构造）、hash（`core/sha256Sync` + `electron/sha256Native.ts` 注入）、repository 能力对账（`core/repositoryCapabilities.ts` 数据矩阵 + 护栏测试）都已是单一来源，不需要再立项。**死代码为零**：全量引用图扫描 0 个零引用模块；4 个「仅测试引用」文件均属有意的测试支撑/对账表（见 §3）。

真问题集中在三处：① **同一判据多套实现的残余**——回收站子树 SQL 六份且 UNION/UNION ALL 语义已经分叉（防环性不一致）、日记归属判据三份、拒写判据两份（有 261124 漂移实证）；② **历史一次性迁移代码已到评估删除期**（enc:v1 分支、published_at→水线回填、tag_absent 迁移）；③ **大文件缺头注释/分区注释**（84 个非测试文件无文件头注释，含 store.ts 2210 / main.ts 1164 / s3v3Engine.ts 1047 / noteExport.ts 765）。按三问筛后值得做的一共 11 条，其中 P2×5、P3×6；无 P0/P1（本域无「不做就丢数据/卡死」的已知缺陷）。

## 2. 方案清单

### C-01 · 回收站子树 SQL 片段收口（顺带清 purge UPDATE 四连重复）
- **问题与证据**：同一条「回收站子树 id 集」递归 CTE 在 5 处各写一份，且**防环语义已分叉**：
  - `electron/noteQueries.ts:218-226`、`electron/searchRepository.ts:148-152`、`:193-198`、`:204-208` 用 `UNION ALL`（树里出现 parent 环时递归无限展开）；
  - `electron/noteMetadataRepository.ts:433` 用 `UNION`，并注明「P1-6：UNION（去重）而不是 UNION ALL —— 树里出现环时递归会无限展开」。
  - 同型还有 `electron/syncReconciliation.ts:244-248`（`sub` CTE）、`electron/trashLifecycle.ts:100-108`（两条边并集的 `flattenedSubtreeIds`，语义不同、保留独立）。
  - 顺带实证的复制粘贴残留：`electron/syncReconciliation.ts:211/214/249/252` 四条 purge UPDATE 的 SET 里 `is_purged=1` 出现两次（`...,is_purged=1, is_dirty=0,is_purged=1,...`），且 4 条语句形态几乎相同。
- **具体方案**：新增 `electron/sql/treeFragments.ts`（纯 SQL 字符串 + 参数助手，不引依赖）：导出 `TRASH_SUBTREE_CTE`（统一 `UNION` 防环版）与 `PURGE_NODE_SQL`/`PURGE_NOTE_SQL`（清掉重复 SET）；替换上述 5 个 `trash_ids` 调用点（注意各点参数顺序不同，助手按「trashId×2 在前」约定收口）。`flattenedSubtreeIds` 的两条边并集**不并入**（语义不同，禁止强行合并）。
- **代价与风险**：低。纯字符串抽提，各调用点均有既有测试覆盖；风险 = 参数占位符顺序错位（用每点单测钉）。行为变化仅一处：UNION ALL → UNION 在环上从「可能无限递归」变「收敛」。
- **优先级 P2**；涉及端：桌面（core 不需要，SQL 只在主进程）。

### C-02 · 「已 gone ⇒ 拒写」判据收口到 core.isGoneNote 单一来源
- **问题与证据**：同语义判据现有两套行级实现 + 一处 SQL 内联：
  - `src/core/syncDecisions.ts:81-86` `isGoneNote`（单一来源，AGENTS §16）；
  - `electron/noteMetadataRepository.ts:52-62` `assertNodeWritable` 自查 `parent_id/trashed_at/is_purged`；
  - `electron/noteContentRepository.ts:87-91` 再内联一份，并留注释「261124 B8-④P2-3：拒写判据与 isGoneNote 对齐 —— 还要看 parent===回收站容器」——**该注释就是判据漂移的实证**（旧判据漏「parent=trash 但 trashed_at 空」的行）。
- **具体方案**：`core/syncDecisions.ts` 增加行级纯谓词 `isGoneRow({ parentId, trashedAt, isPurged })`（`isGoneNote` 改为调它，行为不变）；`assertNodeWritable` 与 `noteContentRepository.save` 的拒写判据改调 `isGoneRow`。**只统一谓词、不挪守卫位置**——符合 AGENTS §3#23（守卫留在入口层/同步专用路径，不下沉共用写函数）；改动注释里按 §3#23 声明调用方分类（U 用户入口拒写 / S 同步镜像走 `saveSynced` 不经谓词）。
- **代价与风险**：低；`noteContentRepository.test.ts` 的 F04 文案断言与 `noteMetadataRepository` 既有测试即护栏。收益是防第三次漂移（已有一次事故记录）。
- **优先级 P2**；涉及端：共享（core 谓词）+ 桌面（两个守卫）。移动端 `bridge.noteGoneState` + `MobileApp.tsx:826/869` 已调 `isGoneNote`，随谓词自动同源，无需改动。

### C-03 · 日记子树归属判据三处实现收口
- **问题与证据**：「沿祖先链找 space=diary 的笔记本」三个实现：
  - `electron/store.ts:462-473`（递归 CTE）+ `store.ts:476-481`（note→node）；
  - `electron/noteMetadataRepository.ts:76-86` `diaryNotebookOf`（JS 循环 + visited 防环）——与上者**语义完全相同、实现不同**（CTE vs JS）；
  - `electron/trashDiaryOrigin.ts:14-26`（沿 `deleted_from_parent_id ?? parent_id` 的**原始父链**变体——语义不同，保留独立）。
- **具体方案**：抽 `electron/diaryAncestry.ts`（或并入 `electron/diaryStore.ts`）单一实现 `diaryNotebookOfNode(db, id)`（用 store.ts 的 UNION 防环 CTE 版）+ `diaryNotebookOfNote`；store 与 noteMetadataRepository 改调；trashDiaryOrigin 保留自己的边语义但在注释里互引，声明「变体、勿合并」。
- **代价与风险**：低；`diaryImmutable.test.ts`/`diaryStore.test.ts` 覆盖。收益 = 日记不可变守卫（AGENTS §3#25）判据只有一份。
- **优先级 P2**；涉及端：桌面。

### C-04 · main.ts 装配外迁 B1/B2（吸收既有建议，标注来源）
- **问题与证据**：`electron/main.ts` 1164 行；`app.whenReady().then`（`main.ts:604`）到 `before-quit`（`main.ts:1125`）之间约 500 行启动装配 + 窗口层。**来源 = 已有旧建议**：`docs/arch/ELECTRON-LAYERING-AUDIT.md` §5「批次 B · 入口装配机械化外迁」（B1 非窗口 wiring → ≤760 行、B2 窗口层 → ≤600 行，含 10 个新文件的逐块搬移表与 4 条不可动时序）+ HANDOFF §0 261113「遗留②」同条。批次 A（门禁）已落地（`electron/architecture.test.ts` 在位）。
- **具体方案**：按该审计 §5 批次 B 的表格原样执行（boot/protocolWiring、startupDecision、recoveryWiring、quickNotesWiring、fileReconcileWiring、backupWiring、timerWiring、syncWiring、updateWiring、window/* 10 件），纪律沿用「单例不搬家只经 getter 读」；把「`registerAppSchemePrivileges` 模块顶层、`applyUserDataPath` 先于任何 userDataDir、serveAppDist 先于 createWindow、installNativeSha256 先于任何 hash」4 条时序写成注释 + 断言；加 `main.ts` 行数断言（<620）。
- **代价与风险**：约 5 人日（审计原估）；风险 = 启动时序（审计已列不可动清单）与恢复页/定时器回调误用值快照（必须 getter）。验收按审计 §5：全量 vitest + tsc + check-arch + dev/packaged 冒烟。
- **优先级 P2**；涉及端：桌面。

### C-05 · 域级与大文件注释补全批（头注释 / 分区注释 / 契约注释）
- **问题与证据**：实测 84 个非测试文件**无文件头注释**（前 2 行无 `/**`/`//`），含四个已知大文件：`electron/store.ts`（2210 行，import 即开头）、`electron/main.ts`（1164）、`src/core/s3v3Engine.ts`（1047）、`electron/noteExport.ts`（765），以及 `src/core/s3v3Merge.ts`（444，核心合并判据却没有头注释/契约引注）、`electron/syncReconciliation.ts`（484）、`electron/trashLifecycle.ts`（428）、`electron/noteMetadataRepository.ts`（446）、`electron/assetServer.ts`（500）、`electron/webApi/static.ts`（497）、`electron/ipc/registerNotes.ts`（492）等。判据 = 文件前 2 行无任何注释（命令可复现：对 `find electron src/core -name '*.ts' -not -name '*.test.ts'` 逐个查前 2 行）。
- **具体方案**：只给「域级入口 + 大文件 + 契约点」补（约 15 个文件，不做 84 个全量 churn）：① 每个文件补 5-15 行头注释（职责/所属层/关键红线引注 AGENTS 条目）；② `store.ts` 补分区注释（协作类装配 / 笔记 CRUD / 导出委托 / 历史 / 回收站 / 同步账本 1830-2010 / 设置直通 1682-1748 / 缺正文 1749-1828）；③ `s3v3Engine.ts` 补「四相编排职责图」头注释并把 AGENTS §4 的发布/锁/深清语义锚到方法上（syncOnceRound:456、deepCleanup:953、resetFromCloud:1036）；④ `s3v3Merge.ts` 补契约注释指向 `docs/SYNC-PROTOCOL.md` §9.5/§9.8。契约新观测按 AGENTS 要求回填 SYNC-PROTOCOL/RESILIENCE，不只留注释。
- **代价与风险**：半天到一天；零行为改动。风险 = 注释与代码漂移（只写稳定语义、不写可变数值）。
- **优先级 P2**（开源前文档质量）；涉及端：共享 + 桌面。

### C-06 · store.ts 残余真逻辑抽提 + 行数棘轮
- **问题与证据**：`electron/store.ts` 2210 行，已是 20+ 协作类门面（SearchRepository/HistoryRepository/TrashLifecycle/…），但仍有三块真逻辑留在门面里：同步账本写入族（`store.ts:1830-2010`：markNotesSyncedIfUnchanged/markSynced/applyNotesCloudDeleted/waterline/lastSeenCommitId/syncInterrupted/pendingSignature 等约 30 个方法）、缺正文族（`store.ts:1749-1828`）、设置直通族（`store.ts:1682-1748`，23 个 `this.settingsRepository` 一行委托）。
- **具体方案**：① 同步账本族 → 并入既有 `electron/syncReconciliation.ts` 或新 `electron/syncStateBookkeeping.ts`（与 SyncReconciliation 同层、复用 db）；② 缺正文族 → `electron/missingBodyService.ts`（判据已是 `src/core/missingBody.ts` 纯函数，只搬 DB/文件操作）；③ 设置直通族改为 IPC 层直调 settingsRepository（或保留薄委托）；④ 加 store.ts 行数棘轮断言（搬完后 <1600，防长回）。**必须护栏先行**：先补 markSynced 族的表驱动单测再搬。
- **代价与风险**：中（1-2 人日 + 全量回归）；收益 = HANDOFF 长期焦点「拆大文件」里收益最实的一块（同步账本写入是数据敏感面，独立成文件便于审）。低于此收益的进一步拆分不做。
- **优先级 P3**；涉及端：桌面。

### C-07 · noteExport.ts 抽离 ink 渲染块
- **问题与证据**：`electron/noteExport.ts` 765 行 = 两块无关职责：手写板 SVG/PDF 渲染（`noteExport.ts:34-255`：inkStrokePathsMarkup/buildInkPageSvg/buildInkPdfBody/INK_PDF_PRINT_CSS）+ 导出编排（`:256-765` NoteExport 类）。
- **具体方案**：抽 `electron/noteExportInk.ts`（34-255 原样搬 + 头注释），NoteExport 与 `readInkPageSvg` 调用点改 import；顺带补 `noteExport.ts` 头注释（见 C-05）。
- **代价与风险**：低（纯移动）；导出/手写板既有测试覆盖。
- **优先级 P3**；涉及端：桌面。

### C-08 · 删 secretCipher 的 enc:v1 分支（历史兼容①）
- **问题与证据**：`electron/secretCipher.ts:24`（V1_PREFIX）、`:76-82`：enc:v1 密文只做「按未配置读出 + warn」，不解密不迁移（261204 裁决已定）。而落到 `:83-87` 的「非 enc: 前缀（旧明文）」分支同样返回空串 + warn ⇒ **删掉 v1 分支行为完全等价**，只损失一句更友好的告警文案。
- **具体方案**：删 V1_PREFIX 常量与 v1 分支，把「enc:v1: 旧钥匙串存量也按未配置处理」并进通用分支的注释/告警文案；同步 `src/core/secretCipher.ts:6-8` 头注释。三个语义护栏测试（`secretCipher.test.ts:45`、`store.test.ts:1531`、`settingsRepository.test.ts:40`）断言的是「按未配置读出」语义，预计只需微调文案断言。
- **代价与风险**：极低；注意读路径「不改写存量行」的语义（store.test.ts:1538）保持不变。
- **优先级 P3**；涉及端：桌面。

### C-09 · 删 published_at→水线一次性回填与 sync_state 删列段（历史兼容①）
- **问题与证据**：Del-6（261029）的「首次升级回填」仍在每次启动跑：`electron/schemaInit.ts:212-228`（deleted_notes.published_at → tombstones_published_at → DROP COLUMN）、`electron/quickNotes/schema.ts:106-121`（小记同款）；以及 `schemaInit.ts:206-211`/`quickNotes/schema.ts:131-133` 的 sync_state 删列/删触发器段。
- **具体方案**：发布一个「最低升级版本」声明（如「只支持从 ≥1.6.x 升级」，写进 RELEASE-NOTES/README）后整段删除：水线键缺失时直接写 "0"（新库本就如此），不再查 `published_at`。同批删 sync_state 清理段。**注意**：删除后从 Del-6 之前直升的库会把全部历史删除行当「待同步」重新发布一次删除意图（幂等、不丢数据，只是多一轮流量）——这是可接受代价，删除方向安全。
- **代价与风险**：低；`store.test.ts:1678` 一类水线测试需按新语义微调。前提 = 版本声明先行（对开源新用户零影响）。
- **优先级 P3**；涉及端：桌面（小记库同属桌面进程）。

### C-10 · 删 tag_absent_migrated 一次性迁移（历史兼容①，带前置条件）
- **问题与证据**：`electron/quickNoteTagsStore.ts:36-37`（标记键）、`:279-320`（migrateTagAbsence 事务）、`:97-110`（`tags.deleted_at` 列只为旧库 DDL 保留）；移动端同款孪生 `src/mobile/data/quickNoteTagsRepository.ts:235-247`（`bridge/context.ts:99` 调用）。
- **具体方案**：两端同删（跨域同批）：删迁移方法 + `deleted_at` 从新库 DDL 去列（旧库残留列无害、不写清理）；或按 §3#7 判据的保守版**只删桌面侧、移动侧留待移动域审计裁决**。前置 = 同 C-09 的版本声明：从 pre-261105（v1.0.x）直升的库会把旧墓碑标签当 active 复活（可见 + 会被重新发布，用户重删即可，不丢数据）。
- **代价与风险**：低-中（取决于是否接受「pre-1.x 不支持直升」）；一次性代码本就两端各一份（见 §4 注），删除反而消掉一处跨域重复。
- **优先级 P3**；涉及端：共享决策 + 桌面 + 移动（移动落点在移动域，需两域会签）。

### C-11 · 删 rendererLogLevel 旧签名分支（历史兼容①，未核实）
- **问题与证据**：`electron/rendererLogLevel.ts:29-33` 保留「旧签名 args = [level, message, line, sourceId]」兜底。Electron 已 pin 44；**未核实** 44 的 `console-message` 事件是否还有旧形状（需查 Electron 44 changelog/实测）。
- **具体方案**：先核实事件形状；若 44 恒为新形状（event.level 字段）则删该分支与 `fromNumber` 的对应入口，保留字符串/数字映射。核实不到就**不动**（删除收益仅 5 行）。
- **代价与风险**：极低；错删 = renderer 日志级别回落 info（可观测性小损）。
- **优先级 P3**；涉及端：桌面。

## 3. 明确不建议做

1. **抽公共 `nowIso`/`uuid` 小工具**（`nowIso` 实测 11 处本地定义 + 43 处 `new Date().toISOString()` 内联；`uuid` 3 处）：一行函数，合并收益只停在整洁，且注入点分散反而增加 import 面。§3#17 直接否。
2. **合并 4 处 `escapeHtml`**（`electron/startupRecovery.ts:364`、`electron/noteExport.ts:76-83`（text/attr 两版）、`src/core/mdToHtml.ts:7`、`src/core/search/snippet.ts:8`）：各处转义集刻意不同（snippet 因 dangerouslySetInnerHTML 全转义；mdToHtml 只做文本节点），合并易错、收益是整洁。
3. **统一「重试/退避」抽象**（updateService 下载重试 3 档、s3v3 发布重试 6 次、quickPush 3 次、上传 journal 5 次退避）：预算与语义各域不同（协议定数），强行合并 = 过度设计。
4. **把 `electron/s3v3/deviceConformance.ts`（844 行）/`fileDeviceStore.ts`/`electron/testing/sourceText.ts` 搬进 testing/ 目录**：三者均「仅测试引用」的测试支撑（deviceConformance 是多端一致性门禁装置），不进打包产物（ELECTRON-LAYERING-AUDIT §2.3 已实测 136 个 src 文件进包、测试支撑不进）；搬家纯审美。同理 `src/core/repositoryCapabilities.ts`（对账表 + 护栏）留在 core 是有意设计。
5. **s3v3Engine.ts 结构性拆分**（1047 行）：四相决策/执行已抽到 `core/s3v3/commit/`+`plan/`，余下是编排 + bodyCache；继续拆属于「没有护栏的大规模重写」（AGENTS 长期方向明令），收益低于风险。只做 C-05 的注释补全。
6. **根平铺 83 个 electron 文件搬主题目录 / 窗口账本 / StartupBranch 判别联合 / preload codegen**：ELECTRON-LAYERING-AUDIT §6 已逐条裁决不做（审美/类型整洁收益、60+ 文件 diff 与启动语义风险），已结案不重开。
7. **清理旧库残留空表（declared_assets / sync_base）**：`schemaInit.ts:93` 已裁决「残留空表无害，不为旧数据写迁移/清理」，已结案。
8. **恢复 enc:v1 解密/迁移、给便携包写 formatVersion 1 兼容、inkDoc/lockedText 读兼容降级**：分别被 261204 / 261122 / AGENTS §3#25·INK-PAD 裁决封死，已结案别立项。
9. **「格式级改动在 dirty 之外」退出保存闸**：HANDOFF §3 已登记为独立小批（落点在保存闸/UI 域），不在本域重复立项。
10. **把 deviceStore.ts（940 行）按 createFileBackedAssetIo / createDeviceStoreMeta 拆三份**：文件内两块各自有清晰分区注释与端口接口（`deviceStore.ts:35-195`），拆分收益=整洁，降级不做。

## 4. 历史兼容代码清单

分类口径：① 真·历史数据兼容候选删；② 协议/跨端/内容格式读兼容不许删；③ 测试/工具旧夹具；（附）schema 升级 DDL —— 用户库不能删了重建（§3#7 判据答案为「否」），既非历史兼容也不可删，单列说明。

| # | 位置 | 类别 | 现状语义 | 能否按 §3#7 删 | 删的代价 |
|---|------|------|----------|----------------|----------|
| 1 | `electron/secretCipher.ts:24,76-82` enc:v1 分支 | ① | 旧钥匙串密文按未配置读出 + warn，不解密不迁移（261204） | **可删**（C-08） | 丢一句专用告警文案，行为等价 |
| 2 | `src/core/secretCipher.ts:6-8` enc:v1 格式约定注释 | ① | 同上的口径文档 | 随 #1 同步改写 | 无 |
| 3 | `electron/schemaInit.ts:212-228` published_at→水线回填 + DROP COLUMN | ① | Del-6 首次升级：水线=COALESCE(MAX(published_at)) 保留未发布旧删除行语义 | **可删**（C-09，前置版本声明） | pre-Del-6 直升库全部删除行重发一轮（幂等、不丢数据） |
| 4 | `electron/quickNotes/schema.ts:106-121` 小记同款水线回填 | ① | 同上（quick_tombstones_published_at） | **可删**（C-09 同批） | 同上（小记删除行重发一轮） |
| 5 | `electron/schemaInit.ts:206-211`、`quickNotes/schema.ts:131-133` sync_state 删列/删触发器 | ① | 旧「sync_state 触发器」模型清理（无数据回填） | **可删**（C-09 同批） | 旧库残留列无害；从远古版本直升会残留死列 |
| 6 | `electron/quickNoteTagsStore.ts:36-37,279-320` tag_absent_migrated 迁移 | ① | 旧「删除=墓碑」→「删除=缺席」：清墓碑行 + 并入待删 + 置标记，单事务幂等 | **可删**（C-10，前置版本声明，两端同批） | pre-261105 直升库旧墓碑标签复活（可见/重发布，重删即可） |
| 7 | `electron/quickNoteTagsStore.ts:97-110` tags.deleted_at 列 DDL | ① | 只为旧库 DDL 同形保留，无查询依赖 | 随 #6 一起从新库 DDL 去列 | 旧库残留列无害 |
| 8 | `src/mobile/data/quickNoteTagsRepository.ts:235-247` 移动端孪生迁移 | ① | 与 #6 同语义（跨域重复实例） | 可删但属移动域，需会签 | 同 #6 |
| 9 | `electron/rendererLogLevel.ts:29-33` 旧 console-message 签名兜底 | ① | args[0] 为数字 level 的旧事件形状 | 待核实后可删（C-11） | 核实不了则不动 |
| 10 | `electron/tagStorage.ts:54-113` migrateNoteTagLinksToQuickNotes | ①（数据搬迁） | 261107 文档标签关系一次性跨库迁入小记库（ATTACH+单事务+幂等标记） | **不可删**：文档标签关系=用户数据，不能删了重建 | 删=从 pre-261107 升级的用户文档标签关系全丢 |
| 11 | `src/core/s3v3/state/intentLogState.ts:130-140` salvagedAssetsOf + `212-233` 旧信封（v1/v2）重置 | ②（安全关键） | Q23 裁决「不迁移只重置」，但**抢救资产投影与 hashCache**——丢了会把「未下载」误判「删光附件」⇒ 云端误 GC（文件头注明） | **暂不可删**：待存量安装全部过 Q23 后可评估（届时删的是「抢救」，不是「迁移」） | 删早了 = 旧版升级设备可能云端误 GC 资产 |
| 12 | `src/core/lockedText.ts:26,134,152` LOCKED_TEXT_SCHEMA_VERSION=1 + legacy-yuque 识别 | ② | 内容格式读兼容（含语雀 App 加密卡提示） | 不许删 | 删=旧正文加密卡整块打不开 |
| 13 | `src/core/inkDoc.ts:31`（INK_DOC_VERSION=4，读 1 or 2 or 3 or 4 写 4） | ② | 跨端内容格式读兼容（AGENTS 定案） | 不许删 | 删=旧手写板正文整篇进只读/打不开 |
| 14 | `src/core/portable/portableFormat.ts:8,50,71` formatVersion=2 拒 1 | ②（现行协议） | 「不写 v1 兼容」本身就是 261122 裁决语义 | 不动（已结案） | — |
| 15 | `electron/portable/mobileToDesktopMapping.ts`、`importMobileSnapshot.ts:185-203` | ② | 移动布局→桌面反向映射（跨端读兼容） | 不许删 | 删=手机便携包无法导入桌面 |
| 16 | `src/core/noteKind.ts:5,17-19` 缺省 "doc" 归一 | ② | 旧库/旧清单 kind 缺失兜底（normalizeNoteKind） | 不许删 | 删=旧行 kind 判别失败 |
| 17 | `electron/main.ts:777`（恢复 seed 注释提及 enc:v1）/`registerNotes.ts:243` 同注释 | ①（注释） | 仅注释残留 | 随 C-08 改写注释 | 无 |
| 18 | `electron/settingsRepository.ts:245-255`「已配置的旧库仍默认开着」 | —（非兼容） | 默认开关策略（=是否已配置 S3），不是旧数据兼容 | 不适用 | — |
| 19 | 测试护栏：`secretCipher.test.ts:45`、`store.test.ts:1531`、`settingsRepository.test.ts:40`（enc:v1 语义钉）；`store.test.ts:1678`（水线） | ③ | 钉「按未配置读出/不写迁移」裁决语义的护栏，不是旧夹具 | 不删（C-08/C-09 落地时微调断言） | 无 |
| 20 | `src/mobile/data/quickNoteTagAbsence.test.ts`（移动迁移护栏） | ③ | 同上（钉迁移幂等语义） | 随 #8 会签处理 | 无 |
| 21 | （附）`electron/schemaInit.ts:182-205`、`quickNotes/schema.ts:103-105,122-130` ALTER 补列族 | schema DDL | 给存量用户库补新列（默认值、无回填） | **不可删**：用户库不能删了重建 | 删=存量库缺列、SQL 全面报错 |
| 22 | （附）`electron/schemaInit.ts:28-80` CREATE TABLE IF NOT EXISTS 全量 DDL | schema DDL | 每次启动幂等建表 | 不可删（现状即终态） | — |

**结论**：① 真·历史兼容 **9 条**（#1–#9；5 条可直接删、3 条需版本声明前置、1 条待核实）；② 不许删 **7 条**（#10–#16，#10 严格说是数据搬迁）；③ 测试护栏 **2 组**（#19/#20，不删）；schema DDL **2 组**不可删（#21/#22）。**可删 5 / 带前置可删 3 / 待核实 1 / 不可删 9**。

## 5. 大文件与注释现状小结

**已知大文件 + 本次新发现（非测试，实测行数）**：

| 文件 | 行数 | 头注释 | 现状与补注释方案 |
|------|------|--------|------------------|
| `electron/store.ts` | 2210 | ✗ | 20+ 协作类门面 + 三块真逻辑（同步账本 1830-2010 / 缺正文 1749-1828 / 设置直通 1682-1748）。补头注释（职责=仓储门面、协作类清单）+ 分区注释；结构按 C-06 |
| `electron/main.ts` | 1164 | ✗ | whenReady:604→before-quit:1125 约 500 行装配。补头注释 + 4 条启动时序注释/断言；结构按 C-04（B1/B2） |
| `src/core/s3v3Engine.ts` | 1047 | ✗ | 四相编排 + bodyCache；syncOnceRound:456（272 行）/deepCleanup:953。**不拆**（§3 不建议做 5）；补「编排职责图」头注释 + 方法级契约引注（SYNC-PROTOCOL 锁/发布/深清语义） |
| `src/core/s3v3/state/deviceStore.ts` | 940 | ✓ | 资产 IO 端口 + State 端口 + DeviceStoreMeta 三块，已有分区；不拆（§3 不建议做 10） |
| `electron/s3v3/deviceConformance.ts` | 844 | ✓ | 测试支撑（多端一致性门禁），不进产物；不搬（§3 不建议做 4） |
| `electron/noteExport.ts` | 765 | ✗ | ink 渲染 34-255 + 导出编排；按 C-07 拆 + 补头注释 |
| `src/core/bitableMutations.ts` | 672 | ✓ | 纯函数、头注释齐；无动作 |
| `src/core/inkDoc.ts` | 642 | ✓ | 内容格式契约文件；无动作（版本语义见 §4 #13） |
| `src/core/s3v3/plan/plan.ts` | 610 | ✓ | 纯函数 planSync、头注释齐；无动作 |
| `electron/update/updateService.ts` | 506 | ✓ | 无动作 |
| `electron/assetServer.ts` / `webApi/static.ts` / `ipc/registerNotes.ts` | 500/497/492 | ✗ | 补头注释（C-05 清单内） |
| `electron/syncReconciliation.ts` | 484 | ✗ | 补头注释；SQL 四连重复按 C-01 清 |
| `src/core/diary.ts` | 482 | ✓ | 无动作 |
| `electron/startupRecovery.ts` / `historyLifecycle.ts` | 475/469 | ✓/✗ | historyLifecycle 补头注释（C-05） |
| `src/core/s3v3Merge.ts` | 444 | ✗ | **核心合并判据缺头注释**——C-05 优先补（契约引注 SYNC-PROTOCOL §9.5/§9.8） |
| `electron/noteMetadataRepository.ts` / `trashLifecycle.ts` | 446/428 | ✗ | 补头注释（含 §3#23 调用方分类声明） |

**缺头注释总量**：84 个非测试文件（前 2 行无任何注释），其中约 15 个属「域级入口/大文件/契约点」（C-05 批次覆盖），其余为小文件（<150 行、单一职责），不建议全量 churn。**分区/契约注释缺口**集中在 store.ts、main.ts、s3v3Engine.ts、syncReconciliation.ts、noteExport.ts；**契约注释**缺口最值得补的是 s3v3Merge.ts 与 trashLifecycle.ts（都承载 AGENTS 红线级语义：三方合并、删除传播）。
