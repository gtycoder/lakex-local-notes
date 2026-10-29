# 00 · 执行摘要：全仓审计（S3 v3 之后）与重构路线

> **261029 收口第二批后状态**：84 条 = 已修 64 / 部分 8 / 未做 8 / 延期 4（含已裁决不做/合并）；逐条证据与最新门禁见 `13-audit-status.md`（本文其余为审计当时快照）。
> **执行状态（261028 更新）**：审计基线已从 `41def9f0` 前进到 `ea576a80`（另一会话已提交 4 个 commit）；**A 止血批已实施、B（v4 RFC）已交付**，详见 `08-ab-execution.md` 与 `07-rfc-convergence-kernel-v4.md`。
> **261028 用户裁决落地（已实施，未提交）**：浏览器端保留（分屏交给浏览器，不做深链/多窗口；P0 安全收口已完成）、移动置灰项保留待议、表格 `ff` 收敛 core 常量、ink undo 走 patch 方案、全量重拉改为「回收站 + 云端已删除·仅本地」（复用远端 purge 语义）。门禁：tsc 0 / vitest **473 文件 2999 例（25.8s）** / ui-metrics / check:core 115 文件 0 / check:mobileui / 两次构建 / bundle 预算 / perf 门禁 全绿。浏览器端编辑完整性（插图/附件 + AI 流式）已补齐；第四轮修完 C 的 B1/B2/B3/B4、SD-07/10、DT-03/14；第五轮修完 MOB-08/09/12/15、DT-05/08、SD-02；第六轮修完 MOB-02/11、DT-12/13、浏览器 P1、CORE-02；第七轮修完 SD-09/11/13、CORE-03/09、DT-04/11/16、MOB-03/07；第八轮修完 DT-06/07、SD-08/12、CORE-05/06/08/10、MOB-13/14/17，并恢复 vitest 到 24s；第九轮收尾移动 sheet/设置页/log/board+ink 只读判据；第十轮补 SD-06 契约与 10 场景 conformance、MOB-04 长文档探针（未切换虚拟渲染）；第十一轮清理 manifest 时代死代码（净减约 1760 行）、移动画板接只读判据、浏览器 P2 评估为不做。安全项暂停（CSP 通配为既有决定）。门禁实测：tsc 0 / vitest **448 文件 2824 passed（11 skipped）** / ui-metrics 通过 / check:core 0 / check:mobileui 通过 / git diff --check 干净。

> 审计日期：2026-10-27（Asia/Shanghai）。**只读会话**：唯一写入 = `docs/audit-261027/` 下的 7 份文档；未改任何代码/配置/依赖，未跑构建、Electron、gradle、npm install，未触碰正式数据目录。
> 基线：`master @ 41def9f0` + 工作树在途改动（21:29 采样 49 项 → 21:33 54 项，另一个会话仍在改；`dist-mobile` 21:31 被并行重建）。证据一律「文件 + 符号 + 读取时间」，行号仅作定位。
> 子文档五份：**产品/架构**（`01`）、**安全**（`02`）、**桌面**（`03`）、**移动**（`04`）、**同步/数据**（`05`）；第一性原理重设计见 `06`。

---

## 0. 一页纸

**一句话**：v3 把「协议」做对了，把「编排」做肿了；壳层在来源/路径/SSRF 上已是可引用的正面样本，风险集中在三处——**渲染层能动主进程的凭据与出网目标**、**「云端胜出」路径会静默删除本地数据**、**UI/状态机缺行为护栏导致重构被锁死**。

**数字快照**

