# SYNC-PROTOCOL.md — Lake Notes 同步协议（重置 V1）

> 日期：2026-08-21 ｜ 配套：`docs/ARCHITECTURE.md`（架构总览，Manifest 版本说明以此为准）
> 本文件定义 Lake Notes 的 S3 同步协议：Manifest 结构、对象布局、冲突语义、协议边界。
> 基线：代码 `electron/syncEngineController.ts` / `electron/s3Store.ts` / `electron/s3Maintenance.ts` / `electron/quickNotesSync.ts`，实测与文档一致。

> **260928 协议重置**：远端与本地旧数据全部清空后，Lake 清单重新使用 **V1 编号**，但**内容 schema 沿用原 v7
> （folders/墓碑/锁/prevCommitId/kind/board 全部保留）**。代码只读写新 V1，不兼容旧 V1 结构；
> 所有会访问同一 S3 前缀的客户端必须同时升级。小记独立 manifest 的 V1 不受影响。

---

## 1. 产品协议边界（单写者语义，撤销 Manifest CAS 的依据）

当前系统是**个人单用户同步工具**，同步协议基于以下前提（**不是**跨设备代码锁）：

1. S3 是本地数据的**远端镜像**，本地是真相；镜像侧短暂不一致可接受「下一轮同步自愈」。
2. 同步提交采用**单写者、顺序提交**语义（单实例锁 + enqueueMaintenance 串行队列保证单设备内串行）。
3. 两个设备同时提交不同本地变更时，**不保证 latest 指针线性化**（无 CAS/If-Match）；被覆盖方下一轮依据本地内容重新收敛。
4. **不支持多人协作或同一文档的并发编辑**；先提交云端的版本确定胜出。
5. 若未来引入后台高频自动同步 / 多窗口 / 多人协作 / 同内容并发编辑，必须重新评估 Manifest CAS。

---

## 2. S3 对象布局（前缀由 settings.prefix 决定，默认 `lake-notes/`）

```text
objects/{noteId}-{contentHash}.lake     Lake 正文（内容寻址，幂等 PUT）
assets/{noteId}/{filename}              Lake 资源
manifests/latest.json                   latest 指针（可变，无条件覆盖）
manifests/{commitId}.json               不可变 commit（prevCommitId 链，保留 8 层）
quick-notes/manifests/latest.json       小记独立清单
quick-notes/objects/{contentHash}.qnote 小记正文（内容寻址）
quick-notes/assets/{quickNoteId}/{filename}  小记资源
```

**对象语义**：

| 对象 | 语义 |
|---|---|
| 正文对象 | 内容寻址（hash 即 key）；同 hash 重复 PUT 幂等无害 |
| 资源对象 | filename 不可变 + 内容寻址校验（size + sha256） |
| latest 指针 | 可变；无条件覆盖（单写者前提） |
| commit 链 | 不可变；prevCommitId 追溯历史；latest 可达链保留 8 层，其余 prune |
| 墓碑 | 删除方软删保留 .lake，同步时读文件算真实 hash 上传；其他设备先拉删除前内容再应用墓碑 |

---

> **表格文档（`kind="usheet"`）复用同一条正文对象管线**（正文=内容寻址 JSON）。
> 清单已升 **v6**：每条 note 多一个可选 `kind?: "doc" | "usheet" | "bitable"`（缺省 doc，**只有非 doc 才写**；纯文档库的清单条目逐字节不变）。旧端读到 v6 会**显式拒绝同步**（刻意安全闸）。
> 表格正文格式 = **v1 Univer IWorkbookData 快照**（`{kind:"usheet",version:1,workbook:{…}}`）；本地 `usheets/{id}.usheet.json` → S3 `objects/{id}-{hash}.lake`。详见 `docs/STORAGE-LAYERS.md`。
> **补充（表格图片，无协议变更）**：表格 drawing 的 `source` 存**资产 filename**（不再内联 base64），文件按既有
> `note-assets/{noteId}/{filename}` 走同步；`manifest.assets` 声明照旧（**磁盘实扫**，正文不需要额外声明），**版本号不变、协议零改动**。见 `docs/STORAGE-LAYERS.md`。
>
> **260920 补充：画板文档（`kind="board"`）走同一条管线**，清单独占 **v7**（`kind` 多一个取值 `board`）。
> **为什么加个取值也要升版本**：旧端 `normalizeNoteKind` 对未知取值一律回退 `doc` ⇒ v6 端读 v7 清单会把画板 JSON 当 Lake 文档导入并保存 = 毁正文；
> 该历史升级策略已被 260928 的 V1 重置取代：当前只读写新 V1。
> 画板正文 = Drawnix/Plait 场景 JSON（`{kind:"board",version:1,engine:"drawnix",preset,elements[],viewport?}`）；本地 `boards/{id}.board.json` → S3 `objects/{id}-{hash}.lake`。详见 `docs/STORAGE-LAYERS.md`。

