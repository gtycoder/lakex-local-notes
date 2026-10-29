# 10 核心业务语义补审（src/core：搜索 / 小记 / AI / 规则与状态）

| 项 | 值 |
|---|---|
| 审计对象 | 本批：搜索、小记领域、AI 契约、规则与状态、横切（单一来源 / 死代码 / 边界 / 测试） |
| 基线 | master @ ea576a80 + 工作树 A 止血批未提交改动（**未触碰**） |
| 方法 | 由外到内：能力/契约 → 模块 → 代码；证据一律「文件 + 符号」（行号只作定位，漂移时以符号为准） |
| 纪律 | **只读**：唯一写入 = 本文；未跑 build / Electron / gradle / npm install，未碰正式数据目录。FTS5 行为用 python3 sqlite3（内存库）实测 |
| 产出 | 14 条发现（P1 × 4 / P2 × 10）、9 条删除/合并候选、3 类护栏建议 |

---

## 0. 结论摘要

1. **搜索索引是一份会过期、且没有判据能发现过期的派生数据**：`electron/searchRepository.ts · upsert` 在 body=null 时取 `notes.text_cache`（不是正文），而同步落盘正文的路径恰好不传缓存（`desktopStoreAdapter.saveState → store.saveNote(id,title,content)`）⇒ 他端改过的文档在本端同步后，FTS 永久停在旧正文，账本还记成「已索引」，不会自愈（CORE-01）。
2. **查询构造器会产出 FTS5 语法错**：`buildMatchExpression` 对单拉丁词直接加 `*`，未规避保留字 ⇒ 输入全大写 AND / OR / NOT 抛 fts5 syntax error（已实测），四个搜索入口同时中招，桌面 SearchPanel 把异常吞成「无结果」；而单测正把这个错误产出钉成期望值（CORE-02）。
3. **小记 S3 布局有两份实现，自称「唯一来源」的那份已死**：`src/core/quickNoteKeys.ts` 全量零生产引用（含 v2 的单文件清单 key），v3 实际用 `s3v3Keys.quickNoteBodyKey/quickNoteAssetKey` ⇒ 按注释去改会改了不生效，按它写对象会落到 v3 永不读取的位置（CORE-03）。
4. **`aiProviders` 声称两端共用，实际只有桌面用**：移动端 AI 设置整个在 Kotlin（默认模型 deepseek-chat、无 provider 目录、无 temperature clamp、**无 SEC-01 的「改 baseUrl 必须重填 Key」门槛**）（CORE-04）。
5. **core 里约 800 行是 manifest v2 残留**（清单解析/校验/键构造、7 个 legacy 同步决策、v2 端口类型），且 MANIFEST_VERSION 被移动端当「协议版本」显示成 **manifest v2**（用户可见的错口径）（CORE-05）。
6. **`setSha256HexImpl` 的唯一调用点在零生产引用的 syncAdapters.ts** ⇒ 桌面 v3 一直跑纯 JS SHA-256，注释里「快 10-20 倍」的注入从未发生；同时 electron 有 7 处直连 crypto.createHash（CORE-06）。
7. **「同一判据多处实现」可点名**：`fileKindOf` 两套（11 类 vs 7 类）、`isSafePathSegment` 两份、`TRASH_NOTEBOOK_ID` 两个常量、`autoMode` 归一三处（回退策略互相矛盾）、FTS 账本四份（两套同名不同列 schema）（CORE-07/09/13/14）。
8. **跨端「契约」有五种载体，其中一种是纯诱饵**：`core/services.ts` + `src/lib/services.ts` + 121 行测试，`createNativeServices` 零生产调用；`repositoryCapabilities` 的矩阵形态是用户 Q6 定稿，别重开（CORE-08）。
9. **纯函数不纯**：时钟（`selectHistoryDrops` 内部 Date.now()）、随机（Math.random 兜底）、locale（`toLocaleLowerCase()` 依赖宿主 locale）；core 另有两个 import vitest 的非测试 .ts，门禁为它们开了白名单（CORE-10）。
10. **可删面集中在「协议换代的残留」**，与 v4 RFC §15 的 M5 收口同批做即可（无需新批次）；删之前别动 `repositoryCapabilities`（Q6 定稿）与 `cloudState` 文案（261009 定稿）。

---

## 1. 现状盘点

### 1.1 规模与形状

| 指标 | 数值（261028 实测） |
|---|---|
| `src/core` 生产代码 | **15,712 行 / 113 个 .ts**（不含测试） |
| `src/core` 测试 | **8,240 行 / 92 个 .test.ts**（测试/生产 = 0.52） |
| 本批覆盖 | **43 个模块 / 约 3,980 行**（≈ core 生产代码 25%） |
| 导出面 | core 共 **937 个 export 声明**（均值 8.3/文件）；本批 324 个 |
| 循环依赖 | **0**（core 内部 ./ 导入图无环，DFS 实测） |
| 分层门禁 | scripts/check-core-boundaries.mjs：core 运行时零 node:/electron/DOM/react（绿灯） |

本批四组：

| 组 | 模块（生产行数） | 生产 | 测试 |
|---|---|---|---|
| 搜索 | search/segment 38 · query 31 · snippet 94 · index 3 | 166 | 111 |
| 小记 | quickNoteModel 258 · quickNoteTags 213 · quickNoteQueries 91 · quickNoteFilters 77 · quickNoteSort 71 · quickNoteKeys 69 · quickNoteSyncTypes 69 · quickNoteTypeFilter 64 · quickNoteSearch 32 · quickNoteReconcile 29 | 973 | 610 |
| AI | aiProviders 384 · aiErrors 152 · aiChatMessages 86 · aiCorpus 56 · aiNetwork 26 | 704 | 274 |
| 规则/状态/工具 | syncUtils 296 · assetNaming 224 · fileCard 201 · maintenancePolicy 167 · syncDecisions 162 · services 150 · repositoryCapabilities 94 · logFormat 87 · dateFormat 85 · sha256Sync 83 · storeUtils 76 · missingBody 68 · noteBodyPaths 66 · treeBehaviorContract 60 · noteInfo 59 · cloudState 54 · ports 51 · types 37 · noteSearchText 31 · resourceBehaviorContract 31 · noteKind 18 · storeErrors 18 · searchTypes 10 · noteSaveDecision 9 | 2,137 | 979 |

> **261028 晚更新（本表是 261027 快照，别按它找文件）**：`core/services.ts`（+ `lib/services.ts`）已随死代码删除；`treeBehaviorContract.ts` / `resourceBehaviorContract.ts` 已移到 **`src/testing/`**（core 非测试文件 import vitest = 0）；`quickNoteSyncTypes.ts` 69→25 行；新增 `repositoryCapabilities.ts` + `sha256Native` 接线。

### 1.2 入口与契约（能力 → 模块 → 消费方）