| 项 | 值 |
|---|---|
| 生产代码 | TS/TSX/CSS 约 **13.9 万行**（桌面 8.6 万 / 移动 4.2 万 / core 2.4 万 / electron 2.5 万，含重叠计数） |
| 测试 | **491 文件 / 3110 passed / 12 skipped**；`tsc` 0 错误（**261028 晚基线**；来源 Lead 最终门禁口径。注：`HANDOFF` §0 同段记 11 skipped，若 Lead 复跑数字不同以 Lead 为准） |
| 全量 vitest | **≈24s**（第八轮把 `perf.integration` 默认降到 500/2000 后，08 §16-2；审计当时的 78.7s 已不成立） |
| 同步内核 | 生产 34 文件 / 6127 行 + 测试 58 文件 / 5694 行；`s3v3Engine.ts` 1895 行 / 55 方法 |
| IPC 面 | **135 通道**（`ipcChannelParity.test.ts` 三家断言一致）；preload 143 键（135 invoke + 5 事件 + 3 常量）；浏览器端 shim 同样覆盖 135 |
| 桌面包体 | 入口 chunk **1.90MB gzip**（预算 2.9MB，66%）；25 条 modulepreload |
| 移动首屏 | 入口 69KB gz JS + **138KB gz CSS** + **20 条 preload**（AGENTS 目标 12） |
| 审计发现 | **P0 × 1、P1 × 21、P2 × 38**（合计 **60** 条 = 只统计 `02`–`05`，见 §1）；**另有 `09`/`10` 的 CORE 24 条** ⇒ 全仓编号 finding **84**（逐条状态见 `13-audit-status.md`） |

**三个必须立刻止血的点**
1. **P0 数据丢失**：全量重拉（`baseline.json.gz` 丢失/损坏即可触发）会永久删除本地独有文档，连刚写的历史快照一起删（`05` SD-01）。
2. **P1 凭据外泄**：`ai_test_connection`/`ai_save_settings` 可用**已存 Key** 请求渲染层指定的任意 `baseUrl`；`save_s3_settings` 可把同步目标改向攻击者桶（`02` SEC-01/02）。
3. **P1 分发产物**：CI 只出 **debuggable** debug APK 且 Android job `continue-on-error`（`02` SEC-03）。

---

## 1. 分级总表（按主题归并，去重）

| 主题 | P0 | P1 | P2 | 归属 |
|---|---|---|---|---|
| T1 数据安全与删除/恢复语义 | SD-01 | MOB-06（purge 不清资产）、SD-03（恢复入口断头）、SD-04（待同步计数挂起）、SD-05（成功报失败） | MOB-16、SD-09、SD-13、MOB-09 | 01/04/05 |
| T2 凭据与出网目标 | — | SEC-01、SEC-02 | SEC-04、SEC-05、SEC-07 | 02 |
| T3 分发与平台配置 | — | SEC-03 | SEC-06、SEC-08、SEC-09、SEC-11、SEC-12 | 02/04 |
| T4 交互与状态机 | — | MOB-01（返回键）、MOB-02（10 浮层 state）、MOB-03（分页器定时器）、MOB-07（双份 useEditSurface）、DT-02（11 处原生 confirm）、DT-03（9 处估算定位）、DT-05（小记全量 IPC） | MOB-11、MOB-12、MOB-17、DT-06、DT-09、DT-12、DT-13、DT-14、DT-15 | 03/04 |
| T5 崩溃隔离 | — | DT-01（doc 无错误边界）、MOB-08（看门狗 × recreate 无上限，在途） | — | 03/04 |
| T6 性能与内存 | — | SD-02（首拉内存线性）、MOB-04（为 DOM 查找关虚拟渲染）、MOB-15（无首屏预算） | DT-07（巨石函数/组件）、SD-07、DT-04 之外的 bundle 项 | 03/04/05 |
| T7 重复实现与架构 | — | SD-06（双端 15 条语义两写） | DT-06（5 套宿主契约）、SD-10 | 03/05 |
| T8 测试护栏与门禁 | — | DT-04（0 个 .test.tsx；334 例源码字符串断言） | SD-08、SD-12（零断言 benchmark / 坏基准 / 固化失败） | 03/05 |
| T9 死代码/半成品/删除面 | — | — | MOB-10（表格 32 项/10 置灰 + 4 死分支）、DT-10、D-1（浏览器端）、MOB-11 | 01/03/04 |
| T10 文档与口径 | — | — | SD-11（协议文档仍是 V2）、MOB-13（HANDOFF 计数过期）、01 P-06 | 01/04/05 |

