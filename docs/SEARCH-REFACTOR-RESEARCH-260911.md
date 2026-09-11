# 搜索功能重构 · 前期调研（260911）

> 本文是**搜索重做的技术调研**，不含代码改动。目标是：先讲清现状与根因，用**实测数据**给出跨端可落地的技术选型，再给分阶段方案。
> 相关文档：`AGENTS.md`（红线）· `HANDOFF.md` §3「FTS 索引重做」· `docs/SYNC-PROTOCOL.md`（不涉及同步）· `docs/LAKEX-CONTRACT.md`（正文纯文本来源）。

---

## 0. 结论先行（TL;DR）

1. **当前"不稳定 + 逻辑不合理"的根因不是实现 bug，而是选错了 tokenizer**：`trigram` 天生要求查询串 ≥3 字符，于是被迫写"1 字/2 字/≥3 字"三套分支；2 字不能搜正文、1 字只搜标题——这是**索引能力倒逼出来的产品语义**，不是用户想要的。
2. **桌面与移动各写了一套完全不同的搜索**（桌面 FTS5 trigram；移动 LIKE 裸扫描 `notes.content`），排名/摘要/matchType 全不一致，这也是"体感差"的直接来源。
3. **关键实测结论（本轮新证据）**：桌面 better-sqlite3 = SQLite **3.53.4**，安卓 SQLCipher 4.17.0 = SQLite **3.53.3**，且安卓内核编译了 **`ENABLE_FTS5`**（还带 `ENABLE_FTS3/4`、`ENABLE_LOAD_EXTENSION`）。**两端都能用 FTS5** —— 移动端"不依赖平台 FTS"的旧判断过时了。
4. **推荐方案**：统一到 **SQLite FTS5 + `unicode61` + 纯 TS 预分词**。把中文按**单字**、拉丁按**词**切分后用空格写入 FTS 列，查询串用同一分词器构造 **phrase（引号）+ AND** 表达式。**取消所有长度分支**，1/2/3+ 字走同一条索引路径；摘要/高亮在 JS 里用原文生成（不依赖 FTS 的 `snippet/Highlight`）。不新增依赖、不引外部搜索引擎。
5. **必须一起做的三件事**：① 桌面/移动共享一个 `src/core/search/` 核心（分词 + 查询构造 + 结果映射）；② 索引改**增量账本**（按内容 hash 只重建变更行），去掉启动时 `DELETE FROM notes_fts` 全量重插；③ 删除按 **rowid** 而不是 `note_id`（当前 `DELETE ... WHERE note_id=?` 是 FTS 全表扫描）。

---

## 1. 目标与验收判据

用户原话（本会话）：*"完全重构搜索功能，当前搜索不稳定，且逻辑不合理还需要区分 1-2 字和 3 个字以上，使用体感很差，使用更合理的技术栈或者开源工具重新开发；可参考思源，也思考是否有更好方案。"*

把它翻译成可验收的判据：

| # | 判据 | 现状 |
|---|------|------|
| U1 | **语义统一**：1/2/3+ 字都是"标题优先、正文命中"，不再有长度分支 | ✗（1 字仅标题、2 字仅标题、≥3 才有正文） |
| U2 | **跨端一致**：同样的词，桌面与安卓返回同样的排序、同样的摘要 | ✗（两套实现） |
| U3 | **索引增量**：改一篇只更新一篇；启动不阻塞全量重建 | ✗（每次启动全清重插） |
| U4 | **摘要可读**：正文摘要来自纯文本、能标出命中词，不出现 HTML/JSON | ✗（移动端截裸 `content`） |
| U5 | **可定位**：打开结果能滚到命中处 | 桌面 DOM 启发式；移动无 |
| U6 | **可测**：分词/查询构造/排名是纯函数，单测覆盖；性能有 5000 / 100k 基准 | 部分 |
| U7 | **规模达标**：5000 文档基线可接受，10 万文档长期不崩 | 未验证 |

---

## 2. 现状盘点（源码级）

### 2.1 桌面链路（Electron 主进程）

| 位置 | 内容 |
|------|------|
| `electron/schemaInit.ts:134-135` | `CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, note_id UNINDEXED, tokenize='trigram')` |
| `electron/searchRepository.ts:42-60` `upsert()` | 先 `SELECT title,body FROM notes_fts WHERE note_id=?` 判等；变了则 `DELETE FROM notes_fts WHERE note_id=?` + `INSERT` |
| `electron/searchRepository.ts:62-80` `rebuild()` | **每次启动** `DELETE FROM notes_fts` 全清，再 `WITH RECURSIVE` 扫全部 `tree_nodes`（排除回收站），对缺 `text_cache` 的调 `ensureNoteCaches`（读盘/解析），逐条插入 |
| `electron/searchRepository.ts:82-156` `search()` | 按 `queryLength` 分三支：**1 字** = 标题 `LIKE`；**2 字** = 标题 `LIKE`（**注释明确写"2 字不再命中正文"**）；**≥3 字** = FTS5 `MATCH` + `highlight()` |
| `electron/store.ts:232` | Store 构造时 `try { this.searchRepository.rebuild() }` |
| `electron/store.ts:511-518` | `rebuildSearchIndex()` / `searchNotes()`（IPC：`electron/ipc/registerNotes.ts:114` `search_notes`） |
| `src/components/SearchPanel.tsx` | ⌘K 面板；120ms 防抖 + 请求版本守卫；`sanitizeSnippet()` 把 `highlight()` 的 `<mark>` 白名单放行 |

补充：`electron/searchRepository.ts:159` 的 `highlightSnippet()` **是死代码**（无调用）。

### 2.2 移动链路（Capacitor WebView）

| 位置 | 内容 |
|------|------|
| `src/core/mobileSearch.ts` | 纯查询构造：`buildSearchSql` 产出 `SELECT n.id,n.title,n.content,... FROM notes n LEFT JOIN folders f ... WHERE n.trashed_at IS NULL AND (n.title LIKE ? OR n.content LIKE ?) ORDER BY n.updated_at DESC LIMIT 50`；**完全不依赖 FTS**，注释写"不依赖平台 SQLite 的 FTS 编译特性" |
| `src/mobile/noteRepository.ts:99-108` | 执行上面的 SQL；`toSearchResult` 用 `content.slice(0,120)` 当摘要 |
| `src/mobile/bridge.ts:265-269` | `bridge.searchNotes()` |
| `src/mobile/settings/SearchSheet.tsx` | 移动搜索面板；200ms 防抖；只显示标题+父笔记本，无摘要 |

关键事实：移动端 `notes.content` 存的是**编辑器序列化正文（Lake HTML 方言）**，不是纯文本。所以：
- `LIKE '%关键词%'` 会命中标签/属性/card 内嵌 JSON；
- 摘要就是裸 `content` 前 120 字 → UI 里可能出现 `<card ... value="data:%7B...`；
- 排序只有 `updated_at DESC`，**没有任何相关性**（标题命中不会靠前）。

### 2.3 UI 与"定位"

