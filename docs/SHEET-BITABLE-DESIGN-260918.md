# 表格 / 多维表 支持设计（260918）

> **命题（用户）**：给 Lake Notes 增加「表格」和「多维表」，像语雀那样用得顺手；两者都要走 S3 与目录栏，作为**新建项**（新建表格 / 新建多维表）与 Lake 文档、小记共存。参考实现 = `/Users/admin/file/local-lake/local-lake-notes-tauir`（最初灵感来源，套 Lake 资源做本地，已做过表格与多维表）。
> **本文性质**：设计调研 + 方案定稿建议。**不含代码改动**。

---

## 0. 结论先行（六条核心决策）

| # | 决策 | 一句话理由 |
|---|---|---|
| **D1** | 表格/多维表是**新的文档种类**（`notes.kind`），但**复用笔记的存储与同步管线**；`tree_nodes.node_type` 仍保持 `note` | 新增 `node_type` 会牵动回收站/目录/两端同步的每一处 `node_type==="note"` 分支；而 `kind` 是纯附加维度，**零回归面** |
| **D2** | 本地正文仍写 `notes/{id}.lake`（kind-agnostic 容器），**不新建目录、不改 `notePathFor`** | 历史快照/回收站/purge/备份/孤儿扫描全都以这个路径为唯一入口，改路径 = 全线返工 |
| **D3** | S3 **零新增前缀**：正文 → `objects/{id}-{hash}.lake`，图片/附件 → `assets/{id}/{filename}`，清单仍是 `manifests/latest.json` | 内容寻址对象不关心内容是 HTML 还是 JSON；**GC / 墓碑 / 深清理 / 声明差集一行都不用改** |
| **D4** | `MANIFEST_VERSION` 5 → **6**（新增 `kind` 字段），读兼容 `{4,5,6}` | 不 bump 的话**旧端会把表格 JSON 当 Lake 文档打开、保存即毁**。活着的正是 v4→v5 那套「未知版本整轮拒绝」先例 |
| **D5** | 表格编辑器 = **Univer**（Apache-2.0）+ ExcelJS（MIT，二期、懒加载）；多维表 = **自研**（无成熟可嵌入的开源多维表） | Univer 是唯一同时满足「开源可商用 + 离线 + React 18 + 公式引擎 + 多 Sheet」的成熟选项；多维表没有可嵌入方案（NocoDB/Teable 都是服务端应用，会破坏本地优先） |
| **D6** | 移动端 v1 **只保证不腐坏**：识别 `kind` → 只读占位、**禁止 Lake 编辑器打开与保存**；编辑器后置 | 移动端把正文存 `notes.content` 并原样同步，**不改就能正确搬运字节**；唯一必须做的是「别让 Lake 编辑器碰它」 |

**明确不做**（首期）：独立 S3 namespace / 把表格作为卡片嵌进 Lake 文档 / 公式·关联·汇总字段 / 表单·日历·画廊视图 / 多人协同 / 表格正文全文索引（先只索引标题）。

---

## 1. 先厘清：语雀的三种「表」不是一回事

| 形态 | 语雀里的位置 | 我们现在的状态 | 本次要做的 |
|---|---|---|---|
| **文档内表格**（rich table，`ne-table`） | Lake 文档里插入 | **已经支持**（内核 slash `cardSelect.table`，`lakeRuntime.ts:710-711` 的 `table.groups`；`ne-table-wrap` 已接表格工具栏 hover 桥） | 不做 |
| **表格文档**（语雀表格，`.lakesheet`） | 知识库目录里的独立文档，Excel 式 | 无 | ✔ 本次新增 |
| **多维表 / 数据表**（record-based database） | 独立文档，表格视图 / 看板视图 / … | 无 | ✔ 本次新增 |

### 1.1 为什么不能「打开内核里的能力」（已核实，别再去试）

- 运行内核是 `vendor/lakex-doc-react/src/components/lakex/lakex.js`（闭源 `@dlient/lakex-doc-react`）。它里面有 `icon-数据表-表格视图 / 卡片视图 / 看板视图` 三个图标（`icon.tsx:2087-2260`），**但在这份 wrapper 里从未被引用**（只有定义）——那是语雀站点的图标集，不是本地编辑器能力。
- `.lakesheet` 在 kernel 里**只出现一次**（`lakex.js:122081`），位于一个**文件扩展名数组**（`.docx/.lake/.lakebook/.lakesheet/.lakemind/.lakeshow/...`）里 —— 那是「上传文件时的类型识别」，不是「嵌入表格编辑器」。
- wrapper 源码目录只有 `BlockCardSelect / BlockContextMenu / BlockHoverHandle / CardResizer / lakex / plugin(bookmark,imageToolbar)`，**没有任何 sheet/bitable 组件**。

⇒ 结论：**内核是文档编辑器，表格与多维表本来就是语雀的另外两个应用**。本地要不来，只能自己做（或嵌第三方编辑器）——这正是 tauir 走的路。

---

## 2. 参考实现 tauir 给我们的可复用结论（读源码得到）

| 它的做法 | 我们是否照搬 | 说明 |
|---|---|---|
| 表格用 **Univer**（`@univerjs/core` + `preset-sheets-core` + `themes` 0.21.1），落盘是 **Univer `IWorkbookData` 快照 JSON**（不是磁盘上的 `.xlsx`：`spreadsheetSnapshot.ts:26-29` 明确「只做 JSON 序列化，不再转换为 XLSX」） | ✔ 照搬思路 | 与我们的「纯文本正文 + 内容寻址对象」天然契合 |
| ExcelJS（MIT）做 xlsx 双向桥，**明确拒绝 Univer Pro exchange-client**（依赖商业 license） | ✔ 照搬 | 我们二期做，且懒加载 |
| 多维表 = **自研**，格式 `{ kind: "multidimensional-table", version, fields, records, views, activeViewId }`，文件后缀 `.dbtable.json` + 内容判别字段双保险 | ✔ 照搬数据模型，**改后缀与判别字段**（见 §3.2） | 它的 plan 明确首期不做公式/关联/汇总/表单/日历 |
| 文档种类进目录树、参与重命名/移动/删除/导出 | ✔ 一致 | 它的 `WorkspaceDocument.kind = "lake" | "spreadsheet" | "multidimensional-table"` |
| 自动保存防抖 900ms，且**中间状态不推父组件重渲染**（`spreadsheetAutosave.ts:116-134`） | ✔ 照搬 | 表格/多维表对焦点极敏感，这条是硬要求 |
| 它把文件**直接放知识库目录**（`.xlsx`/`.dbtable.json` 与 `.lake` 平级），没有数据库行 | ✘ **不照搬** | 我们的目录树是 DB（`tree_nodes`）+ manifest，**文件系统不是真相源**；必须走笔记管线，否则同步/回收站/历史全断 |

---

## 3. 数据模型与文件格式

### 3.1 表格（kind = `sheet`）

**正文 = Univer `IWorkbookData` 的 JSON**（不发明自己的格式）。新建时的空工作簿参照 tauir `spreadsheetDocument.ts:18-65`：1 个 sheet、100 行 × 26 列、默认行高列宽、`locale = zh-CN`。

要点：
- **不要 pretty-print**。tauir 用 `JSON.stringify(x, null, 2)`（`spreadsheetSnapshot.ts:28`），体积直接翻倍；我们写紧凑 JSON。
- Univer 的 workbook **id 在文档内固定**即可；我们的全局唯一键是 noteId，两者不要混。
- xlsx 只在**导入/导出**时出现（ExcelJS，懒加载 chunk），不参与同步与存储。

### 3.2 多维表（kind = `bitable`）

> **260919 修订**：多维表的**产品口径与数据模型已改为一文档多数据表**，以 `docs/BITABLE-PRODUCT-SPEC-260919.md`（§1.9 钉钉对照 / §3.3 v1 范围 / §4 模型 / §6 决策记录）为准；
> 下面这段是**初稿的单表模型**，其中 `BitableDoc { fields, records, views }` 已被该文档的「**文档 ⊃ 表 ⊃ 视图**」三层结构（`BitableDoc.tables[]`）取代，字段清单也以产品文档为准。

沿用 tauir 的 record-based 模型，但判别字段与扩展名换成我们自己的（避免与它的文件互串，也避免以后导出时混淆）：

```ts
type FieldType = "text" | "longText" | "number" | "select" | "multiSelect" | "date" | "checkbox" | "url" | "attachment";

interface BitableField { id: string; name: string; type: FieldType;
  options?: { id: string; name: string; color?: string }[]; width?: number; }
interface BitableRecord { id: string; values: Record<string, unknown>; createdAt: string; updatedAt: string; }
interface BitableView { id: string; name: string; type: "grid" | "kanban";
  groupByFieldId?: string; hiddenFieldIds?: string[]; }

interface BitableDoc { kind: "bitable"; version: 1;
  fields: BitableField[]; records: BitableRecord[];
  views: BitableView[]; activeViewId: string; }
```

设计原则（为将来留门，但不现在实现）：
- **字段类型用开放字符串**：旧版本遇到未知 type 只读展示、不清空数据 ⇒ 以后加字段类型不需要 bump 格式版本。
- **值以 `values[fieldId]` 存储**（不是按列序），加字段/改字段顺序不动已有记录。
- **附件字段存 filename**（`assets/{noteId}/{filename}` 里的名字），直接复用现有资产管线与 `manifest.assets` 声明——**这是复用管线最大的红利**。
- 首期字段类型：`text / longText / number / select / multiSelect / date / checkbox`；`attachment` 只留格式位（二期接上传）。
- **类型词表对齐思源 AV 的命名**（`siyuan-master/kernel/av/av.go:158-176`，16 种：`block(主键)/text/number/date/select/mSelect/url/email/phone/mAsset/template/created/updated/checkbox/relation/rollup/lineNumber`），并且**视图词表也取它的三种**（`table/gallery/kanban`）。理由：那是目前最完整的本地优先数据库语义集，用它的词表意味着我们以后加字段类型时**不需要改格式版本**，也便于对照实现细节。
- 默认模板：`标题(text)` + `状态(select: 待开始/进行中/已完成)` + `日期(date)`，视图 = 表格 + 看板（看板按「状态」分组）。

---

## 4. 存储与 S3 设计（本节是核心）

### 4.1 本地（按种类分目录 —— 复核后从「共用一个容器」改为「各归其位」）

> 初稿曾建议三种文档共用 `notes/{id}.lake`（理由是「少改动」）。**复核后推翻**：路径只有一个出口，分目录其实很便宜，而 `.lake` 这个扩展名对 JSON 正文是错的、会长期误导排查。

```text
workspace-default/
├─ metadata.sqlite3                  # + notes.kind 列（ALTER TABLE，默认 doc）
├─ notes/{noteId}.lake               # kind=doc      （现状不动）
├─ sheets/{noteId}.sheet.json        # kind=sheet    （新增；Univer IWorkbookData JSON）
├─ bitables/{noteId}.bitable.json    # kind=bitable  （新增；自有 record-based JSON）
├─ note-assets/{noteId}/{filename}   # 三种共用（表格插图 / 多维表附件）
└─ history/{noteId}/*.lake.gz        # 三种共用（正文是文本就能快照）
```

**为什么这仍然便宜**（实测调用面）：
- 正文路径**只有一个出口** = `store.notePath(id)`（`electron/store.ts:296`）。全仓库 `notePathFor` 37 处引用、`notePath(` 17 处调用**全部经它**；`notes/` 字面量只有 2 处（`store.ts:149` 建目录、`store.ts:296` 拼路径）。
  ⇒ 分目录 = **改 1 个函数 + 加 2 处建目录**，不是 37 处返工。
- 唯一的真难点：`notePath(id)` 只吃 id，而 kind 在 DB 里。做法 = 函数内查 `SELECT kind FROM notes WHERE id=?`（主键查询）+ 进程内 Map 缓存（**kind 创建后不可变 ⇒ 缓存永不失效**）；查不到（行已删）→ 回退 `notes/{id}.lake`。
- 两个边界已核对：
  - `trashLifecycle.ts:255` 取路径发生在事务内、`delNote`（`:270`）之前 ⇒ 行还在，查得到；
  - `syncAdapters.ts:193` `readDeletedContent` 面对的是**已 purge（行已删）**的墓碑 ⇒ 走回退；而 purge 本来就把 `.lake` 删了，返回 `null` 是正确语义。
- `workspaceBackup` 是遍历 workspace 根目录复制（`workspaceBackup.ts:37-48`）⇒ 新目录**自动进备份**，无需改。
- **不把 `notes/` 改名成 `docs/`**：纯改名收益只是好看，代价是既有开发数据全部「文件找不到」。要改单独立项。