> **计数口径（261028 晚明确，避免引用错数）**：P0/P1/P2 合计 1+21+38=**60 条，只统计 `02`–`05` 的编号条目**（`02` 10 条 P2 / `03` 11 条 P2 / `04` 10 条 P2 / `05` 7 条 P2）。**另有 `09` / `10` 的 CORE 24 条**（`09` CORE-01..10 + `10` CORE-01..14）**不在 60 之内** ⇒ **全仓编号 finding 总数 = 84**（SEC 13 / DT 16 / MOB 18 / SD 13 / CORE 24）。逐条状态与证据见 `13-audit-status.md`。`01` 的 P-*/A-* 是跨层归纳与架构判断，与上述条目**有意重叠**，不重复计数；`01` 另含 1 条 P0 引用（即 SD-01）。

**各层一句话**
- **安全（02）**：来源判定、路径下沉、SSRF、CSP 都是好样本；缺口在「渲染层→凭据/出网目标」「分发产物」「平台默认值」。
- **桌面（03）**：无 P0；最贵的是「五种宿主里唯一挂内核的 doc 没有错误边界」与「桌面 UI 零执行测试」。
- **移动（04）**：无 P0；最贵的是「返回键 = 退出工作区/退出 App」与「浮层状态机靠 10 个 useState 手写互斥」。
- **同步（05）**：有 P0；核心是「补丁账本 + 双端两写」在 v3 冲刺里固化，且协议文档已与实际相反。

---

## 2. Top 10 优先动作（按风险 × 杠杆排序）

| # | 动作 | 对应 | 成本 | 门禁 |
|---|---|---|---|---|
| 1 | **止住不可恢复删除**：`saveState` 只应用不物理删；全量重拉路径禁止 `purgeTrashItem`；`archived` 落成备份区 | SD-01 | S | 新增 `pullAllSafety.test.ts`（删 baseline → 同步 → 本地独有文档仍在、历史不减） |
| 2 | **收凭据与出网目标**：草稿 baseUrl 必须自带 Key / 白名单；`assertS3Settings` 保存前 `validateS3Settings` + 端点变更告警 | SEC-01/02 | S | 新增 2 个负向单测；手点设置页 |
| 3 | **Android 产物去 debuggable**：`assembleRelease` + debug keystore 签（或 CI secrets）；Android job 不再 `continue-on-error` | SEC-03 | S | 已本机验证：release APK 非 debuggable（aapt/xmltree）+ apksigner + 模拟器装机启动（`run-as` 拒绝）；**CI 首跑待做** |
| 4 | **删除第一批死面**：浏览器端（或只读化）、3 个零引用模块、ink 永久置灰导出、移动置灰 10 项 + 4 死分支、Cordova `config.xml` | D-1、DT-10、MOB-10、SEC D-2 | S | tsc + 全库 vitest + 移动 6 态（若动 UI） |
| 5 | **移动彻底删除清资产**：`purgeTreeItem` 后删 `note-assets/` 与 `quick-notes/assets/` | MOB-06 | S | `bridgePurge.test.ts` 扩 1 例 + 设备 `run-as ls` |
| 6 | **移动返回栈止血**：工作区浮层 + 首页标签面板 + 设置子页各注册 `pushBackHandler` | MOB-01 | S | 新增 jsdom/mock backButton 用例；设备 KEYCODE_BACK |
| 7 | **doc 错误边界**：`MultiTabEditor` 默认分支套 `EditorErrorBoundary` | DT-01 | S | 组件崩溃用例或 CDP 注入 |
| 8 | **4 个不可逆动作换自有 Dialog**：回收站 x3 + 云端恢复 | DT-02 | S | 定点快照 2 态 |
| 9 | **同步语义三修**：`hasSyncBase` 改 v3 事实；`published_at` 补齐或改计数口径；`executePending` 失败降级为 warning | SD-03/04/05 | S/M | 定向 vitest + 手工换桶演练 |
| 10 | **补行为护栏**（重构前置）：桌面 UI 试点 1 个域（`useTabLifecycle` + capture 注册）；conformance 扩到 10 场景；perf 改比值断言 | DT-04、SD-12、SD-06 | M | 新用例必须能「修前红、修后绿」 |