- 桌面入口：⌘K → `SearchPanel`（`src/components/DesktopOverlays.tsx:131`），`onOpenNote(id, query)` → `useTabLifecycle.ts:46` 的 `openNote(id, locateQuery)`。
- 定位实现：`src/features/editor/EditorTab.tsx:60-75` `locateEditorSearchHit()` —— 用 `document.createTreeWalker` 在 TAB DOM 里找**第一个包含该串的文本节点**，取最近块级父级加 `.lake-search-hit-target` 并 `scrollIntoView`；外层最多重试 8 次（`useTabLifecycle.ts:47-53`）。
- 移动端点结果**只打开文档，不定位**。

### 2.4 索引生命周期

- 桌面：启动全量重建；保存时 `store.ts:467` `searchRepository.upsert(...)`；同步/删除/回收站路径手工 `DELETE FROM notes_fts WHERE note_id=?`（`syncReconciliation.ts:192/228/275`、`trashLifecycle.ts:115/248`）。
- 移动：无索引，查询即全表扫描。
- 没有任何"重建索引"的 UI/IPC 暴露（`rebuildSearchIndex` 只在 Store 内和测试里出现）。

### 2.5 现有测试与 TODO

- `electron/searchRepository.test.ts`：断言了当前"1 字仅标题 / 2 字仅标题 / ≥3 正文"的语义（**重构时这些断言要改**）。
- `src/core/mobileSearch.test.ts`：LIKE 构造与转义。
- `electron/store.test.ts:355`「全文搜索：正文 trigram 命中 + 高亮，标题 LIKE 回退，删除后消失」。
- `docs/TODO.md:39` 原始待办：*"全文搜索 2 字以内查询回退：trigram 最小 3 字符……需 LIKE 回退或提示"*。
- `README.md` §设计先决条件 #6：**搜索单独立项**；#5：数据基线 **5000 文档 / 2 万附件**（AGENTS §1 的 10 万/100 万仅长期参考）。

---

## 3. 根因分析

| 编号 | 根因 | 表现 |
|------|------|------|
| R1 | **trigram 的 ≥3 字符硬约束** | 1/2 字无索引可走 → 只能 LIKE 全扫 → 只好"限定标题"；这是所有"长度分支"的总根源 |
| R2 | **双实现分叉** | 桌面 FTS、移动 LIKE；摘要/排名/matchType 语义不同 |
| R3 | **移动端按裸 Lake 正文 LIKE** | 命中标签与内嵌 JSON；摘要不可读；`content` 无纯文本缓存 |
| R4 | **启动全量重建** | `rebuild()` 每次启动 DELETE 全表 + 逐条 `ensureNoteCaches`（读盘），5000 篇就是启动期 O(N) 读盘；100k 不可接受 |
| R5 | **按 `note_id` 删除 FTS 行** | `note_id` 是 `UNINDEXED`，`WHERE note_id=?` 需**全表线性扫描**；每次保存/删除都付这个成本 |
| R6 | **摘要/高亮依赖 FTS `highlight()`** | 生成了 HTML，再由前端正则白名单放行，脆弱；移动端完全另一套；死代码 `highlightSnippet()` |
| R7 | **定位是 DOM 启发式** | 只找第一个文本节点，受虚拟渲染/格式化影响，`locate()` 靠重试；移动端缺失 |
| R8 | **不搜小记** | 桌面帮助文案明说"不搜索小记"；产品上是否要搜，未决策 |
| R9 | **无 bench 护栏** | 搜索只有单测正确性，没有 5000/100k 的索引体积与延迟基准 |

---

## 4. 平台能力实测（本轮关键证据）

### 4.1 桌面 better-sqlite3

```
sqlite_version: 3.53.4
unicode61: OK   trigram: OK   porter: OK
compile_options: ENABLE_FTS3, ENABLE_FTS3_PARENTHESIS, ENABLE_FTS4, ENABLE_FTS5
db.loadExtension: function
```

### 4.2 安卓 SQLCipher（`@capacitor-community/sqlite@8.1.1` → `net.zetetic:sqlcipher-android:4.17.0`）

直接解包 Gradle 缓存里的 `sqlcipher-android-4.17.0.aar`，`strings libsqlcipher.so`：

```
version: 3.53.3
COMPILER=clang-14.0.7
ENABLE_FTS3  ENABLE_FTS3_PARENTHESIS  ENABLE_FTS4  ENABLE_FTS5
ENABLE_LOAD_EXTENSION  ENABLE_RTREE  ENABLE_SESSION  ...
fts5  fts5vocab  ...
```

**结论：安卓端底层 SQLite 3.53.3 完整支持 FTS5**。`src/core/mobileSearch.ts` 里"不依赖平台 FTS 编译特性"的前提已不成立，**两端可以统一到 FTS5**。

### 4.3 分词策略原型（同一批 FTS5 表，better-sqlite3 3.53.4）

文档 `"欢迎使用Lake编辑器性能测试"`：

| 方案 | 中文切分结果 | 1 字 | 2 字 | 3 字 | "Lake" | 摘要可读性 |
|------|-------------|:---:|:---:|:---:|:---:|------|
| `unicode61` 原文（不预处理） | 整段一个 token | 0 | 0 | 0 | 0 | — |
| **`unicode61` + unigram 预分词** | `欢 迎 使 用 Lake 编 辑 器 性 能 测 试` | ✅ | ✅ | ✅ | ✅ | 需 JS 从原文出 |
| `unicode61` + bigram 预分词 | `欢迎 迎使 使用 Lake 编辑 辑器 器性 性能 能测 测试` | ✅(前缀`编*`) | ✅ | ✅ | ✅ | 需 JS 从原文出 |
| `trigram`（现状） | 自动 3-gram | ❌ | ❌ | ✅ | ✅ | `highlight()` |

并验证了 FTS5 查询语义（同文档集）：

- **不加引号**的空格分词 = **AND**（`编辑 器` 命中 2 篇：一篇正文"编辑…修复器"也中）；
- **加引号** = **phrase，要求位置相邻**（`"编 辑 器"` 只命中"编辑器"那篇）→ 这正是"精确子串"需要的语义；
- `bm25(notes_fts, 10.0, 1.0)`（title 权重 10）能把标题命中排在正文命中之前（`r` 越负越靠前）。

> 这套"**用纯 TS 预分词在 JS 侧复刻 SiYuan 的 C 分词器行为**"是推荐方案的技术支点：不需要编译/分发任何原生扩展，桌面与移动共享同一段代码。

---

## 5. 思源方案拆解（源码级，非道听途说）

思源 v3.8.0（`/Users/admin/file/local-lake/siyuan-master`，AGPL-3.0，只读参考）：

### 5.1 分词器：自定义 FTS5 tokenizer `"siyuan"`（单字分词）