## 3. Manifest V1 schema（260928 重置；内容沿用原 v7）

```ts
interface Manifest {
  version: number;          // 1（260928 重置；字段内容沿用原 v7）
  workspaceId: string;      // "default"
  commitId: string;         // uuid
  prevCommitId: string | null;
  createdAt: string;
  notes: ManifestNote[];
  folders: ManifestFolder[];
}

interface ManifestNote {
  id: string; title: string; parentId: string | null; sortOrder: number;
  updatedAt: string; contentHash: string; isConflict: boolean;
  isLocked?: boolean; lockedAt?: string | null;   // v3 锁元数据（独立于正文哈希，按 lockedAt LWW）
  icon?: string | null;                            // 可选字段：旧清单无此字段时本地保持原样
  assets: { filename: string; size: number; hash: string }[];
  deleted?: boolean; deletedAt?: string;
  trashedAt?: string | null; deletedFromParentId?: string | null;  // 回收站条目
}

interface ManifestFolder {
  id: string; title: string; parentId: string | null; sortOrder: number;
  nodeType: "notebook" | "group"; icon: string | null; updatedAt: string;
  trashedAt?: string | null; deletedFromParentId?: string | null;
}
```

**可选字段语义**：`icon: undefined` 保留本地 vs `null` 显式清除；锁字段缺席视为未锁定。

---

## 4. 冲突与一致性规则

### 4.1 统一冲突语义：先同步者胜

- 正文：以 `sync_base.content_hash`（本设备已确认基线）为锚——远端 hash == 基线且本地在其上续编 → 本地为准上传；远端是其他设备新提交 → 接受远端，本地当前版本强制留历史快照（supersededNotes 提示）。
- 元数据（标题/父目录/排序/图标）：以 `sync_base.last_synced_meta_at`（本设备上次成功同步时 updated_at）为已确认版本——远端 updatedAt 新于它 → 应用远端；否则保留本地续编。
- 锁：`mergeLockState` 按 lockedAt 字段级 LWW。

### 4.2 墓碑权威（删除压编辑）

- A 删除后，B 的编辑（无论早于晚于删除）不抵抗删除——B 跟随删除；
- 被删设备的本地编辑：**Lake 强制留历史快照**；**小记不备份**（云端为主，随手记语义）；
- 墓碑携带删除前内容（真实 hash + 对象上传），其他设备先拉内容再应用墓碑 → 回收站/恢复拿到删除方最新版；
- 墓碑按 id 永久保留在 manifest（本地重建同名笔记前不剪除），防长期离线设备删除复活。

### 4.3 恢复是唯一显式例外

- 用户从回收站恢复 → 写 `restore_pending_at`（本地标记）→ 同步时 local-wins，上传 active 覆盖墓碑并传播；
- 恢复标记在 markSynced 时清除（绝不能残留，否则墓碑永胜失效）；
- 墓碑 vs 远端恢复按 updatedAt LWW（远端 active 更新 → 墓碑让位）。

### 4.4 目录语义

- 目录（notebook/group）无独立对象上传，只进 manifest.folders；
- 先提交者胜 + 墓碑权威 + 恢复例外（与笔记同构）；
- **已知限制**：目录无墓碑——本地离线移入回收站的目录会被远端无条件还原（个人场景低频，文档明示）。
- 目录归位：latest 发布成功后按构建时 updatedAt 快照条件归位（`markFolderSynced`）。

### 4.5 对象缺失行为（V5 §5.5，B 方案）