> 前 9 项都是 S 级（合计约 3–5 人日），可并成 1 个「止血批」先合。第 10 项是后续所有架构重写的**前置条件**（AGENTS §2：没有测试护栏不做大重写）。

---

## 3. 删除 / 合并清单（跨文档合并，按可删安全性排序）

| # | 对象 | 证据 | 收益 | 前置/风险 |
|---|---|---|---|---|
| Del-1 | 浏览器端整套（`webApiServer.ts` 26KB + shim + `registerWeb` + 设置项 + CORS 特例 + 6 IPC + 312 行测试） | 01 P-04 / 02 SEC-07；opt-in、覆盖 135 个写方法 | 少一个前端、一套方法镜像、一个本机 HTTP 面 | 产品确认无人使用；否则只读化 |
| Del-2 | 3 个零引用模块：`core/editorHost.ts`、`desktop/treeRepositoryAdapter.ts`(+test)、`lib/imageConverter.worker.ts` | 03 DT-10（grep 仅自引用） | 少 3 个「看起来是架构意图」的诱饵 | 无 |
| Del-3 | 移动表格 10 个置灰占位 + 4 处不可达 toast + 画图 5 项置灰 + dock disabled 项 | 04 MOB-10（32 项/10 置灰；HANDOFF 记 29/7 已过期） | 入口更短、负反馈消失 | 用户裁决①；动 UI 要过 6 态 |
| Del-4 | `android/.../res/xml/config.xml`（Cordova 残留 `<access origin="*">`） | 02 D-2 | 去掉误导性死配置 | 无 |
| Del-5 | manifest 时代死代码：`syncAdapters.ts`(245)、`core/syncAssets.ts`(183)、`gcDecisions.ts`、`syncDecisions.ts` 7 个 legacy 函数、`s3_gc_pending` 链路 | 05 §3 #1–#5 | 少 ~600 行 + 死 IPC/UI 区块 | 先确认 grep 无生产引用（审计已做） |
| Del-6 | 三张死账本：sync_base / declared_assets / deleted_notes.published_at + markTombstonesPublished | 05 SD-03/04 | 数据模型与判据一致 | **261029：三张死账本全部收口**——sync_base + declared_assets 已彻底删除（桌面+移动 schema/读写/测试；可云恢复判据改 remoteNoteIds v3 事实；诊断改读 v3 baseline）；**published_at 改单一 waterline**（device_state 两键，pending = deleted_at > 水线；成功后写水线）并删列（桌面 DROP COLUMN + 移动 schema v10）；学习型墓碑不受影响 |
| Del-7 | ink 导出两个永久 disabled 行 + `ui-metrics` 失效 allowlist 项 + 3 处过期注释 | 03 DT-10 | 用户可见半成品清零 | 无 |
| Del-8 | `DeviceState.archived` | 05 SD-01 | 要么实现备份区、要么删 | 与动作 #1 绑定 |
| Del-9 | 过程文档（Manifest V2 的 `SYNC-PROTOCOL`、`S3-V3-*`、`S3-GC-DESIGN` 等） | 05 SD-11 | 新会话不再按旧文档改错层 | **已完成（261029）**：18 份过程文档物理删除，23 处引用改指 SYNC-PROTOCOL / 注明 git 可查 |

---

## 4. 统一重构路线（合并四份路线，按依赖排序）

