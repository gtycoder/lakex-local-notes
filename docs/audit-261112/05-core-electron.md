# 05 · src/core 领域层 + Electron 主进程 审计

> 审计对象：`src/core/**`（164 个非测试 .ts / 22,433 行）+ `electron/**`（164 个非测试 .ts / 24,054 行）+ `electron/preload.cjs`。
> 审计日期：261112。性质：**只读**（未改任何产品代码、未装依赖、未跑构建、未跑全量 vitest、未启动 App/设备、未触碰真实数据目录）。
> 契约依据：`docs/SYNC-PROTOCOL.md`、`docs/STORAGE-LAYERS.md`、`docs/RESILIENCE.md`、`docs/TAG-SYSTEM-DESIGN.md`、根 `AGENTS.md` §3/§4。
> 本报告自包含：执行者**不需要**本会话上下文，每条 finding 都带 file:line 或可复现命令。

---

## 0. 方法与范围

**方法与口径**

| 项 | 做法 |
| --- | --- |
| 文件/行统计 | `find <dir> -name '*.ts' ! -name '*.test.ts' -exec cat {} + | wc -l`（只算 .ts，不含 .tsx） |
| IPC 通道 | 用正则提取 `\.handle|\.handleEvent("<channel>"` 与 preload 的 `invoke("<channel>"`，并与 `electron/ipc/register*.ts` 交叉核对 |
| 模块引用图 | 自写解析器（相对路径 → 绝对路径，JS 扩展名归一），统计每个 `src/core/*.ts` 的非测试引者 |
| 事实校验 | 只读 `read`/`grep`/一次性 `node` 脚本；每个「推断」都显式标注 |

**范围**：`src/core/**` 全部；`electron/**` 全部（重点 store.ts / quickNotes.ts / main.ts / s3v3/ / ipc/ / ai/ / update/ / portable/ / assetServer / webApiServer / s3Store / s3Maintenance / history* / trash* / tag*）；`electron/preload.cjs`；上述契约文档与 `AGENTS.md` §3/§4。

**本次未覆盖（见附录 B）**：`electron/ai/**` 与 `electron/update/updateService.ts` 的行为细节、便携包 zip 条目级校验、`webApiServer.ts` 988 行逐段、真实 S3 往返与设备端实测、better-sqlite3 主进程阻塞的实测采样。

**证据分级**：`【已核实】` = 我直接读到/统计到；`【推断】` = 由代码结构推得、未实测。

---

## 1. 事实地图

### 1.1 进程与数据流（桌面）

