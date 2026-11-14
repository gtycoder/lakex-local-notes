# STORAGE-LAYERS.md — 存储分层与「设备本地」契约（单一来源）

> **目的**：把「哪些数据是本地真相 / 哪些进 S3 镜像 / 哪些属于保留链 / 哪些是纯本机派生」收敛到这一处，避免再出现「注释说本地、代码其实同步」的漂移。
> 协议细节看 [`SYNC-PROTOCOL.md`](SYNC-PROTOCOL.md)；端口差异看 [`SYNC-DEVICE-CONTRACT.md`](SYNC-DEVICE-CONTRACT.md)；降级/自愈看 [`RESILIENCE.md`](RESILIENCE.md)；待办看 [`HANDOFF.md`](HANDOFF.md) §3。
> **261112 重写**：按 S3 v3（指针 + 不可变索引 + 每篇资产声明，无墓碑 / 无 manifest 链）重写；删除 V2 布局、`manifestTypes` 与已删除模块的引用。

## 0. 三条铁律

1. **本地是真相，S3 只是镜像**（AGENTS §3#1）：数据不丢由本地保证（正文、回收站、历史快照），云端丢/坏可由本地重推。
2. **进 S3 的只有协议白名单**：pointer / 索引 / 每篇资产声明 / 内容寻址正文 / 附件。**设备本地态一律不进**（基线、删除意图、游标、UI 偏好、密钥、历史、回收站状态、同步账本）。
3. **派生数据可重建，正文/资产不可重建**：`text_cache`、FTS、markdown 缓存随时可 DROP 重建；正文/附件/历史属于「删了就没了」的一侧，改动必须走保留链。

## 1. 三层定义

| 层 | 语义 | 位置 | 冲突 / 恢复语义 |
| --- | --- | --- | --- |
| **L1 本地真相** | 用户数据的权威副本：正文（五种 kind）、附件、小记、目录/元数据、标签关系 | 每端本地：SQLite 元数据 + 文件正文 | 本地编辑为准；同步只做镜像收敛，不反向「以云端为准」覆盖本地真相（显式恢复除外） |
| **L2 S3 镜像** | 跨端同步所需的云端投影：pointer + 两个不可变索引 + 每篇资产声明 + 内容寻址正文/附件 | S3 桶内（key 见 §3） | 单写者 + 发布锁 + 读回；内容按 hash/updatedAt、**位置三件套（parentId/trashedAt/deletedFromParentId）独立三方合并**（`SYNC-PROTOCOL.md` §9.5）；远端已发布版本胜出，被覆盖版本先写历史快照 |
| **L3 保留链** | 删除/覆盖后的可恢复副本与恢复账本：回收站软删、历史快照、「云端已删除·仅本地」副本、小记 `purged` 窗口、待补资产账本 | 几乎全在本地；仅小记 `purged[]` 进索引且带 90 天窗口 | 恢复是唯一显式例外（写恢复标记 → local-wins → 重新发布）；窗口到期后不可恢复 |

> 记住三条判据：**「删了能重建」→ 不写兼容（AGENTS §3#7）**；**「云端没有」= 删除（缺席），不是「还没传」**（AGENTS §3#3/#15）；**回收站 ≠ 墓碑**（软删不写墓碑，purge 才是永久删除，AGENTS §3#5）。

## 2. L1 · 本地真相

### 2.1 桌面磁盘（工作区）

工作区根 = `app.getPath("userData")/workspace-default`（开发版 userData = `lakex-local-notes-dev`；正文路径单一来源 `src/core/noteBodyPaths.ts`）。