| 能力 | core 契约 | 生产消费方 |
|---|---|---|
| 检索分词/查询/摘要 | core/search/index.ts barrel：segmentText / segmentToIndexText / buildMatchExpression / escapeLike / buildSnippet | 桌面 searchRepository.ts、electron/quickNotes.ts；移动 mobile/data/searchIndex.ts、quickNotesSearch.ts（**4 个消费方、4 套账本**） |
| FTS 索引/账本 | **不在 core**：桌面 schemaInit + searchRepository / quickNotes；移动 schema.ts + searchIndex + quickNotesSearch | — |
| 正文→检索文本 | core/noteSearchText.ts · searchTextForKind（按 kind 分派 doc/usheet/bitable/board/ink） | 桌面 store.searchTextFor；移动 searchIndex.plainForRow |
| 小记内容模型 | quickNoteModel：normalize / validate / serialize / sameContent / buildQuickNoteImageFiles / rewriteQuickNoteAssetScope | 桌面 electron/quickNotes.ts、quickNoteConversion；移动 quickNotesRepository、v3/mobileDeviceStore |
| 小记标签 | quickNoteTags：实体校验、派生 ID（t_ + sha256/16）、目录索引、筛选、LWW 合并、目录等价 | 桌面标签 store / 管理页；移动 tagService / sheet；两端筛选 UI |
| 排序/筛选/搜索 | quickNoteSort（四档+存储键+旧值映射）、quickNoteFilters（时间档）、quickNoteTypeFilter（图片/附件）、quickNoteSearch（已加载字段过滤） | 桌面 QuickNotesWorkspace；移动 useQuickNoteListModel |
| AI 设置/消息块 | aiProviders：AI_PROVIDERS(6)、normalizeAiSettings / mergeAiSettings / aiSettingsView / aiSettingsReady、validateAiBaseUrl / aiBaseUrlChangeError、AiChatMessage / AiContentPart / AiAssetRef | 桌面 registerAi、settingsRepository、electron/ai/*、渲染层 AI 面板；移动**仅用类型**（aiChatStore） |
| AI 错误/预算/语料/出网 | aiErrors（15 类 + retryable + 中文）、aiChatMessages.assertMessages、aiCorpus、aiNetwork.aiCanTouchNetwork | 桌面 aiClient；移动 aiChatStore、aiSession、SettingsDrawer |
| 云同步状态 | cloudState：cloudStateOf / canTouchNetwork / isCloudActive / cloudStateHint / CLOUD_PRIVACY_NOTICE | 两端设置页与同步门（AGENTS §3#20 指定唯一判据） |
| 互斥域 | maintenancePolicy：4 张 OPS 表 + classifyOp / lockDomainOf（未知操作抛错） | 移动 bridge/context.ts（唯一运行态消费方）；桌面用源码窗口护栏 electron/maintenanceQueueScope.test.ts |
| 正文路径 | noteBodyPaths：5 种 kind 的目录/扩展名 + 小记/历史/草稿路径 | **仅移动**（mobile/data/noteBodies.ts）；桌面 store.notePath 另实现 |
| 命名/类型/格式化 | assetNaming、fileCard、dateFormat、logFormat、noteInfo、noteKind | 两端 |
| 保存判脏 | noteSaveDecision.hasNoteSaveChanges（title+content） | 桌面 noteContentRepository、移动 noteRepository（真·两端单一来源） |
| 缺正文可恢复性 | missingBody：missingBodyRecovery / missingQuickNoteRecovery | 桌面 store.listMissingBodies、quickNotes.listMissingQuickNotes |

### 1.3 度量与观察

- **导出面 ≠ 契约面**：本批 324 个导出里，用「\b符号\b 在 src/electron/scripts 非测试文件出现」粗扫，**133 个在生产代码零引用**。多数是「仅供测试的常量/类型」（可接受，但应标 @test-only）；彻底死导出如 fileCard 的 scanFileCards / encodeCardValue / parseFileCardValue / buildDoneFileCardValue、quickNoteKeys 全量、quickNoteReconcile 全量、syncUtils 的 v2 清单块。
- **「单一来源」有成色差异**：真·单源 = noteSaveDecision、cloudState、search/segment、noteKind、dateFormat、logFormat、assetNaming 的命名/MIME/引用提取；名义单源 = maintenancePolicy（桌面未消费）、noteBodyPaths（桌面未消费）、quickNoteKeys（已死）、aiProviders（单端）。
- **依赖方向有一处例外**：8 个 core 文件 import type ... from "../lib/types.js"（core/types.ts 只是 re-export hub）。即**领域类型定义在渲染层 src/lib/types.ts（399 行，含 SyncProgress / DraftJournalEntry 这类 UI 概念）**，core 反向依赖它，边界门禁把该路径写进白名单。
- **测试密度不低但分布偏**：本批 1,974 行测试 / 3,980 行生产（0.50），但有 5 个「判据型」模块零专属测试或只被源码字符串断言覆盖（§5.1）。

### 1.4 已定稿决策（**不作为问题上报**，仅登记出处）

| 决策 | 出处 |
|---|---|
| core 里放 UI 文案：cloudStateHint、CLOUD_PRIVACY_NOTICE（「云端不加密」必须常驻眼前）、aiNetworkHint（移动端要一行可见说明） | cloudState.ts / aiNetwork.ts 头注释（用户 261006 / 261009 / 261023 D1） |
| repositoryCapabilities 用「矩阵 + 存在性对账」而非 TS 接口（签名强行统一即扭曲） | 文件头注释（用户 Q6 / C2-3，261016） |
| 小记排序只存本机、不进 S3；旧两值 updated/created 做键映射 | quickNoteSort.ts 头注释（261015） |
| noteInfo 的体积口径是第三种，与 formatBytes / formatBytesCompact 不合并 | noteInfo.ts 头注释（C1-7 / B1 261016） |
| AI 出网判据与云同步解耦（aiCanTouchNetwork 独立于 canTouchNetwork） | aiNetwork.ts（261023 D1）、AGENTS §3#20 |
| 小记标签「目录 + 关联表」双表、正文去标签、ID 由名称派生 | quickNoteTags.ts 头注释（261016 方案 B） |
| 不为旧数据写迁移：QuickNoteModelError 对 version≠3 直接拒绝、未知 kind 回落 doc | AGENTS §3#7；noteKind.ts 注释 |

---

## 2. 问题清单

### CORE-01 [P1] 同步落盘后索引**在被打开前**停在旧正文（打开文档会自愈；261028 修正标题与判据）

**证据**
- electron/searchRepository.ts · upsert(noteId, title, body: string | null)：body ?? this.readCachedBody(noteId)；readCachedBody 依次取 readNoteCaches().plain（= notes.text_cache）→ derivePlainText。而 store.derivePlainText 在 text_cache != null 时**直接返回缓存**，不回读正文。
- electron/noteContentRepository.ts · save(...)：caches 缺省时（第 68 行）upsertSearch(noteId, title, null) —— 即「正文已换、索引保留旧缓存」。
- 谁不带缓存调用：electron/s3v3/desktopStoreAdapter.ts · saveState（第 210 行 store.saveNote(n.id, n.title, content)，**他端正文落盘的唯一路径**）、src/lib/services.ts（浏览器端保存）。
- 账本 hash 是对**旧缓存**算的（upsert 内 hashText(nextBody)）⇒ 记成「已索引」；启动 ensureIndex 只比条数（CORE-13），也不会修。
- **后置触发（261028 复核补充，原审计漏了）**：`src/hooks/useDesktopHandlers.ts · handleEditorReady` 在**打开文档**时用内核 `getDocument("text/markdown"/"text/plain")` 现算，调 `native.updateNoteCaches` → `store.updateNoteCaches` **同时**写 cache 并 `searchRepository.upsert(id, title, plain)` ⇒ **文档被打开过就会自愈**。原审计说"打开也修不了"只对 `ensureNoteCaches` 成立（它是锁定/只读兜底，非空短路）——这是两条不同路径。
- 真正的缺口因此收窄为：**同步写入后、在本机从未打开过的文档**，搜索仍用旧正文（直到打开一次；且启动 `ensureIndex` 只比条数，不修）。
- 对照移动端（同语义做对了）：src/mobile/data/noteRepository.ts · saveNote 里 const bodyPlain = plain ?? searchTextForKind(kind, content).plain ?? "" —— 正文变了就一定重算缓存。

**影响**
多端场景最普通的一条链路（手机改一段 → 桌面同步 → **不打开该文档**直接在桌面搜索）拿到的是**旧正文**：搜新词搜不到、搜旧词还能命中并给出旧摘要；打开过一次即恢复。资源页「缺正文」的 hasTextCache 也基于同一份缓存。属于「用户看到的搜索结果与磁盘正文不一致」，不报错、不崩溃，但依赖"打开"才自愈。

**建议**
- 保守（推荐，S）：**同步落盘时带上派生缓存**——`desktopStoreAdapter.saveState` 在 contentChanged 时把 `store.searchTextFor(id, content)` 传给 `store.saveNote(..., caches)`（只对变更篇付派生成本，不打开也新）；或留空并在同步结束后 idle 后台 backfill（移动端已有 `backfillTextCache` 同构）。
- 激进（S/M）：删掉 body: string | null 的「null = 保留旧索引」语义，改成 upsert(noteId, title, plain) 单一形态；plain 一律由 core 的 searchTextForKind 从正文派生（两端同一判据）。
- 回归（必须）：新增 electron/searchRepository.freshness.test.ts：建文档 → 索引 → saveNote **不传 caches** → searchNotes 必须命中新词（修前红、修后绿）。

**成本** S（生产 10–20 行 + 1 个回归）。

---

### CORE-02 [P1] 查询构造器会产出 FTS5 语法错：全大写 AND/OR/NOT 抛错，前端静默吞成「无结果」

**证据**
- src/core/search/query.ts · buildMatchExpression：单 token 且 length>=2 且非 CJK ⇒ parts.push(tokens[0] + "*")，**未规避 FTS5 保留字**。
- 实测（python3 sqlite3，内存库，fts5(title, body, tokenize='unicode61')）：
  - AND* / OR* / NOT* → fts5: syntax error near "AND"（分别报 AND / OR / NOT）；
  - and* / And* / or* / NoT* / NEAR* → 正常。
  ⇒ 触发条件 = **整词全大写**的 and/or/not（AND 笔记、NOT 这类），不是大小写无关。
- 四个消费方同一入口：electron/searchRepository.ts、electron/quickNotes.ts、src/mobile/data/searchIndex.ts、src/mobile/data/quickNotesSearch.ts。
- 桌面 UI 吞异常：src/components/app/SearchPanel.tsx 的 catch 分支直接 setResults([])；移动 bridge.searchNotes 直接 reject（SearchSheet 无重试提示）。
- 单测把 bug 钉成契约：src/core/search/query.test.ts 第 27 行 expect(buildMatchExpression('" OR "')).toBe("OR*") —— 断言的正是 FTS5 拒绝的形态。

**影响**
代码/技术类笔记里 NOT / AND / OR 是常见检索词；命中时用户看到「没有结果」而不是「查询不合法」。四个搜索入口同时存在，且是**静默错误**，比报错更难排查。

**建议**
- 保守（推荐，S）：保留前缀语义但**保留字小写化** —— if (/^(and|or|not)$/i.test(token)) token = token.toLowerCase()（实测 and* 可用且仍能前缀命中 android）；或对保留字改用引号短语（放弃前缀）。
- 激进（S）：不再手拼 MATCH 表达式，改成「token 数组 + 每项 {quote|prefix} 标记」传给两端，由 core 统一渲染（顺手把 escapeLike 的 title 分支收进来）。
- 护栏（必须）：query.test.ts 改成**行为断言** —— 用真 FTS5（桌面测试已有 sqlite 夹具）跑每条生成的表达式，AND/and/OR/NOT/Near/' OR ' 全部不得抛错；纯函数侧加「不得产出 ^(AND|OR|NOT)\*」的断言。

**成本** S。

---

### CORE-03 [P1] 小记 S3 key 布局两份实现，自称「唯一来源」的那份已死

**证据**
- src/core/quickNoteKeys.ts（69 行，7 个导出 + quickNoteKeys(prefix)）：头注释写「小记 S3 对象布局的**唯一来源**（B1，261016）」「两处各写一份 ⇒ 单条推送会与整轮同步指向不同的对象」—— 正是 261016 的事故记录。
- 实际引用：**只有 quickNoteKeys.test.ts**（git grep 除自身与测试外 0 命中）。quickNoteObjectKeyRel / quickNoteAssetKeyRel / quickNoteManifestKeyRel / quickNoteKeys 在生产代码全部零引用。
- v3 真正的 key 在 src/core/s3v3Keys.ts：quickNoteBodyKey(contentHash) → quick-notes/objects/{hash}.qnote、quickNoteAssetKey(id, filename)、quickNotePurgePrefixes(id)；两端（desktop / mobile v3）都走它。
- 两份不等价：死的那份含 quick-notes/manifests/latest.json（v2 单文件清单），v3 已无该对象。

**影响**
这是**主动误导型死代码**：注释最强、位置最「该改」、测试还是绿的。接手者按它改布局 ⇒ 改了不生效；按它构造 key ⇒ 对象写到 v3 永不读取的位置（重复上传、GC 误判孤儿）。危险等级高于普通死代码，因为它伪装成唯一来源。

**建议**
- 保守（推荐，S）：删除 quickNoteKeys.ts 与其测试；在 s3v3Keys.ts 的 quickNote* 段补注释「小记对象布局的唯一来源在此；曾有一份 core/quickNoteKeys.ts 是 v2 残留，已删」。
- 激进（S）：不建议保留 re-export 过渡 —— 本项目无外部消费者，AGENTS §3#7 允许直接删。

**成本** S（删 115 行含测试 + 1 段注释）。

---

### CORE-04 [P1] aiProviders 自述「两端共用」，实际只有桌面用；移动端 AI 设置自成一类且缺 baseUrl 准入

**证据**
- src/core/aiProviders.ts 头注释：「桌面（Electron 主进程）与**将来的移动端**共用同一份事实来源——有哪些供应商、默认值是什么、配置怎么规整/脱敏」。
- 事实：src/mobile/** 对 aiProviders 的引用 = **0**（移动只 import aiErrors / aiChatMessages / aiCorpus；AiChatMessage 类型经 aiChatMessages 间接带入）。
- 移动端设置全在原生：src/mobile/bridge/ai.ts · aiGetSettings / aiSaveSettings 仅转发 AiChat.getSettings() / saveSettings(patch)；android/.../AiChatPlugin.kt：DEFAULT_BASE_URL = https://api.deepseek.com/v1、DEFAULT_MODEL = deepseek-chat、DEFAULT_TEMPERATURE = 0.7，saveSettings 只做 getString("baseUrl") → trim()。
- 与桌面现状的差异：① 默认模型 deepseek-chat（core 目录里是 deepseek-flash）；② 无 provider 目录/切换、无 reasoningEffort / thinking；③ temperature 无 clamp（core 是 0–2）；④ **没有 aiBaseUrlChangeError 的等价物** —— 改 baseUrl 不会要求重填 Key，已存 Key 会被发往新地址（这正是 A 批修的 SEC-01，桌面侧已在 registerAi 守门）。
- 另：aiErrors.KIND_BY_CODE 自述「码表与 android/.../AiChatPlugin.kt 一致」，Kotlin 侧确有独立的 status → code 映射，两端无任何自动比对。

**影响**
① 能力/默认值两端不同，改 AI_PROVIDERS 默认值时移动端不跟随；② **安全口径只在桌面成立**：移动端 WebView 可改 baseUrl 而复用原生已存 Key（同 SEC-01 的攻击面，换到移动端）；③ 两套「消息块/上限」解析（core assertMessages + Kotlin 解析器，图片上限 10 只靠数字巧合一致）。

**建议**
- 保守（推荐，S/M）：① 改头注释为现状（「桌面事实来源；移动端原生自管，差异见 docs/MOBILE-AI.md」），别让注释继续许诺不存在的东西；② 在 AiChatPlugin.saveSettings 补 ~20 行门槛：改 baseUrl 且未同时给出 apiKey ⇒ 拒绝（文案对齐 aiBaseUrlChangeError）；③ 加源码比对护栏（脚本读 Kotlin 常量 vs AI_PROVIDERS / KIND_BY_CODE）。
- 激进（M/L）：移动端设置改走 core（原生只存 Key、只回 hasKey/keyTail），一次消掉两套模型；前置是 MOBILE-AI.md 通道契约重写，**不建议本轮做**。

**成本** S（注释 + Kotlin 门槛）/ L（迁移）。

---

### CORE-05 [P2] core 里约 800 行 manifest v2 残留；MANIFEST_VERSION 还被当成「协议版本」显示给用户

**证据**
- 无生产引用的 v2 代码（复核与 05-sync-data.md §3 Del-5 一致，并补了它没列的）：
  - src/core/syncUtils.ts：MANIFEST_VERSION（仅移动设置页与 appInfo 引用，见下）、parseLakeManifest、validateManifest（60+ 行逐字段校验）、manifestFromWire / manifestNoteToWire / manifestToWire、syncSnapshot、objectKey（v2 objects/{id}-{hash}.lake）、collectManifestRefs；
  - src/core/syncDecisions.ts：decideFolderPurge / decideLocalTombstone / decideMetaApply / decideTombstoneYield / buildUploadEntry / buildTombstoneEntry / computeBookkeeping（**仅测试引用**）；
  - src/core/manifestTypes.ts（80 行，无外部引用）、src/core/syncEngineTypes.ts 的 SyncConfig / S3Store / SyncDbPort / SyncReport（v2 端口，仅移动类型引用）。
- **用户可见的错口径**：src/mobile/settings/SettingsDrawer.tsx 渲染「协议：manifest v{appInfo?.protocolVersion ?? MANIFEST_VERSION}」；src/mobile/native/appInfoPort.ts 里 PROTOCOL_VERSION = String(MANIFEST_VERSION) ⇒ v3 产品的设置页写着 **manifest v2**。
- 测试绿灯假象：src/core/syncUtils.test.ts 覆盖 parseLakeManifest / validateManifest / objectKey / mimeTypeFor —— 全部是死代码，绿得毫无意义。

**影响**
① 接手者按 manifest 思维改 v3（05 SD-11「协议文档仍是 V2」的代码版孪生）；② 用户被告知错误协议版本，排障时误导；③ 死代码里还藏着一份 mimeTypeFor 重复实现（与 assetNaming.mimeTypeForFilename 重复且只有 7 个扩展名，生产零引用）。

**建议**
- 保守（推荐，S）：与 05 Del-5 同批删（含测试）；protocolVersion 改成 v3 事实（或直接删该行文案）。
- 激进：syncUtils.ts 只保留仍在用的 sha256Hex / extnameLikeNode / validateS3Settings / normalizeEndpoint / isNoSuchKey / errorMessage / chunkArray / assertSafeKey，文件 296 → ~120 行。
- **不要**顺手删 syncModes / cloudState —— 它们仍是一线判据。

**成本** S。

---

### CORE-06 [P2] setSha256HexImpl 的唯一调用点在零生产引用的模块 ⇒ 桌面一直跑纯 JS SHA-256；另有 7 处直连 crypto

**证据**
- src/core/sha256Sync.ts 注释：「注入自定义实现（桌面端在 adapter 注入 node:crypto，吞吐高于纯 JS **10-20 倍**）」。
- 全仓唯一调用点：electron/syncAdapters.ts。而该模块**只被测试引用**（store.test.ts、syncApplyGuard.test.ts），生产无人 import ⇒ 注入从不发生。
- 于是 src/core/syncUtils.sha256Hex（所有 v3 正文 hash 都走它）在桌面跑纯 JS：desktopStoreAdapter.saveState（hashCache 对每个变更正文算 hash）、s3v3Index、s3v3AssetBackfill、quickNotesRecovery。
- 同时 electron 有 7 处**绕过**同一工具直连 crypto.createHash("sha256")：store.ts、historyLifecycle.ts、diagnostics.ts、syncReconciliation.ts、quickNotes.ts（hash helper）、desktopSync.ts。
- ID 侧同样三套：quickNoteModel.randomUUID（带 Math.random 兜底）、s3v3Engine 的 globalThis.crypto.randomUUID、electron 的 crypto.randomUUID。

**影响**
① 大库/弱机上的正文 hash 慢一个数量级（注释自述 10-20×），而 v4 的 apply/transfer 会**增加** hash 次数（RFC §7 性能预算按 native 速度估）；② 「等价性由 sha256Sync.test.ts 保证」只保证纯 JS 与 node 输出一致，不保证「生产到底注入了哪份」——注释与事实相反是典型误导；③ 两套 UUID 让「同输入同 id」类断言无法统一。

**建议**
- 保守（推荐，S）：在 electron/main.ts 启动处（app.ready 之前）调用一次 setSha256HexImpl(createHash impl)，删掉 syncAdapters.ts 里的副作用；加一条断言（源码或运行时）「桌面进程内 sha256Sync 不是纯 JS 实现」。
- 激进（S/M）：core 出单一工具 hash.hex(bytes) + newId()，electron 的 7 处直连改调它；sha256Sync 的注入改成显式依赖（构造参数）而非模块级可变单例（多实例/测试并行下的隐患）。
- 注：移动端跑纯 JS 是**预期**（无 node），这条只针对桌面。

**成本** S。

---

### CORE-07 [P2] fileKindOf 同名两套分类：同一文件在「图标」与「预览分流」得到不同类型

**证据**
- src/core/assetNaming.ts · fileKindOf → AssetFileKind（image/pdf/doc/sheet/slide/archive/audio/video/code/text/file，11 类，扩展名表 ~120 项）。消费方：features/bitable/FileKindIcon.tsx、FileBadgeIcon.tsx（AGENTS §3#14 指定为附件/图片展示的单一来源）。
- src/core/fileCard.ts · fileKindOf → AttachmentKind（image/pdf/audio/video/document/archive/other，7 类，表 ~90 项）。消费方：features/attachment/attachmentPreviewController.ts、openAssetEntry.ts。
- 实际分歧：x.ts → code / **other**；x.docx → doc / **document**；x.svg → image（一致）；未知扩展名 → file / other。
- 两个同名函数同处 src/core，import { fileKindOf } 的自动补全无法区分。

**影响**
附件列表里显示「代码文件」图标的 .ts，点开预览却按「其他」处理（可能无预览/走系统打开）；新增扩展名要改两处，漏一处就是「图标对、行为错」。属 AGENTS §3#14「同一交互语义只能有一套」的判据层面违反。

**建议**
- 保守（推荐，S）：fileCard 侧改成派生 —— attachmentKindOf(name) = map(fileKindOf(name))，删 KIND_BY_EXT 表；保留两个函数名以不动调用方。
- 激进（S）：只保留 assetNaming.fileKindOf，AttachmentKind 与 fileCard.fileKindOf 删除，调用方改用 11 类 + 一个 isPreviewableKind()。

**成本** S。

---

### CORE-08 [P2] 跨端「契约」有五种载体，其中一种是纯诱饵（core/services.ts 零生产调用）

**证据**

| 载体 | 行数 | 运行态消费方 | 说明 |
|---|---|---|---|
| core/ports.ts | 51 | 移动 4 处（SecretStore / CachePort / AppInfoPort） | 纯接口 |
| core/services.ts | 150 | **0**（只被 src/lib/services.ts 用） | DTO + 5 个 Service 接口 |
| src/lib/services.ts | 111（+121 测试） | **0**（createNativeServices 无生产调用） | 桌面适配器 |
| core/repositoryCapabilities.ts | 94 | 测试（存在性对账） | 用户 Q6 定稿 |
| ~~core/treeBehaviorContract.ts / resourceBehaviorContract.ts~~ **261028 已移到 `src/testing/`** | 91 | 两端各跑一遍 vitest | 行为契约装置（test-only，不属于 core 生产边界） |
| electron/s3v3/deviceConformance.ts | 496 | 测试 | 设备存储对账（v4 M3 将替换） |

**影响**
services.ts 看起来是「最正式的那份跨端服务契约」（NoteService / QuickNoteService / TrashService / AssetService / SyncService），实际没人调；真正在跑的是 src/lib/native.ts（143 方法）+ 移动 bridge + lakeNativeContract。新人按它实现新能力会白做一轮；它也解释了为什么 IPC 面「三处镜像」始终没有收敛点。

**建议**
- 保守（推荐，S）：删 core/services.ts + src/lib/services.ts + src/lib/services.test.ts（281 行代码 + 121 行测试）；在 docs/ARCHITECTURE.md 加一张「契约载体分工」表：行为契约（管语义）／存在性对账（管缺口）／端口接口（管注入）／IPC 面（管方法），并写明**不要再新增「服务聚合接口」这一层**。
- 激进：其余四种不动；deviceConformance 留给 v4 M3 删（RFC §9.2）。

**成本** S。

---

### CORE-09 [P2] 三个「小判据」各有多份实现（路径段 / 回收站 id / 错误描述）

**证据**
1. isSafePathSegment：src/core/storeUtils.ts（导出，electron 大量使用，含 noteBodyPaths）vs src/core/quickNoteModel.ts 的私有 isSafeSegment（逻辑逐字相同）。后者用于校验**远端内容 JSON 里的 id / filename**（validateQuickNoteContent）。
2. TRASH_NOTEBOOK_ID：src/core/syncDecisions.ts（core，s3v3Engine 用）与 electron/store.ts（桌面，DB 初始化/查询用）；core 那份注释写「对齐桌面 electron/store.ts:33」，实际已漂到 56 行。两个常量都是字面量 "notebook-trash"，**无任何测试断言二者相等**。
3. describeError：src/core/logFormat.ts vs src/features/editor/lockedTextCard.tsx（同逻辑私有副本，渲染层）。

**影响**
① 路径段判据是**安全判据**（防 ../、防跨目录），两份实现只要有一份被加固（未来加 NUL/控制字符/Windows 保留名），另一份就静默留着旧口径，改的人不会知道；② 回收站 id 若哪天改成 workspace 维度，core 与桌面会指向不同节点，表现为「删除不传播」；③ 错误描述副本让日志格式在报错路径上不一致（排查时 grep 不到）。

**建议**
- 保守（推荐，S）：quickNoteModel 改 import isSafePathSegment；TRASH_NOTEBOOK_ID 收敛为一个（store re-export core 的，或反之）+ 一条相等断言；lockedTextCard 改 import core。
- 激进：TRASH_NOTEBOOK_ID 进 core/ids.ts（连同 workspace id、默认笔记本 id），一次收口。

**成本** S。

---

### CORE-10 [P2] 纯函数不纯：时钟 / 随机 / locale；core 还 import vitest 与 ../lib/types.js

**证据**
- **时钟**：src/core/storeUtils.ts · selectHistoryDrops 内部 const now = Date.now()（不可注入，测试只能造相对时间）；dateFormat.formatListTime(now = new Date())、quickNoteFilters.matchesQuickNoteTimeFilter(now = new Date())、assetNaming.buildAssetFilename(now = Date.now()) 都是「默认参数注入」，**可用但调用方普遍不传**（grep 无一处传 now）。
- **随机**：quickNoteModel.randomUUID / assetNaming.randomHex4 都带 Math.random() 兜底。资产文件名 {13ts}_{8hex}.{ext} 若走兜底，碰撞会**静默覆盖**已有资产（同名同路径）。
- **locale**：search/snippet.ts、quickNoteSearch.ts、treeIndex.ts 用 toLocaleLowerCase()（无参数 = 宿主 locale）。土耳其语等 locale 下 I→ı，与 FTS5 unicode61 的折叠不一致 ⇒ 摘要 <mark> 位置与命中词可能对不上；也让快照式断言依赖运行环境。
- **core 里的测试装置**：treeBehaviorContract.ts / resourceBehaviorContract.ts 是**非测试 .ts** 却 import { describe, expect, it } from "vitest"；边界门禁显式为 spec === "vitest" 开了白名单。**261028 晚已修**：两个文件移到 `src/testing/` ⇒ core 非测试文件 import vitest = 0（129→127 文件）。
- **依赖方向例外**：8 个 core 文件 import type ... from "../lib/types.js"（门禁白名单）。领域类型定义在渲染层 src/lib/types.ts，core 反向依赖，其中 SyncProgress / DraftJournalEntry 是纯 UI 概念。
- **门禁本身是行级的**：import {\n  x\n} from "node:fs" 这种多行 import，from 所在行没有 import 关键字 ⇒ **不会被拦**（当前无实例，属护栏缺口）。

**影响**
时间/locale 依赖让「同一输入必同输出」在测试与跨端复现上不成立（FTS 摘要、历史清理策略）；Math.random 兜底把「安全文件名唯一性」变成概率问题；vitest 进 core 的 .ts 让误 import 时把测试框架打进 bundle。

**建议**
- 保守（推荐，S）：① selectHistoryDrops(createdAtList, config, nowMs = Date.now()) 并让调用方显式传；② 搜索链路的 toLocaleLowerCase() 全改 toLowerCase()（4 处 + 一条「摘要与索引同折叠」用例）；③ 两个契约装置改名 *.contract.ts 并移出 src/core（或加 // @vitest-only 白名单注释）；④ 门禁改整文件正则（或 TS AST）以覆盖多行 import。
- 激进（M）：core/types.ts 升为领域类型的**定义处**，src/lib/types.ts 改 re-export（一次性改 import 约 40 处，机械但面广）——若本轮不动，至少在 types.ts 注释写明这是已知方向例外。

**成本** S（①②④）/ M（③ 搬家 / 类型反转）。

---

### CORE-11 [P2] 展示文案被测试当作契约；AI 错误码表跨语言双写无护栏

**证据**
- 文案在 core（**多数是已定稿，不算问题**）：aiErrors.MESSAGE（15 条中文）、cloudStateHint / CLOUD_PRIVACY_NOTICE、aiNetworkHint、noteInfo.SYNC_STATE_LABEL、quickNoteTags.UNTAGGED_FILTER_LABEL。
- **真问题**：src/testing/resourceBehaviorContract.ts（261028 从 `src/core/` 移出）用中文文案断言行为 —— rejects.toThrow(/附件超过 100 MiB 协议上限/)、/图片为空或超过 25 MiB/。这两条同时被桌面与移动的契约测试执行 ⇒ 改一个词（哪怕行为不变）两端契约同时红，且红的原因与「行为」无关。而已有结构化错误：storeErrors.AppError.kind（NotFound / InvalidInput / NotConfigured / Conflict / NetworkTimeout / Cancelled）+ QuickNoteModelError.kind = "InvalidInput"。
- 码表双写：aiErrors.KIND_BY_CODE 注释「码表与 android/.../AiChatPlugin.kt 一致」；Kotlin 侧独立实现 status → code（401/403/404/408/429/5xx/4xx），无任何自动比对（不像 ipcChannelParity.test.ts 那样把三处钉住）。

**影响**
① 文案即契约 ⇒ 产品改词 = 两端门禁红，团队会学会「别动文案」，与「文案属展示层」的本意相反；② Kotlin/TS 码表漂移时，移动端会出现 core 不认识的 code（落 unknown = 「未知错误」），而没有测试会红。

**建议**
- 保守（推荐，S）：① 契约测试改断言 AppError.kind / code（或 QuickNoteModelError.kind），文案另用一条快照用例；② 加 scripts/check-ai-error-codes.mjs：解析 Kotlin 的 status → "code" 分支与 aiErrors.kindFromStatus 比对，顺带断言 Kotlin DEFAULT_MODEL 与 AI_PROVIDERS 默认一致（或显式白名单），挂到 check:core 旁。
- 激进（M）：Kotlin 只回 status + detail，**分类与文案全部归 core**（aiErrorInfoFromCode 已支持 status 输入，改动只在原生侧删映射）。

**成本** S。

---

### CORE-12 [P2] quickNoteSyncTypes 保活了一个 30+ 方法的死端口；移动端 369 行实现只剩「建表」在用

**证据**
- src/core/quickNoteSyncTypes.ts（69 行）头注释自述「旧 quick-notes 同步通道的类型残留（仅类型，无运行时实现）… **不要**在此文件加运行时逻辑」。
- QuickNotesSyncDbPort 有 30+ 方法（applyRemoteQuickNote / listDeletedQuickNotes / baseHash / markSynced / mergeRemoteQuickNoteTags…）；实现方 src/mobile/data/quickNotesDbPort.ts（**369 行**）。唯一存活用法：src/mobile/data/schema.ts 引 buildQuickNotesSyncSchemaStatements（即那些方法服务的表仍会被建出来）。
- QuickNotePushOutcome 仍被 5 处 type-only 引用（lib/native.ts、electron/ipc/registerQuickNotes.ts、electron/s3v3/desktopSync.ts、electron/syncEngineController.ts、mobile/bridge/quickNotes.ts），其中 "full-sync" 分支是 v2 遗留（v3 起「保存并同步」= 整轮同步兜底）。

**影响**
① 移动端为一个死端口建表/维护 DDL，schema 变大、冷启动 DDL 变长（移动端 DDL 是成本敏感项）；② 类型面让「单条推送」看起来还存在，容易有人去实现它（AGENTS §4 明确禁止）；③ 删除时容易被「有 5 个引用」吓退，实际全是 type-only。

**建议**
- 保守（推荐，S）：删 QuickNotesSyncDbPort 与 QuickNoteSyncItemImage；把 buildQuickNotesSyncSchemaStatements 移到 src/mobile/data/schema.ts（它本来就该在那里）；QuickNotePushOutcome 收敛为 {status:"pushed"…} | {status:"not-found"}（删 full-sync 分支与 QuickNotesSyncResult）。
- 激进（M）：连 quickNotesDbPort.ts 里的死方法一起删（保留建表 + 真正被 v3 调用的少数几个），需过移动门禁（check:mobileui + 设置/小记 6 态）。

**成本** S（类型收敛）/ M（删实现）。

---

### CORE-13 [P2] 搜索账本四份实现、两套同名不同列 schema；桌面的「一致性」定义是 COUNT

**证据**
- 桌面 Lake：electron/schemaInit.ts → search_index(note_id, fts_rowid, title_hash, body_hash, indexed_at)；electron/searchRepository.ensureIndex **只比 ledgerCount() === activeNoteCount()**，不等就 rebuild()（清空后全量重插，text_cache 缺失时逐篇 derivePlainText 读盘）。
- 桌面小记：electron/quickNotes.ts 另一张 quick_notes_search_index(..., text_hash, text_cache, tags, ...)；ensureSearchIndex 同样只比 COUNT，不等就 rebuildSearchIndex —— **逐个 listQuickNotes() 读全部小记正文**。
- 移动 Lake：src/mobile/data/schema.ts 同名表但多 title + raw_hash 两列；searchIndex.reconcileIndex 是**逐篇 hash 对账** + 每批 20 条 executeSet（261026 为 Android OOM 专门调过）。
- 移动小记：src/mobile/data/quickNotesSearch.ts 第四份。
- 同一句 INSERT INTO notes_fts(rowid,title,body) 在 4 个文件各写一遍；tokenize='unicode61' 这个**与 core 分词器强耦合**的参数在 4 处 DDL + 2 处测试夹具各写一遍。

**影响**
① 「一致」被定义成「条数相等」，删一篇 + 加一篇（数量不变）时索引错位不会被发现 —— 虽成对事务让这种情况罕见，但把判据放在计数而非集合/内容上是脆弱口径（移动端已证明可以逐篇 hash）；② 桌面启动只 COUNT，一旦不等就**同步重建全库**（大库 = 启动卡住 + 逐篇读盘），移动端则是增量对账；③ 同名表两端列不同，任何「共享 DDL / 共享对账」的尝试都会立刻崩，而这正是 v4「单实现」方向的胃口。

**建议**
- 保守（推荐，S）：① 桌面 ensureIndex 判据从 COUNT 改**集合判据**（两条 SQL：账本有而活跃集没有 / 活跃集有而账本没有 ⇒ 再重建），全量重建留作兜底；② 桌面小记 rebuildSearchIndex 改成「只重建缺失/变更的条目」（照搬移动端 keyset + hash 对账写法，**逻辑已在移动端验证过**）；③ 抽 core/search/schema.ts 常量（表名/列名/tokenize）供 4 处 DDL 与夹具引用，只做「字符串单一来源」。
- 激进（M）：把「账本对账」抽成 core/search/ledger.ts 的纯函数（输入 = 活跃行 + 账本行 + 已派生 plain，输出 = 要删/要写的 key 列表），两端只实现 SQL 执行 —— v4「plan/apply」思路在搜索域的小复制，风险可控。
- **不要**为搜索引入第二套分词/索引库（AGENTS §3#22 四问）。

**成本** S（①②③）/ M（纯函数化）。

---

### CORE-14 [P2] 同一份 SyncSettings 的归一有三处实现，回退策略互相矛盾；interval 判据 core 有、桌面不用

**证据**
- electron/ipc/registerSync.ts：非法 autoMode ⇒ **抛 IpcInputError**（「同步模式格式无效」）。
- electron/settingsRepository.ts：非法 ⇒ **回落 def.autoMode**（= manual）。
- src/mobile/bridge/context.ts：非 interval/onOpenClose ⇒ **一律 manual**；同文件 enabled: parsed.enabled !== false（缺省即 true，与桌面「默认 = 是否已配置 S3」，261022 定稿不同口径）。
- interval 是否该触发自动同步：core syncModes.shouldSyncOnInterval（判据 + 注释「与桌面 electron/main.ts 一致」）vs electron/main.ts **内联同一条件**（!cfg.enabled || cfg.autoMode !== "interval" || cfg.autoIntervalMinutes < 1）。

**影响**
同一份残缺/旧版设置在三端得到三种状态；「默认值 = 是否已配置 S3」这条 261022 定稿只在各自实现里成立，改一处不会同步另一处。桌面 interval 判据与 core 双写，是「core 有单一来源但没人用」的典型（与 noteBodyPaths / maintenancePolicy 同型）。

**建议**
- 保守（推荐，S）：core 加 normalizeSyncSettings(raw, defaults)，三处调用；桌面 startSyncTimers 改调 shouldSyncOnInterval。
- 激进（M）：把「默认 enabled = hasS3Settings」也做成 core 纯函数（输入 = 是否存过 S3 行 + 是否显式存过），两端驱动只提供布尔。

**成本** S。

---

## 3. 删除 / 合并清单

> 原则：删除不损能力；每条给证据与前置。批次列标注与 05 Del-5 / 07 §15 的关系。

| # | 对象 | 行数 | 证据 | 收益 | 前置/风险 | 批次 |
|---|---|---|---|---|---|---|
| D-1 | src/core/quickNoteKeys.ts + 测试 | 69 + 46 | 全量零生产引用；v3 key 在 s3v3Keys | 去掉「伪装成唯一来源」的陷阱 | 无（grep 已核） | 独立，S |
| D-2 | src/core/quickNoteReconcile.ts + 测试 | 29 + 17 | reconcileQuickNote 零生产引用（v3 用 planQuickNotesMerge） | 少一份「看起来在跑」的旧决策 | 无 | 独立，S |
| D-3 | src/core/services.ts + src/lib/services.ts + 测试 | 150 + 111 + 121 | createNativeServices 零生产调用 | 去掉最大的架构诱饵 | 无 | 独立，S |
| D-4 | syncUtils 的 v2 清单块（MANIFEST_VERSION / parseLakeManifest / validateManifest / manifest*Wire / syncSnapshot / objectKey / collectManifestRefs / mimeTypeFor） | ≈180 | 无生产引用（collectManifestRefs 只被死模块 gcDecisions 用） | core 少 12% 的同步残留 | 与 D-5 同批；测试同步删 | 05 Del-5 + 07 §15 的 M5，S |
| D-5 | syncDecisions 的 7 个 legacy 决策 + 相关类型 | ≈68 | 仅测试引用（复核与 05 一致） | 少一份「两种删除语义」 | **保留** TRASH_NOTEBOOK_ID / rowToLocalState / isGoneNote | 同上，S |
| D-6 | src/core/manifestTypes.ts | 80 | 仅 core 内部（D-4/D-5 删后归零） | — | 依赖 D-4/D-5 | 同上，S |
| D-7 | syncEngineTypes 的 SyncConfig / S3Store / SyncDbPort / SyncReport + quickNoteSyncTypes.QuickNotesSyncDbPort | ≈120 + 69 | v2 端口；移动只做类型引用 | 类型面不再许诺 v2 | 先删 mobile/data/quickNotesDbPort 的死方法（CORE-12） | 07 §15 的 M5，M |
| D-8 | fileCard 的 scanFileCards / encodeCardValue / parseFileCardValue / buildDoneFileCardValue | ≈50 | 零生产引用（仅测试） | 导出面收缩 | 将来附件 AI 要扫描卡片时再从 git 取回 | 独立，S |
| D-9 | storeUtils 的 re-export 面（ASSET_NAME_RE / extractAssetRefs / isAssetFilename / buildAssetFilename …） | 5 | 仅为「不改 import 面」保留（自己注释写了） | 少一层转手 | 需批量改 import（~10 处） | 独立，S（收益低，可延后） |

合计：**core 约 −800 行（5%）**，非 core 约 −230 行。D-1 / D-2 / D-3 建议**立刻做**（无依赖、纯删）。

---

## 4. 重构建议（按 收益/风险 排序）

| 序 | 动作 | 收益 | 风险 | 与 v4 RFC 的关系 |
|---|---|---|---|---|
| 1 | 修 CORE-01（索引新鲜度）+ CORE-02（FTS 保留字） | 用户可感的正确性；两个 S 级改动 | 低（局部 + 回归） | **前置**：v4 的 apply-remote 会新增写正文的路径（RFC §6.2），不先修会把「索引过期」从偶发变常态 |
| 2 | 删 D-1 / D-2 / D-3（死模块 + 诱饵） | 去掉三处最容易被误用的「假单一来源」 | 无（grep 已核，测试同删） | 与 RFC 无关；减少 M5 删除面 |
| 3 | CORE-06 注入 native sha256 | 桌面 hash 快 10-20×（注释自述），v4 性能预算成立的前提 | 低（1 行 + 断言） | RFC §7 的「零变更 <80ms / 20k <300ms」按 native hash 估；**E5 之前修** |
| 4 | CORE-13 桌面账本改集合/增量判据 | 大库启动不再因一条错位全量重建 | 中（SQL 改动 + 一致性用例） | 独立；但「单实现」思路与 RFC §9.2 同源，可作搜索域预演 |
| 5 | CORE-14 normalizeSyncSettings 下沉 + 桌面 interval 复用 | 同一设置三端同解 | 低 | RFC §13 Q2「跨端混版」需要归一判据；M2 双写前做 |
| 6 | CORE-04 移动端 AI baseUrl 门槛（Kotlin ~20 行 + 注释纠偏） | 关掉与 SEC-01 同型的口子 | 低（原生小改 + 装机验证） | 独立 |
| 7 | CORE-05 + D-4..D-7（manifest 收口） | core 少 800 行 + 修「协议：manifest v2」用户可见错 | 中（同步删测试；protocolVersion 有 UI 依赖） | **就是 RFC §15 的 M5**，与新 SYNC-PROTOCOL.md 同批，不要提前单独做 |
| 8 | CORE-08 契约载体收敛（删 services）+ ARCHITECTURE 分工表 | 消除「最正式的那份契约没人用」 | 低 | RFC §9.2 用单实现替换 conformance；本项为它清场 |
| 9 | CORE-07 / 09 判据合并（fileKindOf / isSafePathSegment / TRASH id） | 少三处「同一判断两套」 | 低（逐条小改） | 独立 |
| 10 | CORE-10 纯函数化（nowMs / toLowerCase / 契约装置搬家 / 门禁升级） | 测试可重复、跨 locale 一致 | 低 | 独立；但「plan 同输入字节一致」（RFC §6.2）依赖这类纯度 |
| 11 | CORE-12 死端口收敛 | 移动 schema/类型面变小 | 中（移动门禁） | 独立 |

**不要做**（避免返工）：
- 不要合并 repositoryCapabilities（Q6 定稿）与 ports.ts；
- 不要把 cloudState / aiErrors 的中文文案「下沉到 UI」（261006 / 261009 / 261023 定稿）；要改的是**测试断言**（CORE-11），不是文案位置；
- 不要为搜索引入第二套分词器 / 外部 FTS 库；
- 不要在 v4 E1–E3 期间重排 s3v3* 的导出面；D-4 / D-5 的删除必须在 M5 且与测试同批。

---

## 5. 测试与度量

### 5.1 覆盖空洞（按风险排序）

| # | 空洞 | 证据 | 可能漏掉的问题 |
|---|---|---|---|
| 1 | **没有「保存不带缓存后索引仍新鲜」的用例** | electron/searchRepository.test.ts 只测 upsert/search/rebuild；noteContentRepository 的 caches 分支无行为断言 | CORE-01（现网已发生） |
| 2 | **查询表达式从未真正喂给 FTS5** | src/core/search/query.test.ts 全是字符串相等断言，且第 27 行把 OR* 钉成期望 | CORE-02 |
| 3 | noteBodyPaths 零专属测试 | 66 行 / 8 个路径构造器（含 isSafePathSegment 校验），只有 store.test / boardEditorMount.test 的源码字符串提及 | 路径布局漂移（移动端正文丢失类事故） |
| 4 | noteSearchText（kind 分派）无行为测试 | 生产被两端调用；测试里只有 features/board/boardEditorMount.test.ts 的源码字符串断言 | 非 doc 正文被当 Lake HTML 解析（261026 踩过一次：移动搜索里全是 JSON 碎片） |
| 5 | 桌面/移动 search_index schema 不同列无护栏 | CORE-13 | 两端对账逻辑不可复用、迁移脚本按单端假设 |
| 6 | aiChatMessages 的单测在 electron/ai/（core 无同名测试） | electron/ai/aiChatMessages.test.ts 覆盖 assertMessages | 可接受（有覆盖），但「core 模块的测试不在 core 旁」会让覆盖率看不出 |
| 7 | aiErrors 只测 TS 侧，Kotlin 码表零比对 | CORE-11 | 移动端错误落 unknown |
| 8 | quickNoteKeys.test.ts 在为一具尸体站岗 | D-1 | 绿色掩盖「唯一来源却是死的」 |

### 5.2 可加的护栏（每条都能「修前红、修后绿」）

1. **electron/searchRepository.freshness.test.ts**：建文档 → 索引 → store.saveNote(id, title, newContent)（**不传 caches**）→ searchNotes(新词) 命中；searchNotes(仅旧文才有的词) 不命中。（CORE-01）
2. **src/core/search/query.fts5.test.ts**：表驱动 AND/and/OR/NOT/Not/' OR '/Near/AND 笔记，用真 FTS5 执行每条 buildMatchExpression 输出，断言不抛错且命中预期；纯函数侧加「不得产出 ^(AND|OR|NOT)\*」。（CORE-02）
3. **scripts/check-core-exports.mjs**（报告型，先不做门禁）：列出「core 模块在生产代码零引用」；另把 check-core-boundaries 改成整文件正则（覆盖多行 import）。（CORE-03/10）
4. **scripts/check-ai-error-codes.mjs**：解析 AiChatPlugin.kt 的 status → code 与 aiErrors.kindFromStatus 比对；顺带断言 Kotlin DEFAULT_MODEL 与 AI_PROVIDERS 默认一致（或显式白名单）。（CORE-04/11）
5. **electron/quickNotes.searchLedger.test.ts**：对 ensureSearchIndex 的计数判据做「删一条 + 加一条」用例（应红），推动改成集合判据。（CORE-13）
6. **src/core/search/snippet.locale.test.ts**：buildSnippet("Iİ", "i") 与 segmentToIndexText 的折叠一致（当前 toLocaleLowerCase 会因宿主 locale 失败）。（CORE-10）
7. **契约升级**：resourceBehaviorContract（现 `src/testing/`）的断言从中文正则改 AppError.kind（expect(fn()).rejects.toMatchObject({ kind: "InvalidInput" })），文案另立快照。（CORE-11）

### 5.3 复测命令（只读；不写仓库）

    export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
    cd /Users/admin/file/local-lake/lakex-local-notes

    # 本批范围（≈4s）
    npx vitest run src/core/search src/core/quickNoteModel.test.ts src/core/quickNoteTags.test.ts \
      src/core/quickNoteSort.test.ts src/core/quickNoteFilters.test.ts src/core/quickNoteTypeFilter.test.ts \
      src/core/quickNoteSearch.test.ts src/core/quickNoteKeys.test.ts src/core/quickNoteReconcile.test.ts \
      src/core/aiProviders.test.ts src/core/aiErrors.test.ts src/core/aiErrorCode.test.ts \
      src/core/aiCorpus.test.ts src/core/aiNetwork.test.ts src/core/noteSaveDecision.test.ts \
      src/core/syncDecisions.test.ts src/core/cloudState.test.ts src/core/maintenancePolicy.test.ts \
      src/core/missingBody.test.ts src/core/storeUtils.test.ts src/core/assetNaming.test.ts \
      src/core/fileCard.test.ts src/core/dateFormat.test.ts src/core/logFormat.test.ts \
      src/core/noteInfo.test.ts src/core/repositoryCapabilities.test.ts \
      electron/searchRepository.test.ts electron/quickNotes.test.ts \
      src/mobile/data/searchIndex.test.ts src/mobile/data/quickNotesSearch.test.ts

    # 边界 + 类型
    node scripts/check-core-boundaries.mjs
    npx tsc --noEmit

    # 死代码复核（删除前后各跑一次，期望「只剩测试」）
    git grep -n -e "quickNoteKeys" -e "quickNoteReconcile" -e "createNativeServices" -- src electron
    git grep -n -e "parseLakeManifest" -e "validateManifest" -e "manifestToWire" -e "computeBookkeeping" -- src electron

    # FTS5 保留字行为自证（内存库，不落盘；期望只有 and* 通过）
    python3 - <<'PY'
    import sqlite3
    db = sqlite3.connect(":memory:")
    db.execute("CREATE VIRTUAL TABLE t USING fts5(title, body, tokenize='unicode61')")
    db.execute("INSERT INTO t(rowid,title,body) VALUES(1,'x','a n d android')")
    for q in ["AND*", "and*", "OR*", "NOT*"]:
        try:
            db.execute("SELECT rowid FROM t WHERE t MATCH ?", (q,)).fetchall()
            print(q, "OK")
        except Exception as e:
            print(q, "ERROR", e)
    PY

**度量建议（不必新建门禁）**：把「本批 324 导出 / 133 零生产引用」当作一次基线，下次动 core 时用同一脚本复核；比值下降即说明「export = 契约」这件事在改善。

---

*审计结束。本文只读产出，未修改任何代码；建议按 §4 的 1→2→3 先做三项 S 级改动（CORE-01/02 + D-1/D-2/D-3），其余随 v4 批次收口。*


### 261028 实施状态（逐条对账，替代原「第四轮」五行汇总）

> 采样 = 2026-10-28 21:15–21:30（Asia/Shanghai）；状态以**工作树代码**为准（逐条 grep），不再用「05/06/08/09/10… 未做」的批量写法。
> 其中 CORE-06/07/09/10/CORE-12 正由并行工作流收口，最终以工作树为准；完整对账见 `13-audit-status.md` §1。

| 项 | 状态 | 证据（文件 : 符号）与残余 |
|---|---|---|
| CORE-01 搜索索引过期 | ✅ 已修（第四轮） | 桌面同步落盘 `saveState` 在 contentChanged 时派生 `searchTextForKind("doc", content)` 并随 `saveNote` 落 cache+FTS（打开文档的后置触发仍在，作为二次兜底） |
| CORE-02 FTS 保留字 | ✅ 已修（第四轮） | `buildMatchExpression` 对 AND/OR/NOT/NEAR 输出引号短语、不加 `*`；用 better-sqlite3 真 MATCH 断言 |
| CORE-03 `quickNoteKeys` | ✅ 已删（第四轮） | 零生产引用；`s3v3Keys` 补「唯一来源」注释 |
| CORE-04 `aiProviders` 桌面单端 | ❌ 未做（安全项暂停） | 移动 AI 设置仍走 Kotlin（`android/**/AiChatPlugin.kt`）；SEC-01 的 baseUrl/Key 门槛只在桌面侧 `electron/ipc/registerAi.ts` |
| CORE-05 manifest v2 残留 | ✅ 已修（261029） | `src/core/syncUtils.ts` **296→90 行**：MANIFEST_VERSION / READABLE_MANIFEST_VERSIONS / MAX_MANIFEST_* / parseLakeManifest / validateManifest / manifest*Wire / syncSnapshot / objectKey / collectManifestRefs / mimeTypeFor / extnameLikeNode 全删（全仓含测试 0 命中）；`manifestLockWire.test.ts` 删、`syncUtils.test.ts` 缩为 isNoSuchKey 3 例；「关于」展示改「同步内核 v4（plan→apply→commit→finalize） · 协议 v{S3V3_POINTER_VERSION}（pointer + 内容寻址索引）」（appInfoPort 改挂 v3 常量）。**D-7 已同批完成（261029）**：`src/core/manifestTypes.ts` + `src/core/syncEngineTypes.ts` + `src/mobile/data/syncDbPort.ts`（509 行）+ 批量窗口测试已删；最小活面迁 `src/mobile/data/localStorePort.ts`；`createCapacitorS3Store` 死适配器与 `SyncReport/SyncConfig/S3Store/LocalNoteRow/SyncNowOptions` 一并删；`s3Store.ts` 201→45 行（只留 client 工厂） |
| CORE-06 SHA-256 注入点 | ✅ 已修（261028） | `electron/sha256Native.ts`（`nativeSha256Hex` = `node:crypto` + `installNativeSha256()`）在 `electron/main.ts` 启动处调 `setSha256HexImpl`（core 仍不 import node）；core 加只读访问器 `currentSha256HexImpl()`；测试 `electron/sha256Native.test.ts`（身份 + 边界矩阵 + FIPS 向量 + 静态接线）；移动端不注入（WebView 无 node）。**激进项未做**：7 处直连 crypto / UUID 判据 |
| CORE-07 `fileKindOf` 同名两套 | ✅ 已修（261028） | `src/core/fileCard.ts:192` 改成 `assetNaming.fileKindOf` 的**投影**（`PREVIEW_KIND_BY_ASSET_KIND` 映射，删掉第二张分类表；单源 = `src/core/assetNaming.ts:81`；7 桶 API 不变）。语义变化：`json/apk/bin` 由 `other→document`（同渲染分支，已接受）；护栏 `src/core/fileCard.test.ts` 50 扩展名矩阵 |
| CORE-08 跨端契约五种载体 | ◐ 部分（诱饵载体已删、契约装置已移出 core） | `08` §20 已删 `core/services.ts` + `lib/services.ts`；261028 晚把 `treeBehaviorContract.ts` / `resourceBehaviorContract.ts` 从 `src/core/` 移到 **`src/testing/`**（core 生产边界不再含 test-only 装置）；能力矩阵载体 = `src/core/repositoryCapabilities.ts`（+ 测试）。残余：`electron/s3v3/deviceConformance.ts`（496 行）仍在 electron，与 v4 M3 一起收 |
| CORE-09 三个小判据多份实现 | ✅ 已修（261029；describeError 按裁决保留两处） | 路径段单一来源 = `storeUtils.isSafePathSegment`（+控制字符）；`TRASH_NOTEBOOK_ID` 单一来源 = `src/core/syncDecisions.ts`（`electron/store.ts` 改 import+re-export；v4 `s3v3/commit/pullRound.ts` 第三处 `PULL_TRASH_ID` 也改 import）；护栏 `syncDecisions.test.ts` 锁字面量。`describeError` 两处（core `logFormat` = "Name: message" vs `lockedTextCard` = LockedTextError.code→用户中文）**语义不同，判定不合并**，已记录 |
| CORE-10 纯函数不纯 | ✅ 已修（261029） | 契约装置移 `src/testing/`（core 非测试 import vitest = 0）；locale 折叠 `toLowerCase`；`selectHistoryDrops(..., nowMs = Date.now())` 可选注入；新增 `src/core/randomId.ts`（WebCrypto 优先 + 确定性兜底，替代 3 处 Math.random ID 兜底）；剩余 Math.random 仅重试退避 jitter（合理保留）。**CORE-10 tail 已同批完成（261029）**：新增 `src/core/sharedTypes.ts`（SyncSettings/SyncWarning/NoteInfo/QuickNote*/TreeNode*），`src/lib/types.ts` 改 re-export（渲染层 import 路径不变），core 生产文件 `../lib/types` import = 0；删死 barrel `src/core/types.ts`；`check-core-boundaries.mjs` 白名单删 `../lib/types.js` 防回退 |
| CORE-11 展示文案当契约 | ❌ 未做 | AI 错误码 `src/core/aiErrors.ts` 与 Kotlin 侧双写、无护栏；未见任何轮次记录 |
| CORE-12 `quickNoteSyncTypes` 死端口 | ✅ 已修（261028） | `src/mobile/data/quickNotesDbPort.ts`（369 行 30+ 方法死端口）**已删**，其建表/加列 DDL 迁入 `src/mobile/data/schema.ts`（L281 注释点名 CORE-12）；`QuickNotesSyncDbPort / QuickNoteSyncItemImage` 类型随之删除，`src/core/quickNoteSyncTypes.ts` 收窄到 25 行（只留 `QuickNotePushOutcome` / `QuickNotesSyncResult` 等仍被 type-only 引用者） |
| CORE-13 搜索账本四份实现 | ✅ 已修（261029） | 新增 `src/core/search/schema.ts`：分词器/表名/列片段/索引名/建表语句单一来源；移动 `src/mobile/data/schema.ts` 引用（+逐字节冻结契约测试）；桌面 `electron/schemaInit.ts` / `electron/quickNotes.ts` 已接 `notesFtsDDL/quickNotesFtsDDL/searchLedgerDDL/searchLedgerRowidIndexDDL`；4 处建表不再手写 `tokenize='unicode61'` |
| CORE-14 SyncSettings 归一三处 | ✅ 已修（261029） | 类型单源：`electron/storeTypes.ts` re-export `src/lib/types.ts` 的 SyncSettings；新增 `src/core/syncSettings.ts` 纯函数 `normalizeSyncSettings(raw, fallback)`；桌面 `settingsRepository.getSyncSettings` 与移动 `bridge readSyncSettings` 均改调（fallback 由调用方传：hasS3Settings / hasStoredS3Settings；移动「缺 enabled」回落与桌面同口径）；`electron/main.ts` 的 interval 判据改 `autoSyncIntervalMs`；`syncSettings.test.ts` 7 例。**附带**：`S3Settings` 三处定义（core/syncUtils、src/lib/types、electron/storeTypes）也已收口到 core/syncUtils（lib/storeTypes re-export）。 |