- 注册：`kernel/sql/database.go:512` `ftsTokenize()` 返回 `"siyuan"`（或 `"siyuan case_insensitive"`），`blocks_fts` 建表见 `database.go:294` / `:2069`。
- 实现：**在 fork 的 SQLite C 源码里**（`~/go/pkg/mod/github.com/88250/go-sqlite3@.../sqlite3-binding.c`）：
  - `fts5SiYuanTokenize()`（`:237828`）**对每个 UTF-8 码点都产出一个 token**（`CharacterBytesForUTF8` 逐字取长），即中文=单字、英文=逐字母；
  - `fts5SiYuanCreate`（`:236988`）支持 `case_insensitive`（用 `strToLwrExt` 做 Unicode 小写折叠）；
  - 注册表 `{ "siyuan", {fts5SiYuanCreate, fts5SiYuanDelete, fts5SiYuanTokenize} }` 在 `:237889`。
- 取舍：**单字 token 让任意长度查询（含 1 字）都能走索引**，代价是索引大、英文按字母切、单字查询命中面很宽（靠排序/limit 收敛）。

### 5.2 查询构造：引号 phrase + 空格 AND + 列过滤

- `kernel/model/search.go:3254` `stringQuery()`：整串加双引号；若含空格则**按空格拆成多段，每段各自加引号**（FTS5 中相邻 token 构成 phrase，多段之间是 AND）。
- `:3212` `columnFilter()`：把 MATCH 限定在 `{content name alias memo ial tag}` 列。
- `:2314` / `:2478`：`WHERE blocks_fts MATCH ?`，参数为 `columnFilter() + ":(" + query + ")"`。

### 5.3 摘要与排序

- 摘要：SQL 里用 FTS5 `snippet(blocks_fts, 列号, 左标记, 右标记, '...', 64/512)` 生成命中片段（`:2307-2313`、`:2469-2477`）。
- 排序：`CASE WHEN name=关键词 THEN 10 WHEN alias=… WHEN content=关键词 AND type='d' THEN 40 WHEN content LIKE '%词%' … END ASC, sort, length`（`:2331-2345`）——即"精确标题/别名/正文整篇命中 > 前缀/包含 > 其他"，本端就是可借鉴的**分级相关性**。
- 存储：`blocks_fts` 是 **external-content 表**（`content='blocks', content_rowid='rowid'`），只维护倒排索引，列值在 `blocks` 表（`:291-306`）。

### 5.4 能借鉴 / 不能照搬

| 可借鉴 | 说明 |
|--------|------|
| ✅ **单字/短语查询 + phrase 语义** | 用 JS 预分词即可在标准 FTS5 上复刻，不需要 C 扩展 |
| ✅ **查询串统一构造，屏蔽长度** | 与我们 U1 完全一致 |
| ✅ **分级相关性 + 标题权重** | `bm25(col weights)` 或 `CASE` 分级 |
| ✅ **列过滤** | 标题/正文分列，标题高权重 |
| ✅ **external-content 表** | 索引与正文分离，写入显式 rowid |
| ❌ 自定义 C tokenizer | 需 fork SQLite 并逐平台编译；桌面可 loadExtension，安卓要写原生插件，成本过高，**不在本期** |
| ❌ 块级索引（block-level） | 与 Lake Notes 的文档级模型/同步模型不匹配，过度设计 |
| ❌ 附件内容搜索 | 超出本期范围 |

---

## 6. 候选方案对比

### A. SQLite FTS5 + `unicode61` + 纯 TS 预分词（unigram）★推荐

中文逐字空格分隔、拉丁整词保留，写入 FTS5；查询用同一分词器构造 `"编 辑 器"` phrase / 多段 AND；摘要与高亮在 JS 用原文生成。

- 优点：**1/2/3+ 完全统一**；零新依赖；桌面/移动**同一份 TS**；FTS5 已内建；支持 bm25 加权；正则外无需第三方。
- 缺点：索引比原文大（约 1–2×，需 benchmark）；单字查询命中面宽（靠排序+limit）；拉丁变"整词匹配"（子串需前缀/分词，见 §10）。

### B. SQLite FTS5 + `unicode61` + TS 预分词（bigram）

相邻中文两字组 token，查询按 bigram phrase，1 字用前缀 `X*`。

- 优点：比 unigram 更"有区分度"，索引 token 更少、单字查询更快；2 字直接命中。
- 缺点：查询构造更复杂（1 字前缀、奇偶长度、重叠校验）；索引每条 token 是 2 字，体积≈2× unigram；仍是纯 TS。**作为 A 的备选优化**（若 benchmark 显示 unigram 索引/单字查询不可接受再切）。

### C. 保留 trigram + 短词 LIKE 回退（现状改良）

- 只修 R4/R5，不动语义。治标不治本，U1 仍不满足。**不采用**。

### D. 纯 JS 索引库（MiniSearch / FlexSearch / Orama）

- 优点：完全可移植，CJK 靠自定义 tokenizer；脱离 SQLite。
- 缺点：**新增依赖**（AGENTS §3 #8 倾向不加）；需要第二份索引的持久化/加载/与 DB 变更同步；Electron 主进程/WebView 双份内存；100k 文档内存不确定。**不采用**（除非 A/B 在移动端遇到不可解问题）。

### E. 自定义 FTS5 loadable extension / Android 原生插件（SiYuan 同款）

- 优点：与思源完全一致的最高质量。
- 缺点：需要为 macOS(arm64/x64)/Windows/Linux 编译/签名/分发 `.dylib/.so/.dll`，安卓再写原生 FTS5 tokenizer 插件；CI、体积、可维护性全面变差。**明确不在本期，留作远期**。

### F. 外部搜索服务（Meilisearch / Typesense）

- 违反"本地优先 / 离线可用 / 不引外部服务"，打包与运维成本高。**排除**。

| 维度 | A unigram | B bigram | C 现状改良 | D JS 库 | E 原生分词 |
|------|:--:|:--:|:--:|:--:|:--:|
| 1/2/3+ 统一 | ✅ | ✅ | ❌ | ✅ | ✅ |
| 零新依赖 | ✅ | ✅ | ✅ | ❌ | ❌ |
| 跨端同码 | ✅ | ✅ | ❌ | ✅ | ❌ |
| 索引体积(20k实测) | **最小 18.9MB** | 25.4MB | — | 高(内存) | 中 |
| 实现复杂度 | 低 | 中 | 低 | 中高 | 高 |
| 长期可维护 | 高 | 高 | 低 | 中 | 低 |

### 6.7 各方案优缺点展开（用于综合考虑）

> 结论仍是 **A 为首选**，但下面把每个维度的代价摊开，便于权衡。核心判断变量：**能否在拿到“任意长度都能索引”的同时，不新增依赖、不让桌面/移动分叉、不给 10 万文档埋雷**。

#### A. FTS5(unicode61) + TS unigram —— 均衡首选
**优点**
- **语义最干净**：写/查同一分词器，1 字、2 字、3+ 字、中英混合全走同一条 FTS5 路径；`"编 辑 器"` phrase 保证位置相邻 = 精确子串，没有 trigram 的 ≥3 门槛。
- **零新依赖、零新服务**：FTS5 两端已确认存在（§4），索引就存在现有 DB 文件里，**与笔记写入同一事务**，不存在“第二份索引漂移”。
- **跨端天然同码**：分词/查询/摘要都是纯函数放 `src/core/search/`，桌面主进程与移动 WebView 共用；只差执行 SQL 的端口。
- **排障与测试友好**：纯函数 + SQL 都可单测；分词行为有官方文档兜底。
- **可增量、可事务、可离线**：按 rowid 删/插 O(1)，索引随工作区/DB 一起备份恢复，天然离线。
- **失败可退**：即便以后要换 bigram 或原生分词，结果契约（SearchResult/排序/摘要）不变，只需换分词与 DDL。