```text
userData/
├── logs/lakex-local-notes.log       # 日志（不属于工作区）
├── sync-v3/baseline.json.gz         # 设备同步基线（每篇 contentHash）—— L3 账本，绝不上传
├── sync-v3/state.json               # 设备同步状态（删除意图/恢复标记/待补资产）—— L3 账本
└── workspace-default/
    ├── metadata.sqlite3             # 主库（WAL）：元数据 + 本地账本（见 §2.2）
    ├── notes/{noteId}.lake          # 正文 kind=doc（L1，S3 对象 objects/…）
    ├── usheets/{noteId}.usheet.json # 正文 kind=usheet（Univer IWorkbookData）
    ├── bitables/{noteId}.bitable.json # 正文 kind=bitable（自研 record JSON）
    ├── boards/{noteId}.board.json   # 正文 kind=board（Drawnix/Plait 场景）
    ├── inks/{noteId}.ink.json       # 正文 kind=ink（inkDoc v4）
    ├── note-assets/{noteId}/{filename} # 附件/图片（L1，S3 assets/…）
    ├── materials/*.board.json       # 画板自定义素材（**设备本地，不进 S3**；桌面可在素材面板「打开素材文件夹」后自行拷贝/放置画板文档；移动端暂存 localStorage）
    ├── history/{noteId}/*.body.gz   # 历史快照（L3 本地，不进 S3）
    └── quick-notes/                 # 小记空间（与 Lake 空间完全隔离）
        ├── metadata.sqlite3         # 小记库 + 标签域（261107 起）
        ├── items/{quickNoteId}.qnote    # 小记正文（L1，S3 quick-notes/objects/…）
        ├── assets/{quickNoteId}/{filename} # 小记图片（L1，S3 quick-notes/assets/…）
        └── staging/{draftId}/{filename}    # 未保存草稿图片（纯本机）
```

### 2.2 桌面主库（只存元数据/账本/派生）

| 表 | 层 | 说明 |
| --- | --- | --- |
| `notes` / `tree_nodes` | L1 元数据 | 文档与目录元数据（正文在文件）；`sync_state`、`is_conflict`、`deleted_at` 等字段是本端状态 |
| `settings` | 本地配置 | S3/同步/GC/历史/备份/AI 设置；S3 与 AI 密钥经 `secretCipher` 加密（**fail-closed**） |
| `device_state` | L3 账本 | 本机键值：上次打开/同步时间、同步结果、安全模式等 |
| `deleted_notes` | L3 账本 | 本地删除意图/墓碑账本（purge 写 `purged_at` 永久保留，防「重建复活」；**不向云端写墓碑**，v3 用基线 + 意图判「云端缺席」） |
| `note_history` / `history_fallback_state` | L3 保留链 | 历史快照索引与降级状态 |
| `orphan_assets` | L3 派生 | 未引用资源记录（可重算） |
| `s3_gc_log` | L3 派生 | GC 审计日志 |
| `ai_writing_conversations` / `ai_writing_messages` | L1（仅本端） | AI 写作会话（**只存本机，不进同步/搜索/目录树**） |

派生缓存（`text_cache` / `md_cache` / FTS 索引）不属于任何层，重建即可。

### 2.3 小记库（桌面 `quick-notes/metadata.sqlite3`）

`quick_notes` / `quick_note_assets` / `quick_note_sync_base` / `quick_note_deleted` / `quick_note_conversions` / `quick_note_file_ops`，
以及 **标签域**：`tags` / `tag_links` / `tag_link_versions` / `device_state`。

- **标签目录 + 所有关系（含桌面文档标签 `target_kind='note'`）+ 版本 单一归属小记库**（261107 迁移，见 `TAG-SYSTEM-DESIGN.md`）。
- 标签顺序与拖拽记忆是**设备本地视图**，不进 S3（置顶已删除，不要恢复）；标签删除 = 物理删行 = 缺席（**禁止墓碑**）。
- 备份/恢复必须**同时覆盖两库**（`workspaceRestoreFromBackup` 已支持；旧备份无小记库时只恢复主库）。

### 2.4 移动端（App 私有 `Directory.Data`）

```text
files/
├── notes/ usheets/ bitables/ boards/           # 正文（kind 同上，路径同源 noteBodyPaths）
├── note-assets/{noteId}/{filename}             # 文档附件/图片
├── history/{noteId}/*.body.gz                  # 历史快照（L3）
├── quick-notes/items/{id}.qnote                # 小记正文
├── quick-notes/assets/{id}/{filename}          # 小记图片
└── databases/lakex-local-notes-mobile          # Capacitor SQLite：元数据/账本/派生 text_cache+FTS
```

