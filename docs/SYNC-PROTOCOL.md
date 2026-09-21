# SYNC-PROTOCOL.md — Lake Notes 同步协议（v4 定稿）

> 日期：2026-08-21 ｜ 配套：`docs/ARCHITECTURE.md`（架构总览，Manifest 版本说明以此为准）
> 本文件定义 Lake Notes 的 S3 同步协议：Manifest 结构、对象布局、冲突语义、协议边界。
> 基线：代码 `electron/sync.ts` / `electron/quickNotesSync.ts`，实测与文档一致。

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

> **260919 说明：表格文档（`kind="sheet"`）复用同一条正文对象管线**（正文=内容寻址 JSON）。
> 清单已升 **v6**：每条 note 多一个可选 `kind?: "doc" | "sheet" | "bitable"`（缺省 doc，**只有非 doc 才写**；纯文档库的清单条目逐字节不变）。旧端读到 v6 会**显式拒绝同步**（刻意安全闸）。
> 表格正文格式 = **v2 FortuneSheet workbook**（`{kind:"sheet",version:2,sheets:Sheet[]}`）；本地 `sheets/{id}.sheet.json` → S3 `objects/{id}-{hash}.lake`。详见 `docs/SHEET-BITABLE-DESIGN-260918.md` 与 `docs/FORTUNESHEET-FEASIBILITY-260919.md`。
> **260920 补充（表格图片，无协议变更）**：表格浮动图 `sheets[].images[].src` 存**资产 filename**（不再内联 base64），文件按既有
> `note-assets/{noteId}/{filename}` 走同步；`manifest.assets` 声明照旧（**磁盘实扫**，正文不需要额外声明），**版本号不变、协议零改动**。见 `docs/SHEET-IMAGE-MANAGEMENT-260919.md`。
>
> **260920 补充：画板文档（`kind="board"`）走同一条管线**，清单独占 **v7**（`kind` 多一个取值 `board`）。
> **为什么加个取值也要升版本**：旧端 `normalizeNoteKind` 对未知取值一律回退 `doc` ⇒ v6 端读 v7 清单会把画板 JSON 当 Lake 文档导入并保存 = 毁正文；
> 升版本后 v6 端按既有「版本不兼容」整轮拒绝（`syncUtils.ts` 的 `READABLE_MANIFEST_VERSIONS={4,5,6,7}`）。
> 画板正文 = Drawnix/Plait 场景 JSON（`{kind:"board",version:1,engine:"drawnix",preset,elements[],viewport?}`）；本地 `boards/{id}.board.json` → S3 `objects/{id}-{hash}.lake`。详见 `docs/BOARD-DOC-FEASIBILITY-260920.md`。

## 3. Manifest v4 schema（代码 sync.ts:74-80 + 645-697 实测）

```ts
interface Manifest {
  version: number;          // 4（含锁字段/prevCommitId 链/GC）
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

## 7. 记录

本文件新增于 2026-08-21（V5 Phase 0 收尾）；与代码基线 `hardening/sync-correctness` @ `19dcd5d` 一致。