| 阶段 | 内容 | 依赖 | 规模 |
|---|---|---|---|
| **P0 止血**（3–5d） | 动作 #1–#9 合并为一轮；文档口径纠偏（HANDOFF/README/ARCHITECTURE） | 无 | S |
| **P1 护栏**（1–2w） | 动作 #10；新增安全度量脚本（IPC 来源矩阵 / CSP 契约 / Android 清单断言 / 补丁完整性）；移动设备门禁补 usheet/bitable/board/AI 屏 | P0 | M |
| **P2 交互收敛**（2–4w） | 移动浮层原语 + 返回栈（MOB-02/11/12）、表格复用 useEditSurface（MOB-07）、桌面 popover/rename/confirm 原语（DT-03/12/13）、顶栏 4→1（DT-09） | P1（否则无护栏） | M |
| **P3 架构收敛**（4–8w） | 宿主契约单类型 + 注册表（DT-06）、同步语义下沉（SD-06）、内存流式化（SD-02）、小记列表 summary 投影（DT-05） | P1/P2 | L |
| **P4 同步内核 v4**（8–12w） | `06` 的 Plan/Apply/Commit/Finalize + 单一意图日志 + 单实现 DeviceStore；**协议不变**，可 dry-run 对拍、可回滚。**落地设计/E3-1+E2-4+Del-6 分阶段见 `docs/SYNC-STATE-CONVERGENCE.md`（261029）** | P3 | L |
| **P5 性能与文档** | 增量索引（**需 5 万文档实测证据**，勿提前）、perf 门禁、新 `SYNC-PROTOCOL.md`、删过程文档 | P4 | M |

**明确不做**（避免返工）：重写协议/改 wire format；为锁加 CAS（provider 不支持，已定分支）；提前做 v3.1 按篇增量索引；全仓引 jsdom/引入新 UI 库（AGENTS §3#22 四问）；清理 vendor/依赖死路径（§3#18）；动闭源内核（§2）。

---

## 5. 第一性原理重设计（详见 `06-redesign.md`）

**对象**：双端共用的同步/数据编排内核。**不动协议**，只重写编排层。

- **三条公理**：本地是真相；云端 = 不可变对象 + 唯一可变 pointer；**用户意图是唯一必须跨轮记住的东西**。
- **四相**：`plan(L,R,B,I)` 纯函数（无 IO、可序列化、可 dry-run）→ `apply` 幂等执行（原子写、事务、有界并发）→ `commit`（索引→锁→读回→pointer，幂等）→ `finalize`（基线原子落盘 + 意图 GC）。
- **净效果**：`DeviceState` 9 本账 → 1 本意图日志；`pendingAssets/deferAssets/staging/markerPersist/raceRetries` 全部变成 plan 策略或 apply 原语；双端 481+809 行适配器 + 496 行 conformance → 1 份实现 + 每端 ~80 行驱动；进度由 plan 给出确定性总量（两端同一描述器）。
- **新增不变量 I0**：**云端胜出不得删除本地**——收敛只能归档，删除只由用户显式动作触发（直接修掉 SD-01 的根因）。
- **迁移**：M-1 先止血（SD-01）→ M0 新 plan 与旧引擎 dry-run 对拍（差异 0）→ M1 切执行器 → M2 账本收敛（双写过渡）→ M3 单实现 → M4 性能。协议不变是可回滚的前提。

---

## 6. 数字对账与口径说明（重要，避免引用错数）

