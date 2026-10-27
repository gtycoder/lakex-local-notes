# SYNC-PROTOCOL.md — Lake Notes 同步协议（Manifest V2）

> 日期：2026-10-20 ｜ 配套：`docs/ARCHITECTURE.md`（架构总览，Manifest 版本说明以此为准）
> 本文件定义 Lake Notes 的 S3 同步协议：Manifest 结构、对象布局、冲突语义、协议边界。
> 基线：代码 `electron/syncEngineController.ts` / `electron/s3Store.ts` / `electron/s3Maintenance.ts` / `electron/quickNotesSync.ts`，实测与文档一致。

> **261020 Manifest V2**：在当前结构上正式加入 `kind="ink"`（手写板）。代码写入 `version=2`，同时可读取 V1
> 并升级；所有会访问同一 S3 前缀的客户端必须一起升级。小记独立 Manifest 仍为 V1，不受影响。
>
> **260928 历史**：远端与本地旧数据清空后曾重置为 V1 编号，内容 schema 沿用当时的 v7。该段只用于解释旧清单来历。

---

## 1. 产品协议边界（单写者语义，撤销 Manifest CAS 的依据）

当前系统是**个人单用户同步工具**，同步协议基于以下前提（**不是**跨设备代码锁）：

1. S3 是本地数据的**远端镜像**，本地是真相；镜像侧短暂不一致可接受「下一轮同步自愈」。
2. 同步提交采用**单写者、顺序提交**语义（单实例锁 + enqueueMaintenance 串行队列保证单设备内串行）。
3. 两个设备同时提交不同本地变更时，**不保证 latest 指针线性化**（无 CAS/If-Match）；被覆盖方下一轮依据本地内容重新收敛。
4. **不支持多人协作或同一文档的并发编辑**；先提交云端的版本确定胜出。
5. 若未来引入后台高频自动同步 / 多窗口 / 多人协作 / 同内容并发编辑，必须重新评估 Manifest CAS。

---

## 2. S3 对象布局（前缀由 settings.prefix 决定，默认 `local-lakex-notes/`）

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

> **正文类型统一走同一条内容寻址管线**。`kind` 是可选字段，缺省 = `doc`；当前支持
> `doc | usheet | bitable | board | ink`，只有非 `doc` 值才写入清单。
>
> - 表格（`usheet`）：Univer IWorkbookData 快照；本地 `usheets/{id}.usheet.json`。
> - 多维表（`bitable`）：record-based JSON；本地 `bitables/{id}.bitable.json`。
> - 画板（`board`）：Drawnix/Plait 场景 JSON；本地 `boards/{id}.board.json`。
> - 手写板（`ink`）：矢量笔迹 JSON；本地 `inks/{id}.ink.json`，见 `docs/INK-PAD.md`。
>
> `kind` 字段最早在历史清单 v6 引入、画板在 v7 加入；260928 重置后编号回到 V1，261020 升到 V2 增加 `ink`。
> 这些历史编号只说明字段来源，不代表当前仍兼容旧结构。

## 3. Manifest V2 schema