**缺点/代价**
- **索引体积（实测修正）**：20k 合成文档实测 unigram 索引 **18.9MB，反而是三种方案里最小的**（bigram 25.4MB、trigram 35.9MB）。真正要盯的不是体积，而是**常用字的候选集与 bm25 排序成本**（见 §6.8）。
- **1 字/常用字查询候选集大**：最坏情况（查“的”）要扫大量 posting，靠分级排序 + LIMIT 收敛；极端词延迟需 bench。
- **拉丁变“整词匹配”**：保留 `Lake` 能命中，但 `ake` 不再命中；要子串得自己加前缀 `*` 或对拉丁也 bigram（复杂度上升）。
- **不能用 FTS 的 `snippet()/highlight()`**：因为存的是加空格的分词文本，摘要必须在 JS 用原文生成（这本身也带来“两端一致、可控”的好处，但要多写一段并单测）。
- **需要账本表**：为 O(1) 删除与增量判断引入 `search_index`（小成本）。

#### B. FTS5(unicode61) + TS bigram —— A 的性能备选
**优点**
- **查询更“有区分度”**：2 字直接是一个 token；单个常用字变成前缀 `X*`，命中的 token 更少，**常见词/单字查询延迟通常优于 unigram**。
- 仍是 FTS5/零依赖/跨端同码，改动面与 A 同量级。
- 对“精确子串”同样成立（偶数长=单 bigram；奇数长=相邻 bigram phrase）。

**缺点/代价**
- **查询构造更复杂**：要处理单字前缀、奇偶长度、bigram 重叠与位置相邻、标点/中英边界；边界 case 明显多于 A，测试面更大。
- **索引未必更小**：bigram token 本身是 2 个字，**字典更大、token 值更长**；总索引体积大概率 ≥ A（虽然 posting 更短）。“更省索引”这个印象要纠正为**更省查询时的候选集**。
- 记忆负担：团队要理解“加空格 + bigram + phrase”的隐式语义，可维护性略低于 A。

#### C. 保留 trigram + 短词 LIKE 回退（现状改良）
**优点**：改动最小；trigram 对 ≥3 的拉丁子串也友好；已有测试基本不动。
**缺点**：**完全不满足 U1**（长度分支仍在）；1–2 字 LIKE 是 O(全库文本量)，随规模线性恶化；桌面/移动仍两套；只修了启动重建/删除效率这类“配菜”。**判定：不解决核心诉求，不作为主方案。**

#### D. 纯 JS 索引库（MiniSearch / FlexSearch / Orama）
**优点**
- 检索能力与 SQLite 解耦，**桌面/移动行为可以做到逐字节一致**（同一库同一版本）；分词完全自由（unigram/bigram/词典都行）。
- 通常自带相关度（BM25/TF-IDF）、前缀、模糊、大小写/变音折叠等，省掉不少自研排序。
- 不占用 FTS 表，不依赖平台 SQLite 编译选项。

**缺点/代价**
- **新增依赖 + 版本升级/供应链维护**（AGENTS §3 #8 倾向不加）。
- **第二份真相**：索引必须序列化/持久化，并与保存、同步、回收站、purge、恢复等**每一条写路径**保持同步；一旦漏更新就出现“明明有这篇搜不到/删了还能搜到”，且比 FTS 更难自愈。
- **内存与启动**：整份索引进 JS 堆；5000 篇可行，10 万篇不确定，移动 WebView 内存更紧；冷启动要反序列化。
- **丢掉了 SQL 侧的回收站/目录过滤**：要么把结果拿回 JS 再过滤（慢），要么维护“可见集”（又一份状态）。
- 出问题时要自己实现索引重建/损坏恢复。

#### E. 自定义 FTS5 tokenizer（loadable extension / 安卓原生插件）—— 思源同款
**优点**：质量上限最高（可做“中文单字/双字 + 拉丁词干 + 繁简折叠”的最优组合）；无空格预处理，`snippet()/highlight()` 直接可用；原生速度。
**缺点/代价**：要为 macOS(arm64/x64)、Windows、Linux 分别编译/签名/分发 `.dylib/.so/.dll`，安卓再写原生 FTS5 tokenizer 插件；CI、打包体积、Electron 扩展加载路径、安全审批都成为长期负担。**判定：性价比在本阶段最低，留远期。**

#### F. 外部搜索引擎（Meilisearch / Typesense）
**优点**：功能/性能最省心，天然中文分词、拼写纠错、高亮。
**缺点**：**与“本地优先/离线可用/单机小应用”直接冲突**；要起守护进程、分发二进制、管理端口与数据目录，打包与升级成本极高。**排除。**

#### 综合判断与组合策略
- **现在做**：A（统一 FTS5 + TS unigram）。它在“语义统一 / 零依赖 / 跨端同码 / 可增量 / 可测试”五个项目最看重的维度上同时最优，唯一真正的风险是“索引体积与常用字延迟”，而这个风险有 B 作为**平滑升级路径**（接口不变，只换分词器与 DDL）。
- **何时切 B**：当 P5 基准显示 unigram 在 5000 篇 p95 超预算，或索引体积不可接受时；切换成本主要在分词/查询构造，rank/摘要/契约不动。
- **何时考虑 E**：只有 A/B 都触到天花板、且愿意承担多平台原生构建时才做；对接方式仍是同一份结果契约。
- **不建议**：C（不解决诉求）、D（引入第二份真相与依赖）、F（违背本地优先）。

#### 范围（已确认）：本期只做文档，小记暂不做搜索
- 用户决定：**小记先不纳入搜索**，本期范围 = 文档（标题 + 正文）。
- 二期再评估：桌面小记在独立库 `quick-notes/metadata.sqlite3`，跨库检索需两库各建 FTS 后合并；移动端小记与笔记同库。结果契约预留 `kind` 字段即可，不必现在实现。
- 好处是 P0–P4 更聚焦：先把文档搜索的语义与手感做对。

### 6.8 A 方案的诚实评估（含 20k 文档实测）

> 用户追问“A 这么完美吗”。**不是。** A 是“最平衡”，不是“无短板”。先给实测，再列真实劣势。

#### 实测（better-sqlite3 3.53.4，20k 合成文档 ≈ 每篇 100 中文字；查询为 bm25 + LIMIT 50 的 p50/p95）