- **正文/快照 = 文件**，由原生 `BodyStore` 原子写（临时文件 + fsync + rename；gzip 在原生做）；SQLite 只存元数据/账本/派生。
- 小记与主库同库（沿用 `qn_*` 表），与桌面「小记独立库」的差异**只是存储表示**，语义一致。
- 旧库（正文在 `notes.content`）升级时**整库重置一次**（AGENTS §3#7），不写兼容读取。
- 移动端 schema 是版本门 + 批量 DDL（`PRAGMA user_version`）；改表/索引必须 +1 版本号。

### 2.5 绝对不进 S3 的设备本地态

| 类别 | 例子（非穷举） |
| --- | --- |
| 同步账本 | `sync-v3/baseline.json.gz`、`sync-v3/state.json`（删除意图/恢复标记/待补资产/小记待删） |
| UI / 视图偏好 | localStorage：`lakex-local-notes-v3.dialog-states`、`…sidebar-width`、`…bitable-nav.<noteId>`、`…quick-notes-sort`、`lakex-local-notes-mobile.pad-panels` 等（完整清单 grep `lakex-local-notes`） |
| 历史 / 回收站状态 | `history/`、`note_history`、`deleted_notes`、回收站父/时间戳等本端表示 |
| 密钥 | S3/AI 密钥（桌面 safeStorage 密文；移动 Keystore 密文）——**永不进 S3、永不导出明文** |
| 同步审计 | 同步记录账本（本机表，500 条 / 90 天轮转） |

## 3. L2 · S3 镜像（v3 对象布局）

单一来源 = `src/core/s3v3/protocol/s3v3Keys.ts`；协议见 `SYNC-PROTOCOL.md` §3–§7。

| 对象 | key（相对前缀） | 可变性 |
| --- | --- | --- |
| 指针 | `meta/pointer.json` | 可变（无条件覆盖；唯一读入口） |
| Lake 索引 | `meta/index/{commit}.json` | 不可变（内容寻址） |
| 小记索引 | `quick-notes/meta/index/{commit}.json` | 不可变 |
| Lake 资产声明 | `meta/assets/{noteId}/{declHash}.json` | 不可变（该文档云端在用集全量快照） |
| 小记资产声明 | `quick-notes/meta/assets/{quickNoteId}/{declHash}.json` | 不可变 |
| Lake 正文 | `objects/{noteId}-{contentHash}.lake` | 不可变（同 hash 幂等） |
| Lake 附件 | `assets/{noteId}/{filename}` | 覆盖写（同名 = 同内容） |
| 小记正文 | `quick-notes/objects/{contentHash}.qnote` | 不可变（跨小记去重） |
| 小记附件 | `quick-notes/assets/{quickNoteId}/{filename}` | 覆盖写 |
| 发布锁 | `meta/lock.json` | 短暂可变 |

- 索引条目只带「文档/小记/标签」的元数据与 `contentHash`/`assetsHash`；**正文和元数据都不再上传独立对象**。
- **删除 = 对象缺席**：purge 按前缀清 `objects/{id}-`、`assets/{id}/`、`meta/assets/{id}/`；无墓碑对象。
- **资产 = 每篇声明差集**：声明永远全量；上传只 PUT 缺失项，下载按 size+sha256 差集（禁止逐对象 HEAD/GET 当存在性判据）。
- **旧 `manifests/latest.json` 是 V2 遗留孤儿**：不读、不迁移、不删除（深清按保留窗口回收）。
- gzip 只用于 `meta/` 与 `quick-notes/meta/` 下的元数据对象（按 key 判定，不看魔数）。

## 4. L3 · 保留链