```ts
interface Manifest {
  version: number;          // 2（读取端兼容 V1 并升级）
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
  // v3 锁元数据（锁编辑，独立于正文哈希，按 lockedAt 字段级 LWW）。
  // ⚠️ 线上 JSON 键冻结：永远是 isLocked / lockedAt（跨端与旧数据契约，不得改名）。
  //    代码内存类型叫 isEditLocked / editLockedAt；改名只发生在解析/写出边界
  //    （src/core/syncUtils.ts 的 parseLakeManifest→manifestFromWire / manifestToWire）。
  isLocked?: boolean; lockedAt?: string | null;
  icon?: string | null;                            // 可选字段：旧清单无此字段时本地保持原样
  assets: { filename: string; size: number; hash: string }[];
  kind?: "doc" | "usheet" | "bitable" | "board" | "ink"; // 缺省 doc
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

**线上键冻结（261023）**：`isLocked` / `lockedAt` 是**线上键**，不随代码标识符改名（内存叫 `isEditLocked` / `editLockedAt`）。任何新写入都必须只产出这两个键；解析侧兼容旧清单（只有这两个键）。护栏 `src/core/manifestLockWire.test.ts`。

---

## 4. 冲突与一致性规则

### 4.1 统一冲突语义：先同步者胜

- 正文：以 `sync_base.content_hash`（本设备已确认基线）为锚——远端 hash == 基线且本地在其上续编 → 本地为准上传；远端是其他设备新提交 → 接受远端，本地当前版本强制留历史快照（supersededNotes 提示）。
- 元数据（标题/父目录/排序/图标）：以 `sync_base.last_synced_meta_at`（本设备上次成功同步时 updated_at）为已确认版本——远端 updatedAt 新于它 → 应用远端；否则保留本地续编。
- 锁：`mergeEditLockState`（原 mergeLockState）按 lockedAt 字段级 LWW。

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
> 移动端 `src/mobile/native/s3Store.ts` 直接实现端口（AWS SDK + `CapacitorHttpHandler` → Android OkHttp，绕 WebView CORS）。
> **分成两份实现是正确的**（传输栈不同）；要守的是**协议面等价**。本节 = 那张对拍表 + 已发现的漂移。
> 判据 = 逐项读码对比（见 `AGENTS.md` C2-4）。**本节的 P1 项尚未修**，P2 项需真云验证或产品决策。

### 7.1 端口面（core 契约）与两端实现

| 端口方法 | 桌面（adapter → ObjectStore） | 移动端（Capacitor） | 判定 |
| --- | --- | --- | --- |
| `getObject` | ✅ `getOptional`（adapter 剥 prefix） | ✅ 直连（端口收含 prefix 的完整 key） | 等价 |
| `putObject` | ✅ `put`（adapter 剥 prefix） | ✅ | ✅ D5 已修（261017） |
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
| gzip 写 | 压缩 **+ `Content-Encoding: gzip`** | 压缩 **+ `Content-Encoding: gzip`**（261017 真云验证后补） | ✅ |
| `maxBytes` 语义 | 解压**后**判定（防解压炸弹） | 解压后判定 | ✅ 一致 |
| prefix 归属 | adapter 剥 prefix（ObjectStore 内部再加） | 端口收完整 key | ✅ 契约一致 |
| 并发上限 8 | 在 core（`runAssetPool` / `ASSET_TRANSFER_CONCURRENCY`） | 同 | ✅ 单一来源 |
| 404 判定 | `isNoSuchKey()`：`NoSuchKey` / `NotFound` / message 含 404 | 只判 `$metadata.httpStatusCode === 404` 或 `name === NoSuchKey` | ⚠️ **D4** |
| key 安全校验 | `assertSafeKey`（get/put/putStream/delete/deleteMany） | **无** | ⚠️ **D1** |
| endpoint 规范化 | `normalizeEndpoint()`（补 https、去重斜杠） | ✅ 与桌面同源（client 工厂 + 保存/读取都规范化） | ✅ D3 已修（261017） |
| 配置校验 | `validateS3Settings()`（非空 + 强制 https，localhost 例外） | ✅ 与桌面同源（保存时校验，失败给可见提示） | ✅ D3 已修（261017） |
| `forcePathStyle` | 取设置（设置页有开关：「自建 MinIO 等需要开启」） | **有意固定 false**：只支持虚拟托管（阿里云 OSS/腾讯云 COS/AWS/七牛）；自建 MinIO 不在移动端支持范围 | ✅ D2 结案（261017，产品口径） |
| 响应 checksum 绕行 | 未设 `responseChecksumValidation` | `s3Store` 设 `WHEN_REQUIRED`（七牛只回 content-md5 的绕行）；`bridge.createS3Client` **未设** | ⚠️ **D6** |
| region 缺省 | `region \|\| "cn-east-1"` | ✅ `region?.trim() \|\| "cn-east-1"`（client / native 配置 / 保存读取一致） | ✅ D7 已修（261017） |

### 7.3 已发现的漂移与建议（**都还没修**）

| # | 漂移 | 风险 | 建议 | 优先级 |
| --- | --- | --- | --- | --- |
| **D1** | `assertSafeKey` 只在桌面执行。该判据的注释写明目的是「防非 ASCII 键导致 ListObjectsV2 编码不一致（fail fast）」 | 移动端若出现非 ASCII key，`listObjects` 可能与写入侧编码不一致 ⇒ GC 看不到对象（漏删/误判） | 移动端口在 get/put/list/deleteMany 前调 core 的 `assertSafeKey`（纯函数、core 已导出） | **P1** |
| **D4** | 404 判定两端两套：桌面 `isNoSuchKey`（含 `NotFound`），移动端只认 404 状态码 / `NoSuchKey` | 桌面注释**明确记录**"部分操作（AWS/七牛 Kodo）返回 NotFound" ⇒ 移动端可能把"对象缺失"当错误抛出（首次同步判定失败） | 移动端改用 core 的 `isNoSuchKey`（纯函数） | **P1** |
| **D6** | 移动端有**两套** client 工厂且设置不同：`bridge.createS3Client`（用 `cfg.forcePathStyle`、**无** checksum 绕行）只服务「测连通」；`mobile/s3Store`（硬编码 false、**有**绕行）服务全部同步 | 可能出现「测连通报 Checksum mismatch，真同步却正常」这类难查的不一致；`forcePathStyle` 也会两边不同 | 合并为**一个** client 工厂（移动端内部先自洽，再谈与桌面对齐） | **P1** |
| **D2** | `forcePathStyle` 移动端写死 false | 自建 MinIO（path-style）无法在移动端使用；主流公有云不受影响 | ✅ **261017 用户定稿：不做**。支持范围 = 虚拟托管风格（阿里云 OSS 官方仅支持虚拟托管；腾讯云 COS 2024+ 新桶不支持 path-style；AWS/七牛同理）。移动端固定 false 写成有意约束；桌面端保留开关。自建 MinIO 等需要 path-style + http 的场景与 D3 一起另立项 | ✅ |
| **D5** | 移动端 gzip PUT **不带** `Content-Encoding: gzip`（桌面带） | 读侧按魔数识别 ⇒ 当前兼容；但对象元数据两端不同（控制台/第三方工具看移动端 manifest 是"未知二进制"） | ✅ **261017 已修 + 真云验证**：七牛 `local-lake-hebei` / prefix `local-lakex-notes-dev1` 实测——gzip 体（不带 header）存回 `ContentEncoding=null`；带 `Content-Encoding: gzip` 存回 `ContentEncoding=gzip`，Get 回压缩字节（SDK 不解压），读侧魔数兼容仍成立。移动端 gzip 分支补 header；`s3PortGuards` 加 D5 护栏 | ✅ |
| **D3** | `normalizeEndpoint` / `validateS3Settings` 只在桌面 | 误写 endpoint 两端表现不同；移动端不强制 https（签名重放风险） | ✅ **261017 已修**：D2 定稿不做 MinIO 后冲突消失；移动端 client 工厂/保存/读取统一走 core 规范化 + 保存时校验（强制 https），错误在设置页可见。护栏：`s3PortGuards` D3/D7 | ✅ |
| **D7** | region 缺省不同（桌面 `cn-east-1`，移动端空） | 用户没填 region 时行为可能不同 | ✅ **261017 已修**：移动端 client/native 配置/保存读取统一 `region?.trim() \|\| "cn-east-1"` | ✅ |

**修复进度**：

- **D6 ✅ 已修（261016）**：移动端两套 client 工厂合并为 `createMobileS3Client`（`src/mobile/native/s3Store.ts`）**一处**——
  checksum 绕行随之上移到工厂，于是「测连通」路径**也**拿到绕行（原先只有同步路径有，正是漂移点）。
  护栏 = `src/mobile/native/s3PortGuards.test.ts`（`new S3Client(` 只允许一处；`responseChecksumValidation:` 只允许一次；
  已自证：注入第二处 ⇒ 失败）。
- **D1 ✅ 已修（261016）**：移动端端口 5 个校验点（getObject / putObject / deleteMany / putObjectStream / getObjectToFile）
  统一调用 core 的 `assertSafeKey`（与桌面 `ObjectStore` 的校验点对齐；`listObjects` 的 prefix 按桌面同样不校验）。
  护栏同 `s3PortGuards.test.ts`。
- **D4 ✅ 已修（261016）**：移动端 `getObject` 改用 core 的 `isNoSuchKey`（与桌面**同一判据**）——
  `isNoSuchKey` 认 `NoSuchKey` / `NotFound` / message 含 404，而原先移动端只认 HTTP 404 状态码或 `NoSuchKey`
  ⇒ 桌面注释明确记录的「部分操作（AWS/七牛 Kodo）返回 NotFound」在移动端会变成**抛错**（首次同步判定失败）。
  护栏同 `s3PortGuards.test.ts`（并断言不得再自己拼 `httpStatusCode === 404`）。
- **P1 三项（D6/D1/D4）+ D2/D5/D3/D7 均已处理（261017）**：D2 定稿不做 path-style；D5 真云验证补 header；D3/D7 与桌面同源规范化/缺省。**§7.3 全部清零。**

### 7.4 结论

1. **协议面的"硬骨头"两端是一致的**：超时、重试、连通性检查方式、gzip 读、maxBytes 语义、prefix 归属、并发上限 —— 这些都对上了。
2. ~~真实缺口集中在桌面侧防御性/规范化工具在移动端缺失（D1/D3/D4）~~ 261017 全部补齐（core 纯函数复用）；D3/D7 同步收口。
3. ~~**D2（forcePathStyle）是一处真实功能缺口**~~ 261017 产品定稿：移动端只支持虚拟托管，不做 path-style；桌面端仍支持 MinIO。
4. ~~建议顺序~~ 已全部走完：D6 → D1/D4 → D2/D5 → D3/D7（261017）。§7.3 无遗留。

---

## 8. 记录

本文件新增于 2026-08-21（V5 Phase 0 收尾）；与代码基线 `hardening/sync-correctness` @ `19dcd5d` 一致。