| 对象 | 行为 |
|---|---|
| 正文/资源对象缺失 | **跳过受影响条目 + warnings 提示，不覆盖本地**，其余同步继续（下一轮重试） |
| 资源 size/sha256 不符（损坏） | 拒绝（中止导入，不静默接受） |
| manifest 缺失 | 视为首次同步 |
| manifest 损坏/协议不可解析 | 整轮中止（协议级问题，跳过无意义） |
| 小记墓碑内容缺失 | 保留本地可恢复状态（跳过覆盖） |

### 4.6 同步收尾（本地记账时序）

```text
上传对象（幂等）→ commit manifest → latest 发布 → setLastUploadedHash → setBaseHash
→ markSyncedIfUnchanged（本地同步快照保护：磁盘 hash 重读 + metadata 比对 + updated_at 条件）→ 目录归位
```

- `lastUploadedHash` = 已成功发布到 latest 的版本 hash（不在对象 PUT 后提前记账）；
- 崩溃窗口（latest 已发布 → 记账前）由下次同步 hash 对齐 + 内容寻址幂等自愈；
- 本地同步快照保护：同步期间任何编辑（正文 hash / updated_at / 锁 / icon 变化）→ 保持 local，下轮重传。

---

## 5. 小记（quick-notes）同步差异

- 独立前缀 `quick-notes/` + 独立小记库（`quick-notes/metadata.sqlite3`）；
- 小记同步失败不否定 Lake 文档同步结果（SyncResult.quickNotes 独立状态）；
- 小记墓碑/恢复/转换 journal（quick_note_conversions / quick_note_file_ops）语义与 Lake 对齐（先提交为确定 → 只补做不撤销）；
- 小记正文对象缺失 → 跳过 + 日志（B 方案）。

---

## 6. 一致性保障清单（本地侧）

1. 本地是真相：S3 只是镜像；
2. 多表写全部事务化；
3. 小记 save/import 走 staging → DB 提交 → 原子 promote（4 态 journal + 启动恢复）；
4. 单对象大小上限：manifest 20MiB / Lake 正文 64MiB / 资源 25MiB / 小记清单 10MiB / 小记正文 64MiB；
5. endpoint 强制 https（localhost 开发例外）。

---

## 7. S3 传输层：两端对拍（261016，代码 review 产出）

> 背景：`S3Store` 是 core 的**端口**（`src/core/syncEngineTypes.ts`）。两端各自实现传输层——
> 桌面 `electron/s3Store.ts`（`ObjectStore`，Node SDK + NodeHttpHandler）经 `electron/syncAdapters.ts` 适配成端口；
> 移动端 `src/mobile/s3Store.ts` 直接实现端口（AWS SDK + `CapacitorHttpHandler` → Android OkHttp，绕 WebView CORS）。
> **分成两份实现是正确的**（传输栈不同）；要守的是**协议面等价**。本节 = 那张对拍表 + 已发现的漂移。
> 判据 = 逐项读码对比（见 `docs/CODE-REVIEW-261015.md` C2-4）。**本节的 P1 项尚未修**，P2 项需真云验证或产品决策。

### 7.1 端口面（core 契约）与两端实现

| 端口方法 | 桌面（adapter → ObjectStore） | 移动端（Capacitor） | 判定 |
| --- | --- | --- | --- |
| `getObject` | ✅ `getOptional`（adapter 剥 prefix） | ✅ 直连（端口收含 prefix 的完整 key） | 等价 |
| `putObject` | ✅ `put`（adapter 剥 prefix） | ✅ | ⚠️ 见 D5 |
| `putObjectStream?` | ✅ Node Readable + 显式 Content-Length（避开 aws-chunked） | ✅ 原生 `NativeAssetSync.putFile`（字节不过桥） | 各自最优 ✓ |
| `getObjectToFile?` | ❌ 未实现（走 getObject 字节路径，由 core 校验） | ✅ 原生流式写 + size/sha256 校验 | 可选钩子 ✓ |
| `listObjects?` | ❌ 未实现（桌面 GC 走 `s3Maintenance` + ObjectStore 直连） | ✅ | ✓ 无 core 调用方 |
| `deleteMany?` | ❌ 未实现（同上） | ✅ | ✓ 无 core 调用方 |

**可选方法覆盖面不对称不是缺陷**：core 里**没有任何一处**调用这四个可选方法；调用方各在两端自己的编排层
（移动 `mobile/bridge.ts` 的深度清理；桌面 `electron/s3Maintenance.ts`）。

