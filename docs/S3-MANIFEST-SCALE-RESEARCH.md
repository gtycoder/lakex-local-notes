# S3 清单规模调研（261025，历史）

> **261026 状态：本调研基于旧单文件 manifest；v3 已改为 pointer + 不可变索引**（零变更轮只读 pointer，不再每轮拉整份清单）。文中行号/文件（`src/core/syncEngine.ts` 等）已删除，仅作历史与「为什么放弃单清单」的证据保留。
> **状态**：只读调研，**未改同步协议、未改代码**。本文是「清单瘦身 / 分片 / 墓碑退役」的调研输入，不是实施方案。
> **配套**：[`S3-GC-DESIGN.md`](./S3-GC-DESIGN.md) §7（墓碑保留策略与 SiYuan/dejavu 对照）· [`SYNC-PROTOCOL.md`](./SYNC-PROTOCOL.md)（协议边界）· `AGENTS.md` §1（量级目标）/ §3#11（资产差集红线）。
> **口径**：字节数由 node 按真实写出形状实测（UTF-8、gzip level 9），非估算；代码行号对应当前 master。

## 0. 摘要（先读这 8 条）

1. **清单体积在目标量级下必然破 20MB**：10 万文档 × 10 附件（共 100 万附件）= **170MB 明文 / 71MB gzip**；上限按**解压后**判定，gzip 对 20MB 上限零帮助。断点：无附件约 **5.76 万篇**、10 附件/篇约 **1.24 万篇**。
2. **每轮同步都要拉整份 latest**（包括零变更轮）：目标量级下 **71MB/轮**；变更轮再双写 commit+latest ⇒ ≈ **213MB/轮**。这比「清单塞不塞得下」更早成为日常成本。
3. **墓碑不是主因但会独立累积**：5k 墓碑 ≈ 2.1MB（1.2%），但 10 万墓碑 ≈ 42MB，单这一点就超上限；墓碑永久是「无锁 + 无基线」的补偿。
4. **条目瘦身有天花板**：assets 数组化 + 去 size ⇒ -48%（88MB）；再加元数据外置 ⇒ -69%（53MB），**仍超 20MB 2.6 倍**。纯字段瘦身到不了目标。
5. **分片是唯一能进 20MB 的方案**（1000 文档 + 1 万附件/片 ⇒ 每片 1.69MB 明文 / 0.70MB gzip，变更轮只写变更片）。但发布/GC/父级解析三处当前都依赖「整份读全」，分片必须自带「清单的清单」。
6. **三项零风险结构项可先做**（不动条目 schema）：① commit+latest **双写改 commit + 指针**（上传 -50%）；② 提交链 **5 份 → 2 份**（云存储 -60%，355→142MB）；③ 零变更轮先读 **ref 指针**再决定是否拉清单（71MB→~0）。
7. **asset hash 可零迁移先改**（不在对象 key 里：20hex ≈ -33% 明文）；**contentHash 不要先动**（与对象 key 强绑定，改表示 = 协议迁移）。
8. **墓碑退役不是基线问题**：最小充分条件 = 发布串行化（条件写或锁对象）+ 云端世代 epoch + 缺席语义翻面 + 主动删条目；设备水位是可选加固，提交谱系不可行（链只保 3 份）。与分片解耦，可独立排期。

## 1. 背景：三个别混在一起的问题

| 问题 | 表现 | 根因 |
|---|---|---|
| A. 清单**装不下** | 20MB 解压上限 → 所有端 `parseLakeManifest` 拒绝 → 同步整体中断 | 单文件清单内联「全量元数据 + 全量资产声明」，体积随库规模线性增长 |
| B. 清单**每次都要全量传** | 零变更轮也拉 71MB；变更轮 213MB | 清单即全量状态；无分片/无增量；无「指针」层 |
| C. **墓碑永久** | 墓碑条目 + 删除前 payload 永不出队 | 无锁、无基线 ⇒ 「远端缺席」有歧义 ⇒ 只能永久保留防复活 |

三者解法不同：A/B 靠**结构（分片 + 指针）**；C 靠**并发协议（锁/epoch）+ 缺席语义**。本文分开给结论。

## 2. 事实基线（当前实现）