| 方案 | 建索引 | 文件大小 | 1 字 | 2 字 | 3 字 | 4 字 | 拉丁词 |
|---|---:|---:|---:|---:|---:|---:|---:|
| A unigram | 346ms | **18.9MB** | 1.77ms | 0.51ms | 0.55ms | 0.65ms | 5.28ms |
| B bigram | 863ms | 25.4MB | 2.16ms | 0.06ms | 0.02ms | 0.03ms | 5.81ms |
| trigram(现状) | 1100ms | 35.9MB | n/a | n/a | 0.02ms | 0.04ms | 7.73ms |

结论（修正此前印象）：
- **A 的索引体积不但不大，反而最小**（单字字典小、重复多、易压缩）；此前“1–2× 正文”的说法作废。
- **A 的 1 字查询约 1.8ms@20k**，并非灾难；真正随规模增长的是“常用字候选集 + bm25 全排序”，100k 需 P5 复测。
- **B 的优势只是短语查询快约 10×**（0.5ms → 0.05ms）；在毫秒级、5000 篇基线下不关键，但 100k + 高频词时 B 更稳。
- trigram 最大、建索引最慢、且天然不能查 1–2 字——再次确认现状方案的问题。

> 注意：合成语料（300 字表）与真实中文（数千字表、长文档）不同，绝对数字仅供相对比较，**P5 必须用真实语料复测**。

#### A 的真实劣势（确实存在，不是“没有短板”）
1. **拉丁/代码/符号的召回退化**：拉丁按整词，`Lake` 能中但 `ake` 不能；`unicode61` 会把 `C++`、`a.b`、`#tag`、URL 当分隔符。代码/公式/标签类笔记的“任意子串/符号”检索会退回，这是相对 trigram 的**真实召回倒退**。
2. **摘要/高亮必须自研**：不能用 FTS 的 `snippet()/highlight()`，要在 JS 里做大小写/全半角/NFKC/变音折叠一致化 + 命中区间 + 上下文截取；归一化后“原文偏移 ≠ 匹配偏移”是经典坑，定位也会受影响。
3. **无词干/形态学**：英文 `note` 不匹配 `notes`（trigram 能，因为子串）。porter 与中文单字混在同一 FTS 表会互相牵制，本期不做。
4. **分词/查询必须逐字节同源**：索引端与查询端任一不一致（NFKC、Unicode 版本、CJK 范围）就会静默漏检；需要强单测锁死。
5. **平台/引擎兼容风险未消**：安卓内核有 FTS5 是硬证据，但 `@capacitor-community/sqlite` 插件层的 DDL/MATCH/bm25 仍需 spike。
6. **增量维护不是白送**：账本、rowid 分配、同步/回收站/purge/恢复各路径的删改、损坏重建，都是实打实的代码与测试面。
7. **短查询的“噪声”**：1 字能搜到后，常见字会命中大量文档（A 让它“能查”但未必“有用”）；需要产品层配合（标题优先、结果计数、是否 1 字只搜标题）——不是索引能独自解决的。
8. **写放大**：FTS5 每次保存重写该行并触发 segment 合并；大文档/频繁保存要注意事务时长（桌面同步阻塞主进程、移动端逐语句往返）。

#### 如果“拉丁/代码召回”很重要：A+（A 的可选增强）
- 同一张 `unicode61` FTS5 表里分列：`title_cjk/body_cjk` 存**中文单字**，`title_latin/body_latin` 存**拉丁 3-gram**；查询按中/拉丁分别构造，用列过滤 `{title_latin body_latin}:("lak ake")`。
- 代价：索引更大、查询构造更复杂。对中文笔记型应用，**先 A，等真实语料证明需要再上 A+** 更划算。

#### 对 A vs B 的最终判断
- 目标基线 5000 篇：**A 足够，且实现/维护成本最低**。
- 若 P5 真实语料显示高频 1–2 字查询 p95 超预算：切 **B**（接口不变，换分词 + DDL）。
- 若拉丁/代码检索重要：在 A 上叠加 **A+** 的拉丁列。
- 不存在“无代价的完美方案”；A 的主要代价是**拉丁/符号召回**与**自研摘要/定位**，而不是体积或 1 字性能。
---

## 7. 推荐方案：统一 FTS5 + 共享分词/查询核心

### 7.1 架构分层

```
src/core/search/                     ← 纯 TS，两端共享，全部可单测
  normalize.ts    归一化（NFKC/大小写/全半角，可选繁简）
  segment.ts      text → tokens（中文单字 + 拉丁整词 + 数字）
  buildQuery.ts   query → FTS5 MATCH 表达式（phrase + AND + 转义）
  rank.ts         标题精确/前缀/包含 加成 + updated_at 兜底
  snippet.ts      从纯文本生成带 <mark> 的摘要（端到端可注入）
  types.ts        SearchResult / SearchHit

electron/search/
  searchRepository.ts   FTS5 DDL/增量 upsert/删除/查询（用核心）
  searchIndexState.ts   增量账本
src/mobile/
  noteRepository.ts     searchNotes() 改为调用同一核心 + 同一段 SQL
```

### 7.2 分词与查询构造规则（核心算法）

分词（写入与查询**必须同一函数**）：
- 逐码点扫描；
- **CJK**（Han / 平假名 / 片假名 / 谚文）→ 每字一个 token；
- **拉丁/数字**连续段 → 一个 token（可选 `porter` 级词干，本期不做）；
- 其余（空白/标点/符号）→ 分隔符；
- 输出 `tokens.join(" ")` 写入 FTS 列。
- 大小写：`unicode61` 自带大小写与变音折叠；可选在分词器里先做 NFKC 全半角归一。

查询构造：
1. 按空白把用户输入拆成 N 个"词项"；
2. 每个词项按上述规则分词，得到 token 序列；
3. 每个词项用双引号包成 phrase：`"编 辑 器"`（保证位置相邻 = 精确子串）；
4. 词项之间用空格连接（FTS5 隐式 AND）；
5. **转义**：token 内的 `"` 复制成 `""`；不把用户原文直接拼进 MATCH；
6. 单 token 词项本身就是合法 phrase（1 字也走同一路径）；
7. 拉丁词项可选在末尾加 `*` 支持"边打边搜"前缀（需评估噪声）。

这样 **1 字 / 2 字 / 3+ 字进入同一个函数、同一条 SQL**，没有任何长度分支。

### 7.3 索引 schema 与增量维护

```sql
-- FTS5：显式 rowid，便于 O(1) 删除；note_id 仅作 UNINDEXED 关联列
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  title,                 -- 分词后的标题
  body,                  -- 分词后的正文
  note_id UNINDEXED,
  tokenize = 'unicode61'
);

-- 增量账本：判断"是否需要重建"，并持有稳定 rowid
CREATE TABLE IF NOT EXISTS search_index (
  note_id     TEXT PRIMARY KEY,
  rowid       INTEGER NOT NULL,   -- notes_fts 的 rowid
  title_hash  TEXT NOT NULL,
  body_hash   TEXT NOT NULL,
  indexed_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_search_index_rowid ON search_index(rowid);
```