| 项 | 本摘要采用 | 说明 |
|---|---|---|
| IPC 通道 | **135** | `electron/ipc/ipcChannelParity.test.ts:90-92` 同时断言 registrar / preload invoke / `WEB_METHODS` = 135。`02` 文中的 138/132/124 是不同统计口径（含 handleEvent 与手写 shim 行数），**以 135 为准**。 |
| preload | 143 顶层键 = 135 invoke + 5 `on*` + `rendererReady/assetPort/assetToken` | 浏览器端 shim 覆盖 135 个 invoke 方法（**不是只读子集**） |
| 测试 | **491 文件 / 3110 passed / 12 skipped**（261028 晚基线；审计当时为 453/2792/11） | `03` 的「2141 例」是静态 `it(` 计数，二者不矛盾；数字每次改动都会变，引用请带日期 |
| 全量 vitest | **≈24s**（261028 晚基线；审计当时 78.7s 含 `perf.integration` 68s，第八轮已把 perf 默认降到 500/2000 并移 5000/20000 到手动脚本） | `05` 的 59.19s 是同步层专项；README/AGENTS 的「≈20s」口径已被本轮取代 |
| 空跑/首传 | 2k/5k 空跑 199/215ms；改 10 篇 259–405ms；首传 500 篇 502ms | 与 261026/261027 文档数字（181ms 等）不可复跑，方差最大 3.2× ⇒ **性能数字必须带基线与方差** |
| 移动首屏 | 69KB gz JS + 138KB gz CSS + 20 preload | 来自并行会话 21:31 构建的 `dist-mobile`，非 HEAD 构建，量级参考 |

---

## 7. 方法与局限（写给下一个审计者）

- **只读**：所有结论来自 read/grep/glob + 只读脚本（`ui-metrics`、`audit-*`、`check-bundle-budget`）+ vitest（写 `$TMPDIR`）。没有起 Electron/模拟器，**运行态行为（键盘/权限/导航）标为「未取证」**，不拿推测当证据。
- **在途改动**：审计期间仓库被并行会话持续修改（49 → 54 项，`dist-mobile` 重建）。因此证据以「文件 + 符号」为准；若行号对不上，先 `git log -1 -- <file>` 看是否被改。
- **已核验的正面样本**（不要在重构中削掉）：IPC 来源双判、路径校验下沉到路径构造、SSRF 连接层钉死、prod CSP 严格（inline hash 实测一致）、云端不可信 filename 三层校验、内容寻址幂等、删除=缺席、恢复 local-wins、资产声明全量差集、`planLakeMerge/planQuickNotesMerge` 纯函数化、`s3v3Gate` 的「宁可不删不可误删」。
- **数量口径**：本摘要的 P0/P1/P2 是「问题条目」计数（去重前 60 条）；子文档里还有删除项、度量指标与复测命令，未计入。

---

## 8. 文档索引

| 文档 | 内容 | 条数 |
|---|---|---|
| `01-product-architecture.md` | 产品能力矩阵、跨层架构、删除候选、分层路线 | 10 结论 + P×6 + A×8 |
| `02-security.md` | 威胁模型、信任边界、机密、协议、供应链、安全度量 | SEC-01..13 |
| `03-desktop.md` | 桌面组件/状态/设计系统/性能/测试/死代码 | DT-01..16 |
| `04-mobile.md` | 移动状态机/导航/IME/性能/原生/功能缺口 | MOB-01..18 |
| `05-sync-data.md` | v3 协议/状态机/账本/不变量/内存/测试债 + 重写素材 | SD-01..13 |
| `06-redesign.md` | **第一性原理重设计：收敛式同步内核 v4**（含迁移与验收） | — |
| `07-rfc-convergence-kernel-v4.md` | **B**：v4 RFC（SyncPlan/IntentLog 契约、端口、迁移、PR 拆分、待决问题） | — |
| `08-ab-execution.md` | **A**：止血批实施记录（改动、偏离、验收方式、门禁） | — |
| `09-core-data-models.md` | **C**：core 数据模型审计（bitable/usheet/ink/board/lake 序列化） | CORE-01..10 |
| `10-core-services.md` | **C**：core 服务与横切审计（搜索/小记/AI/规则/错误/单一来源） | CORE-01..14 |
| `11-browser-end-plan.md` | 浏览器端保留方案（P0 安全收口 / P1 能力+下载 / P2 评估为不做） | — |
| `12-v4-test-report.md` | v4 真机/真桶/多端验收报告 + P1 修复（锁争用/错误分类/移动从云端恢复） | — |
| `13-audit-status.md` | **审计项状态对账表**（84 条逐条状态 + 证据；SD-06 8 条漂移结论；文档不一致修正清单） | 84 |