### 2.1 对象布局与上限

- 正文 `objects/{noteId}-{contentHash}.lake`；资产 `assets/{noteId}/{filename}`；清单 `manifests/latest.json` + `manifests/{commitId}.json`；小记独立前缀。
- 上限：`MAX_MANIFEST_BYTES = 20MB`、`MAX_MANIFEST_NOTES = 200k`、`MAX_MANIFEST_FOLDERS = 50k`（`src/core/syncUtils.ts:30-32`）；小记清单 10MB（`docs/SYNC-PROTOCOL.md` §6）。
- **判定发生在 JSON.parse 之前、gunzip 之后**（`src/core/syncUtils.ts:102-105`、`electron/s3Store.ts:87-90`）⇒ gzip 只省带宽与存储，**不改变上限**。
- `MAX_MANIFEST_NOTES=200k` 当前是**名义值**：200k 条 × ~364B ≈ 73MB，体积上限会先拒绝。

### 2.2 写入/读取路径

- 每轮同步**无条件 GET latest 并解析**（`src/core/syncEngine.ts:114-121`）——零变更早退也发生在解析之后。
- 变更轮：整份重建 + 排序（`syncEngine.ts:790-816`），gzip 写 commit 与 latest **两份**（`:846-849`）。
- 云端提交链：`MANIFEST_CHAIN_KEEP=3`（`electron/s3Maintenance.ts:20`），目标 5 份（latest+commit+链 3），滞后水位下瞬时最多 11 份。
- GC keep 集 = latest + 链 3 份 + 本地历史引用（`s3Maintenance.ts:40-68`）；`onPublished` 按 prev/next 全量差集登记待回收（`electron/syncEngineController.ts:63-84`）。

### 2.3 体积实测

| 条目 | 字节 |
|---|---|
| active 无附件 | **364** |
| active 10 附件 | **1,685**（附件 1,310B = 78%） |
| active 1 万附件 | **1.32 MB** |
| 墓碑（deleted+deletedAt） | **418** |
| 回收站条目（10 附件，assets 全量） | **1,751** |
| 单个 asset 声明 | **131** = hash 79 + filename 45 + size 19 |
| asset hash → base64(32B) / 20hex / 16hex | 110 / 87 / 83 |

**全库（10 万文档 × 10 附件 + 5k 墓碑 + 500 目录）**：明文 **170MB** / gzip **71MB**；100 万文档 = 1.7GB / 710MB。

**断点**（按 20MB 解压后）：无附件 ≈ **5.76 万篇**；10 附件/篇 ≈ **1.24 万篇**；100 万附件下每附件预算只剩 **21B**（现状 131B）。

**每轮成本**：零变更轮 **71MB 下载**；变更轮 **≈213MB**（71 下载 + 2×71 上传）；云链稳定 5 份 ≈ **355MB**（瞬时 11 份 ≈ 781MB）。

## 3. 字段去留矩阵

**判据**：无基线的对端与新设备也必须能决策（冲突、下载、删除、GC、树、锁、kind）。

### 3.1 Lake 笔记条目