```
渲染层 (src/**)  ── src/lib/native.ts（类型门面，638 行）
      │  window.lakeNative（preload.cjs 注入）
      ▼
electron/preload.cjs  187 处 invoke("...") 调用（文件内共 188 处 `invoke(`，含 :16 的 helper 定义）→ 187 个通道，无重名
      ▼  ipcRenderer.invoke
electron/ipc/registrar.ts:51-94   —— 唯一 ipcMain.handle 出口（187）
      │   （校验 sender、错误 envelope、慢调用埋点 ≥200ms）
      ▼
electron/ipc/register*.ts（21 个注册文件，按域）
      ▼
领域仓储：store.ts(2108) / quickNotes.ts(1451) / noteQueries / noteContentRepository /
         assetRepository / historyLifecycle / trashLifecycle / syncReconciliation / diaryStore …
      ▼
src/core/**（164 文件，纯净：无 node:/electron/DOM/react/better-sqlite3）
      ▼
electron/s3v3/*（适配器：S3v3S3Remote / DesktopStoreDevice / desktopPlatformPort）
      ▼
云端 = meta/pointer.json + 两个不可变索引 + 每篇资产声明（v3/v4 内核在 src/core/s3v3/commit/*）
```

**已核实的分层不变量**（三条命令，0 命中即干净）：

```bash
rg -c 'from "node:' src/core -g '!*.test.ts'                     # = 0
rg -n 'from ".*electron/' src/core -g '!*.test.ts'               # = 0
rg -n 'from "../../src/(features|app|mobile|components|styles)/' electron -g '!*.test.ts'  # = 0
rg -n 'from "../../electron/|from "electron/' src -g '!*.test.*'  # = 0
```

- electron 对 src 的依赖面 = **58 处 `src/core` + 1 处 `src/lib`（仅类型 `electron/ipc/registerDuplicateNotes.ts:25`）**【已核实】。
- 护栏脚本 `scripts/check-core-boundaries.mjs` 额外禁止 `process.`/`Buffer`/`document.` 等全局（:26-35），HANDOFF §1 记录 `check:core` = 164 文件 0 违规。
- **结论：分层边界目前是干净的，且有可执行门禁。本节不构成 finding。**

### 1.2 IPC 全量方法清单：三处是否一致？【已核实：一致，且有护栏】

- 通道总数 = **187**：注册侧 187（`handles|handleEvent` 字面量）↔ preload 187（`invoke` 字面量）↔ `webApiServer.ts` 的 `WEB_METHODS` 187。
- 护栏文件 `electron/ipc/ipcChannelParity.test.ts`：
  - :58-70 ①↔② 全等（并**禁止同名通道重复注册**）；
  - :72-83 ①↔③ 全等；
  - :85-118 **规模钉死 187**，增删必须解释。
- 唯一 `ipcMain.handle` 出口 = `electron/ipc/registrar.ts:70-84`（统一 `validateSender` + `encodeIpcError` + 慢调用 warn，:33/:41-49）。
- `src/lib/native.ts:426` 的 `api()` + :431 起的 `native` 包装对象是**第四面**（类型 + 运行时转调），**不在**上述护栏覆盖内 —— 见 P2-3。

### 1.3 core 导出面与消费者统计【已核实，自写解析器】

| 指标 | 数值 |
| --- | --- |
| `src/core` 非测试 .ts | 164（22,433 行）；测试文件 148 |
| 被 electron **与** mobile 同时消费 | **65** |
| 仅 electron 消费 | 25 |
| 仅 mobile 消费 | 25 |
| 零引者模块（含测试都不引） | **0** |
| 只被测试引的模块 | 2：`src/core/s3v3Gc.ts`（98 行）、`src/core/repositoryCapabilities.ts`（95 行，末端是「能力对账数据表」，其自身 doc 说明就是给测试用的，**合规**） |

`electron` 侧同口径：**无**非测试引者的模块里，`electron/main.ts` 是进程入口（预期）；另有 3 个「只被测试引」的测试支撑文件（`s3v3/deviceConformance.ts` 740 行、`s3v3/fileDeviceStore.ts` 133 行、`portable/zipTestReader.ts` 63 行，见 P2-6）。

### 1.4 大文件与职责（拆分目标的输入）

| 文件 | 行数 | 实际职责（读方法/函数名得到） |
| --- | --- | --- |
| `electron/store.ts` | 2108 | 已是**门面**：绝大多数方法委托给 repository；自身只剩 3 个 `db.transaction`（:800/:883/:1799）+ sync 投影 SQL（`listNotesSyncMeta` :563、`listFoldersForSync`）+ 导出分派（:1244-1301） |
| `electron/quickNotes.ts` | 1451 | **一个类装 7 个域**：DDL/迁移(:168-285)、staging 生命周期(:699-960)、save 主路径(:762-880)、回收站/恢复/清除(:964-1060)、搜索索引(:564-698)、标签关系(:402-460)、缺正文恢复(:462-563) |
| `electron/main.ts` | 1306 | 启动/boot 窗口(:336-398)、单实例与退出(:202-218,:1267-1306)、协议与 CDN/资产 token 重定向(:139-335)、**IPC 全量装配(:614-786，172 行)**、定时器与崩溃登记(:389-396,:794) |
| `electron/webApiServer.ts` | 988 | HTTP 引导 + 静态资源 + SSE(/__events) + WEB_METHODS 桥 + 安全判定(:261-345 `isAllowedRequest`/`hasValidToken`/`sameOrigins`/`documentSetCookies`) |
| `src/core/s3v3Engine.ts` | 924 | v4 内核编排壳：`runSyncRound` 调用、发布锁重试(:MAX_PUBLISH_RETRIES=6)、首传竞态重试(:MAX_CLOUD_RACE_RETRIES=2)、深清、单条推送委托；真逻辑在 `src/core/s3v3/{plan,apply,commit,state}/` |
| `electron/s3v3/deviceConformance.ts` | 740 | **vitest spec**（10 个场景矩阵），不是产品模块（见 P2-6） |

### 1.5 S3 v3/v4 同步：不变量在代码中是否可证明【已核实的主体】

| 不变量（AGENTS §3/§4） | 代码证据 | 判定 |
| --- | --- | --- |
| 先拉后推 | `electron/s3v3/desktopSync.ts:156` → `S3v3SyncEngine.sync()` 内先 `pullRound/readRemoteIndexes`，再 `runSyncRound`（`src/core/s3v3/commit/runSyncRound.ts:60-81` 的顺序 plan→apply→assets→buildPublishIndex→commitPlan） | ✔ 可证明（顺序写死在一个可测单元里，文件头 :1-10 是它的「意义声明」） |
| 发布 = 写索引→锁→读回→写 pointer（无 CAS） | `commitPlan` + `PUBLISH_LOCK_WAIT_MS=10s`/`BUSY_BUDGET=20s`（`src/core/s3v3Engine.ts:32-35`），retry 语义在 `runSyncRound.ts:86-88`「retry 不做清理/不结算意图」 | ✔ |
| 清理只在真的发布后进行 | `runSyncRound.ts:90-108`（`commit.status==="published"` 才 `savePending`） | ✔ |
| 删除 = 缺席 + 本地删除意图 | `src/core/s3v3/plan/plan.ts` + `intentLog`；`s3v3Engine.ts:61` 引用 `state.intents` | ✔ |
| 恢复标记 = 唯一 local-wins 例外 | `plan.ts` 的 restore 分支 + `runSyncRound.ts:112`（restoredIds 结算） | ✔ |
| 并发 12 硬夹 32 | `s3v3Engine.ts:36,208`、`quickPush/pipeline.ts:52,219` | ⚠ 正确但有**两处**字面量（P1-2） |
| 事务/半失败 | 小记保存 = staging 落盘 → `db.transaction` 提交 → promote 改名（`quickNotes.ts:830-870`），启动时 `recoverStagedSaves`(:883-911) 按「DB content_hash == meta.contentHash」补 promote | ✔ 设计正确；残余见 §2.d-3 |
| I1/I2/I3 互斥域 | `src/core/maintenancePolicy.ts`（纯数据+纯函数，两端共用）；桌面实现 `electron/main.ts:175` `enqueueMaintenance` + `electron/syncEngineController.ts:36` `serializedQuickPush`（高优先门，不进维护队列） | ✔ 桌面侧可证明（移动侧不在本报告范围） |

---

## 2. 问题清单

> 判定纪律：只列「问题真实存在 + 不做有代价 + 收益 > 复杂度」的项；个人风格偏好与「代码更整洁」不进清单（AGENTS §3#17）。
> **P0 = 无。** 我按 P0 形态逐项查过：路径穿越、命令注入、凭据明文落盘、多表写缺事务、同域自锁、未捕获异常、三方 IPC 漂移 —— 均未发现可复现问题（依据见 §2.g「已核实无问题」）。

### a. 分层/边界

**A-1【P2】`src/lib/native.ts` 是三方护栏之外的「第四面」，漂移只在运行时报「不是函数」**
- 证据：护栏 `electron/ipc/ipcChannelParity.test.ts:58-83` 只比对 ①注册侧 ②preload ③WEB_METHODS；`src/lib/native.ts:431` 起的 `native` 对象逐方法 `api().xxx()` 转调，没有任何测试把它与 ①②③ 对齐。
- 真实存在吗：是。`preload.cjs` 是原生 CJS（不能 import TS），`native.ts` 的 `LakeNative` 接口（:96）与 preload 之间**没有共享类型**；`interface` 只能约束「调用形状」，约束不了「preload 是否真的有这个方法」。
- 代价：与 261016 实际事故同类（并发会话给 preload 加 `find_in_document` 却漏了 `WEB_METHODS`，被测试抓住；那一面当时没人守）。漏一面 = 用户点下去才发现。
- 修法（~20 行测试）：在 `ipcChannelParity.test.ts` 增第四个提取器，扫 `src/lib/native.ts` 的 `api().(w+)(` 方法名集合，与 preload 的方法名集合全等。**不要**改成 codegen（违反 §3#17，且 preload 不能引 TS）。

**A-2【P2】`electron/main.ts` 的 IPC 装配段（:614-786，172 行）是内联闭包 + 模块级单例**
- 证据：`assetToken`(:139)/`webApiToken`(:146)/`trustedWebContents`(:265)/`enqueueMaintenance`(:175) 都是模块级；`registerIpc()` 一次性把所有依赖以闭包注入 21 个 register 文件。
- 真实存在吗：是（结构事实）。代价：① 想给某域写集成测试只能整段启动；② 拆分/改名时依赖面不可见。
- 但收益：目前 187 通道有测试护栏且启动只有一条路径 ⇒ **不值得单独开批**，只在 §3 的拆分方案里顺带处理。

### b. 重复与可抽提公共方法

**P1-2【单一来源红线】S3 传输并发常量有两份字面量 + 两份夹取逻辑**（AGENTS §3#13「S3 并发上限 = 12」是红线单源）
- 证据：`src/core/s3v3Engine.ts:36` `const DEFAULT_TRANSFER_CONCURRENCY = 12`（:208 `Math.max(1, Math.min(32, ...))`）与 `src/core/s3v3/quickPush/pipeline.ts:52` 同一常量名、同一数值、:219 同一夹取表达式。第二处**独立定义**、未 import 第一处。
- 真实存在吗：是（两条网络热路径各有一份）。不做会付什么代价：有人按「移动端内存不足」把 engine 调到 8，快路径仍是 12 ⇒ 在移动/弱网下**单条推送静默突破整轮口径**，而 §3#13 的戒律是「不得调到 16+」，双源让这条戒律只能靠人肉记得。
- 修法（零风险）：`src/core/s3v3/limits.ts` 导出 `DEFAULT_TRANSFER_CONCURRENCY=12`/`clampTransferConcurrency()`（或直接由 `s3v3Pool.ts` 旁挂），两处 import。**不要**改数值、不要按端分化。

**P1-1【假护栏】`src/core/s3v3Gc.ts`（98 行）是**死产品模块**，却有 3 个测试文件在为它写用例**（删除/GC 域）
- 证据：`planLakeDeletes`/`planQuickNotesDeletes` 的产品引者 = **0**；引用者只有 `src/core/s3v3Core.test.ts`、`s3v3Capacity.test.ts`、`s3v3Scale.test.ts`（自写解析器 + `rg 'planLakeDeletes|planQuickNotesDeletes' electron src` 交叉验证）。生产 GC 规划在 `src/core/s3v3/commit/executePending.ts` 与 `buildPublishIndex.ts`、深清在 `s3v3Engine.deepCleanup`。
- 该文件自身 doc 写着「待删键规划（纯逻辑）… 执行时仍须过 §5.2 门禁」——是**旧 GC 的规划器**，v4 收口（HANDOFF §1 的 `03ef3fb3` 2026-10-29）后被漏删。
- 不做会付什么代价（这是它列为 P1 而不是「代码整洁」的原因）：**删除安全域出现假护栏**。下一个人改 `deepCleanup` 的待删键规则时，`s3v3Core.test.ts:192-225` 里 `planLakeDeletes`/`planQuickNotesDeletes` 的 4 个用例、以及 `s3v3Scale.test.ts:66`、`s3v3Capacity.test.ts:48` 两处调用，依旧全绿，而它们测的不是生产路径 —— 「有测试覆盖」的错觉比没测试更危险。这与 HANDOFF §1 的 261109 清理批（`decideUpload*`/`lakeReconcile*`）是同一类残留。
- 修法见 §3 S-1：**删文件 + 删那 6 处调用点（4 个用例 + 2 处散点）**；若判定「GC 待删键规划应当有单测」，则反向处理（让生产 `executePending` 的规划改调它）—— 这是一条分叉，列入 §5 裁决。

**P2-1【重复】`runPool` 两份实现、`sleep` 四份实现**
- `src/core/s3v3Pool.ts:25` `export async function runPool`（+ :8 `runPoolSettled`）vs `src/features/bitable/useAiFieldGeneration.ts:40` `export async function runPool`（渲染层另写一份并发池）。
- `function sleep` 四份：`src/core/retry.ts:52`、`electron/resourceRepository.ts:115`、`src/features/import/markdownImportPipeline.ts:239`、`src/features/aiWriting/convertAiMarkdown.ts:60`（最后一处还带 AbortSignal，语义略不同）。
- 判定：真实存在，但**代价很低**（15 行以内的纯工具）。建议只做一件事：把 core 的 `runPool` 改成 `src/core/asyncPool.ts`（名字去 S3 化）后让 bitable 复用；`sleep` 四份**不建议合并**（跨层 + 一份要 AbortSignal，强行统一是 §3#17 的「两个本不相同的东西强行合并」）。**如果只能做一项，做 P1-2 不做本项。**

**P2-2【重复入口】同一个「正文 hash」语义值有两个算法入口**
- `electron/noteBodyHash.ts:8` `noteBodyHash()` = `crypto.createHash("sha256").update(body,"utf8")`，用于保存版本守卫 baseHash（`electron/store.ts:616,982`、`electron/noteContentRepository.ts:84,91,111`）；
- `src/core/sha256Sync.ts:29` `sha256Sync`（桌面由 `electron/sha256Native.ts:13` 注入 node:crypto 实现），同步 `contentHash` 走这条（`src/core/syncUtils.ts:78-79` `sha256Hex` → `sha256Sync`）。
- 输出目前**逐字节相同**（`sha256Sync.test.ts` 是等价性测试），所以**不是正确性缺陷**；真实代价 = 「同一语义值两条实现」，将来若给 contentHash 加规范化（BOM/换行/编码），改一处不会报错，只会表现为 baseHash 守卫误报 `external_changed` 或同步反复空传。
- 修法（一行）：`noteBodyHash()` 改成 `sha256Hex(new TextEncoder().encode(body))` 委托 core，删掉 `node:crypto` 直连。护栏：现有 `sha256Sync.test.ts` + 保存守卫相关测试。

### c. 大文件拆分（按职责，不按行数）

见 §3 S-2～S-6 的目标模块图与迁移顺序。核心判断：**这 5 个文件里只有 `quickNotes.ts` 与 `webApiServer.ts` 是「真混装」；`store.ts` 已经是门面（不要再拆）、`main.ts` 只该抽 IPC 装配、`s3v3Engine.ts` 只该抽发布/重试。**

### d. S3 v3 与同步

**D-1【P2，推断】墓碑水线在「同步未真正发布」时也会推进，可能让已 purge 对象的多余清理延后到 deepCleanup**
- 证据：`electron/s3v3/desktopSync.ts:160-164` 在 `engine.sync()` **返回成功**后无条件 `store.markTombstonesWaterline(at)`；而引擎允许「上传失败的笔记本轮不进新索引」「零变更轮不发布 pointer」（§4 明文 + `runSyncRound.ts:86-108` 只在 published 时执行 `executePendingDeletes`）。
- 推得后果：某次成功轮里若 pending 删除未执行，其墓碑（`deleted_at ≤ 水线`）下一轮不再纳入 ⇒ 云端对象成为孤儿，直到 `deepCleanup` 才清。**不是数据丢失**（删除 = 缺席，索引里已经没有），是云端暂存成本。
- 判定：**不建议现在改**。改成「只在 published 推进」会让长时间零变更的库把墓碑数组无限增长（设计者用「尝试水线」正是为了避免这点）。若要改，需同时给墓碑数组加保留窗口 —— 那是协议级改动。**列为观察项，不做。**

**D-2【P2】深清的 keep 集是 N+1 查询**
- `electron/s3v3/desktopSync.ts:26-34` `localHistoryAssetRefs`：`store.listNoteIdsWithHistory()` 后对**每篇**调 `store.getProtectedRefs(noteId)`（`electron/assetRepository.ts:81-95`，内部 = 当前正文引用 + 历史引用 + 草稿引用，3 段查询）。
- 量级：2 万篇有历史的库 ⇒ 6 万次 prepare/get。better-sqlite3 单次 µs 级 ⇒ **推断**百毫秒级，只发生在手动/定时深清，不在同步热路径。
- 修法（可选）：`assetRepository` 增 `getProtectedRefsForAll(): Map<noteId, Set<filename>>`，一次 `SELECT` 全量历史引用。**优先级低于 P1**。

**D-3【已核实，非缺陷但需登记】小记保存的「DB 已提交、promote 未完成」窗口**
- 顺序：staging 正文+meta 落盘（`quickNotes.ts:831-840`）→ `db.transaction` 更新行 hash/`is_dirty=1`（:842-857）→ `promoteStagedSave` 改名（:859 → :863-882）。若 promote 在 rename 中抛错（缺文件/磁盘满），**DB 已前进而正文文件还是旧的**；启动时 `recoverStagedSaves`(:883-911) 用「DB content_hash == meta.contentHash」判定后**补 promote**，成功才删 staging。
- 结论：崩溃与半失败都有自愈路径；**残余** = 从「保存报错」到「下次启动」之间，UI 读到旧正文而 DB 声称新 hash（读文件为准，不会写坏）。**不要**改成「先 promote 后提交」（那才是真半失败）。
- **登记目的**：避免后续有人「优化」成先改名后入库。

**D-4【P2】小记通道的 env 开关会产出「只同步文档、不碰小记」的半轮**
- 证据：`electron/s3v3/desktopSync.ts:88` `const quickV3 = process.env.LAKE_SYNC_PROTOCOL !== "legacy" && process.env.LAKE_S3V3_QUICK_NOTES !== "0"`；置 0 时 `quickNotes=null`、:91 的 `assertQuickNotesSyncAvailable(quickV3)` 放行，整轮照跑。
- 说明：`LAKE_*` 开发变量是 AGENTS §1 明确保留项，**不算违规**；这里只记录「存在一个能产生半轮世界的开关」，且 :89-90 的注释自己承认「半轮状态比明确失败更危险」—— 这条注释与 :88 的开关是同一文件里的张力。建议在 `docs/RESILIENCE.md` 的失败面登记表补一行（该文档要求「新增失败面必须回填」）。

### e. 性能

**已核实的设计级护栏（不是问题，避免后人重复优化）**
- 同步元数据投影 = **单 SQL**：`electron/store.ts:563-585` `listNotesSyncMeta()`（`LEFT JOIN tree_nodes`，注释「禁止逐篇 readNote/getNoteInfo」）。注意 :565 有 `'' AS content_hash` —— 这是**刻意**的：桌面正文是文件，hash 由 core 每轮按文件实算，且有 `src/core/s3v3/state/bodyChangeGuard.ts` 专门处理「hash 变了但行 updatedAt 没动 = 外部改动」的误传风险。**不要把它改成「从 notes 表读 hash」**。
- hash 复用：`src/core/s3v3/state/deviceStore.ts:258-281` 用 `{mtimeMs,size}` 缓存，未变不重读。
- 进度上报节流 250ms：`desktopSync.ts:122-135`（2 万附件不刷爆 IPC）。
- 声明对象进程内 LRU 4096：`s3v3Engine.ts:52-57`（跨引擎共享，注释给了 4,070 次 GET 的实测背景）。
- 事务：多表写按 §3#9 落 `db.transaction`，分布 `quickNotes.ts`(14)、`syncReconciliation.ts`(7)、`noteMetadataRepository.ts`(6)、`trashLifecycle.ts`(4) 等。

**E-1【P2，推断】主进程同步 IO 无分帧证据**
- better-sqlite3 是同步 API，且主进程同时承担文件 IO + 全库映射（`deviceStore.ts:512` 每轮再取一次 `listNotesSyncMeta`，即一轮内 2 次全表）。20k 文档时单次映射成本推断为几十 ms，若叠加 VACUUM/深清（`assetServer` 与 IPC 同进程）会阻塞事件循环。
- 未实测 ⇒ 只记录，不建议现在动（AGENTS §3#17：没有实测证据不做「优化」）。测量入口已有：`registrar.ts:33` 的 `SLOW_IPC_MS=200` warn、`desktopSync.ts:143-149` 的 `onPhase` 慢阶段 warn。

### f. 兼容代码（AGENTS §3#7 逐条）

| # | 位置 | 内容 | 判定与删除判据 |
| --- | --- | --- | --- |
| C1 | `src/core/s3v3/state/intentLogState.ts:167-190` `legacyToV2`/`isLegacyShape` + :243-268 `migratePersisted` 的 v2 分支 | 设备侧同步账本的 **v1 旧形状 + v2 形状 → v3 信封** 单向迁移 | **候选**。v3 信封自 `03ef3fb3`（2026-10-29）起，首个发布版 v1.0.0 = 2026-11-08 ⇒ **已发布版只写 v3**，v1/v2 分支只服务 2026-10-26～10-29 的开发数据。删除判据：`git log` 确认无发布版写过 v2（已确认）+ 判定「开发机同步账本可重建/可弃」（账本里 `intents` 不可重建，但开发机可接受）。**不建议单独开批**（收益 = 少 ~35 行分支；风险 = 若判断错，旧的 purge 意图丢失会让已删笔记被重新上传） |
| C2 | `electron/schemaInit.ts:208-220`；`electron/quickNotes.ts:252-262` | 首次建 `tombstones_published_at` 水线时读旧行（`hasPublishedAt`）兜底 | **保留**（删除判据不满足：删了 = 旧 purge 墓碑被当成「未发布」，会把已删对象重新纳入清理范围；一次性 5 行，代价极低） |
| C3 | `src/core/quickNoteSort.ts:52-58` | 旧两值 `updated/created` → 新四档映射 | **保留**（文件 doc 已写明判据：这是**本机 UI 偏好**，不是可重建的文档/库表；丢了等于让用户偏好莫名回默认） |
| C4 | `src/core/noteKind.ts:12-16` | `normalizeNoteKind` 非法/缺失 → `"doc"` | **保留**（跨端白名单语义：未知 kind 被旧端降级成 doc 会毁正文，见该文件 :10-11 的警告；这是**安全阀**不是历史兼容） |
| C5 | `src/core/lockedText.ts:152` | `legacy-yuque` 加密文本卡（本机解不开，只提示） | **保留**（数据在**正文内**，属「用户文档内容」，删了 = 老文档里的卡片显示异常） |
| C6 | `src/core/syncDecisions.ts:49`、`electron/syncEngineController.ts:77` | 已是「v2 legacy 决策已删 / 回滚入口已移除」的注释证据 | **已闭合**，仅作对照，证明清理批确实落地 |
| C7 | `electron/s3v3/desktopSync.ts:88` | `LAKE_SYNC_PROTOCOL=legacy`/`LAKE_S3V3_QUICK_NOTES=0` env 开关 | **非违规**（AGENTS §1 保留 `LAKE_*` 开发变量）；仅建议在 RESILIENCE 失败面登记（见 D-4） |

**结论**：本域**没有**「为旧数据写的读取分支/迁移函数」违规项需要立即删除；C1 是唯一还站得住的删候选，且属于「可延后、收益仅整洁」档 —— 按 §3#17 不应单独开批。

### g. 安全 / 健壮（逐项核过，大多为「已核实无问题」）

**已核实无问题（含证据，供发版前复核引用）**
- 路径穿越：`electron/assetServer.ts:288-311` 每段过 `isSafePathSegment`、`/vendor/cdn/` 显式拒 `..`/反斜杠/空段（:255-258）、`decodeURIComponent` 有 400 兜底（:252-253）；孤儿资源预览二次校验（`electron/orphanLifecycle.ts:194-199`）。
- 凭据：S3 Secret 走 `SecretCipher`，**fail-closed**（`electron/secretCipher.ts:23-31`：safeStorage 不可用/后端 `basic_text` 时**抛错拒绝保存**，不落明文）；旧明文值拒绝读取并提示重配（:37-44）。A2 云端恢复的 seed 只写 **settings 原始密文行**（`electron/settingsRepository.ts:53-57` `exportS3SettingsRow`、`electron/ipc/registerNotes.ts:237-240`、`electron/main.ts:976-983`），绝不写明文；工作区备份排除 sqlite（`electron/workspaceBackup.ts:14-21`）。
- 命令注入：全仓 **0** 处 `exec/spawn`（`rg 'execSync|execFile|spawn\(' electron` 只命中 openPath/openExternal）。`shell.openPath` 只吃主进程自有路径（`registerUpdate.ts:22-30` 只认 service 记录的下载路径；`registerWeb.ts:14-23` 只开自建 URL）；`shell.openExternal` 有 `https://` 前缀校验（`registerUpdate.ts:33-36`）。
- 未捕获异常：`electron/main.ts:389-396` `uncaughtException`/`unhandledRejection` 落日志；:389 前写**持久** crash marker（`startupRecovery.ts:254`「自身绝不抛错」）；`render-process-gone`(:537-543) 与 `child-process-gone`(:794-796) 都有登记。
- 日志敏感信息：`rg 'log\.(info|warn|error)\(.*(secret|AccessKey|token)'` = 0 命中；IPC 埋点只记通道名+耗时（`registrar.ts:41-49`）。
- 本地 HTTP 面：`electron/webApiServer.ts:320-345` 单一来源 `isAllowedRequest`（Host 白名单防 DNS rebinding / Origin 精等同源两形态 / 无 Origin 时只认 Sec-Fetch-* 或合法 token / token 常量时间比较），API token 与 asset token **分离**（:230-247），`/__native.js` 不下发令牌（:23）。
- 资源服务 CORS：非主进程 origin 一律 403（`assetServer.ts:247-250`），CORS 请求需 `?token=`（:283-287），SVG 走 `nosniff`+CSP sandbox（:318-326）。

**S-1【P2，注释漂移，非逻辑缺陷】`electron/settingsRepository.ts:65` 的注释说「不可用时退回明文」，实现已 fail-closed**
- 证据：注释「密钥用 Electron safeStorage 加密落盘；不可用时退回明文」；实际 `encryptSecret`→`SecretCipher.encrypt` 在不可用时 **throw**（`secretCipher.ts:30-31`「宁可拒绝保存，也不把 S3 Secret 明文落盘（旧实现是静默明文）」）。
- 代价：这是安全域的反向注释 —— 后来者若信注释「恢复」明文回退，会直接破坏已修的安全属性。修法：改一行注释。**这是本报告里最便宜的一项，值得顺手做。**

---

## 3. 方案

### S-1 死模块处置（对应 P1-1）—— **需先裁决，见 §5-1**

分支 A（推荐，默认）：`src/core/s3v3Gc.ts` 整体删除；同步删除 `s3v3Core.test.ts` 中 `describe("planLakeDeletes / planQuickNotesDeletes")`（:192-225）与两处 sparse 用例（`s3v3Scale.test.ts:66`、`s3v3Capacity.test.ts:48`）。
- 迁移顺序：① 先跑 `npx vitest run src/core/s3v3Core.test.ts src/core/s3v3Scale.test.ts src/core/s3v3Capacity.test.ts` 确认当前绿；② 删文件 + 删断言；③ `npx tsc --noEmit` + 全量 vitest；④ 若 `scripts/css-audit/audit-dead-css.mjs` 之类有清单需同步（本项无）。
- 护栏变更：**净减少** 3 个测试文件的断言数，需在提交说明写「删除的是死模块的假护栏，删除域的护栏在 `runSyncRound.test.ts`/`commitPlan.test.ts`/`executePending.test.ts`/`deviceConformance`」。
- 风险：极低（0 产品引者）。**唯一风险**是判定错「生产真在用」——已用两种方法交叉验证（解析器 + 符号名 grep），可再让 reviewer 跑一次 `rg 's3v3Gc' src electron`。

### S-2 单一来源收口（对应 P1-2 / P2-1 / P2-2）

**顺序（从零风险到低风险）**：

1. `src/core/s3v3/limits.ts`（新，~10 行）：
   ```ts
   export const DEFAULT_TRANSFER_CONCURRENCY = 12;   // AGENTS §3#13，唯一来源
   export const MAX_TRANSFER_CONCURRENCY = 32;
   export function clampTransferConcurrency(v?: number): number {
     return Math.max(1, Math.min(MAX_TRANSFER_CONCURRENCY, v ?? DEFAULT_TRANSFER_CONCURRENCY));
   }
   ```
   `s3v3Engine.ts:36,208` 与 `quickPush/pipeline.ts:52,219` 改为 import。
   护栏：新增 `src/core/s3v3/limits.test.ts`（1 例：默认=12、夹取 [1,32]、两处调用点用同一常量 —— 后者可用 `expect(clampTransferConcurrency(64)).toBe(32)` + 一条「quickPush 与 engine 的默认值相等」的导入断言）。
2. `electron/noteBodyHash.ts:8` 改为委托 `sha256Hex`（core），删 `node:crypto` 直连。护栏：`sha256Sync.test.ts` + `electron/noteBodyHash.test.ts`（若有）+ 保存守卫测试。
3. `src/core/s3v3Pool.ts` → `src/core/asyncPool.ts`（保留 `runPool`/`runPoolSettled` 名字），`src/features/bitable/useAiFieldGeneration.ts:40` 删本地实现改 import。**若 reviewer 认为「S3 命名泄露到渲染层」不可接受则本步不做**（权重最低）。

### S-3 `quickNotes.ts`（1451）拆分 —— 目标模块图

**不是按行切，是按「事务边界 + 文件顺序不变量」切**：

```
electron/quickNotes/
  schema.ts        DDL + migrate()（:168-285）            ← 无事务依赖，最安全
  staging.ts       stageImage/stageFile/discardStagedImage/readStagedMetadata
                   /readAllStagedMetadata（:699-751, :883-960）
  savePipeline.ts  saveQuickNoteInternal/promoteStagedSave/recoverStagedSaves
                   （:762-911）                            ← **必须整体搬，不能拆**
  trashLifecycle.ts delete/restore/purge/revoke/list（:964-1060 起）
  searchIndex.ts   rebuildSearchIndex/upsertSearchIndex/reindex*（:564-698）
  tagLinks.ts      list/set/applyRemote/merge（:402-460）
  missingBody.ts   listMissing/recoverFromText/applyRecoveredFromCloud/purgeMissing（:462-563）
  index.ts         QuickNotesStore 门面（保留对外方法名 → IPC 不改）
```

- **接口形状**：`QuickNotesStore` 继续是唯一对外类型（IPC/同步都只认它），子模块拿 `{ db, root, log }` 的窄 context（与 `electron/store.ts` 的 repository 注入同款）。
- **迁移顺序**：schema → searchIndex → tagLinks → missingBody → trashLifecycle → staging → savePipeline（最后，因为它跨事务与文件顺序）。每步单独提交、每步跑 `electron/quickNotes*.test.ts` + `quickPush*` 相关。
- **风险（必须写进 PR 描述）**：① better-sqlite3 的 `db.transaction` **不可跨模块嵌套**（同连接同事务嵌套 = savepoint，行为可接受但语义变化）⇒ savePipeline 的 `tx()` 与 staging 写入必须在同一模块内；② staging→DB→promote 的**顺序不变量**（V5 §5.3）一旦跨模块就靠注释守不住 ⇒ 方案是把「顺序」写进 `savePipeline.ts` 的导出函数签名（一个函数做完三步，不暴露中间态）；③ `recoverStagedSaves` 必须在 open 时跑到（现在在 `migrate` 内）——搬走时别丢调用点。

### S-4 `webApiServer.ts`（988）拆分

```
electron/webApi/
  security.ts   sameOrigins/isAllowedRequest/hasValidToken/timingSafeEqual/documentSetCookies（:261-345）
  static.ts     dist 静态服务 + mime + 缓存头
  events.ts     /__events SSE + retryEventStream（:426）
  bridge.ts     WEB_METHODS + registry 调用（与 IPC 同一批 handler）
  index.ts      createWebServer（只做装配）
```
护栏：`electron/webApiServer.test.ts`（②↔③ 全等）+ `ipcChannelParity.test.ts`（①↔③）。**注意 `WEB_METHODS` 必须仍从 `webApiServer.ts` 可导入**（`ipcChannelParity.test.ts:24` `import { WEB_METHODS } from "../webApiServer.js"`）⇒ 拆分后用 `export * from "./webApi/bridge.js"` 保持导入路径不变，否则要改测试（可接受但要一起改）。

### S-5 `main.ts`（1306）只抽两块（其余不动）

```
electron/boot/paths.ts     userData 覆盖/single-instance/userDataDir/workspaceRoot/vendorCdnDir（:99-118,:277-289）
electron/boot/ipcWiring.ts registerIpc 的依赖装配（:614-786），入参 = { store, quickNotes, controllers… } 显式对象
```
- 单例（`assetToken`/`webApiToken`/`trustedWebContents`/定时器）**不搬家**，以 `createBootState()` 一次创建、显式传递 —— 避免「两次 randomBytes」这类事故。
- 不做：窗口创建/菜单/崩溃处理（它们本来就是进程级）。

### S-6 `s3v3Engine.ts`（924）只抽发布路径

```
src/core/s3v3/engine/publish.ts   锁+读回+重试+pointer 写入（MAX_PUBLISH_RETRIES/PUBLISH_LOCK_*）
src/core/s3v3/engine/deepCleanup.ts  深清（keep 集/保留窗口/dryRun）
```
`S3v3SyncEngine` 保留为编排壳（谁调用它都只用这几个入口）。
- 风险：`DECL_CACHE`（:52-57）是**刻意跨引擎共享**的进程级 LRU，抽文件时不能顺手改成实例级（会回到「崩溃追赶 4,070 次 GET」）。
- 护栏：`electron/s3v3/syncEngine.test.ts`、`correctness.integration`、`deviceConformance`（10 场景）、`perf.integration`（注意 HANDOFF §2：并行跑会因宿主负载误报）。

### S-7 其余 P2

- A-1：`ipcChannelParity.test.ts` 增第四提取器（`src/lib/native.ts` 的 `api().X(`）。
- S-1（安全注释）：改 `settingsRepository.ts:65` 一行注释。
- A-2/C7/D-4：只在 `docs/RESILIENCE.md` 失败面表补登记（该文档要求「新增失败面必须回填」），不改代码。
- **测试支撑文件命名**：`electron/s3v3/deviceConformance.ts`(740)/`fileDeviceStore.ts`(133)/`portable/zipTestReader.ts`(63) 都是测试专用但不符合 `*.test.ts` 约定 ⇒ 任何「产品 LOC/死代码」统计都会把它们算进去（本报告的 24,054 行里就含这 936 行）。**建议只在 HANDOFF §2 记一句口径**，不改名（移动端也 import `deviceConformance`，改名要动两端路径，收益仅统计准确）。

---

## 4. 明确不做项（附理由）

1. **不改 S3 协议、删除/恢复语义、并发数值 12**（AGENTS §3 已定稿）——本报告只做「常量单源」，不动语义与数值。
2. **不把 `'' AS content_hash`（store.ts:565）改成读表**——桌面正文是文件，配套 `bodyChangeGuard` 才是判据；改了会让「外部改文件」被判成用户编辑并上传。
3. **不做 safeStorage 明文回退**——已 fail-closed，回退是安全倒退。
4. **不删 C2/C3/C4/C5 兼容分支**——删除判据不成立（见 §2.f）。
5. **不改「先 DB 后 promote」的小记保存顺序**——现状崩溃可自愈，顺序反过来才是真半失败。
6. **不删 core 的纯 JS `sha256Sync`**——移动端 WebView 需要，桌面靠注入 native 提吞吐（`sha256Native.ts`），这是**已收口**的设计（CORE-06）。
7. **不给 preload 做 codegen/常量表**——`preload.cjs` 是原生 CJS 不进构建，护栏已够（`ipcChannelParity.test.ts` 的 doc 已论证过，§3#17）。
8. **不合并 4 处 `sleep`**、不引入新依赖、不清理 vendor 内核。
9. **不做「主进程 IO 分帧」**——无实测证据（E-1 只记录）。
10. **不拆 `store.ts`**——它已是门面，继续拆只增加间接层。

---

## 5. 需用户裁决

**§5-1 `src/core/s3v3Gc.ts`：删，还是复活为单一来源？**（P1-1 的分叉）
- 选项 A（推荐）：**删文件 + 删 6 处调用点**（`s3v3Core.test.ts:192-225` 的 4 个用例、`s3v3Scale.test.ts:66`、`s3v3Capacity.test.ts:48`）。理由：产品 0 引者（两种方法交叉验证），生产 GC 规划已在 `s3v3/commit/executePending.ts`+`buildPublishIndex.ts`；删后「删除域护栏」集中在真路径。
- 选项 B：**让生产调用它**（把 `executePending` 的待删键规划改为 `planLakeDeletes`）。理由：纯函数单测最便宜。代价：v4 内核刚收口就要动删除路径 = 发版前引入回归面，且 `s3v3Gc` 的 `PlannedDelete` 形状与 v4 的 pending 模型不同，是**真实重构**不是接线。
- 我的判断：A。B 违反「不在发版前做没有护栏的大改」。

**§5-2 拆分是否在发版前做？**（S-3/S-4/S-5/S-6）
- `quickNotes.ts` / `webApiServer.ts` 拆分收益 = 可维护性，风险 = 同步/小记热路径回归。建议：**发版后再做，按 S-3 的顺序一模块一提交**；发版前最多做 S-4 的 `security.ts` 抽离（零行为改动，且有 `webApiServer.test.ts` 覆盖）。

**§5-3 并发常量放哪**：`src/core/s3v3/limits.ts`（新文件）vs 复用 `s3v3Pool.ts` 导出。我推荐前者（语义明确、不与池实现耦合），但这是纯口味级选择，若 reviewer 反对不阻塞。

**§5-4 是否给 `native.ts` 补第四面护栏**（A-1，~20 行测试）。零风险，建议做。

**§5-5 D-1 墓碑水线是否改成「只在 published 推进」**：不建议改（理由见 D-1），若用户认为云端孤儿成本更痛则需同时设计墓碑保留窗口 = 协议级议题。

---

## 附录 A · 跨域线索（只记录，不深挖）

1. **移动端同语义同名模块**：`src/mobile/v3/mobilePlatformPort.ts:144` `listNotesSyncMeta`、`src/mobile/data/noteRepository.ts:217,268` 每次写自己算 sha256（与桌面 `noteBodyHash` 同族）、`src/mobile/data/quickNotesRepository.ts:230` 同。→ 移动审计核对「两端 hash 口径是否真的逐字节一致」（有 `sha256Sync.test.ts` 等价性测试兜底，但移动端**没有**对应的 baseHash 守卫测试）。
2. `docs/ARCHITECTURE.md` 部分内容已过期（本次审计对象之一）：本报告只用代码事实，不引用该文结论。文档侧归文档审计。
3. `electron/s3v3/deviceConformance.ts`(740) / `fileDeviceStore.ts`(133) / `portable/zipTestReader.ts`(63) 是测试专用但文件名不含 `.test` ⇒ 全仓 LOC 统计、死代码扫描、"产品代码" 类门禁都会误算。→ 工具链审计。
4. `AGENTS.md` §4 里「store.ts 2108 / quickNotes.ts 1451 / main.ts 1306 / webApiServer 988 / s3v3Engine 924」与实测一致；但 §1 的「electron 275 files / 43K」在本机实测为 **164 非测试 .ts / 24,054 行（含 936 行测试支撑）+ 147 测试文件** ⇒ AGENTS/任务的概览数字可能是「含测试」或旧快照，建议文档审计统一口径。
5. `scripts/check-core-boundaries.mjs` 禁 `process.`，而 `src/core/s3v3/state/intentLogState.ts` 等只做纯数据变换（合规）；桌面侧所有 `process.env` 都在 `electron/**`（合规）。→ 无需动作，供复核引用。

## 附录 B · 本报告未覆盖清单

1. `electron/ai/**`（aiContentResolver/aiWritingRepository 等）与 `src/core/aiProviders.ts` 的**行为**细节（只核了分层与 IPC 面）。
2. `electron/update/updateService.ts`(506) 的下载/校验流程只核了入口安全性（`registerUpdate.ts`）。
3. 便携包 `electron/portable/zipStore.ts`+`portableExport.ts` 的 **zip 条目名校验**（是否防 `../` 逃逸）未逐行读；建议下轮单独看（属「路径穿越」剩余面）。
4. `webApiServer.ts` 988 行的 SSE/静态服务细节（只核了安全判定与通道映射）。
5. 真实 S3 往返、设备端、2 万文档压测：未跑（按铁律不进设备/不跑全量）。
6. better-sqlite3 主进程阻塞（E-1）无实测采样。
7. `electron/s3Maintenance.ts`/`s3Store.ts` 的老路径（v3 转正后是否仍被引用）未逐一核对 —— 只确认了「legacy 回滚入口已移除」（`syncEngineController.ts:77`）。

## 附录 C · 复现命令

```bash
cd "$(git rev-parse --show-toplevel)"

# 1) 分层纯净
rg -c 'from "node:' src/core -g '!*.test.ts'                       # 期望 0
rg -n 'from ".*electron/' src/core -g '!*.test.ts'                 # 期望空
rg -n 'from "../../src/(features|app|mobile|components|styles)/' electron -g '!*.test.ts'  # 期望空

# 2) IPC 三方规模
rg -o '.(handle|handleEvent)(s*"[a-z0-9_]+"' electron/ipc -g '!*.test.ts' | wc -l   # 187
rg -o 'invoke("[a-z0-9_]+"' electron/preload.cjs | wc -l                              # 187

# 3) 并发常量双源（P1-2）
rg -n 'const DEFAULT_TRANSFER_CONCURRENCY' src/core

# 4) 死模块（P1-1）：产品引者应为 0
rg -n 'planLakeDeletes|planQuickNotesDeletes' electron src | grep -v 's3v3Gc.ts'

# 5) 命令注入面（期望只命中 openPath/openExternal）
rg -n 'execSync|execFile|spawn(' electron -g '!*.test.*'

# 6) 安全注释漂移（S-1）
rg -n '不可用时退回明文' electron/settingsRepository.ts
```