### 7.2 协议面逐项对拍

| 维度 | 桌面 | 移动端 | 判定 |
| --- | --- | --- | --- |
| 超时 | 30s 元数据 / 120s Get·Put（AbortController 中断） | 30s / 120s（`connectTimeout` + `readTimeout`，注释显式对齐桌面常数） | ✅ 一致 |
| 重试 | `maxAttempts: 3`（显式） | 未设 ⇒ SDK 默认 3 | ✅ 等价（移动端是隐式默认） |
| 连通性检查 | `ListObjectsV2`（不用 HeadBucket：七牛对存在的桶也 404） | 同 | ✅ 一致 |
| gzip 读 | 端口内按**魔数** gunzip；`Content-Encoding` 自动解压与原始字节两种响应都兼容 | 同（`DecompressionStream`） | ✅ 一致 |
| gzip 写 | 压缩 **+ `Content-Encoding: gzip`** | 压缩但**不写该 header** | ⚠️ **D5** |
| `maxBytes` 语义 | 解压**后**判定（防解压炸弹） | 解压后判定 | ✅ 一致 |
| prefix 归属 | adapter 剥 prefix（ObjectStore 内部再加） | 端口收完整 key | ✅ 契约一致 |
| 并发上限 8 | 在 core（`runAssetPool` / `ASSET_TRANSFER_CONCURRENCY`） | 同 | ✅ 单一来源 |
| 404 判定 | `isNoSuchKey()`：`NoSuchKey` / `NotFound` / message 含 404 | 只判 `$metadata.httpStatusCode === 404` 或 `name === NoSuchKey` | ⚠️ **D4** |
| key 安全校验 | `assertSafeKey`（get/put/putStream/delete/deleteMany） | **无** | ⚠️ **D1** |
| endpoint 规范化 | `normalizeEndpoint()`（补 https、去重斜杠） | **无**（原样交 SDK） | ⚠️ **D3** |
| 配置校验 | `validateS3Settings()`（非空 + 强制 https，localhost 例外） | 只查非空凭证（`assertS3Credentials`） | ⚠️ **D3** |
| `forcePathStyle` | 取设置（设置页有开关：「自建 MinIO 等需要开启」） | **硬编码 false**；保存时也写死 false | ⚠️ **D2（功能缺口）** |
| 响应 checksum 绕行 | 未设 `responseChecksumValidation` | `s3Store` 设 `WHEN_REQUIRED`（七牛只回 content-md5 的绕行）；`bridge.createS3Client` **未设** | ⚠️ **D6** |
| region 缺省 | `region \|\| "cn-east-1"` | 原样（空则由 SDK 决定） | ⚠️ 轻微 D7 |

### 7.3 已发现的漂移与建议（**都还没修**）