| 字段 | 当前作用（消费方） | 结论 | 移出后的兜底/代价 |
|---|---|---|---|
| `id`、`contentHash` | 对象键（`syncUtils.ts:118`）、冲突对账（`lakeReconcile.ts:41`）、skip-fast（`decideUpload.ts:20`）、云恢复（`syncEngineController.ts:219`） | **必留** | 无替代：对象 key 与冲突判定都靠它 |
| `updatedAt` | 元数据 LWW（`syncDecisions.ts:76/83`）、恢复 LWW（`syncEngine.ts:454`） | **必留** | 无替代 |
| `parentId`/`sortOrder`/`title`/`kind` | 树与环检测（`syncEngine.ts:349,502`）、正文路径与编辑器分派（`core/noteBodyPaths.ts:31`） | **必留** | 无替代（元数据不在正文里） |
| `isEditLocked`/`editLockedAt`（线上 `isLocked`/`lockedAt`） | 字段级 LWW（`syncDecisions.ts:10`）、只读态（`desktopDerivedState.ts:95`） | **必留** | 无替代 |
| `deleted`/`deletedAt` | `decidePurge`（`syncDecisions.ts:50`）、墓碑让位（:83）、`rememberDeleted`（:244） | **必留**（退役后仍需删除时间做 LWW 锚，见 §7） | 退役后由 epoch/缺席语义承担，但删除时间仍要留 |
| `assets` | 上传/下载差集（`syncAssets.ts:45,148`）、全量声明（:136）、GC keep（`syncUtils.ts:129`） | **必留**（红线 AGENTS §3#11） | 移出则 GC 失去「云端在用集」单点权威；必须同时设计聚合资产索引对象 |
| `isConflict` | Lake 侧无产生方，仅透传 + `noteInfo` 文案 | **可移** | 无正确性影响 |
| `icon` | LWW（`syncReconciliation.ts:176`） | **可移**（移基线） | 新设备丢图标，可接受 |
| `trashedAt` | 回收站自动过期基准（`trashPolicy.ts:22`）、软删 LWW（`syncEngine.ts:388`） | **可移** | 可退化为 `updatedAt`，精度下降 |
| `deletedFromParentId` | 恢复落点（`trashRepository.ts:130`） | **可移**（移基线） | 新设备恢复落点退化（护栏 `electron/sync.test.ts:1191`） |

`folders[]` 七个字段 + 墓碑：**全留**（树/环检测/目录墓碑让位都依赖；见 `noteMetadataRepository.ts:194`、`decideFolderPurge`）。

### 3.2 小记条目

- **必留**：`id/createdAt/updatedAt/contentHash/isConflict/deleted/deletedAt`、asset 的 `filename/size/hash`（校验 :234）、`tagIds/tagsUpdatedAt`（关系 LWW :357）。
- **可移**：asset 的 `mimeType/width/height/id`（到达后重算）；标签目录 `tags[]` 可独立为目录对象。

**结论**：字段级最优「可移」只有 4 项 + 小记附带项，≈ 每条约 -60B，**对 170MB 无实质影响**。真正肥的是 assets（典型文档 78%）与 contentHash（81B/条）。

## 4. 分片的最大障碍：六处「必须整份读全」

1. 20MB 上限在 parse 前按解压后整块判定（`syncUtils.ts:103`）；
2. `validateManifest` 全量校验（:234）；
3. `validParents` 需要**全部** folders + 全部 active id（`syncEngine.ts:222`）；
4. 发布 = 整份重建 + 全序（`syncEngine.ts:790-816`）——**最大障碍**；
5. GC 差集 `onPublished` 要 prev/next 全量（`syncEngineController.ts:63`）、keep 集沿链（`s3Maintenance.ts:40`）；
6. 云恢复按整清单 `find`（`syncEngineController.ts:219`）。

只有预取窗口（`syncEngine.ts:44`）是流式的。⇒ **分片必须配一份「清单的清单」（根索引）**，承载 commit/prev/folders/墓碑归属/片清单；否则发布与 GC 两处失去全量视图。

## 5. 方案对比（10 万文档 / 100 万附件目标）

| 方案 | 清单明文 | gzip | 变更轮传输 | 云存储（5 份） | 结论 |
|---|---|---|---|---|---|
| 基线 | 170MB | 71MB | 213MB | 355MB | — |
| a1 hash→base64 | 139MB（-18%） | 72.6MB（**+2%，传输更差**） | 218MB | 363MB | 不建议（hex 压缩率更好） |
| a2 hash→20hex | 114MB（-33%） | 43.6MB（-39%） | 131MB | 218MB | asset 可零迁移；contentHash 需迁移 |
| a3 hash→16hex | 109MB（-36%） | 41MB（-42%） | 123MB | 205MB | 碰撞余量 2^64，建议 20hex 更稳 |
| b assets 数组化+去 size | 88MB（-48%） | 42.5MB（-40%） | 128MB | 213MB | 失去下载前廉价比对，只剩全文 sha256 |
| c 元数据外置（a2+b） | 53MB（-69%） | 22MB（-69%） | 66MB | 109MB | **仍超 20MB**；每轮仍需全量元数据对账；assets 声明无处放 |
| d **分片**（1000 文档+1 万附件/片） | **每片 1.69MB** | **0.70MB** | **≈1.5–2.2MB** | 只存变更片 | **唯一进 20MB**；首装仍全量 |
| e 链 5→2 + latest 指针 | 不变 | 不变 | 上传 -50% | **142MB（-60%）** | 需多一次小 GET 读指针 |