upsert 流程（保存/同步/恢复）：
1. 取纯文本 `title`、`body`，算 hash；
2. 查 `search_index`：hash 相同 → 直接 return（**当前"无变化短路"保留，但改成基于内容 hash**）；
3. 存在 → `DELETE FROM notes_fts WHERE rowid=?`（**O(1)**）；
4. `INSERT INTO notes_fts(rowid,title,body,note_id) VALUES(?,?,?,?)`，rowid 取 `search_index` 里的旧 rowid 或新分配；
5. 写回 `search_index`。

启动：**不再 `DELETE` 全表**。只做一次轻量对账（可选、后台、走 `enqueueMaintenance`）：`search_index` 缺行 / `notes` 的 `text_cache` 变化 → 补索引；删除的 note → 删索引。另提供显式 `rebuildSearchIndex()`（IPC + 设置项）用于极端修复。

> 是否用 external-content 表（`content='search_docs'`）可二期再评估：它省不了空间（分词文本仍需落表），但能让索引/正文彻底分离。**一期用普通 FTS5 表即可**。

### 7.4 排序与摘要

排序（SQL 内完成主排序，JS 只做轻量后处理）：
```sql
SELECT f.note_id, t.title, t.updated_at, parent.title AS parent_title,
       bm25(notes_fts, 10.0, 1.0) AS rank
FROM notes_fts f
JOIN tree_nodes t ON t.note_file_id = f.note_id
LEFT JOIN tree_nodes parent ON parent.id = t.parent_id
WHERE notes_fts MATCH :match
  AND t.node_type='note' AND t.deleted_at IS NULL
  AND t.id NOT IN (回收站子树)
ORDER BY
  CASE WHEN t.title = :rawq THEN 0
       WHEN t.title LIKE :prefix THEN 1
       WHEN t.title LIKE :contains THEN 2
       ELSE 3 END,
  rank, t.updated_at DESC
LIMIT :limit;
```

摘要（`snippet.ts`，两端共用）：
- 输入：原始纯文本（标题/正文）+ 命中词项；
- 在原文里定位命中区间（大小写不敏感、可处理全半角归一），从命中处向两侧截取窗口，输出 `…前文<mark>命中</mark>后文…`；
- **不再用 FTS 的 `highlight()/snippet()`**（避免分词文本泄漏、两端行为一致、可测）。
- 前端仍保留"只放行 `<mark>`"的转义，但输入是受控的纯文本转义，风险更低。

### 7.5 纯文本来源（两端）

- 桌面：已有 `notes.text_cache`（保存时由 lakex `getDocument("text/plain")` 生成，锁定态走 `src/core/lakeCaches.ts` 兜底）。索引直接用它。
- 移动：**当前没有纯文本缓存**，`notes.content` 是 Lake HTML。需要：
  1. 保存时用 `lakeHtmlToPlain()`（`src/core/lakeCaches.ts`，纯函数、两端可共享）派生并落到一个 `text_cache` 列（或 `search_index` 旁表）；
  2. 首次升级对存量笔记做一次性后台派生（开发期数据可删重建，见 AGENTS §3 #7/#10）；
  3. 索引写的就是这份纯文本。

> 这同时修掉 R3：移动端摘要不再可能截出 `<card value=...>`。

### 7.6 跨端一致性

- 分词/查询/摘要/排名全部在 `src/core/search/`，桌面主进程与移动 WebView 引入同一文件；
- 唯一平台差异是"执行 SQL 的端口"（better-sqlite3 ↔ Capacitor SQLite），SQL 文本也共享同一构造函数；
- 用同一组 fixture 做**契约测试**：给定 (title, body, query) → 断言两端产出的 `note_id + rank 顺序 + snippet` 完全一致。

### 7.7 定位/高亮（U5）

- 桌面：把 `locateEditorSearchHit` 从"找第一个文本节点"升级为"按命中词项 + 偏移在所有文本节点里遍历，支持跳过首个命中"，至少做到多词/格式化文本可定位；保留重试。
- 移动：给移动端补一个等价定位（打开后 TreeWalker + `scrollIntoView`）。
- **注意**：`docs/LAKEX-CONTRACT.md` 未记录 lakex 有原生 search/highlight API（只有 `getDocument` MIME 枚举）。若后续发现内核有查找能力，应优先用内核 API 而非 DOM 启发式，并回填契约表。

### 7.8 索引生命周期与增删改（回答“会不会一打开/一编辑就重建”）

**一句话：正常打开 0 写入；正常编辑/新增/删除都是单条 O(1)；批量重建只出现在“首次迁移 / 手动重建 / 损坏修复”三类一次性场景。**

#### 打开时
- 索引持久化在桌面 `metadata.sqlite3` / 移动 native SQLite 里，跨启动保留。
- 启动只跑 `CREATE ... IF NOT EXISTS`（幂等、无数据写入），**绝不 `DELETE FROM notes_fts` 全量重插**（当前 `store.ts:232` 就是这个反模式）。
- 可选“轻量对账”（默认后台、非阻塞）：只比对 `notes` 与 `search_index` 的 note_id 集合差 + 各 note 的 hash，发现缺失/过期才逐条补。
- 首次升级（账本为空）：**一次性**后台建索引，分片 + 进度；不阻塞首屏。开发期可直接删库重建（AGENTS §3 #7/#10）。

#### 增删改各场景
| 场景 | 操作 | 复杂度 |
|---|---|---|
| 新增 | 单条 insert（分配 rowid） | O(1) |
| 编辑标题/正文 | 单条按 rowid delete + insert（内容 hash 未变则跳过） | O(1) |
| 纯样式/结构调整（plain 不变） | hash 相同 → 跳过 | O(1) |
| 重命名/移动 | 标题变才 upsert；移动不改索引内容（父标题是 join 出来的） | O(1) |
| 软删/进回收站 | 单条 delete（推荐：FTS 只放 active 文档） | O(1) |
| purge/彻底删 | 单条 delete | O(1) |
| 恢复 | 单条 upsert | O(1) |
| 文件夹删除 | 一条 `DELETE ... WHERE note_id IN (子树)` | O(子树) |
| 同步下载 | 按远端变更集逐条 upsert/remove | O(变更数) |
| 冲突覆盖 | 单条 upsert | O(1) |
| 导入/整库恢复 | 一次性重建（后台） | 批量，非热路径 |

- **内容 hash 短路**：`indexed_hash = hash(title + plain)`；未变直接 return。这保证“连续保存 / 纯样式改动”不产生写放大。
- **与笔记写入同事务**（桌面）/ 同一 maintenance 队列（移动）：避免“笔记写了、索引没写”的漂移。
- **推荐 FTS 只放 active 文档**：进回收站即删索引行，恢复即重建。这样查询不再需要递归回收站 CTE，读更快；删除路径本来就已有 `DELETE FROM notes_fts`，改动小。

#### 写入路径要“收口”，避免漏更新
当前 FTS 删除散落在 `syncReconciliation.ts` / `trashLifecycle.ts`。重构时收敛为 Store 上的 `indexNote(noteId)` / `unindexNotes(noteIds)`，所有写路径只调它们。
更稳的做法：**external-content + 触发器**——只写 `search_docs` 一张普通表，由触发器维护 `notes_fts`，从机制上杜绝漏更新（这正是思源 external-content 的做法）。
但要先用 spike 验证 Capacitor 插件能建 external-content FTS5 与 `VALUES('delete',...)` 触发器；不行就退回手工收口方法。