| 机制 | 语义 | 落点 | 有效期 |
| --- | --- | --- | --- |
| 回收站（软删） | **删除 = 移动进回收站**（位置变更）：写 `trashedAt`（进入时间）+ `deletedFromParentId`（原父/恢复位置）；正文/附件不删、**不写墓碑**（261112：回收站 = 特殊笔记本，协议表述见 `SYNC-PROTOCOL.md` §10.3） | 本地：桌面 `notes.parent_id` 历史实现指向容器 `notebook-trash`（原父记 `deleted_from_parent_id`）；移动端保留原父 + `trashed_at` + `deleted_from_parent_id`。`notebook-trash` **不进云端 `folders[]`、不作为对外 parent 语义** | 默认 90 天自动过期（`trashAutoPurgeDays`；cloud_deleted 副本不豁免） |
| 历史快照 | 远端覆盖本地/删除前留档；小记**没有**历史快照（产品定稿） | `history/{noteId}/*.body.gz` + `note_history` | 按历史保留设置 |
| 「云端已删除·仅本地」 | 他端 purge 后本机保留的只读副本（只读、可恢复、不参与 S3，唯一例外是显式恢复） | 本地回收站 + `cloud_deleted` 投影 | 直到用户 purge / 显式恢复 / 云端同 id 复活 |
| 小记 `purged[]` | 唯一类墓碑：只存 id，表示「不可恢复删除」 | 小记索引（**90 天窗口** `pruneQuickPurgedIds`） | 90 天（缺失/非法时间保守保留） |
| 待补资产账本 | 附件下载失败重试账本 | `state.pendingAssets`（本机） | 下一轮重试；`attempts>3` 丢弃、上限 500 |
| 深清 | 对比 pointer/索引/声明回收不可达对象 | `deepCleanup`（手动/定时，串行维护队列） | 保留窗口内不删 |

**恢复路径**：回收站恢复 → 写恢复标记（`notes.restore_pending_at` / `quick_notes.restore_pending_at`）→ local-wins 重新发布并清标记；云端已删副本只能本机恢复；历史快照用于「被远端覆盖」的找回；**从未持有过副本的设备无法恢复**（用户已接受）。

## 5. 新增持久化检查清单

- [ ] **要跨端吗？** 要 → 进 L2，但只能改协议（`src/core/s3v3/protocol/` + 索引/声明 + `SYNC-PROTOCOL.md`），并想清冲突（LWW/删除=缺席/恢复例外）与上限。
- [ ] **同步/恢复需要但跨端无意义？** → L3 账本（本机表/文件），**不进索引**。
- [ ] **只是本机 UI/缓存/历史？** → 纯本机；派生类必须可重建。
- [ ] 是否触碰红线？AGENTS §3#3/#4/#5/#11/#15/#16（删除压编辑=缺席 / 恢复例外 / 回收站≠墓碑 / 资产声明差集 / purge 永久判定 / 打开入口判回收站）。
- [ ] **写路径分层**：新增写守卫必须声明调用方分类（用户/同步/导入/恢复/维护）；面向用户的策略守卫**不得下沉到两端共用的底层写函数**——同步镜像写走专用路径（`SYNC-PROTOCOL.md` §9.6）。
- [ ] **位置字段**：涉及 parentId/trashedAt/deletedFromParentId 的改动按 §9.5 独立合并判定，不要跟内容赢家绑在一起。
- [ ] 有没有把「每端独立」误做成「跨端同步」（或反之）？设置类默认每端独立。
- [ ] 移动端加表/索引是否 +1 schema 版本、是否只改 `baseSchemaStatements`/`collectSchemaStatements`？

## 6. 已知漂移教训（防再犯）

- 注释曾把文档/分组图标写成「本地化，不进 manifest」，实际一直在同步 —— **注释会漂移，故本文作为单一来源**。
- 曾把「恢复前留档」注释成 `force=true`，实际 `force=false`（24h 同 hash 防抖）。
- V2 时代的 `manifests/latest.json`、`manifestTypes`、`deleted_notes = 同步墓碑` 等描述已全部过期；**遇到旧文档/旧注释按 v3 判据核对**（云端无墓碑，删除 = 缺席）。