## 6. 推荐路径（每阶段可独立验收、可停可回滚）

**阶段 0 · 零风险结构项（不动条目 schema，建议先做）**
1. commit+latest **双写改 commit 写一次 + latest 只写指针**（上传 -50%）；
2. 提交链 **5 份 → 2 份**（云存储 -60%）；
3. 零变更轮先读 **ref 指针**（commitId）再决定是否拉清单（71MB/轮 → ~0）；
4. 体积与解析耗时**埋点**（同步结果/日志输出清单明文字节、占比），并加 50%/75% 告警；
5. `MAX_MANIFEST_NOTES` 与 `MAX_MANIFEST_BYTES` 配套重算（现在名义 200k 条 = 73MB，永远到不了）。

> 预期：不改变协议语义，传输与云存储显著下降；**不解决 20MB 上限**，但给后续争取时间与可观测性。

**阶段 0.5 · 资产声明瘦身（可零迁移）**
- asset 声明数组化、去掉可由下载后重算的 `size`、hash 改 20hex（asset hash 不在对象 key 里，**无需迁移**）；预计 gzip -40%。
- **contentHash 不要先动**：它与 `objects/{id}-{hash}.lake` 强绑定（`syncUtils.ts:118-120`），改表示 = 全量对象迁移 + 旧端不兼容。

**阶段 1 · 分片（唯一能到目标量级）**
- 按**笔记本**分片（如 1000 文档/片），另加**根索引**：commitId/prev/folders/片清单（片 id + 片 hash + 片内容 hash）。
- 发布只写变更片 + 根索引；GC keep 集 = 根索引 + 各片声明（「全量视图」的能力保留在根索引里或定期全量对账）。
- 墓碑归属：按笔记所属片；根索引保留墓碑片的声明，避免退役时全片扫描。
- 首装仍是全量（可并行下载片）；**只为增量与上限优化**。

**阶段 2 · 墓碑退役（与分片解耦，见 §7）**

**阶段 3 · 可选**：元数据/资产索引外置（分片后再评估是否仍有必要）。

## 7. 墓碑退役：最小充分条件（独立于分片）

**关键结论：不是「每设备基线快照」的问题。** `sync_base` 只证明「本机没改」；锁只保证「发布串行」；而**当前「远端条目缺席」被解释为「桶被重置」**（`syncEngine.ts:584-589`、`core/decideUpload.ts:20-30`）——所以退役墓碑后，任何离线设备回归都会把已删文档重新上传（复活）。

最小充分条件（四条，缺一不可）：

1. **发布串行化**：条件写（If-Match/ETag）或 lock 对象（Kodo 需实测）；
2. **云端世代 epoch**：1 个云对象 + 1 个本机字段。latest 缺失/epoch 不符 = 重置（保留全量重传）；latest 在、epoch 一致、id 缺席 = **删除**；
3. **缺席语义翻面**：本地有基线且远端无条目 → 不上传，改为回收站 + `rememberDeleted`；
4. **退役动作**：发布时主动删 `next.notes` 条目并剪本地 `deleted_notes`（接上 `pruneTombstones`）；payload 老化（90 天）另做。

**设备水位非必需**（成本 = device id + devices 注册 + 每轮 ack + 弃用 TTL，收益只是可审计）；**提交谱系不可行**（链只保 3 份，且退役 = 永久遗忘，链证明不了「所有设备都见过」）。

**四场景（有锁 + 有 epoch 后）**：
- 长期离线回归：latest 在且 epoch 一致 ⇒ 缺席 = 删除 ⇒ 不复活；epoch 不符 ⇒ 全量重传（不误删）；
- 换机/重装：空库无基线 ⇒ 全量下载，天然安全；
- 恢复旧备份：旧文档若已退役 ⇒ 按删除处理（进回收站，可捞）；未退役 ⇒ 墓碑压回回收站 + 留档；
- 双端同时同步：锁串行化后不再丢失条目；锁失效必须**不写、报错、稍后重试**，绝不降级为并发覆盖。