- `notes` 加一列：`ALTER TABLE notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'doc'`（值 `doc|sheet|bitable`）。**不动 `tree_nodes` 的 CHECK 约束**。
- 新建入口复用现有漏斗 `store.createNoteInWithContent(parentId, title, content, assets, id, position)`（`electron/store.ts:412`），只是传入不同的 `content` 与 `kind`。
- 回收站、purge、历史、孤儿、备份：**逻辑零改动**（它们只认 noteId；路径由 `notePath` 统一解析）。

### 4.2 S3（布局不变是刻意的）

```text
{prefix}/
├─ objects/{noteId}-{contentHash}.lake     # 三种文档的正文对象（内容寻址，扩展名只是历史命名）
├─ assets/{noteId}/{filename}              # 三种文档的资源
├─ manifests/latest.json                   # 单清单，条目带 kind
└─ manifests/{commitId}.json
```

**为什么这是「最好的方式」**：同步引擎对正文是**字节无关**的——它只做 `sha256(内容)` → 比对 → 上传/下载 → 校验。表格 JSON 与 Lake HTML 在它眼里完全同类。因此我们**白拿**：

| 能力 | 来源 | 需要改什么 |
|---|---|---|
| 多端同步 / 内容寻址去重 | `syncEngine` | 无 |
| 墓碑 / 软删 / 回收站 / 恢复例外 | `syncDecisions` + `trashLifecycle` | 无（`kind` 随 manifest 走即可） |
| 冲突覆盖前强制留档 | `createHistorySnapshot` | 无（正文是文本） |
| GC / 深清理 / 待回收 / 年龄保护 | `sync.ts` + `gcPolicy` | 无（键空间没变） |
| 资产声明差集 / 孤儿跳过 | `scanLocalAssets` | 无 |
| 备份 / 云端恢复 | `workspaceBackup` | 无 |

**S3 为什么不跟着本地一起按 kind 分目录**：
- `objects/` 前缀是 GC 枚举（`sync.ts:475`）、purge 前缀删除（`deletePrefix("objects/{id}-")`）、深清理的共同锚点。拆成 `sheets/` / `bitables/` = N 套键空间 × N 套 GC/purge/对账路径，**零功能收益**——类型已经由清单里的 `kind` 表达，对象本身是内容寻址的 hash。
- 键尾 `.lake` 要不要改：`objectKey()`（`src/core/syncUtils.ts:76`）是非测试 15 处调用的唯一拼接口，改成 `.obj` 之类技术上可行，但同样零收益，且会让桶里既有对象变成「未引用」而被 GC 回收。**保持不动。**
- 一句话：**本地布局给人看（要正确），S3 布局给 GC 看（要稳定）。**

### 4.3 清单协议变更（三处同改，`docs/STORAGE-LAYERS.md` §0 铁律）

1. **类型**：`src/core/manifestTypes.ts` → `ManifestNote` 加 `kind?: "doc" | "sheet" | "bitable"`（缺省 = `doc`，兼容旧清单）。
2. **两端 build/apply**：
   - `buildUploadEntry`（`src/core/syncDecisions.ts:93`）带上 `kind`；`LocalNoteState` / `SyncNoteRowShape` / `rowToLocalState` 同步加字段。
   - 桌面 `electron/syncAdapters.ts` 的 `rowFromSync` / `applyRemoteNote` / `applyRemoteNoteMeta`；移动端 `src/mobile/syncDbPort.ts` 的对应方法。
   - 新建 `notes.kind` 的读写（`noteQueries.ts` / `schemaInit.ts` / 移动端 `schema.ts`）。
3. **版本**：`MANIFEST_VERSION = 6`，`READABLE_MANIFEST_VERSIONS = {4,5,6}`；`docs/SYNC-PROTOCOL.md` 的 schema 段同步更新。

> **版本号是安全闸，不是仪式**：v5 代码读到 v6 清单会走 `validateManifest` 的「版本不兼容」→ 整轮中止（`syncUtils.ts:195-197`），**明确报错而不是把表格当文档打开**。代价是「升级要所有端一起升」，对个人 2-3 端可接受；不 bump 的代价是静默毁数据。

### 4.4 必须按 kind 分支的三处「正文当作 Lake HTML 处理」

现有代码里正文会被喂给 Lake 的文本抽取器（`src/core/lakeCaches.ts` 的 `lakeHtmlToMarkdown` / `lakeHtmlToPlain`）：

| 位置 | 现状 | 非 `doc` 类型要做的 |
|---|---|---|
| `electron/store.ts:545-546`（保存） | 保存后重算 markdown/plain 缓存 | 按 kind 分支：表格/多维表 → markdown = `null`，plain = 抽取器（v1 可为 `null`，即只搜标题） |
| `electron/store.ts:565-566`（导入/恢复） | 同上 | 同上 |
| `electron/store.ts:408`（复制文档 / `:613` 读取缓存兜底） | 同上 | 同上 |

**为什么这是 M0 必做而非优化**：把一坨 JSON 交给「Lake HTML → 文本」解析器，轻则索引里塞进垃圾、重则解析抛错导致**保存失败**。它在「每次保存」的路径上，属功能级风险。

对应地，创建路径是安全的：`electron/store.ts:460` 只写 `upsert(id, title, "")`，不会解析正文。

### 4.5 被否决的方案（写下来防以后重走）

| 方案 | 否决理由 |
|---|---|
| 独立 S3 namespace（`sheets/`、`bitables/` + 独立清单 + 独立 GC） | 等于把整条资产/GC/墓碑管线复制两遍；且跨类型目录移动、备份、回收站都要重做。收益仅是「键好看」 |
| 把表格嵌成 Lake 文档里的卡片（像画板卡） | 内核没有这类卡片；自研卡片要重做编辑器挂载/序列化/水合三套，且文档只能单端打开 |
| 用一个 `node_type` 新值（`sheet`/`bitable`） | 触碰 `tree_nodes` 的 CHECK 与所有 `node_type==="note"` 分支（回收站子树、墓碑、两端映射）——回归面最大、收益为零 |
| 复用 Univer 的「数据库」能力 | Univer 没有 bitable preset；且其 Pro 路线依赖商业 license（tauir 已否决） |

---

## 5. 同步语义逐条核对（这是「能不能上」的关键）

| 场景 | 现有机制 | 对表格/多维表是否成立 |
|---|---|---|
| 两端各改同一张表 | 先提交者胜；被覆盖方**强制留档历史快照** | ✅ 成立（正文是文本）。用户会看到「远端修改已覆盖本地 N 篇（已存历史）」，从历史里能整份找回 |
| 删除/回收站/恢复 | 软删 = 移到回收站笔记本；恢复 = 唯一例外 | ✅ 成立（只认 noteId） |
| 彻底删除 | purge 写墓碑 + 删 `objects/{id}-` 与 `assets/{id}/` 前缀 | ✅ 成立 |
| 云端 GC | keep 集来自 manifest 声明 | ✅ 成立（`kind` 不影响引用收集） |
| 桶被清空/换桶 | `decideUpload` 对远端缺失一律 upload | ✅ 成立 |
| **旧版本客户端** | 读清单版本校验 | ⚠️ **必须 bump 版本**，否则旧端按 Lake 打开并保存 = 表格变 HTML（不可逆） |
| 移动端 | 正文存 `notes.content`，原样同步 | ✅ 搬运没问题；❌ **不能让 Lake 编辑器打开**（见 §7） |

---

## 6. 编辑器选型论证

### 6.1 表格：候选全貌与取舍

> **260919 更新（已落地）**：本节是 260918 的选型论证（当时推荐 Univer、CE/FortuneSheet 出局）。用户实测后选定 **FortuneSheet**，已按 `docs/FORTUNESHEET-FEASIBILITY-260919.md` 完成替换（CSP 补丁 + 正文 v2 + 编辑器重写）。**本节结论以该文档为准**。

数据是 2026-09-18 从 npm registry / GitHub API 实取的（不是印象）：

| 候选 | 许可 | 活跃度 | 体积（unpacked） | 判断 |
|---|---|---|---|---|
| **Univer**（`@univerjs/core` + `preset-sheets-core` + `themes`） | Apache-2.0 | ★14.4k，最近推送 **2026-09-18**；preset 116 万下载/月 | core 2.94 + preset 9.47 MiB | ✅ **推荐**：唯一同时满足开源可商用 + 离线 + React + 完整公式/多 Sheet/工具栏；tauir 已跑通 |
| FortuneSheet（`@fortune-sheet/react`） | MIT | ★3.7k，最近推送 **2025-12**（明显转冷） | 7.84 MiB | ⚪ **备选**：Luckysheet 的 React 重写、MIT 更宽松；但维护趋缓、生态小 |
| jspreadsheet CE | MIT | ★7.2k，最近推送 **2026-09-17**（很活跃） | 0.30 MiB（包体极小） | ⚪ **轻量路线**：若只需要「表格式录入/计算公式」而不追求 Excel 级，它体量小一个数量级 |
| **Luckysheet** | MIT（npm 未声明） | ★16.6k，**仓库已 archived**（`archived=true`），自身描述写着「**Luckysheet upgraded to Univer**」 | 28.8 MiB | ❌ **官方已死并钦点 Univer**；选它等于接手一个归档项目 |
| **x-spreadsheet**（`x-data-spreadsheet`） | MIT | ★14.6k，最后推送 **2024-08-07**，**412 个未处理 issue**；描述写着「**migrated to @wolf-table/table**」，而后者 ★676、最后推送同日、npm 仍是 **0.0.3** | 1.16 MiB | ❌ 本体与官方指定的继任者**都已停摆**；「太薄 + 无人维护」双重不合格 |
| Handsontable | 商用需授权 | — | — | ❌ 违反「不引入商业订阅」 |
| AG Grid Community | MIT | ★很活跃 | 20.6 MiB | ❌ 是 grid 不是 spreadsheet（公式在 Enterprise） |
| HyperFormula（公式引擎）作底座 + 自研网格 | **GPL-3.0-only** | 160 万下载/月 | 12.3 MiB | ❌ **许可红线**：GPL 会传染到整个 Electron 分发物。这个坑很常见（「Univer 太重，那就 HyperFormula + 网格」），必须挡住 |
| 自研网格 + 自研公式 | — | — | — | ❌ 无底洞，且远离产品目标 |

#### 需求校准（260918 用户口径）—— 这一条改变了选择的天平

> 用户明确：**「这种笔记大部分只要结构化存储和简单公式；真正用 Excel，可以在文档里挂附件」⇒ 不需要实现完整的 Excel 功能。**

这条口径是对的，而且它把选型从「谁功能最全」改成「谁最省且够用」。逐项核对：