#### 批量重建只在这三种情况
1. 首次迁移（账本为空）；
2. 用户显式“重建索引”（需补设置项 + IPC，当前没有）；
3. 损坏修复或更换分词器（schema 变）。
三者都走后台 `enqueueMaintenance` + 分片事务 + 进度反馈，绝不阻塞 UI。

#### 成本量级（实测 + 估算）
- 单条 upsert：hash + 一次索引查找 + 单行 FTS 写。5KB 文档分词 O(n)，桌面亚毫秒级；移动多几次 bridge 往返，约 1–4ms（可合并成一次 transaction/execute 减少往返）。
- 全量重建：桌面 20k 文档 **346ms**（实测，非真实语料）；移动受 bridge 往返影响，必须**分片批量**（一次读一批、一次 execute 批量插入），5000 篇预计数秒级、仅一次性。
- FTS5 自动 segment 合并会有偶发小尖峰；空闲时可 `optimize`，非必需。

#### 7.8.1 与 S3「只传改动」的关系：能不能共用同一份列表

先厘清项目里现有的三套“改动检测”，它们不是同一件事：
1. **资产上传**：不是 hash 列表，而是 **manifest 声明差集 + 唯一文件名**。`buildAssetFilename` = `{13位时间戳}_{随机8hex}.{ext}`（`assetNaming.ts:135` / `randomHex4`），**不是内容 hash**；“同名即同内容”靠每次写都换新名、绝不覆写；上传只比云端 latest 是否声明该 filename（AGENTS §3 #11），不逐对象 hash/HEAD。
2. **笔记正文同步**：`sync_base.content_hash`（磁盘 .lake 字节的 sha256，`diagnostics.ts:113` 与磁盘比对）+ `base_hash` 基线 + `last_uploaded_hash`；`decideUpload` 用 `synced 且 remoteContentHash===baseHash` 做 skip-fast。
3. **搜索**要的是 `hash(title + plain)`，plain 是 .lake 派生的**纯文本**。

**不能共用同一个值 / 同一张列表**：
- 对象不同：raw .lake 字节 vs 派生纯文本；
- 单调性单向：raw 不变 ⇒ plain 不变（可安全跳过）；**raw 变 ≠ plain 变**（改样式 / data-lake-id / asset token 时 raw 变、plain 不变）；
- 时序不同：`sync_base` 只在同步时更新/清除；搜索必须在**本地未同步**笔记上立刻正确；
- 方向相反：S3 是“云端缺什么”，搜索是“本地派生物过期了什么”；
- 红线：`sync_base` 的 baseHash/lastUploadedHash **绝不上 manifest**（AGENTS §4），不能当通用派生哈希表。

**可以共用的**：写入口。桌面 `noteContent.save/updateNoteCaches` 与移动 `noteRepository.saveNote` 已是“缓存 + 搜索”的同一入口，在这里一次读出 raw，同时更新 raw hash（sync）与 plain hash（search），不重复读盘。可合并成一张 `note_derived(note_id, content_hash, text_hash, fts_rowid, indexed_at)` 账本，但 `sync_base` 保持独立。

**推荐分层短路**：
- L0：raw 未变 → 跳过 plain 计算与重索引（安全单向推断）；
- L1：raw 变才重算 plain，比 `text_hash` 决定是否动 FTS；
- L2：plain 变才单条 rowid 改写。
注意标题也纳入 `indexed_hash = hash(title + plain)`，改名要单独触发。

**不要**拿 S3 的 `sync_state`/dirty 列表当搜索待建列表：它不含“已同步但派生物过期 / 损坏 / 首次建索引”的笔记，硬合并会丢状态。
### 7.9 移动端统一（结论：能统一，但有 3 个平台差异要处理）
- **能统一的**：分词、查询构造、摘要、排序、结果契约（`SearchResult`）全部放 `src/core/search/`，两端同码；两端都用 FTS5（安卓内核已确认有）；同一段 SQL 文本。
- **要处理的差异**：
  1. **纯文本来源**：桌面用 lakex `getDocument("text/plain")`（`desktopTypes.ts:80`），锁定态走 `lakeHtmlToPlain` 兜底。移动端当前只保存序列化 `content`，没有纯文本缓存。必须在移动编辑器边界取同样的 `text/plain`（`window.__mobileEditor` 的 lakex 是否暴露 `getDocument` 需确认），否则退回两端共享的 `lakeHtmlToPlain`。**若两端来源不同，索引内容与摘要就会不同，就谈不上完全统一。**
  2. **执行方式**：移动是 Capacitor 异步逐语句/批量 `execute`；首次建索引/重建必须分片批量，不能逐条 5000 次往返。
  3. **写路径挂点**：移动的 `noteRepository.saveNote`（已 1s 防抖）、trash/purge、`syncDbPort` 应用远端都要挂 `indexNote/unindexNotes`；schema 加 `notes_fts` + `search_index` + `text_cache`。
- **一致性护栏**：同一组 fixture（title/body/query → note_id 顺序 + snippet）在桌面与移动各跑一次，断言完全一致。
---

## 8. 分阶段落地计划

> 开发期数据可删重建（AGENTS §3 #7/#10），因此**可以直接换 schema，不写迁移/兼容**。

| 阶段 | 交付 | 验收 |
|------|------|------|
| **P0 契约先行** | `src/core/search/` 纯函数（segment/buildQuery/snippet/rank）+ 单测 | 1/2/3+/混合/特殊字符/空白/超长 全绿；与原型表一致 |
| **P1 桌面替换** | 新 `notes_fts` DDL + `search_index` 账本 + `searchRepository` 重写；保存/同步/删除的 upsert/delete 改 rowid | 旧的长度分支测试改写；`tsc` / `vitest` 全绿 |
| **P2 增量与重建** | 启动不再全量重建；后台对账；`rebuildSearchIndex` 暴露 IPC + 设置项 | 启动无 O(N) 读盘；手工重建可用 |
| **P3 移动替换** | 移动端 `text_cache` 派生 + 用同一核心/FTS5；`bridge.searchNotes` 走新路径 | 安卓模拟器实测；与桌面同查询同排序（契约测试） |
| **P4 UX** | 摘要/高亮、相关性排序、多词、`↑↓`/Enter、空态；定位改进；是否搜小记的产品决策 | 手测 + CDP 实测 |
| **P5 基准** | 5000 文档（基线）+ 合成 100k 文档的索引体积/重建/延迟基准 | 达标（见 §9） |

**每阶段门禁**：`npx tsc --noEmit` · `npx vitest run` · `npx vite build` · `npx vite build -c vite.mobile.config.ts`（移动相关阶段加 `scripts/android-build.sh --sync --install`）。搜索只读本地派生数据，**不涉及 S3/同步协议，不需要改 manifest/GC**。

---

## 9. 性能与容量预算