**锁的已知风险**：dejavu 的锁是 Download → 判过期 → Upload **非原子**（65s TTL / 30s 续租 / 3×5s 重试），两端可同时读到「无锁」；崩溃最长锁 65s、解锁失败留锁。我们照做 = 接受同一个窗口，所以**发布前读回校验必需**（发布前确认 latest 仍是我读到的 commit）。

## 8. 思源（dejavu）对照结论

- `Index.Files` 是**纯文件 ID 列表**（SHA-1 40 hex ⇒ ~43B/条），无元数据、无墓碑、无资产声明；文件元数据/分块在独立对象里；索引 zstd 压缩。
- 实测 100 万文件索引 **43MB 明文 / 23MB gzip**；同规模（110 万文件）≈ **47MB**——**它也超我们的 20MB**，只是它不设解析硬上限，失败模式是「慢/占内存」。
- 它真正省的是**指针与单份存储**：`refs/latest` 是 40 字符对象 ⇒ 零变更轮只传 ~40B；云端只保留 refs 指向的索引，其余索引 + 未引用对象直接删（`repo.go PurgeCloud`）。
- 它**没有分片、没有增量**，靠「典型库比我们目标小 1–2 个数量级」回避规模问题。
- 对我们：纯 ID 路线**收益被 100 万条资产声明吃掉**（我们 1M 资产 ≠ 思源 1M 文件里的 1M 条 ID，我们还要维护「资产在用集」）。可借的是**常数因子（短 ID）+ 指针 + 单份存储**，不是分片。

## 9. 需要用户拍板

1. **分片是否立项**（唯一能到 10 万/100 万目标的方案；首装仍全量）。
2. **20MB 上限先扩到多少**（如 50MB）作为止血；扩了要求**所有设备同批升级**（旧端会按 20MB 拒绝）。
3. **墓碑退役的离线设备规则**：离线超 N 天（建议 90/180）回归时，缺席按「删除（进回收站）」还是「弹窗让用户选」。
4. **带外旧备份**：接受「恢复旧备份后，已退役的旧文档被判死（可从回收站捞）」吗？
5. **Kodo 条件写**是否支持（需你提供 S3 凭证做一次真云探测）；若不支持，接受 dejavu 式 65s 锁吗？——不做锁，墓碑退役禁令不解除。
6. **墓碑退役窗口与 payload 老化窗口**是否同口径（建议 90 天）。
7. **是否引入 device id / 设备水位**（可选加固；不做也能靠 epoch 起步）。
8. **contentHash 表示变更**（= 协议迁移）是否做；建议先只改 asset hash（零迁移）与结构项。

## 10. 未决与风险

- **旧端兼容**：清单格式/版本变化必须全设备同批升级；旧 APK 只在 V1/V2 可读。
- **移动端内存**：分片降低单次解析峰值，但根索引仍需完整；首装全量仍是 71MB gzip 级。
- **GC 复杂度**：分片后 keep 集跨片，需「根索引聚合 + 定期全量对账」，误删风险要重新论证。
- **墓碑归属与扫描**：分片后退役需要知道「墓碑在哪个片」，否则退役 = 全片扫描。
- **锁的非原子性**：即使有锁，仍需发布前读回校验（见 §7）。
- **上限扩容的反向风险**：50MB 清单在手机端解析内存峰值、失败爆炸半径都会变大。

## 附录：测算方法与参考

- 测算：按 `src/core/manifestTypes.ts:11-29` + 线上键（`src/core/syncUtils.ts:43-49`）+ `buildUploadEntry/buildTombstoneEntry`（`src/core/syncDecisions.ts:99-124`）造样本；gzip level 9（同 `electron/s3Store.ts:112`）；脚本只在 /tmp，未入库。
- 思源侧：dejavu 源码只读克隆在 `/tmp/dejavu-research`（`entity/index.go`、`store.go`、`repo.go`、`sync_lock.go`、`util/hash.go`）。
- 本文不改变任何红线：现行协议仍是「本地真相 + S3 镜像 + 墓碑权威 + 先拉后推」（`AGENTS.md` §3、`SYNC-PROTOCOL.md`）。