| 能力 | jspreadsheet CE | FortuneSheet | Univer | 我们需要吗 |
|---|---|---|---|---|
| 单元格编辑 / 行列增删 / 复制粘贴（Excel 快捷键直通） | ✅ | ✅ | ✅ | **需要** |
| 公式 | ✅ 单表公式（跨表/矩阵/`A:A` 动态区域属 **Pro** 付费扩展） | ✅ 内置（fork 自 formula-parser） | ✅ 专业公式引擎 | **简单公式即可** ⇒ 三家都够 |
| 多 Sheet | ✅（v5 起 workbook/worksheets 分离） | ✅ | ✅ | 可选 |
| 样式 / 合并 / 冻结 / 排序 / 筛选 | ✅ 基础 | ✅ 更全（条件格式、查找替换、批注、图片、数据校验） | ✅ 最全 | 基础够用 |
| 图表 / 透视表 | ❌ | ❌（roadmap 未做） | 部分（Pro 更全） | **不需要**（真 Excel 挂附件） |
| **xlsx 导入导出** | ❌ **CE 没有**（仓库里无 xlsx 实现，示例只有 CSV） | ⚠️ 靠第三方社区插件 [fortuneexcel](https://github.com/corbe30/fortuneexcel)（★36，MIT） | ❌ 官方在 Pro（商业 license）；社区路线 = 自己写 ExcelJS 桥 | **不需要**（挂附件） |
| 体积（jsDelivr dist 实测，非 unpacked） | 0.16 MiB + peer `jsuites` 0.42 MiB ＝ **最轻** | core 7.58 MiB + 239 KB CSS | preset 9.37 MiB + core 2.43 MiB ＝ **最重** | — |
| React 集成 | ✅ 官方 React/Vue wrapper | ✅ `@fortune-sheet/react` 一等公民 | ✅ preset + Facade API | — |
| 移动端/触屏 | 官方称更好移动兼容 | roadmap 标 ✅ 移动适配 | canvas，桌面导向 | 二期才需要 |
| 许可 | MIT | MIT | Apache-2.0 | 都可以 |
| 维护活跃度（2026-09-18 实查） | ★7.2k，**最近推送 2026-09-17** | ★3.7k，**最近推送 2025-12-15**（转冷） | ★14.4k，**最近推送 2026-09-18** | 长期活着更重要 |

**⚠️ 修正后的建议（260918 spike 实测后反转；证据见本节末「Spike 实测结论」）**：
1. **首选 Univer**：在「prod CSP 不允许 `unsafe-eval`」这条硬约束下，**它是唯一可用的候选**（内置公式引擎不用 eval；只有显式注册「函数字符串」的自定义函数服务才用 `new Function`，我们不调用）。
2. **jspreadsheet CE 出局**（尽管体验最轻快）：① **任何公式都会触发 `eval` → 被 CSP 拦 → 整表崩**（实测只剩表头、第二个 sheet 都建不出来）；② **图片单元格只认 `data:image`**，存我们的资产 URL 不渲染（源码实锤）。
3. **FortuneSheet 出局**（尽管功能最像 Excel）：维护转冷 + **插入行列用 `new Function`**（拼 `unshift/splice` 参数）→ 同样被 CSP 拦。

> 备选路线（若你更看重 CE 的轻快）：**主动放弃公式**，只做「结构化录入 + 换行 + 多 sheet」，图片用自写的自定义列（`columns[i].render` + `openEditor/closeEditor`），再自己写一个**非 eval 的简单公式求值器**（SUM/AVERAGE/MIN/MAX/IF + 四则 + 单元格/区域引用，约几百行）。这条路可行但要额外工作量，且失去库自带公式的广度。

**「真 Excel 当附件」这条要写进产品语义**：表格文档只承诺「结构化录入 + 简单公式 + 多 Sheet」；用户要复杂公式/图表/透视表时，走「上传 .xlsx 附件」+ 需要时再打开（`assetServer` 已能内联预览 PDF/音视频，xlsx 只能下载或交给系统应用）。这样我们**永远不必追 Excel 保真**，也不必为 xlsx 导入导出背兼容债。

#### jspreadsheet CE 能力核实（换行 / 图片）—— 用户实测后提问，已逐行核对源码

**① 单元格内换行：支持，但选项没写进 v5 文档（属未文档化能力）。**

| 环节 | 结论 | 证据 |
|---|---|---|
| 显示换行 | 单元格会被加上内联 `white-space: pre-wrap` | `src/utils/internal.js:665-675`（单元格更新路径）、`:498-506`（列/表头路径） |
| 触发条件 | `wordWrap !== false` 且满足任一：全局 `options.wordWrap === true` / 该列 `columns[i].wordWrap === true` / **单元格内容 `innerHTML.length > 200`（自动换行彩蛋）** | `internal.js:667-671` |
| 编辑态 | 该列编辑器由 `<input>` 换成 `<textarea>`，因此能输入多行 | `src/utils/editor.js:218-225` |
| 默认不换行 | 单元格默认 `white-space: nowrap`（要 `wordWrap` 才会被内联覆盖） | `src/jspreadsheet.css:166` |
| 插入换行的快捷键 | v2 文档明确写 **Alt+Enter**（需 wrap 开启）；v5 源码里**没有** Enter 的按键处理（应在 `jsuites` 侧），**需在 demo 里实拍确认 Enter / Alt+Enter / Shift+Enter 哪个换行、哪个提交** | `docs/jspreadsheet/v2/examples/text-wrapping.md` |

**② 单元格内放图片：只支持 base64 data URI，存 URL 不渲染（源码实锤，推翻了初稿判断）。**

- CE 的 `{ type: 'image' }` 列在渲染时有一道硬判断（`jspreadsheet-ce/dist/index.js`）：
  ```js
  else if (column.type === "image") { if (s && "data:image" == s.substr(0, 10)) { const img = document.createElement("img"); img.src = s; o.appendChild(img); } }
  ```
  ⇒ **只有以 `data:image` 开头的值才会渲染出 `<img>`**。**存 `http://127.0.0.1:19876/{noteId}/{filename}` 这样的资产 URL ⇒ 单元格里什么都不显示**（spike 实测 `images: 0`）。
- 所以「图片存我们的资产 URL、白拿 assets 管线」的初稿方案在 CE 上**不成立**；要用它的图片列就必须内联 base64，直接后果是：① 正文被 base64 撑爆（200KB 图 ≈ 270KB 文本，每次保存还是一个全新的内容寻址对象）；② `extractAssetRefs` 认不出，图片不进 `assets/`、不进 `manifest.assets`、不参与跨端资产差集与 GC —— 与「资产统一走 assets 管线」的设计直接冲突。
- 「浮动图片」（Excel 那种可自由摆放的）属 **Pro**。
- 若坚持用 CE 的图片能力，绕法是**自写自定义列**：`columns[i].render` 自己渲染 `<img src=资产URL>`，编辑用自定义 editor（API 有 `openEditor/closeEditor`）+ 接我们的上传管线 —— 等于放弃它的图片列，自己实现一套。

**③ 图片单元格的取舍（260918 用户决策：内联 base64，但必须确认它不进 S3 清单）**

用户口径：*「图片我们不一定要自己管理……单纯文件大一点问题不大，但需要确认这个数据不会挂到我们的 S3 清单。」*

**✅ 确认：内联 base64 不会进清单，一个字节都不会。** 证据链（全部可核对）：

| 环节 | 事实 | 位置 |
|---|---|---|
| 清单里存什么 | `ManifestNote` = id/title/parentId/sortOrder/updatedAt/**contentHash**/isConflict/锁/icon/**assets[]**/墓碑字段 —— **没有任何正文字段** | `src/core/manifestTypes.ts:8-22` |
| contentHash 与体积无关 | 永远是 64 位 hex（正文的 sha256），正文 1KB 还是 10MB 都是 64 字符 | `syncUtils.ts:76-78` |
| 清单涨的只有 assets[] | 每项 `{filename,size,hash}` ≈ **130 B**（实测），且**只有走 `assets/{noteId}/` 管线的文件**才会被声明 | `manifestTypes.ts:16`、`syncAssets.ts:119-153` |
| 正文与资产是两件事 | body → `objects/{noteId}-{hash}.lake`；资产 → `assets/{noteId}/{filename}` | `SYNC-PROTOCOL.md` §2 |
| 引用提取器认什么 | `ASSET_NAME_RE = /\d{13}_[0-9a-f]{8}\.[a-z0-9]{1,10}/g` —— 只认「13 位时间戳_8位hex.扩展名」这种**资产文件名** | `src/core/assetNaming.ts:12,110-112` |
| **base64 能否误命中** | base64 字母表是 `A-Za-z0-9+/=`，**根本不含 `_` 和 `.`** ⇒ 数据 URI 里的 base64 段**不可能匹配**该正则 ⇒ 声明集不含它 ⇒ `manifest.assets` 不增加任何条目 | 同上 |

⇒ 结论：**内联 base64 只让「正文对象」变大**（`objects/{id}-{hash}.lake`），清单大小不变（该文档仍是一条 ≈341 B 的条目 + 0 个附件声明）。

**代价全部落在正文侧，且有一个必须知道的硬天花板**：

| 项 | 事实 |
|---|---|
| 正文对象上限 | **64 MiB**（`MAX_REMOTE_NOTE_BYTES`，`src/core/syncEngine.ts:34`）——**只在下行（下载）时校验**，上行不拦 |
| 超限的失败方式（重要） | 下载侧 `getObject(..., {maxBytes})` 抛「S3 对象过大」，而**这条路径没有 try/catch** ⇒ **整轮同步直接失败**（不是跳过这一条）。上传方自己不受影响（本地就是真相），**其他设备全部卡住**，且不自愈 | `syncEngine.ts:350/384/411/479` |
| 换算 | base64 涨 33% ⇒ 约 **45 MB 原始图片字节**就打满。文档里「图片不多」离这条线极远 | — |
| 每次保存的成本 | 正文变了就是**新的内容寻址对象**（全量重传），旧对象进 `s3_gc_pending`、窗口（默认 7 天）后回收 ⇒ 一段时间内的传输/存储 ≈ 正文大小 × 改动次数 | `syncEngineController.ts:57-81`、`sync.ts:391-430` |
| 历史快照 | 每次被覆盖留一份完整正文（gzip level 6），base64 压缩比差（约 0.75），快照也随之变大 | `historyLifecycle.ts:70-104` |

**建议（若走内联 base64）**：加一条**正文体积护栏**——保存/发布前测一次 JSON 字节数，超过阈值（比如 32 MiB）就提示用户，**绝不写到 64 MiB 才让同步炸掉**。这是本次唯一必须补的工程项。

> 反过来：若改走「图片进 `assets/` 管线」（我们的 canonical URL + 自定义列渲染），清单会按 **≈130 B/图** 增长——数量少也可忽略，但要额外写自定义列与上传接线（见上一条）。两条路都行，**内联 base64 更省事，且已验证不污染清单**。

#### Spike 实测结论（260918 · 分支 `spike/sheet-ce` · 真实 Electron + 真实 CSP）

环境：已有 dev 实例（vite:1421 + Electron 44.3.0，CDP:9222）；spike 页 `spike.html` 用与 `index.html` **同一个 `%VITE_CSP%`** 注入真实 CSP；依赖 `jspreadsheet-ce@5.0.4` + `jsuites@5.13.5`；驱动脚本 `scripts/spike-sheet-ce.mjs`。

| 验证项 | 结果 | 证据 |
|---|---|---|
| CSP 确实生效 | ✅ 页面拿到真实 CSP（`script-src 'self' 'sha256-…'`，**无 `unsafe-eval`**） | `window.__spike.info().csp` |
| 无公式时渲染 | ✅ 17 行、892×330，两个 worksheet 的数据都能分别读出 | `info()` / `sheetData(1)` |
| **有公式时渲染** | ❌ **整表崩**：只剩表头（`cells:7`、`h:28`），第二个 worksheet 根本没创建出来 | `?formulas=1` → `sheets:1, rows:0` |
| **CSP 违规** | ❌ `script-src blocked eval`，来源 `jspreadsheet-ce.js` | `violations()` |
| eval 出处（本地源码） | CE 核心 `eval` 做公式 token 的 typeof 检查；`@jspreadsheet/formula` 用 `new Function` 编译公式 | 包内 grep |
| **图片单元格** | ❌ 只认 `data:image` 前缀，存 HTTP 资产 URL **不渲染** | CE dist 源码 + `images: 0` |
| 隐藏 → 显示（keep-alive 模拟） | ✅ 隐藏时 rect 0×0，显示后自动恢复 892×330，**无需手动 resize**（DOM 表格，非 canvas） | `hide()` / `show()` |
| 外部资源 | ✅ **0 条**；CE/jsuites 的 CSS **零 `@font-face`、零外链**，图标全是内联 data URI（文档站里的 Google Fonts 只是给文档页用的） | `externalResources()` |
| 快照体积 | ✅ 两个 sheet 的样例 = **1.1 KB** | `snapshot()` |
| 类型门禁 | ✅ `npx tsc --noEmit` 0 错 | — |

**同样的扫描方式交叉核对三个候选**（决定性的不是体积而是 CSP）：

| 库 | `eval` / `new Function` | 触发点 | 结论 |
|---|---|---|---|
| jspreadsheet CE 5.0.4 | 1 eval + 2 new Function | 公式 token 解析 / 公式编译 | ❌ **用公式即崩** |
| FortuneSheet 1.0.4 | 3 new Function（core） | **插入行列**（拼 `d.unshift(...)` / `d.splice(...)` 的参数） | ❌ **插行列即崩** |
| **Univer 0.21.1** | 2 new Function，**只在 `createFunction` / `createAsyncFunction`**（注册「函数字符串」的自定义函数服务） | 只有显式注册字符串函数才走；**内置公式引擎不用 eval** | ✅ **通过** |

⇒ **结论：在「CSP 不允许 `unsafe-eval`」这条硬约束下，Univer 是唯一可用候选。** 另外两条路各有代价：放弃公式（CE 可留，但要自写非 eval 求值器），或放宽 CSP（**不建议** —— 本项目 prod CSP 是刻意收紧的，且应用会渲染云端文档与粘贴 HTML）。

**多 sheet 的澄清（回答用户）**：不是 v5 才支持 —— **v4.0.0 就已引入 workbook/tab**（官方 changelog「Workbook/tab support」），v5 只是把 spreadsheet 与 worksheets 拆开重构了 API。我们装的就是**最新 v5（5.0.4）**，多 sheet 数据层在 spike 里已实测可用（两个 worksheet 数据可分别读取）。所以选型的分水岭不是版本，而是上面的 CSP。

#### Spike 第二轮：打补丁后复测（260918，回答「能不能只改一行」）

打补丁：把 CE 核心那处 `eval` 换成行为等价的静态判断（**一行**，已在 `node_modules` 实测；正式化走 patch-package）：
```js
// before
eval("typeof(" + tokens[i] + ') == "undefined"')
// after（tokens 只可能是 A1/B12 这类单元格名；原写法只是借 eval 查同名全局变量，等价且不再需要 eval）
(typeof globalThis[tokens[i]] === "undefined")
```

复测环境已修正（spike 专用 vite 配置**不带 electron 插件**，避免再拉起第二只 Electron 抢 devtools 端口；实测 Electron 主进程数 = 1）：

| 轮次 | 打补丁前 | **打补丁后** |
|---|---|---|
| 无公式 | 正常（17 行 / 892×330） | 正常（同左，115 个单元格） |
| **有公式** | ❌ **整表崩**：只剩表头（`cells:7`、`h:28`），第二个 sheet 建不出来 | ✅ **整表不再崩**：2 个 sheet、17 行、115 个单元格全部渲染 |
| **公式求值** | ❌ 原样显示 `=SUM(B1:B3)` | ❌ **仍然算不出**，仍报 `script-src blocked eval` |

⇒ 精确结论（三条）：
1. **CE 核心那处 eval 确实是一行就能消除**，消除后「用公式即整表崩」的问题**消失**；
2. **但公式仍算不出**：`@jspreadsheet/formula/dist/index.js` 里 `new Function(c + "; return " + n)()` 是**公式求值器本体**（把公式编译成 JS 再执行）⇒ **这一处不是一行能替的**，要么自己实现表达式求值，要么换掉整条编译路径；
3. 同包内还有一处 webpack 运行时的 `new Function("return this")`（在 try/catch 内、`globalThis` 存在时根本不执行）——**无害，不用管**。

**顺带修正两条先前判断**：① `wordWrap` 实测生效（首行单元格高 49px = 3 行 × 13px，其余行 23px；上一轮 audit 取错了列，取到行号列）；② 图片单元格填 HTTP URL **确实不渲染**（`images: 0`），与源码判断一致。

#### ✅ 最终选定路线：**CE 原样 + `parseFormulas: false`**（260918 实测，零 patch / 零 CSP 改动 / 零新架构）

用户口径：*「这几个方案我都不想要，都太复杂了」* —— 于是回到最小充分条件：**我们只需要「结构化存储」，公式不是必须**（真要算数就挂 `.xlsx` 附件）。

**关键发现**：CE 的公式路径是**有开关的**，关掉它整条 `eval` 链根本不会执行（源码 `jspreadsheet-ce/dist/index.js`，`parseValue`）：
```js
parseValue = function (e, t, s, n) {
  "=" == ("" + s).substr(0, 1) && 0 != o.parent.config.parseFormulas && (s = executeFormula.call(o, s, e, t));
  ...
}
```
即：`parseFormulas: false`（顶层选项）⇒ `=` 开头的内容**按纯文本处理**，不进入公式编译 ⇒ 不需要 patch、不需要 `unsafe-eval`。

**在未打补丁的原样包上实测（真实 Electron + 真实 CSP）**：

| 配置（同一张表：单元格里放 `=SUM(B1:B3)`） | 渲染结果 | CSP 违规 |
|---|---|---|
| **`parseFormulas: false`** | ✅ **2 个 sheet / 17 行 / 115 单元格 / 892×330** | ✅ **0 条** |
| `parseFormulas` 默认（true，原样包） | ❌ **整表崩**：1 个 sheet / 0 行 / 7 单元格 / h=28 | ❌ `script-src blocked eval` |

**⇒ 这条路线下，之前那四条（A patch / B 全局 unsafe-eval / C 隔离宿主 / D 换 Univer）全都不需要了。**

| 能力 | 这条路线下的状态 |
|---|---|
| 结构化录入（多 sheet / 行列 / 下拉 / 日期 / 数字） | ✅ 全用 CE 自带 |
| 单元格内换行 | ✅ `wordWrap`（实测首行 49px = 3 行） |
| **公式** | ❌ **v1 不做**：`=` 开头按文本存。要算数 → 挂 `.xlsx` 附件（用户既定口径） |
| 图片 | ✅ 内联 base64（CE 图片列只认 `data:image`，其内置上传编辑器默认就写 data URI ⇒ **零额外代码**）；**已验证 base64 不进 S3 清单**，只让正文变大 |
| 离线 | ✅ CE/jsuites 零外链、零网络 API 调用、实测 0 external resources |
| 隐藏/显示（keep-alive） | ✅ 自动恢复，无需手动 resize |
| CSP | ✅ **一个字符都不用改** |

> 以后真想要公式，**最便宜的一步不是回头做 A/B/C/D**，而是：把公式文本存在我们自己的字段里、**自己算好再把纯值喂给 CE**（CE 永远看不到 `=`，因此永不触发 eval）。这条留作后续可选项，现在不做。

#### 「CSP 能不能只给 jspreadsheet-ce.js 单独加白」（回答用户）

**不能。** CSP 的 `script-src` 只能决定「哪些脚本**资源**可以加载/执行」（源 / hash / nonce），**没有任何机制允许某个脚本单独使用 `eval` / `new Function`**；`'unsafe-eval'` 是**整个文档级**的开关。所以真实可选项只有四条：

| 路线 | 做法 | 代价 |
|---|---|---|
| **A. 打补丁 + 不用库自带公式** | patch CE 那行 + 自写非 eval 简单公式求值器（SUM/AVERAGE/COUNT/MIN/MAX/IF + 四则 + 单元格/区域引用） | 额外写求值器（几百行 + 测试）；CSP 保持严格 |
| **B. 全局放开 `unsafe-eval`** | dev+prod 的 CSP `script-src` 加 `'unsafe-eval'` | 一行改动，但**整个 renderer** 都能执行字符串代码；本项目 prod CSP 是刻意收紧的，且应用会渲染云端文档与粘贴 HTML ⇒ 防护降一档 |
| **C. 独立源隔离** | 把表格宿主页放到**另一个 origin**（例如由本机 asset server `127.0.0.1:19876` 提供），只给那个响应头下 `unsafe-eval`，父页面保持严格；用 iframe/webview + postMessage 通信 | 最干净但最重：多一层隔离页面与通信协议，且要接我们的资产/preload 体系 |
| **D. 换 Univer** | 唯一「内置公式不依赖 eval」的候选（见上表） | 体积与集成复杂度最大 |

> 我的建议：**A 优先**（成本可控、防护不降）；若你更看重公式广度与省事，**C 是「不降全局防护」的正路**；**B 只在你明确接受全局降级时选**。

**版本**：先用 tauir 验证过的 **0.21.1** 集成路径（照抄集成与快照格式，省 API 变更踩坑）；升 0.25.x 单独立项。无论选谁，**编辑器必须放在薄适配层后面**（我们只见 `IWorkbookData`），将来换编辑器不用动存储与同步。

#### Spike 第三轮：Univer 0.21.1 实测（260918 · 公式 + 严格 CSP **通过**）

同一套 spike 工具链（独立 vite 配置 + 真实 Electron + 真实 CSP），把 CE 换成 Univer 0.21.1 后实测：

| 验证项 | 结果 |
|---|---|
| 生效的 CSP | **prod 变体**：`script-src 'self' 'sha256-…'` —— **没有 `unsafe-eval`**（最严的那份） |
| **内置公式** | ✅ **算出来了**：A1/A2/A3 = 1/2/3，`B1 = =SUM(A1:A3)` → **6** |
| **CSP 违规** | ✅ **0 条**（证明内置公式引擎**不走 eval**；`new Function` 只在「注册函数字符串」的自定义函数服务里，我们不调用） |
| 多 sheet | ✅ `SheetA` + `SheetB` 两个工作表 |
| 渲染 | ✅ 3 个 canvas 正常（表格区 1800×597 后备缓冲 / 900×298.5 显示），工具栏 43 个按钮 |
| **隐藏 → 显示** | ✅ 隐藏时显示尺寸归 0、显示后**自动恢复** 900×298.5（**不需要手动 resize**，此前担心的 canvas keep-alive 坑没有出现） |
| 外部资源 | ✅ 0 条 |
| 快照体积 | 1.5 KB（这个极小样例） |
| 构建期错误 | ✅ 0 条 |

**代价：两个依赖必须钉版本**（都是 tauir 的 `package.json` 里已经踩过的坑，照抄即可）：

| 依赖 | 症状（不钉就崩） | 钉法 |
|---|---|---|
| `@univerjs/icons` | 装到 1.39.0 时，`@univerjs/docs-ui` / `sheets-ui` 导入的 `MoreIcon` / `DropdownIcon` / `HideGridlinesDoubleIcon` 缺失 ⇒ **14 个 MISSING_EXPORT，依赖预构建直接失败** | `overrides: { "@univerjs/icons": "1.1.1" }` |
| `opentype.js` | 1.3.5 把 `dist/opentype.module.js` 改名成 `dist/opentype.mjs` ⇒ Univer 的 `import …/opentype.module.js` 解析失败（**500 Internal Server Error**） | 显式装 **`opentype.js@1.3.4`** |

⇒ **结论：Univer 确实「公式可用 + 过严格 CSP」**，代价是集成偏重（21 个包、2 个版本钉子、canvas 渲染、几 MB 体积）。这与 CE 的对照就很清楚了：CE 轻快但公式要 eval（被 CSP 拦）；Univer 重但原生过 CSP。

#### Univer 有没有多维表？—— **有，但在商业作用域**（260918 更正，用户实拍官网截图后追查）

> ⚠️ 本文前一版写的是「**没有**」。那是**只核查了开源 `@univerjs/*` 作用域**的结论，**不完整**。用户给的官网截图是对的：Univer Office SDK 宣传里明确列了「多维表格」。追查到真正的包后更正如下。

| 核实路径 | 结果 |
|---|---|
| `@univerjs/*`（开源作用域） | **没有** bases：仓库 `packages/` 60 个包无、npm 检索无、docs 的包名列表（13 个）无；`@univerjs/sheets-table` 只是**电子表格里的「结构化表格」**（Excel Table），不是 record-based 多维表 |
| **`@univerjs-pro/bases`（商业作用域）** | ✅ **存在**：最新 **`1.0.0-rc.0`**，另有 `1.0.0-alpha.1…beta.2` 与大量 `insiders.*` 构建（**共 63 个版本**） |
| 它的依赖 | `@univerjs/core@1.0.0-rc.0` + **`@univerjs-pro/license@1.0.0-rc.0`** + `@univerjs-pro/engine-formula` + `@univerjs/rpc` ⇒ **需要商业授权**；解包后代码里确有 `import { UniverLicensePlugin } from '@univerjs-pro/license'`（启动挂 license 插件） |
| package.json 的 `license` 字段 | **没有**（专有包）；对比开源 `@univerjs/core` = Apache-2.0 |
| 体积 / CSP | tarball 629 KB、解包 **2.9 MB / 84 个文件**；**0 处 `eval`、0 处 `new Function`** ⇒ **和 Sheets 一样过我们的严格 CSP** |
| 官网/文档证据 | docs 首页：「**多维表格** 面向业务数据的表格化应用。支持字段建模、多视图、记录管理和低代码数据工作流」；用户给的 URL 带 `?table=…&view=…`，正是**文档站自己用 Bases 渲染内容**（托管侧已 dogfooding） |

⇒ **对决策的影响（关键）**：
- **技术上**：走 Bases 就能**一套 Univer 同时覆盖「表格 + 多维表」**，两边都是 CSP 干净、纯 web（安卓可用）、快照 JSON（可存进我们的 body）——我前面担心的「两套技术栈」问题随之消失。
- **许可上**：必须接受**商业授权**，且整条栈要上 **1.0.0-rc.0**（开源稳定线是 0.25.2）= 「用 rc 换功能 + 又一次依赖对齐」。这直接撞上 tauir 的原则（其 plan 明确「不引入商业订阅/license」）与本项目此前「不引入商业订阅」的结论——**这是产品决策，不是技术决策**。
- **三条必须确认才能真的用**：① license 是否**强制**、是否**联网校验**（撞我们的**离线**红线）；② Bases 的快照/数据格式（能否整份进 body、能否引用 `assets/` 走我们管线）；③ 1.0.0-rc 的稳定性与转正时间表。

##### 官方文档已核实的接入事实（260918 · 文档站提供 Agent 可读的 `.md` 版与 `llms.txt`）

```bash
# 官方原文（插件模式）：
npm install @univerjs/core @univerjs/design @univerjs/engine-formula @univerjs/engine-render @univerjs/ui \
  @univerjs-pro/bases @univerjs-pro/bases-ui @univerjs-pro/engine-formula @univerjs-pro/license
```

```ts
univer.registerPlugin(UniverRenderEnginePlugin)
univer.registerPlugin(UniverUIPlugin, { container: 'app' })
univer.registerPlugin(UniverProFormulaEnginePlugin)      // 公式：用 Pro 引擎替换开源引擎，二者不可同时注册
univer.registerPlugin(UniverLicensePlugin, { license: 'YOUR_CLIENT_LICENSE' })  // ← 必须最先注册
univer.registerPlugin(UniverBasesPlugin)
univer.registerPlugin(UniverBasesUIPlugin)
univer.createUnit(UniverInstanceType.UNIVER_BASE, {})
```

| 事实 | 内容 |
|---|---|
| 包 | `@univerjs-pro/bases` + `@univerjs-pro/bases-ui` + `@univerjs-pro/engine-formula` + `@univerjs-pro/license` |
| 版本约束 | 官方明确「所有 `@univerjs/*` 与 `@univerjs-pro/*` 包应保持**相同版本**」⇒ 走 Bases 就**全栈上 `1.0.0-rc.0`**（开源稳定线是 0.25.2） |
| 注册顺序 | **先 `UniverLicensePlugin`，再 Bases 插件**；样式先 `@univerjs/design` → `@univerjs/ui` → 产品 CSS |
| 授权 | 需要**客户端许可证字符串**（`license` 参数）；官方《授权与部署》写明「使用需要授权的功能时，请通过 univer.ai 了解授权范围并获取许可证」，许可证**有有效期**且**决定可用功能**；出问题先查「许可证是否完整/有效期内/覆盖当前功能」 |
| **离线** | ⚠️ 文档**只说明 license 是字符串 + 有效期 + 功能门控，未说是否联网校验，也未承诺离线可用** ⇒ **必须向官方确认**（撞我们的离线红线，不能猜） |
| 数据格式 | **`IBaseSnapshot` 是 Bases 的持久化格式**（表 / 表顺序 / 架构版本 / 时间戳 / 修订元数据）⇒ 与 Sheets 的 `IWorkbookData` 同类，**可整份作为我们的正文对象**进 `objects/{id}-{hash}.lake` + 同步/GC 管线；图片字段是 URL 还是内联**待确认** |
| 文档完备度 | 入门/安装/快速入门/Facade/Worker/生命周期/各框架集成/**数据模型**/字段/记录关联与层级/视图/**公式**/权限/跨文档嵌入/仪表盘与透视/评论/打印/协同编辑/历史/导入导出/UI 全都有（v1.0.0-rc.0） |

##### 由此得到的真正取舍（一张表）

| 方案 | 技术栈 | 表格公式 | 多维表 | 授权成本 | 风险 |
|---|---|---|---|---|---|
| **CE + `parseFormulas:false` + 自研多维表** | 一套（CE + 自研） | ❌（挂 xlsx） | 自研 ≈5,400 行 | **0** | 自研工作量大；无公式 |
| **Univer Sheets + Univer Bases** | **一套（Univer 全家桶）** | ✅ | ✅ 功能最全（含公式/仪表盘/权限/协同/导入导出） | **需买 Pro 授权** | **rc 线** + 授权离线待确认 + 交付物里带授权字符串 |

##### 交给用户/官方确认的四个问题（在其回复前不写进方案基线）
1. `@univerjs-pro/bases` 的授权是否**必须联网校验**？能否**完全离线**运行（我们产品是本地优先 + 离线）？
2. Bases 的**图片/附件字段**怎么存：URL 引用还是内联 base64？（决定能否接我们 `assets/` 管线、决定正文体积）
3. `1.0.0-rc.0` 的**转正时间表**与 rc → 正式 的升级承诺；rc 期间是否有 breaking change？
4. 授权**价格与范围**：客户端 license 是否按应用/按席位/按功能分级？Bases 属于哪一档？

##### 官方 README 的「Open Source and Pro」原文（260918 用户提交截图后核实）

用户截图的表格出自 Univer 仓库 README（`dream-num/univer`），原文如下（**逐字**）：

| 区域 | 开源能力（Open-source capabilities） | Univer Pro 扩展（Pro extensions） |
|---|---|---|
| **Bases** | **"Build custom structured-data experiences on top of Univer's plugin, command, and model architecture."** | **"Base database model, commands, formula integration, workbench UI, field editors, and render-engine views."** |
| **Sheets** | Workbook/worksheet/range/selection、**公式**、数字格式、筛选排序、数据验证、条件格式、超链接、评论、查找替换、便签、表格、绘图集成、可扩展 UI 插件 | 协同、编辑历史、**导入导出**、打印、图表、透视表、迷你图、大纲、形状、单元格内图形、数据连接器、服务端计算… |
| **Foundation** | Core SDK、插件系统、渲染引擎、**公式引擎**、Facade API、主题、i18n、框架适配器 | Pro presets / 企业部署包 |

以及边界原则原文：「**OSS packages in this repository are intended to be useful on their own under the Apache-2.0 license. Univer Pro is optional** and is not required to use the public OSS SDK APIs.」

**准确读法（这条容易误读，必须写清）**：
- 开源那一栏对 Bases 说的是**底座**：「在 Univer 的插件/命令/模型架构之上**构建自定义**的结构化数据体验」⇒ **开源确实能用来做多维表，但要你自己构建**。
- **现成的多维表——「Base database model / commands / formula integration / workbench UI / field editors / render-engine views」——全部列在 Pro 一栏** ⇒ 与实证完全一致（`@univerjs-pro/bases` + `@univerjs-pro/bases-ui` 在商业作用域、依赖 `@univerjs-pro/license`；开源 60 个包里没有任何 bases 包）。
- 所以「用开源做多维表」**= 自研**，只是**可以拿 Univer 的开源底座加速**（复用命令系统、插件架构、公式引擎、渲染引擎、UI 外壳、Facade）。

**⚠️ 自我更正**：本文档此前写过「Univer 有没有多维表：**没有**」——那是**错的**（只查了开源作用域）。Bases 是 Univer 的正式产品，只是位于 **Pro（商业）** 一栏；已在上一节更正。另：开源 Sheets 一栏**不含 import/export**（那是 Pro），印证了「xlsx 导入导出要我们自己用 ExcelJS 或挂附件」的判断。

##### 由此得到的三条路线（替换前文的两条）

| 路线 | 表格 | 多维表 | 授权成本 | 备注 |
|---|---|---|---|---|
| **X 纯自研** | CE（`parseFormulas:false`，v1 无公式） | 纯自研（≈5,400 行） | **0** | 技术栈最独立，自研量最大 |
| **Y 开源 Univer 底座 + 自研 Bases** | Univer 开源 Sheets（**公式/筛选排序/数据验证/条件格式/批注/表格/绘图/查找替换全在开源**；xlsx 导入导出自己做或挂附件） | 在 Univer 的插件/命令/模型架构上自研 | **0** | 比 X 省力（复用底座）；代价是 Univer 集成（21 包 + 2 个版本钉子）；**CSP 已实测干净** |
| **Z 买 Pro** | Univer Sheets | **Univer Bases 现成** | **需商业授权 + 全栈 `1.0.0-rc.0`** | 功能最全（按官方文档还有协同/仪表盘/权限/导入导出）；离线与价格待确认 |

#### Univer 在安卓端能不能用？（260918 核实：**能用**）

| 依据 | 说明 |
|---|---|
| 技术形态 | 纯 web（canvas + `worker-src 'self' blob:` 的 worker），**无原生依赖** ⇒ 跑在我们的 Capacitor Android WebView 里没有原理障碍 |
| 官方移动适配 | `@univerjs/sheets-ui` 内置 **3 个 mobile 渲染控制器**：`mobile-contextmenu` / `mobile-header-resize` / `mobile-scroll`（触屏上下文菜单、表头拖拽、滚动） |
| **移动端 CSP 不是障碍** | `mobile.html` 的 CSP **本来就含 `'unsafe-eval'`**（注释写明是给 sql.js WASM 用的）⇒ 在安卓端，CE 的 eval 公式与 Univer 都能跑；**CSP 冲突只存在于桌面端** |
| 需要实测的风险 | 触屏编辑手感、**中文 IME**（canvas + 隐藏输入框那套，我们在 Lake 内核上打过 IME 的仗）、大表在手机上的性能/内存、移动 bundle 再增几 MB；以及移动端正文存在 SQLite（`notes.content`）的体量问题 |

⇒ 结论：**能用，但需真机验证**。移动端 v1 仍建议**只读/占位**（见 §8），要支持就单独立项 + 真机 spike（`scripts/emu-up.sh` 那条链路）。

#### Univer 和 ExcelJS 是什么关系（两层，不是竞品）

```text
  .xlsx 文件
      │  ExcelJS：纯文件编解码（MIT，无 UI、无公式引擎）
      ▼
  Univer IWorkbookData（内存工作簿：sheets / cellData / styles / mergeData / 公式）
      │  Univer：渲染 + 交互 + 公式计算
      ▼
  我们的正文（JSON 文本）→ 本地 sheets/{id}.sheet.json → S3 objects/{id}-{hash}.lake
```

- **Univer** = 编辑器 + 运行时工作簿模型。它**不负责读写 .xlsx**——官方 exchange 能力在 `@univerjs-pro/*`，依赖商业 license，tauir 已明确拒绝。
- **ExcelJS** = 只做 `.xlsx` 读写的库（MIT、月下载 5545 万），没有 UI、没有公式引擎。
- 两者**互不替代**，只在「导入/导出 Excel 文件」时需要中间那层桥（tauir 的 `spreadsheetXlsxBridge.ts` 就是它，约 350 行 + 测试）。
- 关键结论：**.xlsx 不是我们的存储格式**，真相是 Univer JSON；Excel 只是进出口。

#### xlsx 导入导出：SheetJS 还是 ExcelJS？（260918 实查）

| | **SheetJS**（社区版） | **ExcelJS** |
|---|---|---|
| 许可 | Apache-2.0 | MIT |
| 代码托管 | 已迁离 GitHub 到自建 git.sheetjs.com（旧仓库最后推送 2024-04-18） | GitHub exceljs/exceljs，最后推送 2025-01-21，**808 个未处理 issue** |
| **npm 可得性（关键）** | ⚠️ npm 上的 xlsx **停在 0.18.5**；GitHub Advisory 明确 `< 0.19.3` 有 **Prototype Pollution（high）**、`< 0.20.2` 有 **ReDoS（high）**，两条都标 `first_patched_version = none` ⇒ **npm i xlsx 装到的正是这两个未修漏洞都在的版本**。当前版本只能从 cdn.sheetjs.com 的 tgz 装，或用社区镜像 @e965/xlsx@0.20.3（Apache-2.0，7.7 MiB） | ✅ 正常发布在 npm（4.4.0），**5544 万下载/月**；安全公告只有一条 2018 年的 medium（XSS） |
| 格式覆盖 | **广**：xlsx/xlsm/xlsb/**xls**/**ods**/csv/txt/html/dif/sylk… | 窄：**xlsx + csv** |
| 对象模型 | 紧凑 JSON（公式是 `f` 字段），API 偏函数式 | `worksheet.getCell('A1').value = { formula, result }`，样式 API 更直观；有 xlsx 流式读/写 |
| 体积 | 7.15 MiB（npm 旧版）/ 7.70 MiB（@e965/xlsx 新版） | 20.81 MiB（可 tree-shake / 懒加载） |
| 适合我们吗 | 只有真要读 **xls/ods** 这类老格式时才值得（且必须接受自定义安装源） | ✅ **默认选它**：MIT、npm 干净、我们只需 xlsx、tauir 已有现成桥可参考 |

**结论：xlsx 这块选 ExcelJS。** SheetJS 唯一优势是格式覆盖面（xls/ods），代价是「npm 上那个版本带两个未修的高危漏洞」——为一个大概率用不到的能力去背这个不值得。

> 再提醒优先级：按 §6.1 的需求校准，**xlsx 导入导出本身是可以不做的**。真要复杂 Excel，路径是「把 .xlsx 当附件挂进文档」。本节只是「万一要做」时的选型结论，不是 M1 必做项。

#### 那为什么还分一期二期？

不是做不完，是这三件事性质不同：
1. **存储与编辑是产品本体**：新建/编辑/保存/多端同步/历史/回收站——没有它功能不成立。
2. **xlsx 导入导出是互操作**：可选、可砍。它自带保真泥潭（公式、合并单元格、样式、多 Sheet、日期、图片、图表），tauir 的 plan 原话是「如果开源桥接无法达到最小可用保真度，**宁可移除导入导出入口**」。
3. 合成一期也行，代价 = **多 2–3 天 + 一个必须对用户明示的保真边界**（哪些特性不保证往返）。

⇒ **我的修正建议**：把 xlsx 导入导出钉在 **M1 末尾做成可选开关**（默认只存自己的 JSON，需要时再导），而不是含糊地推到「二期」。这样既不让互操作阻塞核心，也不假装它不存在。

### 6.2 多维表：市面上到底有没有现成的？

**结论：没有能嵌进本地优先应用的。** 逐个核实过：

| 候选 | 形态 | 为什么不能用 |
|---|---|---|
| **思源 Attribute View**（`siyuan-master/kernel/av/` + `app/src/protyle/render/av/`） | 原生内核能力（Go ~17,000 行 + 前端 95 文件 ~29,800 行） | ① **AGPL-3.0**，移植会把 AGPL 传染到我们的分发物；② 它的数据存在**内核 SQLite**、靠 `/api/av/renderAttributeView` 取，文档里只有 `data-av-id` 指针 —— 而**我们的 DB 不参与同步**（只有 S3 对象 + 清单），照搬会直接把数据锁死在单机。详见 §13 |
| NocoDB / Baserow / Teable / APITable / Undb / Grist | 服务端应用（要 Postgres/独立进程/浏览器访问） | 引入即破坏「本地优先 + S3 只是镜像」；而且 Grist/NocoDB/Teable 多为 AGPL |
| 前端可嵌入的 bitable 组件 | — | 生态里**不存在**成熟**开源**项。这类产品的价值在字段类型 + 视图 + 筛选/排序/分组的产品设计，不是一张网格 |
| **`@univerjs-pro/bases`**（Univer 的多维表格） | npm 上的**商业作用域**包，`1.0.0-rc.0` + `@univerjs-pro/license` 依赖 | ⚠️ **技术上最省（与 Sheets 同源、CSP 干净、安卓可用），但要买授权 + 全栈上 rc**；离线/数据格式/转正时间表未确认。详见 §6.1 的更正小节 |
| **tauir 的多维表** | 自研（`multidimensionalTableDocument.ts` 1,121 行 + 编辑器/看板/网格/字段面板/值输入 ≈ 5,360 行源码 + ~1,300 行测试） | ✅ **这是唯一可直接借鉴的实现**（同技术栈、同许可前提）。但它不是库，是它应用内部的一坨组件 |

##### 260918 二次检索：市面上到底有没有「能直接嵌」的开源多维表

用户质疑「GitHub 这么多项目，真没有能用的？」——做了地毯式检索（GitHub repo search + npm 逐个核实许可与形态），结论：**没有**。

| 项目 | ★ | 形态 | 许可（已逐个核准） | 能不能嵌 |
|---|---|---|---|---|
| **NocoDB** | 65k | 服务端应用（Node，可用 SQLite） | **Sustainable Use License**（非 OSI 开源、限制商用） | ❌ 许可即拦住 |
| **Teable** | 21.8k | 服务端（NestJS + Postgres + Redis） | 服务端 AGPL（+ 商用 `ee`）；**客户端 SDK 是 MIT** | ⚠️ 见下 |
| **APITable** | 15.6k | 服务端 | AGPL-3.0 | ❌ |
| **Baserow** | 5.9k | 服务端（Django + Nuxt） | MIT core + premium | ❌ |
| **Grist** | 11.8k | 服务端（Python + TS 客户端） | **Apache-2.0**（最友好） | ⚠️ 客户端用 **GrainJS**（非 React），移植成本高 |
| **Undb** | 3.0k | 服务端 React | AGPL-3.0 | ❌ |
| **Rowy** | 6.8k | 服务端 | Other，且 2024-11 起停更 | ❌ |

**唯一「可嵌入的现成件」**：`@teable/sdk`（**MIT**、React 18、解包 6.4 MB，含 grid/kanban/字段编辑器/富文本）——**但它是 Teable 服务端的客户端**：解包后 119 个文件引用 `@teable/openapi`、19 个用 `axios`、还带 websocket 协同 ⇒ **没有那个 AGPL 服务端就跑不起来**。

**但检索过程挖到一个真正降本的东西**：`@teable/core`（**MIT**，解包 2.3 MB）就是**领域模型层**：`models/field`、`models/record`、`models/op`、`**formula/evaluate**（公式引擎）`、`convert`、`query`、`typeguards`。⇒ **「字段类型系统 + 公式计算 + 值转换」这三块最难的，有 MIT 现成件可直接用。**

⇒ **修正「自研很贵」的估算**：tauir 的 5,400 行包含它手写的富文本编辑器、字段配置面板、各种值输入控件、指针拖拽等一整套。我们的 v1 只需：网格用 `@tanstack/react-table`（**Teable 自己的 SDK 也在用它做网格**）、领域模型/公式用 `@teable/core`（MIT）、存储/同步用我们已有的 body + S3 清单 + GC + 回收站 + 历史、UI 用已有的思源 CSS 原语 ⇒ **v1（表格视图 + 看板视图 + 字段增删改 + 记录增删 + 拖拽改状态 + 8 种字段）估 1,500–2,500 行 / 3–5 天**。

**三条可执行路线（替换本节前面的两条）**：

| 路线 | 做法 | 成本 | 风险 |
|---|---|---|---|
| **C1 自研（推荐）** | `@teable/core`(MIT) + `@tanstack/react-table` + 我们的数据层 | **3–5 天** | 需守住 v1 范围（不做公式/关联/汇总/权限/协同） |
| **A sidecar** | 本地跑 NocoDB / Baserow / Teable，嵌它的 UI | 2–3 天接起来 | 数据在它的库里（**脱离我们的 S3 清单/同步/回收站/历史**）、许可（SUL / AGPL）、Electron 里再塞一套服务端 |
| **D 买 Pro** | Univer Bases | 授权费 | rc 线 + **离线是否可行待确认** |

##### 「Smart Table」同名项目核实（260918，用户追问）

「Smart Table」是**多个同名项目**，逐个核实：

| 名字 | 是什么 | 结论 |
|---|---|---|
| `lorenzofox3/Smart-Table`（npm `angular-smart-table`） | **AngularJS** 表格模块，最后推送 2023-01，无 license | ❌ 停更 + 非 React |
| `akveo/ng2-smart-table` | **Angular** 通用数据表格（MIT，2024-08） | ❌ 非 React；且是**通用表格**不是多维表 |
| 腾讯文档 / WPS 的「智能表格」、Smartsheet | 商业 SaaS | ❌ 不可嵌 |
| **`@visactor/vtable`**（VisActor / 字节，MIT，★3.6k，当天仍在推） | **高性能表格与多维分析网格引擎**（canvas、透视表、自定义单元格渲染与编辑），另有 `@visactor/react-vtable` | ⚪ 可用作「网格底座」，但仍**不是多维表**（无字段/记录/视图模型） |

**VTable 实测数据**：解包 **31 MB / 706 个文件**；**0 处 `eval`、0 处 `new Function`**（CSP 干净）；依赖 `@visactor/vrender*`（自研渲染引擎）。

**「网格底座」候选对照（都只是网格，字段/记录/视图仍要自己补）**：

| 网格底座 | 许可 | 体积 | 特点 | 判断 |
|---|---|---|---|---|
| `@tanstack/react-table` | MIT | 小 | headless（逻辑自带、DOM 我们渲染） | ✅ **v1 首选**：最轻、配思源 CSS；**Teable 自己的 SDK 也用它做网格** |
| `@visactor/vtable` | MIT | **31 MB 解包**（canvas） | 高性能、透视表/多维分析、自定义单元格渲染与编辑、开箱 UI | ⚪ 功能最强但最重；canvas + 中文 IME 需实测 |
| `@revolist/revogrid` / `@silevis/reactgrid` | MIT | 中 | 虚拟滚动专用网格 | ⚪ 备选 |

> 关键区分：**网格 ≠ 多维表**。字段类型、记录模型、视图配置、筛选排序分组这些「产品语义」仍要自研（可用 `@teable/core`（MIT）省掉领域模型与公式）；换网格底座只是换掉「虚拟滚动 + 单元格渲染」那一层。

##### 两条路线的实测对照（260918 · 生产构建 + 真实 Electron，全部为实测值）

用户决定走 **Univer 路线**（Univer 表格 + 基于 Univer 能力做多维表），要求与「**CE 做表格 + 仿 tauir 自研多维表**」对比。以下数字均为实测（生产构建 + 强制 GC 后读数），非估算：

| 维度 | **CE 路线** | **Univer 路线** |
|---|---|---|
| 依赖量（装盘） | 3 包 ≈ **1.4 MB**（jspreadsheet-ce 356K + jsuites 880K + @jspreadsheet 144K）；无新增 peer | **20 个 `@univerjs/*` 包 = 118 MB** + **`rxjs` 11 MB（本项目原本没有，需新增）** + `opentype.js` 3.7 MB + `@wendellhu` 620 KB；另有 **2 个版本钉子**（`@univerjs/icons` 1.1.1 / `opentype.js` 1.3.4） |
| **生产产物膨胀** | **2 文件 / 0.66 MiB raw / 0.18 MiB gzip**（610 KB JS + 65 KB CSS） | **79 文件 / 9.77 MiB raw / 2.48 MiB gzip**（主 chunk 5.46 MiB / gzip 1.53 MiB；另有 **55 个 locale chunk ≈ 4.3 MiB**）⇒ 只保留 zh-CN/en-US 预计可裁到 ≈5.5 MiB raw / ≈1.6 MiB gzip（待验） |
| **JS 堆（生产构建 + 强制 GC）** | **4.38 MiB**（空白基线 3.10 ⇒ 编辑器增量 **≈1.3 MiB**），DOM 377 节点 | **23.76 MiB**（空白基线 3.21 ⇒ 增量 **≈20.5 MiB**），DOM 740 节点；**另计 canvas 后备缓冲**（1800×597）与可能的 worker ⇒ 真实进程增量高于 20.5 MiB |
| **多 tab keep-alive**（本项目现状：所有 tab 常驻 DOM） | ≈**1.3 MiB/tab**，无害 | ≈**20 MiB/tab** ⇒ 10 个表格标签 ≈200 MB+ ⇒ **必须改成「非激活 tab 销毁、切回重建」** |
| CSP | 公式需 eval（被我们 CSP 拦）⇒ `parseFormulas:false`（v1 无公式） | ✅ 已实测：**prod CSP 下公式算出、0 违规** |
| 移动端后期 | 纯 web；**DOM 表格（中文 IME 更稳）**；+0.18 MB 产物 / +1.3 MB 每实例；移动端 CSP 本来就有 `unsafe-eval` | 纯 web；官方 3 个 mobile 渲染控制器；**canvas（IME 需实测）**；+2.5 MB 产物 / **+20 MB 每实例**（手机更敏感） |
| 表格侧代码量 | 需写一层适配（加载/保存/懒加载/只读）≈200–400 行 | ≈<b>0</b>（用官方 preset，已跑通） |
| **多维表侧代码量** | **1,500–2,500 行 / 3–5 天**（`@teable/core`(MIT) 复用字段类型与公式模型 + `@tanstack/react-table` + 我们已有的存储与 UI 原语） | **5–8 天（乐观）**，且**风险最高**：开源侧**没有 Bases 文档**（Base 的模型/命令/workbench UI 全在 Pro），只能**照 Sheets 的实现反推 unit / command / plugin 体系** |

**结论与建议**：
1. Univer 在**表格**上确实省事且已全部验证（CSP / 公式 / 多 sheet / 隐藏恢复），代价是**依赖 118 MB、产物 9.8 MB、内存 20 MB/实例**。
2. 但「**基于 Univer 能力做多维表**」是**没有官方文档的逆向工程**（官方把 Base 模型与 workbench UI 放在 Pro），**风险比「用 React 自研」更高，不是更低**。
3. ⇒ **建议混合**：**表格用 Univer**（省事、已验证），**多维表仍按 React 自研**（`@teable/core` 复用字段/公式 + TanStack Table + 我们已有存储/UI）。两者数据模型本就不同，不必为了「统一」把多维表硬塞进 Univer 的单元体系。
4. 若坚持「全 Univer」，必须同时接受三条缓解措施：① **裁掉非 zh/en locale**（省 ≈4 MB）；② **表格 tab 不做 keep-alive**（否则内存线性膨胀）；③ 预留**逆向 Univer 单元体系**的探索时间（这部分无文档可循）。

##### 附：CSP 在我们产品里到底有没有用（260918 用户质问「我们不是 web 服务，有必要这么严吗」）

**先看思源（事实核实，非印象）**——它有 CSP，但**用法和我们相反**：

| 位置 | 思源的 CSP / 加固 | 说明 |
|---|---|---|
| 主题预览 / boot 外观 iframe | `default-src 'none'; style-src 'unsafe-inline' <resourceRoot>; img-src <resourceRoot>; media-src <resourceRoot>; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'` | **无脚本、无外联**，只放主题资源 |
| 用户 **HTML 资产**（iframe 内渲染） | `sandbox allow-scripts; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'` | 用 **`sandbox` 指令**隔离（不透明源，摸不到主应用） |
| 用户 **SVG 资产** | **先消毒** SVG，再下发 `script-src 'none'; object-src 'none'; base-uri 'none'`；用户显式开启 SVG 脚本时**不下发** | 先 sanitize 再禁脚本 |
| **主窗口（Electron）** | **`nodeIntegration: true` + `contextIsolation: false` + `webSecurity: false`** | ⇒ 思源渲染层**本来就有完整 Node**，谈不上靠 CSP 保护主界面 |

⇒ 思源的策略是**「主窗口不隔离（信任第一方），不可信资产逐个沙箱」**；我们是**「主窗口严格隔离（`contextIsolation: true` + 无 `nodeIntegration`）+ 严格 CSP」**。**两者是配套关系，不是谁更啰嗦**：正因为我抳掉了渲染层的 Node、所有能力收进 `lakeNative` IPC，CSP 才成为把「内容注入」关在门外的必要一道。

**为什么思源能做得更「精准」而我们只能一刀切**：它跑**本机 HTTP 内核**（Gin 在 `127.0.0.1:6806` 提供 UI 与资产），可以**按响应/按路径下发 CSP header**；我们是 `file://` + `<meta>`，而 **`<meta>` 只能整文档生效**。⇒ 这既解释了差异，也给出一条未来优化路径：我们已有 asset server / `webApiServer`，将来可把危险资产单独 serv 并单独下发 header（甚至把应用壳搬到 HTTP），学思源的「外科手术式沙箱」。

**CSP 在我们这里的真实价值（按重要性排序）**：
1. **`connect-src 'self' http://127.0.0.1:*`** —— **最值钱的一条**：保证笔记**不可能被静默上传到外部服务器**（只能进你自己的桶）。这与「是不是 web 服务」无关：**我们渲染的是 HTML，HTML 里可以带请求**。
2. `img-src` / `media-src` / `frame-src` / `object-src` —— 挡追踪像素、远程拉取、外部嵌入。
3. `base-uri 'none'` / `form-action 'none'` —— 挡 base 劫持与表单外发。
4. `script-src 'self'` —— **不让「内容」变成「代码」**；我们渲染层虽无 Node，但有 `lakeNative`：读全部笔记 / 写盘 / 改同步设置 / 触发同步 ⇒ 一条注入脚本 == 以用户身份操作全部本地数据。

**「远端数据也是用户自己的」为什么不充分**：内容可能是**别人写的 HTML** —— ① 粘贴的网页（我们的拦截器只做规范化/懒加载升级，**不做消毒**）；② 导入/他人分享的文档；③ **带外修改的本地文件**（本项目 AGENTS 已声明 out-of-band 改文件在范围内）；④ 同一个桶里还有**别的应用**在写。

**诚实划清 CSP 的边界（它防不住什么）**：① **第一方依赖**（我们打包的库即「自己的代码」，CSP 不适用）；② 同机攻击者（有文件访问权）；③ **经 IPC 的滥用**（注入脚本可调 `saveNote` 把内容写进你自己的 S3 —— 那是「你自己的通道」，CSP 不管）。⇒ 它是**纵深防御的一层**，不是万能。

**成本核算（决定要不要守）**：保持严格 CSP 的代价目前只剩「不能用 eval 类公式引擎」；而**已实测 Univer 的公式在严格 CSP 下正常（0 违规）** ⇒ **守严格不损失任何已选定功能**。故结论：**保持现状**，不为 CE 的公式去放开 `unsafe-eval`。

###### 「给它独立源」到底指什么（澄清，防误读）

**不是**「把 eval 组件做成一个服务，每次去调用它的能力」（那会变成 RPC/服务依赖，离线与性能都变差）。
**是**「把组件的**运行环境**隔离到一个独立的、策略更松的文档里」，数据仍然是本地的、离线的：

```text
主窗口（file:// 生产 / 127.0.0.1:1421 开发）
  └─ <iframe src="http://127.0.0.1:19876/<host-page>/?token=…">   ← 不同 origin（跨源）
        响应头：Content-Security-Policy: script-src 'self' 'unsafe-eval';
                connect-src 'none'; frame-ancestors file: http://127.0.0.1:*
        这个文档里跑那个必须 eval 的组件（表格/公式引擎…）
        ▲ postMessage({type:'load', body})      ▼ postMessage({type:'save', body})
  主应用仍然负责：保存 / 落盘 / 同步 / S3 / 回收站 / 历史
```

几个要点：
1. **asset server 在这里只是「另一个 origin 的本地静态文件服务」**（`electron/assetServer.ts`，本来就在 19876 服务 `note-assets/`、`quick-notes/`、`/vendor/cdn/`）。它**不执行**组件、也不「提供能力」；只是把宿主页以**不同 origin + 独立 CSP 响应头**递出去。
2. **组件仍跑在本机**（iframe 就在同一个 renderer 里；若用 webview/BrowserView 则是另一个 renderer 进程），**没有网络往返、离线可用**。
3. **必须跨源**：CSP 逐文档生效，换文档就能换策略；但**同源 iframe 仍能 `window.parent.lakeNative`**（同源可跨帧取父对象）⇒ 隔离形同虚设。跨源后它：拿不到父页面 JS 对象、拿不到 preload（Electron 默认不给子框架注入）、读不到 `file://` 的 DOM/storage。
4. **数据只走 `postMessage`**：父 → 子喂文档 JSON，子 → 父回编辑结果；组件**没有 IPC、没有 S3 凭据、没有文件系统** ⇒ 它的爆炸半径被收窄到「它手里那份数据」。
5. **代价**：多一层 postMessage 协议与生命周期（创建/销毁、非激活销毁）；asset server 要新增一条宿主页路由并单独下发 CSP 头（现在是 node:http 手写响应，加 header 很直接）；`frame-ancestors` 要允许 `file:`（生产主窗口 origin 是 opaque）；父→子用具体 `targetOrigin` 而不是 `*`。
6. **优先级**：目前**不需要**（Univer 的公式在严格 CSP 下就能跑）。这条只是「万一将来遇到确实必须 eval 的组件」的退路，真遇到再做，不提前建。

###### 「独立源」方案的代价量化（260918 实测 + 结构分析）

**每消息成本 = 结构化克隆（postMessage 的语义就是深拷贝，按 payload 计费）**。V8 实测（Node 24；Electron 用同一 V8，同数量级）：

| payload | `structuredClone`（即 postMessage 的每消息成本） | `JSON.stringify`（保存时本来就要做） | `JSON.parse` |
|---|---|---|---|
| 10 KiB | **0.003 ms** | 0.018 ms | 0.024 ms |
| 100 KiB | **0.008 ms** | 0.057 ms | 0.058 ms |
| 1 MiB | **0.135 ms** | 0.693 ms | 0.413 ms |
| 5 MiB | **0.698 ms** | 2.867 ms | 1.885 ms |

⇒ 在「加载一次 / 保存一次」这种频率下（不是每帧、不是每次按键），**postMessage 的开销完全可忽略**（1 MiB 以内 < 0.15 ms）。真正要避免的是**每帧/每次按键跨界传整份文档**——但那是「传什么」的设计问题（我们的自动保存本来就是防抖后整份序列化）。

**「跨源」本身没有网络成本**：不是远程调用，只是同一个浏览器里加载本地 `127.0.0.1` 的静态文件（loopback，不走网卡）。固定成本只有两项：**一次文档加载**（≈ 一次页面首帧，百毫秒级）+ **一个独立的 JS realm**（实测：CE 组件在独立页里 JS 堆增量 **≈1.3 MiB**）。

**是否跨进程取决于 site isolation（决定有没有 IPC）**：
| 场景 | site 是否相同 | 进程 | 额外成本 |
|---|---|---|---|
| 开发：父 `127.0.0.1:1421` / 子 `127.0.0.1:19876` | **同 site**（site 不看端口） | 通常**同一 renderer 进程** | postMessage = 进程内克隆，**无 IPC** |
| 生产：父 `file://` / 子 `http://127.0.0.1:19876` | 不同 site | 很可能**独立进程（OOPIF）** | 每次消息多一次进程间传递（**0.1–1 ms 量级，仍可忽略**）；主要代价是**多一个 renderer 的固定内存**（几十 MB 级） |

> ⚠️ **诚实标注**：这次尝试量「同源 vs 跨源 postMessage 往返」的探针**卡住并超时**（运行时未拿到子页 ready），所以 **OOPIF 的进程数/额外内存我没有实测到**，上表第二行是结构判断而非实测。已实测的部分是「克隆成本」（上表）与「CE 组件在独立页的堆增量 ≈1.3 MiB」。

**结论**：该方案的**运行时性能代价可忽略**（消息 <1 ms + 一次页面加载 + ≈1.3 MiB 组件副本）；**真正的代价在工程复杂度**（postMessage 协议/生命周期/一致性/错误处理）与「独立文档/进程」的额外内存。且——**我们现在的路线（CE + `parseFormulas:false`）根本不需要它**，故仅作备选记档。

**成本高吗**——用 tauir 的实测规模回答：表格+看板两个视图、8 种字段类型、增删记录/字段、看板拖拽 = **约 5,400 行源码**（对应我给的 M2 估时 5–8 天）。**真正的成本不在网格**，在字段类型与视图的细节行为。因此有两条降本路线：
- **借骨架不借网格**：网格视图用 headless 表格库（TanStack Table，MIT / glide-data-grid，MIT）承担虚拟滚动、列宽、单元格选区，我们只写字段渲染与视图配置。这比 tauir 手写网格更省，也更稳。
- **范围先钉死**：首期只做「表格视图 + 看板视图 + 8 种字段类型」，不做公式/关联/汇总/筛选排序分组。

自研的边界必须钉死（对齐 tauir 的 Scope Boundaries）：
- 首期：**表格视图 + 看板视图**；添加/删除记录与字段；单选/多选/日期/复选/数字/长文本编辑；看板拖拽改状态。
- 不做：公式、关联记录、汇总/查找引用、权限、表单视图、日历视图、协作。
- UI 必须走项目既有的「精仿思源」版式语法（`AGENTS.md` §3 #14），**不要**再造一套表格视觉类；拖拽**不要新引依赖**：本项目 `package.json` 里没有 `@dnd-kit`（那是 tauir 的选择），复用现有的指针式拖拽写法（`src/components/treeDrag.ts`）或写一个最小指针实现即可。

---

## 7. UI / 交互集成点（按文件列出）

| 位置 | 现状 | 要做的改动 |
|---|---|---|
| `src/components/Sidebar.tsx` | `type CreateKind = "notebook" | "group" | "note"`；「+」只留「新建笔记本」；文档/分组走右键菜单（`Sidebar.tsx:647`、`487`） | `CreateKind` 加 `sheet`/`bitable`；右键菜单加「新建表格」「新建多维表」（与 tauir 的落点一致）；行图标按 kind 区分 |
| 新建 IPC | `create_note` / `create_note_in`（`electron/ipc/registerNotes.ts:41,135`） | 加 `create_sheet_in` / `create_bitable_in`（或给 `create_note_in` 加 kind 参数——**推荐前者：显式、不易误用**）；桥接三处齐（`preload.cjs` / `webApiServer` / `src/lib/native.ts`） |
| `src/features/editor/MultiTabEditor.tsx` | 每个 tab 渲染 `EditorTab`（`:430` key = noteId + reloadKey） | 按 `tab.kind` 路由到 `EditorTab` / `SpreadsheetTab` / `BitableTab`；两种新编辑器 **`React.lazy` 懒加载**；`reloadKey` 语义沿用（历史恢复/同步覆盖后强制重挂） |
| 文档型 UI 入口 | 顶部导出菜单、大纲栏、复制 Markdown、导出为 Markdown/HTML/PDF/Lake、字数统计、信息面板 | 非 `doc` 类型一律隐藏或替换：表格 → 「另存为 Excel/CSV」；多维表 → 「导出 CSV/JSON」；大纲/字数/复制 Markdown 隐藏（对齐 tauir `TopBar` 的做法） |
| 搜索 | `search_index`（title/markdown/plain，由 `lakeHtmlTo*` 生成） | 首期**只索引标题**；二期加 `sheetToPlain` / `bitableToPlain` 抽取（否则搜索静默漏内容，要在 UI 或文档里写明） |
| 导出资料包 | `electron/noteExport.ts`（md→HTML，Lake 专用） | 加 kind 守卫：非 `doc` 不入 Markdown 包（对齐 tauir R10） |
| 表格工具栏 | CE 默认无工具栏；且 npm 包内**没有** Material Icons 字体文件（`jsuites.css` 只声明 `font-family:"Material Icons"`，图标会退化成裸文字并重叠） | **已实现（260918）**：`SheetEditor.tsx` 开 `toolbar: true` + 本地化字体 `src/features/sheet/MaterialIcons-Regular.woff2`（Apache-2.0，见同目录 `LICENSE-material-icons.txt`）+ `src/features/sheet/sheetEditor.css` 的 `@font-face` / `.material-icons` 规则；CSP `font-src 'self'` 放行、离线可用 |
| 单元格内换行 | CE 默认用单行 `<input>` 编辑器，Alt+Enter 无法插换行 | **已实现（260918）**：CE 只在**列级** `wordWrap:true` 时才用多行 `<textarea>` 编辑器（顶层 `wordWrap` 到不了该路径、实测无效）⇒ `SheetEditor.tsx` 逐列补 `wordWrap:true`（`withWordWrap`/`sheetColumnWidth`，保留已有列配置）。Alt+Enter 插换行、Enter/失焦提交、长文本自动折行 |
| 编辑中行高即时撑高 | CE 只在**提交后**按内容自动调行高；编辑中的多行 `<textarea>` 固定 22px，Alt+Enter 换行后第二行会被 td（`overflow:hidden`）裁掉，看不见正在输入的内容 | **已实现（260918）**：在 mount 上代理 `input`/`keyup`（Alt+Enter 靠 keyup 兜底），用 `height:0` 量 `scrollHeight` 后同时撑高 textarea 与所在行（`setHeight(row, h+4)`）。实测：单行 22→行高 26（不变）、两行 35→行高 39（≈CE 提交后的 38） |
| CSS | `src/styles/cssLayers.test.ts` 是**只允许变小的围栏** | 第三方编辑器自带 CSS 属「合法新增」，需同步抬高基线并注明来源/许可（与 siyuan.scss 的处理一致）。本批已把 `features/sheet/sheetEditor.css` 纳入围栏（`@font-face` 不计声明数） |

---

## 8. 移动端策略（v1 = 不腐坏）

必须做（否则会**静默毁数据**）：
1. 移动端 `notes` 表加 `doc_kind`（`src/mobile/schema.ts:13`），同步层映射 `kind`。
2. `mobile/notebook/NotebookWorkspace.tsx` / `mobileApp` 打开逻辑：`kind !== 'doc'` → **只读占位页**（「此文档类型请在桌面端编辑」），**绝不实例化 Lake 编辑器**、绝不调用保存。
3. 回收站预览（`mobile/trash/TrashPreviewPage.tsx`，同样用 `LakeEditor`）也要按 kind 挡住。

这样移动端不改同步、不做编辑器也能**正确搬运与展示元数据**，等桌面端稳定后再排移动端渲染。

---

## 9. 已知风险与验证清单

| 风险 | 说明 | 应对 |
|---|---|---|
| **keep-alive + canvas 尺寸为 0** | 所有 tab 都挂在 DOM（隐藏）；Univer 是 canvas，隐藏容器里初始化会算成 0 尺寸，切回来可能空白 | 参考本仓库 Lake 编辑器踩过的同类坑：切到该 tab 时创建/显示后强制 `resize()`，或对非激活 tab 延迟创建；e2e 断言「切走再切回，网格可见且有尺寸」 |
| **全局粘贴拦截器会抢 Univer 的剪贴板** | `installPasteInterceptor()` 在 `src/main.tsx:36` 顶层安装（移动端同），会改写 paste 事件 | 拦截器加作用域判断：事件目标在表格/多维表容器内 → 直接放行；**必须有测试** |
| **离线/CSP** | 三条 CSP 只放行 `self` + `127.0.0.1:*`（无外部域） | 构建产物复扫：确认 Univer 无外部字体/图片/脚本 URL（构建产物离线资源复扫）；必要时把资源镜像进 `public/vendor` |
| **bundle 体积** | Univer 量级数 MB；exceljs 20 MiB+ | 两个编辑器 + exceljs 全部 `React.lazy`/动态 import，不进首屏 chunk |
| **大正文对象的传输** | 表格 JSON 可能比文本文档大一个量级；且当前**正文对象不 gzip**（`syncEngine.ts:692` 上传时未传 `gzip`） | 建议顺带给正文对象启用 gzip：`ObjectStore.getOptional` 已按魔数透明解压（`sync.ts:166-174`），而 `contentHash` 始终按**未压缩内容**计算 ⇒ **读写两侧都不受影响、hash 稳定**。这是低风险高收益的一步（对表格尤甚） |
| **历史快照体积** | 每次被覆盖会存一份完整 JSON（gzip level 6） | 可接受；若表格很大，评估「快照只留 N 份 + 更短保留」或快照前做 JSON 归一化 |
| **清单体积** | 每个表格/多维表占一条 note（约 340 B + 附件声明 130 B/个） | 按 5K 文档量级无压力（按当前 manifest 上限估算） |

---

## 10. 分期与工作量（估算，单人）

| 阶段 | 内容 | 估时 |
|---|---|---|
| **M0 协议与骨架** | `notes.kind` + **按 kind 分目录（§4.1：改 `notePath` 一处 + 两处建目录）** + manifest v6（三处同改）+ `READABLE` + 新建入口（Sidebar/IPC/桥接三处）+ tab 类型路由 + 两个**占位编辑器** + **§4.4 的三处 kind 分支** + 移动端防腐坏 + 文档（SYNC-PROTOCOL/STORAGE-LAYERS） | **2–3 天** |
| **M1 表格** | 引入 Univer（懒加载）+ 空工作簿模板 + 打开/保存/自动保存 + keep-alive resize + 粘贴拦截器作用域 + 导出入口按 kind 收口 + **xlsx 导入导出做成末尾可选开关（§6.1 修正建议）** | **3–5 天（含 xlsx 再 +2–3 天）** |
| **M2 多维表** | 数据模型 + 表格视图 + 看板视图 + 字段配置（增删改类型/选项）+ 记录增删 + 拖拽改状态 + 自动保存 | **5–8 天** |
| **M3 打磨** | CSV/JSON 导出、搜索抽文本、筛选/排序/分组、附件字段接资产管线、移动端只读渲染 | **按需拆** |

> 建议顺序：**M0 单独一个批次先落**（它只碰协议与骨架，可独立验收、可独立回滚），M1/M2 各自独立成批。**不要把 M0 和 M1 混在一个提交里**——协议变更是所有后续改动的地基。

---

## 11. 验收标准（M0，第一批）

1. 桌面端能新建表格 / 多维表，出现在目录树、可重命名/移动/删除/进回收站/恢复，与 Lake 文档无异。
2. 新建后两端同步：另一端能收到条目，且**打开的是正确编辑器**（不是 Lake 编辑器）。
3. 旧版本客户端读 v6 清单 → **明确报「清单版本不兼容」并中止**，不产生任何写入。
4. 移动端收到表格/多维表条目 → 显示只读占位，**正文字节不变**（同步往返后 sha256 一致）。
5. 对表格/多维表执行一次「保存 → 同步 → 另一端下载 → 再保存」，**正文 sha256 全程不变**，且搜索索引里没有 JSON 碎片。
6. 门禁：`tsc` 0 · `vitest` 全绿（含新增的 kind 往返/移动端防腐坏用例）· 桌面 + 移动 `vite build` 全绿。

---

## 12. 证据索引

- 参考实现：`local-lake-notes-tauir/docs/plans/2026-05-06-001-feat-univer-spreadsheet-documents-plan.md`、`2026-05-07-001-feat-multidimensional-table-plan.md`；`src/features/spreadsheet/{spreadsheetDocument,spreadsheetSnapshot,spreadsheetAutosave}.ts`；`src/features/multidimensional-table/multidimensionalTableDocument.ts`
- 内核能力核实：`vendor/lakex-doc-react/src/components/lakex/{lakex.js:122081, icon.tsx:2087-2260}`、`src/components/` 目录清单
- 语雀官方口径：`yuque-developer-docs/docs/71 - Webhooks 消息推送 [doc-webhook].md:114-141`（表格正文格式）、`docs/04 - 配置工具栏`（文档内表格工具栏）、`docs/02 - 语雀开放 API`（数据表详情接口）
- 本仓库集成点：`electron/schemaInit.ts:33-52`、`src/core/manifestTypes.ts`、`src/core/syncDecisions.ts:84-103`、`src/core/syncUtils.ts:23-32,192-197`、`electron/syncAdapters.ts`、`src/mobile/syncDbPort.ts`、`src/components/Sidebar.tsx:14,359-367,641-658`、`src/features/editor/MultiTabEditor.tsx:430`、`electron/store.ts:369-431`、`electron/noteExport.ts`、`src/mobile/schema.ts:13-24`
- 相关既有设计：`docs/STORAGE-LAYERS.md`（§0 三处同改铁律）、`docs/SYNC-PROTOCOL.md`、`docs/ARCHITECTURE.md`

---

## 13. 思源 Attribute View（用户新增的资料）能借鉴什么、不能借鉴什么

资料位置 `/Users/admin/file/local-lake/siyuan-master`，即思源的「数据库」（内核叫 Attribute View，前端在文档里以块的形式渲染，用户感知为挂件）。

### 13.1 它是什么、有多大

| 部分 | 位置 | 规模 |
|---|---|---|
| 内核引擎（值/筛选/排序/布局） | `kernel/av/`（`value.go` 3,235 行、`calc.go` 等） | 约 **17,300 行 Go** |
| 前端渲染与交互 | `app/src/protyle/render/av/` | **95 个 TS 文件、约 29,800 行** |
| 数据落点 | **内核 SQLite**（`/api/av/renderAttributeView`、`/api/av/getAttributeView`）；文档 `.sy` 里只有 `data-av-id` 指针 | — |
| 许可 | 仓库根 `LICENSE` = **AGPL-3.0** | — |

### 13.2 三条硬约束（决定了我们不能移植它）

1. **许可**：AGPL-3.0。本项目目前只在 `src/b3/siyuan.scss` 一处按 AGPL-3.0 署名地 vendor 了样式；**把 AV 引擎或前端整块搬进来，会把 AGPL 的传染面扩到整个分发物**。可以读它、学它的模型与交互，不能拷它的实现。
2. **数据位置与我们的同步模型相反**：思源的 AV 数据在**内核 SQLite**，靠 HTTP API 读写；文档文件里只有块属性 `data-av-id`（前端 `blockElement.getAttribute("data-av-id")`）。它的多端同步同步的是**它的数据库**。而我们的模型是「本地 DB 不跨端、只有 **S3 对象 + 清单**跨端」。⇒ 采用它的存法，等于**多维表数据永远出不了这台机器**。所以我们的多维表数据必须落在**被同步的正文文件**里（这是本设计 §3.2 把整份 `fields/records/views` 写进 body 的根本原因）。
3. **重前端事件模型**：AV 前端是「DOM 直改 + fetch 内核」的架构，与我们 React + IPC 的渲染层职责划分完全不同，迁移成本高于自研。

### 13.3 但它是最有价值的**语义与功能参照**（这才是这份资料的正确用法）

| 借鉴点 | 具体取用 |
|---|---|
| **字段类型词表** | 16 种（`av.go:158-176`）：`block/text/number/date/select/mSelect/url/email/phone/mAsset/template/created/updated/checkbox/relation/rollup/lineNumber` ⇒ 我们的 `FieldType` 直接沿用这套命名（§3.2），首期只实现其中 8 种，未知类型只读展示 |
| **视图词表** | `LayoutTable` / `LayoutGallery` / `LayoutKanban`（`av.go:315-317`）⇒ 我们用 `grid/gallery/kanban`，首期实现 `grid + kanban` |
| **字段属性结构** | `Key{ID,Name,Type,Icon,Desc}` + 按类型分挂 `Options[]`（单选/多选）、`NumberFormat`（数字）、日期格式等（`av.go:178-195`）⇒ 我们的 `BitableField` 结构可照此形状设计，天然向前兼容 |
| **功能路线图** | 它已经走过的：筛选 / 排序 / 分组 / 卡片与看板布局 / 计算列 / 关联 / 汇总 ⇒ 就是我们 M3 及以后要补的清单，**按它的顺序排优先级有现成参照** |
| **性能做法** | `app/src/protyle/render/av/virtualScroll.ts`（984 行）等：大数据量下的虚拟滚动与拖选处理 ⇒ 我们的表格视图若自己写网格，这是最有价值的参考；但更省力的仍是直接用 headless 表格库（§6.2） |
| **导出/互操作** | 可参考它把数据库导成 CSV/Markdown 表的边界处理 |

### 13.4 一句话总结

> 思源的数据库在**产品语义**上是我们最好的老师（字段/视图/筛选的词汇表与优先级），在**代码与数据布局**上是最坏的模板（AGPL + 数据在本地 DB + 直改 DOM）。⇒ **学它的模型，不碰它的代码；数据必须进我们被同步的正文。**