| # | 漂移 | 风险 | 建议 | 优先级 |
| --- | --- | --- | --- | --- |
| **D1** | `assertSafeKey` 只在桌面执行。该判据的注释写明目的是「防非 ASCII 键导致 ListObjectsV2 编码不一致（fail fast）」 | 移动端若出现非 ASCII key，`listObjects` 可能与写入侧编码不一致 ⇒ GC 看不到对象（漏删/误判） | 移动端口在 get/put/list/deleteMany 前调 core 的 `assertSafeKey`（纯函数、core 已导出） | **P1** |
| **D4** | 404 判定两端两套：桌面 `isNoSuchKey`（含 `NotFound`），移动端只认 404 状态码 / `NoSuchKey` | 桌面注释**明确记录**"部分操作（AWS/七牛 Kodo）返回 NotFound" ⇒ 移动端可能把"对象缺失"当错误抛出（首次同步判定失败） | 移动端改用 core 的 `isNoSuchKey`（纯函数） | **P1** |
| **D6** | 移动端有**两套** client 工厂且设置不同：`bridge.createS3Client`（用 `cfg.forcePathStyle`、**无** checksum 绕行）只服务「测连通」；`mobile/s3Store`（硬编码 false、**有**绕行）服务全部同步 | 可能出现「测连通报 Checksum mismatch，真同步却正常」这类难查的不一致；`forcePathStyle` 也会两边不同 | 合并为**一个** client 工厂（移动端内部先自洽，再谈与桌面对齐） | **P1** |
| **D2** | `forcePathStyle` 移动端写死 false（`s3Store` 与 `SettingsDrawer` 保存路径都写死） | ① 自建 MinIO（需 path-style）用户在移动端**无法使用**；② 与桌面设置不同步，跨设备行为不一致 | 给 `SyncConfig` 加 `forcePathStyle` 字段并透传到 `createCapacitorS3Store`；`SettingsDrawer` 保存时保留用户设置。**注意与 D3 联动**：若同时补 https 强制，会拒掉 http 的 MinIO 内网地址 ⇒ 两者要一起定 | **P2** |
| **D5** | 移动端 gzip PUT **不带** `Content-Encoding: gzip`（桌面带） | 读侧按魔数识别 ⇒ **当前兼容**；但两端的对象元数据不同（控制台/第三方工具看移动端写的 manifest 是"未知二进制"） | 移动端 gzip 时也设 header。**这是线上写行为的变化 ⇒ 必须先在真云（Tier B）验一次读回路径**，不能凭静态推断改 | **P2** |
| **D3** | `normalizeEndpoint` / `validateS3Settings` 只在桌面；移动端把用户输入原样交给 SDK | 少了「强制 https（防签名重放）」这一安全项；误写 endpoint 时两端表现不同 | 与 D2 一起决策（https 强制 vs 内网 http MinIO）。**不建议单独补**：会与 D2 冲突 | 记录 |
| **D7** | region 缺省不同（桌面 `cn-east-1`，移动端空） | 用户没填 region 时行为可能不同 | 移动端也 `cfg.region \|\| "cn-east-1"` | 记录 |

**修复进度**：

- **D6 ✅ 已修（261016）**：移动端两套 client 工厂合并为 `createMobileS3Client`（`src/mobile/s3Store.ts`）**一处**——
  checksum 绕行随之上移到工厂，于是「测连通」路径**也**拿到绕行（原先只有同步路径有，正是漂移点）。
  护栏 = `src/mobile/s3PortGuards.test.ts`（`new S3Client(` 只允许一处；`responseChecksumValidation:` 只允许一次；
  已自证：注入第二处 ⇒ 失败）。
- **D1 ✅ 已修（261016）**：移动端端口 5 个校验点（getObject / putObject / deleteMany / putObjectStream / getObjectToFile）
  统一调用 core 的 `assertSafeKey`（与桌面 `ObjectStore` 的校验点对齐；`listObjects` 的 prefix 按桌面同样不校验）。
  护栏同 `s3PortGuards.test.ts`。
- **D4 ✅ 已修（261016）**：移动端 `getObject` 改用 core 的 `isNoSuchKey`（与桌面**同一判据**）——
  `isNoSuchKey` 认 `NoSuchKey` / `NotFound` / message 含 404，而原先移动端只认 HTTP 404 状态码或 `NoSuchKey`
  ⇒ 桌面注释明确记录的「部分操作（AWS/七牛 Kodo）返回 NotFound」在移动端会变成**抛错**（首次同步判定失败）。
  护栏同 `s3PortGuards.test.ts`（并断言不得再自己拼 `httpStatusCode === 404`）。
- **P1 三项（D6/D1/D4）已全部修完。** 剩下 D2 / D5 需产品决策/真云验证；D3 / D7 记录备查。

### 7.4 结论

1. **协议面的"硬骨头"两端是一致的**：超时、重试、连通性检查方式、gzip 读、maxBytes 语义、prefix 归属、并发上限 —— 这些都对上了。
2. 真实缺口集中在**桌面侧那套防御性/规范化工具在移动端缺失**（D1/D3/D4）：core 里都有纯函数，搬过去成本很低。
3. **D2（forcePathStyle）是一处真实功能缺口**，不是观感问题：MinIO 用户在移动端用不了，且移动端内部还自相矛盾（D6）。
4. 建议顺序：**先 D6 让移动端内部自洽 → 再 D1/D4（共用 core 判据）→ 最后 D2+D3 一起定产品语义 → D5 走真云验证**。

---

## 8. 记录

本文件新增于 2026-08-21（V5 Phase 0 收尾）；与代码基线 `hardening/sync-correctness` @ `19dcd5d` 一致。