- 基线：**5000 文档**（README §设计先决条件 #5）；长期 100k（AGENTS §1）。
- 索引体积：20k 合成文档实测 unigram 18.9MB（bigram 25.4 / trigram 35.9）。按此推算 5000 篇更小；**真实语料以 P5 实测为准**，目标仍定 ≤ 2× 纯文本。
- 启动：**零全量重建**；对账增量 <1s（仅比对 hash）。
- 查询：5000 篇 p95 < 50ms；100k 篇 p95 < 150ms（common-char phrase 需实测）。
- 单次保存：upsert = 1 次 `DELETE WHERE rowid` + 1 次 `INSERT`，O(1)。

---

## 10. 风险与开放问题

1. ✅ **（260911 已解决）Capacitor 插件建 FTS5 表 / 跑 `MATCH`**：模拟器实测全部通过（见 §13）——`unicode61`/`trigram`、`MATCH`、`bm25()`、`snippet()`、`optimize`、external-content+触发器均可用。**本方案已无平台不确定项。**
2. **拉丁子串**：unigram 把拉丁当整词，会失去 trigram 那种"任意 ≥3 字母子串"。缓解：末尾前缀 `*`、或对拉丁也按 bigram 索引（复杂度上升）。需产品确认。
3. **单字/常用字查询命中面**：靠分级排序 + limit 收敛；必要时对 1 字查询加"标题优先 + 正文最多 N 条"。
4. **繁简/全半角/大小写**：一期用 `unicode61` 自带折叠 + NFKC；繁简折叠（思源 `han_insensitive`）列为可选，需映射表。
5. **移动端存量纯文本派生**：首次全量派生耗时；开发期可直接删重建。
6. **不索引附件内容**、**不索引小记**（除非产品确认）、**索引不参与同步**（派生数据，各端本地重建）——都需在方案里显式写明，避免被误认为遗漏。
7. **定位仍是 DOM 层**：lakex 无公开查找 API；若体验仍差，需评估是否向内核侧要能力（回填 `LAKEX-CONTRACT.md`）。

---

## 11. 建议的下一步

1. ✅ **安卓 FTS5 最小 spike（260911 已完成）**：模拟器实测通过，证据见 §13；可直接进入 P0。
2. 用户拍板**分词粒度**：**A unigram（推荐，最简、实测索引最小）** vs **B bigram（短查询快约 10×、查询构造更复杂）**——优缺详见 §6.7/§6.8。
3. 范围已定：**本期只做文档，小记暂不搜索**；附件文件名也留二期。
4. 拍板后按 P0→P5 落地；本文档作为设计依据，落地时把结论回填 `HANDOFF.md` §3。

---

## 12. 参考与源码位置

**本项目**
- 桌面索引：`electron/searchRepository.ts`、`electron/schemaInit.ts:134`、`electron/store.ts:232/511`
- 桌面 UI：`src/components/SearchPanel.tsx`、`src/features/editor/EditorTab.tsx:60`
- 移动：`src/core/mobileSearch.ts`、`src/mobile/noteRepository.ts:99`、`src/mobile/settings/SearchSheet.tsx`
- 正文纯文本：`src/core/lakeCaches.ts`、`docs/LAKEX-CONTRACT.md`
- 测试：`electron/searchRepository.test.ts`、`src/core/mobileSearch.test.ts`、`electron/store.test.ts:355`、`electron/workspace.benchmark.test.ts:45`
- 待办出处：`docs/TODO.md:39`、`README.md` §设计先决条件 #5/#6

**思源（只读参考，AGPL-3.0）**
- `kernel/sql/database.go:294/512/2069`（blocks_fts、ftsTokenize）
- `kernel/model/search.go:2314/2467`（MATCH）、`:3212`（columnFilter）、`:3254`（stringQuery）、`:2331`（分级排序）
- 分词器实现：`~/go/pkg/mod/github.com/88250/go-sqlite3@v1.14.13-.../sqlite3-binding.c:236988, 237828, 237889`

**外部**
- SQLite FTS5 文档：https://www.sqlite.org/fts5.html
- SQLCipher for Android：https://github.com/sqlcipher/sqlcipher-android
- `@capacitor-community/sqlite`：https://github.com/capacitor-community/sqlite

---

## 13. 安卓端 FTS5 实测结论（260911，模拟器 emulator-5554）

- **环境**：AVD `lake_mobile`（pixel_6/API36/arm64），App `com.lakenotes.mobile`（debug）；`scripts/emu-cdp.sh` 转发 WebView 到 CDP，注入 JS 直接调 `window.Capacitor.Plugins.CapacitorSQLite`。**未改任何应用代码**，用独立库 `fts5_spike_*`，测后清理（已确认设备无残留）。
- **引擎**：`@capacitor-community/sqlite@8.1.1` → `net.zetetic:sqlcipher-android:4.17.0` → SQLite **3.53.3**（`ENABLE_FTS5`）。

实测（全部通过）：

| 项 | 结果 |
|---|---|
| `CREATE VIRTUAL TABLE ... fts5(..., tokenize='unicode61')` | ✅ |
| `tokenize='trigram'` 建表 | ✅ |
| 单字/双字/三字查询（短语） | ✅ `编`/`编辑` → n1,n2,n3；`编辑器` → n1,n2（**n3 有 编…辑…器 不相邻，正确不命中**） |
| 拉丁大小写不敏感 | ✅ `Lake`/`lake` → n1 |
| `bm25(fts,10.0,1.0)` 排序 | ✅ |
| `snippet()` | ✅（返回**分词后带空格**文本 → 印证摘要要在 JS 用原文生成） |
| `INSERT INTO fts(fts) VALUES('optimize')` | ✅ |
| external-content（`content='search_docs'`）+ 触发器 | ✅ 插入自动索引；`VALUES('delete',...)` 触发器删行后查询返回空 |

同 fixture 桌面 vs 安卓结果对比（相同分词 + 相同查询构造）：

| 查询 | 桌面 better-sqlite3 | 安卓 SQLCipher |
|---|---|---|
| 编 | n1,n3,n2 | n1,n3,n2 |
| 编辑 | n1,n3,n2 | n1,n3,n2 |
| 编辑器 | n1,n2 | n1,n2 |
| Lake / lake | n1 | n1 |
| 编辑 器 | n1,n2 | n1,n2 |

**移动端纯文本来源已确认**：`window.__mobileEditor`（`DocumentEditor.tsx:104` 赋值）的 lakex 实例暴露 `getDocument`；实测 `getDocument("text/plain")` 返回干净纯文本（例：`压测N-026\n标识 STRESS2-...-026。这是压测第二轮的富内容文档。`）。→ **移动端可用与桌面相同的 `getDocument("text/plain")` 作索引源，不必退回 `lakeHtmlToPlain` 兜底**，两端索引内容可完全一致。

唯一小坑（不影响功能）：`closeConnection` 之后再 `deleteDatabase` 会报 `No available connection for database`；应在 close 之前删库或忽略该错误，且确认无残留文件。

**结论：A 方案在安卓端的技术前提全部成立（含 external-content+触发器），可进入 P0。**
